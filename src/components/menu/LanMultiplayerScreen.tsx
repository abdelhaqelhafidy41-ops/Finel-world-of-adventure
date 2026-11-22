import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Crown,
  DoorOpen,
  Flame,
  FolderOpen,
  Hammer,
  Info,
  Play,
  PlusCircle,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserMinus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import {
  DEFAULT_LAN_PORT,
  MAX_LAN_PLAYERS,
  discoverLanGames,
  getLanCapabilities,
  getLanHostStatus,
  getLocalLanIp,
  normalizeLanBaseUrl,
  probeLanHost,
  startLanHost,
  stopLanHost,
  type DiscoveredLanHost,
} from '../../game/multiplayer/LanMultiplayerManager';
import {
  loadSavedMultiplayerName,
  saveMultiplayerName,
} from '../../game/multiplayer/MultiplayerService';
import { isSwitchingMultiplayerTransport } from '../../game/multiplayer/MultiplayerTransport';
import { copyTextToClipboard } from '../../game/multiplayer/inviteUtils';
import {
  MultiplayerJoinError,
  type IMultiplayerService,
  type MultiplayerConnectionState,
  type MultiplayerGameStartInfo,
  type MultiplayerRoomState,
} from '../../game/multiplayer/multiplayerTypes';
import { ProfileManager } from '../../game/profile/ProfileManager';
import { LoadManager } from '../../game/save/LoadManager';
import { buildLanRoomSeedFromSaveData } from '../../game/save/LocalWorldStorage';
import { generateWorldId } from '../../game/save/SaveManager';
import type {
  DifficultyLevel,
  SaveGameData,
  SaveGameMeta,
  SaveSlotId,
  WorldType,
} from '../../game/save/saveTypes';
import { RoomChatPanel } from '../multiplayer/RoomChatPanel';
import { MainMenuButton } from './MainMenuButton';

type LanSubView = 'lanHub' | 'lanCreate' | 'lanJoin' | 'lanLobby';

interface LanMultiplayerScreenProps {
  lang: Language;
  service: IMultiplayerService;
  savedWorlds?: SaveGameMeta[];
  initialHostWorldSlotId?: SaveSlotId | null;
  onConsumeInitialHostWorld?: () => void;
  onPrepareHostWorld?: (info: {
    hostWorldSlotId: SaveSlotId | null;
    savedWorldData: SaveGameData | null;
  }) => void;
  onStartMultiplayerWorld?: (info: MultiplayerGameStartInfo) => void;
  onBack: () => void;
}

export const LanMultiplayerScreen: React.FC<LanMultiplayerScreenProps> = ({
  lang,
  service,
  savedWorlds = [],
  initialHostWorldSlotId = null,
  onConsumeInitialHostWorld,
  onPrepareHostWorld,
  onStartMultiplayerWorld,
  onBack,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const isAr = lang === 'ar';
  const caps = useMemo(() => getLanCapabilities(), []);
  const transport = isSwitchingMultiplayerTransport(service) ? service : null;

  const initialLanRoom =
    transport?.getActiveMode() === 'lan' ? service.getRoomState() : null;

  const [subView, setSubView] = useState<LanSubView>(() =>
    initialLanRoom
      ? 'lanLobby'
      : initialHostWorldSlotId && caps.canHost
        ? 'lanCreate'
        : 'lanHub',
  );
  const [playerName, setPlayerName] = useState<string>(() => {
    const p = ProfileManager.getProfile();
    return (
      p?.displayName ||
      loadSavedMultiplayerName(isAr ? 'مغامر' : 'Adventurer')
    );
  });

  // Create LAN state
  const [worldSource, setWorldSource] = useState<'new' | 'saved'>(() =>
    initialHostWorldSlotId && savedWorlds.some((w) => w.slotId === initialHostWorldSlotId)
      ? 'saved'
      : 'new',
  );
  const [selectedSavedWorldId, setSelectedSavedWorldId] = useState<SaveSlotId>(
    () =>
      (initialHostWorldSlotId &&
      savedWorlds.some((w) => w.slotId === initialHostWorldSlotId)
        ? initialHostWorldSlotId
        : savedWorlds[0]?.slotId) ?? '',
  );
  const [worldName, setWorldName] = useState<string>(() => {
    const matched = initialHostWorldSlotId
      ? savedWorlds.find((w) => w.slotId === initialHostWorldSlotId)
      : null;
    return matched?.worldName || (isAr ? 'عالم الشبكة المحلية' : 'LAN Adventure World');
  });
  const [worldType, setWorldType] = useState<WorldType>(() => {
    const matched = initialHostWorldSlotId
      ? savedWorlds.find((w) => w.slotId === initialHostWorldSlotId)
      : null;
    return matched?.worldType ?? 'normal';
  });
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    const matched = initialHostWorldSlotId
      ? savedWorlds.find((w) => w.slotId === initialHostWorldSlotId)
      : null;
    return matched?.difficulty ?? 'normal';
  });
  const [creatingHost, setCreatingHost] = useState(false);

  useEffect(() => {
    if (!initialHostWorldSlotId) return;
    const matched = savedWorlds.find((w) => w.slotId === initialHostWorldSlotId);
    if (matched) {
      setWorldSource('saved');
      setSelectedSavedWorldId(matched.slotId);
      setWorldName(matched.worldName);
      setWorldType(matched.worldType);
      setDifficulty(matched.difficulty);
    }
    if (caps.canHost && !initialLanRoom) {
      setSubView('lanCreate');
    }
    onConsumeInitialHostWorld?.();
  }, [
    caps.canHost,
    initialHostWorldSlotId,
    initialLanRoom,
    onConsumeInitialHostWorld,
    savedWorlds,
  ]);

  // Join LAN state
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredLanHost[]>([]);
  const [scanningLan, setScanningLan] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState(String(DEFAULT_LAN_PORT));
  const [manualCode, setManualCode] = useState('');
  const [joiningLan, setJoiningLan] = useState(false);

  // Active LAN lobby state
  const [activeRoom, setActiveRoom] = useState<MultiplayerRoomState | null>(
    () => initialLanRoom,
  );
  const [hostLanAddress, setHostLanAddress] = useState<string | null>(null);
  const [localIpHint, setLocalIpHint] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<MultiplayerConnectionState>(() => service.getConnectionState());
  const [startingGame, setStartingGame] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const clearNotices = useCallback(() => {
    setStatusNotice(null);
    setErrorNotice(null);
  }, []);

  // Fetch local Wi-Fi IP & any running host address for display
  useEffect(() => {
    let active = true;
    void (async () => {
      const [ip, status] = await Promise.all([
        getLocalLanIp(),
        getLanHostStatus(),
      ]);
      if (!active) return;
      if (ip) setLocalIpHint(ip);
      if (status.running && status.ip) {
        setHostLanAddress(`${status.ip}:${status.port}`);
      } else if (transport?.getLanBaseUrl()) {
        setHostLanAddress(
          transport.getLanBaseUrl()!.replace(/^https?:\/\//i, ''),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [transport]);

  // Subscribe to multiplayer events while on LAN screen
  useEffect(() => {
    const unsub = service.subscribe((ev) => {
      if (ev.type === 'connection-changed') {
        setConnectionState(ev.state);
        if (ev.state === 'error' || ev.state === 'reconnecting') {
          setStartingGame(false);
        }
      } else if (ev.type === 'room-updated') {
        setActiveRoom(ev.room);
      } else if (ev.type === 'room-closed') {
        setActiveRoom(null);
        setHostLanAddress(null);
        transport?.setLanDisplayAddress(null);
        setSubView('lanHub');
        setStatusNotice(
          isAr
            ? 'تم إيقاف الخادم المحلي من صاحب الغرفة.'
            : 'The host has stopped the local server.',
        );
      } else if (ev.type === 'player-kicked') {
        if (ev.isLocalTarget) {
          setActiveRoom(null);
          setSubView('lanHub');
          setErrorNotice(
            isAr
              ? 'تم إخراجك من غرفة الشبكة المحلية.'
              : 'You were removed from the LAN game.',
          );
        }
      } else if (ev.type === 'game-started') {
        setStartingGame(false);
        onStartMultiplayerWorld?.(ev.info);
      } else if (ev.type === 'error') {
        setStartingGame(false);
        setErrorNotice(ev.message);
      }
    });
    return unsub;
  }, [isAr, onStartMultiplayerWorld, service]);

  const scanForLanGames = useCallback(async () => {
    if (!caps.canAutoDiscover) return;
    setScanningLan(true);
    try {
      const found = await discoverLanGames(1600);
      setDiscoveredHosts(found);
    } catch {
      setDiscoveredHosts([]);
    } finally {
      setScanningLan(false);
    }
  }, [caps.canAutoDiscover]);

  useEffect(() => {
    if (subView === 'lanJoin' && caps.canAutoDiscover) {
      void scanForLanGames();
    }
  }, [caps.canAutoDiscover, scanForLanGames, subView]);

  const handlePlayerNameChange = (val: string) => {
    setPlayerName(val);
    saveMultiplayerName(val);
  };

  const handleCreateLanGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingHost) return;
    clearNotices();

    const cleanedPlayer = playerName.trim() || (isAr ? 'مغامر' : 'Adventurer');
    const cleanedWorld =
      worldName.trim() || (isAr ? 'عالم الشبكة المحلية' : 'LAN Adventure World');
    saveMultiplayerName(cleanedPlayer);

    if (!caps.canHost) {
      setErrorNotice(
        caps.limitationReason ||
          (isAr
            ? 'استضافة الشبكة المحلية تتطلب تطبيق Windows أو Android.'
            : 'Hosting an Offline LAN server requires the Windows Desktop or Android app.'),
      );
      return;
    }

    setCreatingHost(true);
    try {
      let hostWorldSlotId: SaveSlotId | null = null;
      let savedWorldData: SaveGameData | null = null;
      let seedPayload: ReturnType<typeof buildLanRoomSeedFromSaveData> | null = null;

      if (worldSource === 'saved') {
        const targetSavedId = selectedSavedWorldId || savedWorlds[0]?.slotId;
        if (!targetSavedId) {
          setErrorNotice(t.lanNoSavedWorldsHint);
          return;
        }
        const loader = new LoadManager();
        const loaded = await loader.loadSlotAsync(targetSavedId);
        if (!loaded.ok) {
          setErrorNotice(t.loadFailedNotice);
          return;
        }
        savedWorldData = loaded.data;
        hostWorldSlotId = loaded.data.meta.slotId;
        seedPayload = buildLanRoomSeedFromSaveData(loaded.data);
      } else {
        hostWorldSlotId = generateWorldId();
      }

      const resolvedWorldName = (
        seedPayload?.worldName || cleanedWorld
      ).slice(0, 36);
      const resolvedWorldType = seedPayload?.worldType ?? worldType;
      const resolvedDifficulty = seedPayload?.difficulty ?? difficulty;
      const resolvedSeed =
        seedPayload?.seed ?? Math.floor(100000 + Math.random() * 899999);

      const hostRes = await startLanHost(
        {
          roomName: resolvedWorldName,
          hostName: cleanedPlayer.slice(0, 24),
          worldName: resolvedWorldName,
          worldType: resolvedWorldType,
          difficulty: resolvedDifficulty,
          seed: resolvedSeed,
          ...(seedPayload
            ? {
                worldTime: seedPayload.worldTime as any,
                worldWeather: seedPayload.worldWeather,
                savedWorldState: seedPayload.savedWorldState,
              }
            : {}),
        },
        DEFAULT_LAN_PORT,
      );

      if (!hostRes.ok || !hostRes.baseUrl) {
        const msg = [hostRes.error, hostRes.firewallHint]
          .filter(Boolean)
          .join(' ');
        setErrorNotice(
          msg ||
            (isAr
              ? 'فشل تشغيل خادم الشبكة المحلية على هذا الجهاز.'
              : 'Failed to start local LAN server on this device.'),
        );
        return;
      }

      if (transport) {
        const localLoopbackUrl = `http://127.0.0.1:${hostRes.port}`;
        transport.useLanMode(localLoopbackUrl);
      }

      const createdRoom = await service.createRoom({
        roomName: resolvedWorldName,
        playerName: cleanedPlayer.slice(0, 24),
        worldName: resolvedWorldName,
        worldType: resolvedWorldType,
        difficulty: resolvedDifficulty,
        seed: resolvedSeed,
        ...(seedPayload
          ? {
              worldTime: seedPayload.worldTime,
              worldWeather: seedPayload.worldWeather,
              savedWorldState: seedPayload.savedWorldState,
            }
          : {}),
        maxPlayers: MAX_LAN_PLAYERS,
        privacy: 'public',
        isPrivate: false,
        allowFriends: true,
        requireAllReady: false,
        friendlyFire: false,
      });

      onPrepareHostWorld?.({
        hostWorldSlotId,
        savedWorldData,
      });

      const displayAddr = hostRes.ip
        ? `${hostRes.ip}:${hostRes.port}`
        : hostRes.baseUrl.replace(/^https?:\/\//i, '');
      setHostLanAddress(displayAddr);
      transport?.setLanDisplayAddress(displayAddr);
      setActiveRoom(createdRoom);
      setStatusNotice(
        isAr
          ? 'تم إنشاء لعبة الشبكة المحلية! يمكن للأجهزة على نفس شبكة Wi-Fi الانضمام الآن.'
          : 'LAN GAME CREATED — Devices on the same Wi-Fi network can join now.',
      );
      setSubView('lanLobby');
    } catch (err) {
      await stopLanHost();
      onPrepareHostWorld?.({ hostWorldSlotId: null, savedWorldData: null });
      setErrorNotice(
        err instanceof Error
          ? err.message
          : isAr
            ? 'تعذر إنشاء لعبة الشبكة المحلية.'
            : 'Unable to create LAN game.',
      );
    } finally {
      setCreatingHost(false);
    }
  };

  const connectToLanTarget = useCallback(
    async (baseUrl: string, rawCode?: string) => {
      if (joiningLan) return;
      clearNotices();
      onPrepareHostWorld?.({ hostWorldSlotId: null, savedWorldData: null });

      const cleanedPlayer = playerName.trim() || (isAr ? 'مغامر' : 'Adventurer');
      saveMultiplayerName(cleanedPlayer);

      setJoiningLan(true);
      try {
        const probe = await probeLanHost(baseUrl, 4000);
        if (!probe.ok) {
          setErrorNotice(
            probe.error ||
              (isAr
                ? 'تعذر الوصول إلى مضيف الشبكة المحلية. تأكد من الاتصال بنفس شبكة Wi-Fi.'
                : 'Could not reach LAN host. Make sure both devices are on the same Wi-Fi network.'),
          );
          return;
        }

        if (
          typeof probe.playerCount === 'number' &&
          typeof probe.maxPlayers === 'number' &&
          probe.playerCount >= probe.maxPlayers
        ) {
          setErrorNotice(
            isAr
              ? `لعبة الشبكة المحلية ممتلئة (${probe.playerCount}/${probe.maxPlayers}).`
              : `LAN GAME FULL (${probe.playerCount}/${probe.maxPlayers} players).`,
          );
          return;
        }

        const effectiveCode = (rawCode || '').trim() || probe.roomCode || '';
        if (!effectiveCode) {
          setErrorNotice(
            isAr
              ? 'أدخل رمز الشبكة المحلية للانضمام.'
              : 'Enter the LAN Code shown on the host screen.',
          );
          return;
        }

        if (transport) {
          transport.useLanMode(baseUrl);
        }

        const joined = await service.joinRoom({
          roomCodeOrId: effectiveCode,
          playerName: cleanedPlayer.slice(0, 24),
        });

        const joinedAddr = baseUrl.replace(/^https?:\/\//i, '');
        setHostLanAddress(joinedAddr);
        transport?.setLanDisplayAddress(joinedAddr);
        setActiveRoom(joined);
        setSubView('lanLobby');
      } catch (err) {
        if (err instanceof MultiplayerJoinError && err.code === 'ROOM_FULL') {
          setErrorNotice(
            isAr
              ? 'لعبة الشبكة المحلية ممتلئة (الحد الأقصى 4 لاعبين).'
              : 'LAN GAME FULL (Maximum 4 players per LAN session).',
          );
        } else if (
          err instanceof MultiplayerJoinError &&
          err.code === 'GAME_ALREADY_STARTED'
        ) {
          setErrorNotice(
            isAr
              ? 'بدأت هذه اللعبة بالفعل.'
              : 'This LAN game has already started.',
          );
        } else if (
          err instanceof MultiplayerJoinError &&
          err.code === 'ROOM_NOT_FOUND'
        ) {
          setErrorNotice(
            isAr
              ? 'رمز الشبكة المحلية غير صحيح أو الغرفة غير موجودة.'
              : 'Invalid LAN code or room not found on that host.',
          );
        } else {
          setErrorNotice(
            err instanceof Error
              ? err.message
              : isAr
                ? 'فشل الاتصال بلعبة الشبكة المحلية.'
                : 'Failed to join LAN game.',
          );
        }
      } finally {
        setJoiningLan(false);
      }
    },
    [clearNotices, isAr, joiningLan, playerName, service, transport],
  );

  const handleManualJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeLanBaseUrl(manualIp, manualPort);
    if (!normalized) {
      setErrorNotice(
        isAr
          ? 'أدخل عنوان IP محلي صحيح مثل 192.168.1.25'
          : 'Enter a valid local IP address (e.g. 192.168.1.25).',
      );
      return;
    }
    await connectToLanTarget(normalized, manualCode);
  };

  const handleLeaveLanRoom = async () => {
    clearNotices();
    onPrepareHostWorld?.({ hostWorldSlotId: null, savedWorldData: null });
    try {
      await service.leaveRoom();
    } catch {
      // Ignore cleanup errors
    }
    await stopLanHost();
    setActiveRoom(null);
    setHostLanAddress(null);
    setSubView('lanHub');
  };

  const handleBackNavigation = () => {
    clearNotices();
    if (subView === 'lanLobby') {
      void handleLeaveLanRoom();
      return;
    }
    if (subView === 'lanCreate' || subView === 'lanJoin') {
      setSubView('lanHub');
      return;
    }
    onBack();
  };

  const handleToggleReady = async () => {
    if (!activeRoom) return;
    const localP = activeRoom.players.find((p) => p.isLocal);
    const updated = await service.setReady(!(localP?.isReady ?? false));
    if (updated) setActiveRoom(updated);
  };

  const handleStartLanGame = async () => {
    if (startingGame) return;
    clearNotices();
    setStartingGame(true);
    try {
      await service.startGame();
    } catch (err) {
      setStartingGame(false);
      setErrorNotice(
        err instanceof Error
          ? err.message
          : isAr
            ? 'تعذر بدء اللعبة.'
            : 'Failed to start LAN game.',
      );
    }
  };

  const handleCopyAddress = async () => {
    if (!hostLanAddress) return;
    const ok = await copyTextToClipboard(hostLanAddress);
    if (ok) {
      setCopiedAddress(true);
      window.setTimeout(() => setCopiedAddress(false), 1800);
    }
  };

  const handleCopyCode = async () => {
    if (!activeRoom?.roomCode) return;
    const ok = await copyTextToClipboard(activeRoom.roomCode);
    if (ok) {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    }
  };

  const localPlayer = activeRoom?.players.find((p) => p.isLocal) ?? null;
  const isLocalHost = Boolean(
    activeRoom &&
      (localPlayer?.isHost ||
        (service.getLocalPlayerId() &&
          activeRoom.hostId === service.getLocalPlayerId())),
  );

  const worldTypes: Array<{
    id: WorldType;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'normal', label: t.worldTypeNormal, icon: <Compass className="w-4 h-4" /> },
    { id: 'survival', label: t.worldTypeSurvival, icon: <Flame className="w-4 h-4" /> },
    { id: 'adventure', label: t.worldTypeAdventure, icon: <Sparkles className="w-4 h-4" /> },
    { id: 'creative', label: t.worldTypeCreative, icon: <Hammer className="w-4 h-4" /> },
  ];

  const difficulties: Array<{ id: DifficultyLevel; label: string }> = [
    { id: 'easy', label: isAr ? 'سهل' : 'Easy' },
    { id: 'normal', label: isAr ? 'عادي' : 'Normal' },
    { id: 'hard', label: isAr ? 'صعب' : 'Hard' },
  ];

  return (
    <div className="space-y-4" data-testid="lan-multiplayer-screen">
      {/* Offline LAN Mode Banner */}
      <div className="p-3.5 rounded-xl bg-[#11261b] border border-[#3d7a58]/55 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#193b28] border border-[#7fe094]/40 flex items-center justify-center shrink-0">
            <Wifi className="w-5 h-5 text-[#7fe094]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display font-bold text-sm sm:text-base text-[#e9f7ed]">
                {isAr ? 'اللعب المحلي (OFFLINE LAN)' : 'OFFLINE LAN'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#183926] border border-[#7fe094]/45 text-[10px] font-bold tracking-wide text-[#9ef0b0] uppercase">
                {isAr ? 'بدون إنترنت' : 'No Internet Required'}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-[#9dc4a8] mt-0.5">
              {isAr
                ? `وصّل جميع الأجهزة بنفس شبكة Wi-Fi · الحد الأقصى ${MAX_LAN_PLAYERS} لاعبين`
                : `Connect all devices to the same Wi-Fi network · Max ${MAX_LAN_PLAYERS} Players`}
            </p>
          </div>
        </div>
        {localIpHint && (
          <div
            dir="ltr"
            className="text-[11px] font-mono-num px-2.5 py-1 rounded-lg bg-[#0b1811] border border-white/10 text-[#9db1a1]"
          >
            Wi-Fi IP: <span className="text-[#e8efe5]">{localIpHint}</span>
          </div>
        )}
      </div>

      {/* Notices */}
      {(statusNotice || errorNotice) && (
        <div
          role="status"
          data-testid="lan-status-banner"
          className={`p-3 rounded-xl border text-xs sm:text-sm flex items-start gap-2.5 ${
            errorNotice
              ? 'bg-[#2a1618]/90 border-[#e05a47]/40 text-[#f6d5d0]'
              : 'bg-[#13291e]/90 border-[#7fe094]/35 text-[#dcf5e3]'
          }`}
        >
          {errorNotice ? (
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-[#f28b7d]" />
          ) : (
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[#7fe094]" />
          )}
          <span className="leading-snug">{errorNotice ?? statusNotice}</span>
        </div>
      )}

      {/* 1. LAN HUB */}
      {subView === 'lanHub' && (
        <div className="space-y-4" data-testid="lan-hub-view">
          <div>
            <label
              htmlFor="lan-player-name"
              className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5"
            >
              {t.mpPlayerNameLabel}
            </label>
            <input
              id="lan-player-name"
              type="text"
              maxLength={24}
              value={playerName}
              onChange={(e) => handlePlayerNameChange(e.target.value)}
              placeholder={t.mpPlayerNamePlaceholder}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-[#f7faf5] placeholder-[#687e6d]"
            />
          </div>

          {!caps.canHost && caps.limitationReason && (
            <div className="p-3 rounded-xl bg-[#272011] border border-[#e5a93c]/40 text-xs text-[#f5dba1] flex items-start gap-2.5">
              <WifiOff className="w-4 h-4 mt-0.5 shrink-0 text-[#e5a93c]" />
              <p className="leading-relaxed">{caps.limitationReason}</p>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            <MainMenuButton
              testId="lan-btn-create"
              label={isAr ? 'إنشاء لعبة LAN' : 'CREATE LAN GAME'}
              icon={<PlusCircle className="w-5 h-5" />}
              variant="primary"
              isRtl={isRtl}
              onClick={() => {
                clearNotices();
                if (!caps.canHost) {
                  setErrorNotice(
                    caps.limitationReason ||
                      (isAr
                        ? 'استضافة الشبكة المحلية تتطلب تطبيق Windows أو Android.'
                        : 'Hosting an Offline LAN server requires the Windows Desktop or Android app.'),
                  );
                  return;
                }
                setSubView('lanCreate');
              }}
            />

            <MainMenuButton
              testId="lan-btn-join"
              label={isAr ? 'الانضمام للعبة LAN' : 'JOIN LAN GAME'}
              icon={<DoorOpen className="w-5 h-5" />}
              isRtl={isRtl}
              onClick={() => {
                clearNotices();
                setSubView('lanJoin');
              }}
            />

            <MainMenuButton
              testId="lan-btn-back"
              label={t.backBtn}
              icon={
                <ArrowLeft className={`w-5 h-5 ${isRtl ? 'rotate-180' : ''}`} />
              }
              isRtl={isRtl}
              onClick={handleBackNavigation}
            />
          </div>
        </div>
      )}

      {/* 2. CREATE LAN GAME */}
      {subView === 'lanCreate' && (
        <form
          onSubmit={handleCreateLanGame}
          className="space-y-4"
          data-testid="lan-create-view"
        >
          {/* New World vs Saved World Selector */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="lan-source-new"
              onClick={() => {
                setWorldSource('new');
                clearNotices();
              }}
              className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition ${
                worldSource === 'new'
                  ? 'bg-[#1a3c2a] border-[#7fe094] text-[#e9f7ed]'
                  : 'bg-[#0c1712] border-[#263e31] text-[#a7bca9] hover:border-[#3c624d]'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t.lanWorldSourceNew}</span>
            </button>
            <button
              type="button"
              data-testid="lan-source-saved"
              onClick={() => {
                setWorldSource('saved');
                clearNotices();
                if (!selectedSavedWorldId && savedWorlds[0]) {
                  setSelectedSavedWorldId(savedWorlds[0].slotId);
                  setWorldName(savedWorlds[0].worldName);
                  setWorldType(savedWorlds[0].worldType);
                  setDifficulty(savedWorlds[0].difficulty);
                }
              }}
              className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition ${
                worldSource === 'saved'
                  ? 'bg-[#1a3c2a] border-[#7fe094] text-[#e9f7ed]'
                  : 'bg-[#0c1712] border-[#263e31] text-[#a7bca9] hover:border-[#3c624d]'
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              <span>
                {t.lanWorldSourceSaved}
                {savedWorlds.length > 0 ? ` (${savedWorlds.length})` : ''}
              </span>
            </button>
          </div>

          {worldSource === 'saved' ? (
            <div className="space-y-2.5">
              <span className="block text-xs sm:text-sm font-semibold text-[#e6eee4]">
                {t.lanSelectSavedWorld}
              </span>
              {savedWorlds.length === 0 ? (
                <div className="p-3.5 rounded-xl bg-[#0c1611] border border-dashed border-[#2b4436] text-xs text-[#9db1a1]">
                  {t.lanNoSavedWorldsHint}
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                  {savedWorlds.map((w) => {
                    const active = (selectedSavedWorldId || savedWorlds[0]?.slotId) === w.slotId;
                    return (
                      <button
                        key={w.slotId}
                        type="button"
                        data-testid={`lan-saved-world-item-${w.slotId}`}
                        onClick={() => {
                          setSelectedSavedWorldId(w.slotId);
                          setWorldName(w.worldName);
                          setWorldType(w.worldType);
                          setDifficulty(w.difficulty);
                        }}
                        className={`w-full p-3 rounded-xl border text-start transition cursor-pointer flex items-center justify-between gap-3 ${
                          active
                            ? 'bg-[#173524] border-[#7fe094] text-[#eef7f0]'
                            : 'bg-[#0c1611] border-[#274033] text-[#c7d6c6] hover:border-[#3c624d]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm truncate">
                            {w.worldName}
                          </div>
                          <div className="text-[11px] text-[#9db1a1] mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="uppercase">{w.worldType}</span>
                            <span>·</span>
                            <span>
                              {t.levelShort}
                              {w.level}
                            </span>
                            <span>·</span>
                            <span dir="ltr" className="font-mono-num">
                              #{w.worldSeed}
                            </span>
                          </div>
                        </div>
                        {active && (
                          <CheckCircle2 className="w-4 h-4 text-[#7fe094] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-[#9dc4a8]">{t.lanSavedWorldHostNote}</p>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="lan-world-name"
                  className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5"
                >
                  {isAr ? 'اسم العالم' : 'World Name'}
                </label>
                <input
                  id="lan-world-name"
                  type="text"
                  maxLength={36}
                  value={worldName}
                  onChange={(e) => setWorldName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0a140f] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm text-[#f7faf5]"
                />
              </div>

              <div>
                <span className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5">
                  {isAr ? 'نمط العالم' : 'World Mode'}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {worldTypes.map((wt) => (
                    <button
                      key={wt.id}
                      type="button"
                      onClick={() => setWorldType(wt.id)}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                        worldType === wt.id
                          ? 'bg-[#1a3c2a] border-[#7fe094] text-[#e9f7ed]'
                          : 'bg-[#0c1712] border-[#263e31] text-[#a7bca9] hover:border-[#3c624d]'
                      }`}
                    >
                      {wt.icon}
                      <span>{wt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5">
                    {isAr ? 'الصعوبة' : 'Difficulty'}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {difficulties.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDifficulty(d.id)}
                        className={`min-h-[40px] px-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                          difficulty === d.id
                            ? 'bg-[#2a2313] border-[#e5a93c] text-[#f7d488]'
                            : 'bg-[#0c1712] border-[#263e31] text-[#a7bca9]'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs sm:text-sm font-semibold text-[#e6eee4] mb-1.5">
                    {isAr ? 'الحد الأقصى للاعبين' : 'Max Players'}
                  </span>
                  <div className="min-h-[40px] px-3 rounded-xl bg-[#0c1712] border border-[#2f493b] flex items-center justify-between text-xs text-[#dce5d8]">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-[#7fe094]" />
                      {isAr ? '4 لاعبين (المضيف + 3)' : '4 Players (Host + 3)'}
                    </span>
                    <span className="font-mono-num font-bold text-[#7fe094]">
                      MAX {MAX_LAN_PLAYERS}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="submit"
              disabled={creatingHost || (worldSource === 'saved' && savedWorlds.length === 0)}
              data-testid="lan-submit-create"
              className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-white font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>
                {creatingHost
                  ? isAr
                    ? 'جاري تشغيل خادم LAN...'
                    : 'Starting LAN Host...'
                  : isAr
                    ? 'بدء استضافة LAN'
                    : 'START LAN HOST'}
              </span>
            </button>
            <button
              type="button"
              onClick={handleBackNavigation}
              className="min-h-[46px] px-4 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 text-xs font-semibold text-[#dce5d8] cursor-pointer"
            >
              {t.backBtn}
            </button>
          </div>
        </form>
      )}

      {/* 3. JOIN LAN GAME */}
      {subView === 'lanJoin' && (
        <div className="space-y-4" data-testid="lan-join-view">
          {/* Auto-Discovered LAN Games */}
          <div className="p-3.5 rounded-xl bg-[#0b1611] border border-[#274033] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Radio
                  className={`w-4 h-4 text-[#7fe094] ${scanningLan ? 'animate-pulse' : ''}`}
                />
                <h3 className="font-display font-bold text-xs sm:text-sm uppercase tracking-wide text-[#e9f7ed]">
                  {isAr ? 'ألعاب LAN المكتشفة' : 'LAN GAMES FOUND'}
                </h3>
              </div>
              {caps.canAutoDiscover && (
                <button
                  type="button"
                  onClick={() => void scanForLanGames()}
                  disabled={scanningLan}
                  data-testid="lan-refresh-btn"
                  className="min-h-[34px] px-3 rounded-lg bg-[#16291f] hover:bg-[#1f392b] border border-[#345443] text-xs font-semibold text-[#dce5d8] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${scanningLan ? 'animate-spin' : ''}`}
                  />
                  <span>{isAr ? 'تحديث' : 'Refresh'}</span>
                </button>
              )}
            </div>

            {!caps.canAutoDiscover ? (
              <p className="text-xs text-[#9db1a1]">
                {isAr
                  ? 'الاكتشاف التلقائي عبر Wi-Fi متاح في تطبيق Windows أو Android. يمكنك الإدخال اليدوي أدناه.'
                  : 'Automatic Wi-Fi discovery is available in the Windows Desktop and Android apps. Use manual IP join below if supported.'}
              </p>
            ) : scanningLan && discoveredHosts.length === 0 ? (
              <p className="text-xs text-[#9db1a1]">
                {isAr
                  ? 'جاري البحث عن ألعاب على شبكة Wi-Fi المحلية...'
                  : 'Scanning local Wi-Fi network for LAN games...'}
              </p>
            ) : discoveredHosts.length === 0 ? (
              <p className="text-xs text-[#9db1a1]">
                {isAr
                  ? 'لم يتم العثور على ألعاب LAN تلقائياً. تأكد أن المضيف على نفس شبكة Wi-Fi أو أدخل عنوان IP يدوياً.'
                  : 'No LAN games discovered yet. Ensure the host is on the same Wi-Fi network or enter the host IP manually below.'}
              </p>
            ) : (
              <div className="space-y-2">
                {discoveredHosts.map((host) => {
                  const isFull = host.playerCount >= host.maxPlayers;
                  return (
                    <div
                      key={`${host.ip}:${host.port}:${host.roomCode}`}
                      className="p-3 rounded-xl bg-[#112018] border border-[#2d4a3a] flex items-center justify-between gap-3 flex-wrap"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-bold text-sm text-white truncate">
                            {host.worldName || host.roomName}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#183926] border border-[#7fe094]/45 text-[10px] font-bold text-[#9ef0b0]">
                            LAN
                          </span>
                          <span className="text-[11px] font-mono-num text-[#e5a93c]">
                            {host.playerCount} / {host.maxPlayers}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#9db1a1] mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>
                            {isAr ? 'المضيف:' : 'Host:'} {host.hostName}
                          </span>
                          <span>·</span>
                          <span className="uppercase">{host.worldType}</span>
                          <span>·</span>
                          <span dir="ltr" className="font-mono-num">
                            {host.ip}:{host.port}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isFull || joiningLan}
                        onClick={() =>
                          void connectToLanTarget(host.baseUrl, host.roomCode)
                        }
                        className="min-h-[38px] px-3.5 rounded-lg bg-[#276d46] hover:bg-[#318656] disabled:bg-[#2a1a1c] disabled:text-[#f28b7d] disabled:border-[#e05a47]/40 border border-[#7fe094]/55 text-xs font-display font-bold text-white cursor-pointer"
                      >
                        {isFull
                          ? isAr
                            ? 'ممتلئ (4/4)'
                            : 'LAN GAME FULL'
                          : isAr
                            ? 'انضمام'
                            : 'JOIN'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Manual IP / Code Join */}
          <form
            onSubmit={handleManualJoinSubmit}
            className="p-3.5 rounded-xl bg-[#0b1611] border border-[#274033] space-y-3"
          >
            <h3 className="font-display font-bold text-xs sm:text-sm uppercase tracking-wide text-[#e9f7ed]">
              {isAr ? 'الانضمام المباشر عبر IP' : 'Direct Wi-Fi IP / Code Join'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label
                  htmlFor="lan-manual-ip"
                  className="block text-[11px] font-semibold text-[#c9d7cb] mb-1"
                >
                  {isAr ? 'عنوان IP للمضيف' : 'IP ADDRESS'}
                </label>
                <input
                  id="lan-manual-ip"
                  type="text"
                  dir="ltr"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="192.168.1.25"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#08100c] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm font-mono-num text-[#f7faf5] placeholder-[#5a7060]"
                />
              </div>

              <div>
                <label
                  htmlFor="lan-manual-port"
                  className="block text-[11px] font-semibold text-[#c9d7cb] mb-1"
                >
                  {isAr ? 'المنفذ (PORT)' : 'PORT'}
                </label>
                <input
                  id="lan-manual-port"
                  type="number"
                  dir="ltr"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  placeholder={String(DEFAULT_LAN_PORT)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#08100c] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm font-mono-num text-[#f7faf5]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="lan-manual-code"
                className="block text-[11px] font-semibold text-[#c9d7cb] mb-1"
              >
                {isAr ? 'رمز LAN (اختياري إذا كانت غرفة واحدة)' : 'LAN CODE (optional)'}
              </label>
              <input
                id="lan-manual-code"
                type="text"
                dir="ltr"
                maxLength={12}
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                placeholder="ABCD"
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#08100c] border border-[#2f493b] focus:border-[#7fe094] focus:outline-none text-sm font-mono-num tracking-widest uppercase text-[#f7faf5] placeholder-[#5a7060]"
              />
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="submit"
                disabled={joiningLan || !caps.canJoinDirectIp}
                data-testid="lan-submit-join"
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-white font-display font-bold text-sm cursor-pointer"
              >
                {joiningLan
                  ? isAr
                    ? 'جاري الاتصال...'
                    : 'Connecting...'
                  : isAr
                    ? 'انضمام'
                    : 'JOIN'}
              </button>
              <button
                type="button"
                onClick={handleBackNavigation}
                className="min-h-[44px] px-4 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/12 text-xs font-semibold text-[#dce5d8] cursor-pointer"
              >
                {t.backBtn}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. LAN LOBBY */}
      {subView === 'lanLobby' && activeRoom && (
        <div className="space-y-4" data-testid="lan-lobby-view">
          {/* Connection Details Card */}
          <div className="p-3.5 rounded-xl bg-[#0b1611] border border-[#2d4c3b] space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-display font-bold text-base text-white">
                  {activeRoom.worldName || activeRoom.roomName}
                </h3>
                <p className="text-xs text-[#9db1a1]">
                  {isAr ? 'المضيف:' : 'Host:'} {activeRoom.hostName} ·{' '}
                  {isAr ? 'اللاعبون:' : 'Players:'}{' '}
                  <span className="font-mono-num text-[#7fe094] font-bold">
                    {activeRoom.players.length} / {Math.min(MAX_LAN_PLAYERS, activeRoom.maxPlayers)}
                  </span>
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
                  connectionState === 'connected'
                    ? 'bg-[#173222] border-[#7fe094]/45 text-[#9ef0b0]'
                    : 'bg-[#2b2514] border-[#e5a93c]/45 text-[#f7d488]'
                }`}
              >
                {connectionState === 'connected'
                  ? isAr
                    ? 'متصل بالشبكة المحلية'
                    : 'LAN Connected'
                  : isAr
                    ? 'جاري الاتصال...'
                    : 'Connecting...'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {hostLanAddress && (
                <div className="p-2.5 rounded-xl bg-[#08100c] border border-white/10 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-[#8fa594]">
                      {isAr ? 'عنوان الشبكة المحلية' : 'LAN Address'}
                    </div>
                    <div
                      dir="ltr"
                      className="font-mono-num text-xs sm:text-sm font-bold text-[#e9f7ed] truncate"
                    >
                      {hostLanAddress}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyAddress()}
                    className="min-h-[34px] px-2.5 rounded-lg bg-[#16291f] hover:bg-[#1f392b] border border-[#345443] text-[11px] font-semibold text-[#dce5d8] inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedAddress ? (
                      <Check className="w-3.5 h-3.5 text-[#7fe094]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {copiedAddress
                        ? isAr
                          ? 'تم النسخ'
                          : 'Copied'
                        : isAr
                          ? 'نسخ العنوان'
                          : 'COPY ADDRESS'}
                    </span>
                  </button>
                </div>
              )}

              <div className="p-2.5 rounded-xl bg-[#08100c] border border-white/10 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-[#8fa594]">
                    {isAr ? 'رمز LAN' : 'LAN Code'}
                  </div>
                  <div
                    dir="ltr"
                    className="font-mono-num text-sm sm:text-base font-bold tracking-widest text-[#e5a93c]"
                  >
                    {activeRoom.roomCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyCode()}
                  className="min-h-[34px] px-2.5 rounded-lg bg-[#16291f] hover:bg-[#1f392b] border border-[#345443] text-[11px] font-semibold text-[#dce5d8] inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-[#7fe094]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedCode
                      ? isAr
                        ? 'تم النسخ'
                        : 'Copied'
                      : isAr
                        ? 'نسخ الرمز'
                        : 'COPY CODE'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Guest Waiting-for-Host Banner */}
          {!isLocalHost && activeRoom.status === 'waiting' && (
            <div
              data-testid="lan-guest-waiting-banner"
              className="px-3.5 py-2.5 rounded-xl bg-[#241f10] border border-[#e5a93c]/45 text-xs text-[#f7d488] flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
              <span>
                {isAr
                  ? 'بانتظار فتح الخادم المحلي من صاحب الغرفة...'
                  : 'Waiting for the host to open the local server...'}
              </span>
            </div>
          )}

          {/* Connected LAN Players (Max 4) */}
          <div className="p-3.5 rounded-xl bg-[#0b1611] border border-[#274033] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-display font-bold uppercase tracking-wider text-[#c9d7cb]">
                {isAr ? 'اللاعبون في الغرفة' : 'LAN Players'} (
                {activeRoom.players.length}/{MAX_LAN_PLAYERS})
              </span>
              {activeRoom.players.length < MAX_LAN_PLAYERS && (
                <span className="text-[11px] text-[#9db1a1]">
                  {isLocalHost
                    ? isAr
                      ? 'يمكنك البدء الآن أو انتظار لاعبين'
                      : 'You can start now or wait for players'
                    : isAr
                      ? 'بانتظار لاعبين...'
                      : 'Waiting for players...'}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {activeRoom.players.map((p) => (
                <div
                  key={p.id}
                  className="px-3 py-2 rounded-xl bg-[#112018] border border-white/10 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: p.avatarColor || '#7fe094' }}
                    />
                    <span className="text-xs sm:text-sm font-semibold text-white truncate">
                      {p.displayName}
                    </span>
                    {p.isHost && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2a2313] border border-[#e5a93c]/45 text-[10px] font-bold text-[#f7d488]">
                        <Crown className="w-3 h-3" />
                        {isAr ? 'المضيف' : 'HOST'}
                      </span>
                    )}
                    {p.isLocal && (
                      <span className="text-[10px] text-[#9db1a1]">
                        ({isAr ? 'أنت' : 'You'})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.pingMs !== null && (
                      <span
                        dir="ltr"
                        className="text-[11px] font-mono-num text-[#7fe094]"
                      >
                        {Math.round(p.pingMs)}ms
                      </span>
                    )}
                    {!p.isHost && (
                      <span
                        className={`text-[11px] font-semibold inline-flex items-center gap-1 ${
                          p.isReady ? 'text-[#7fe094]' : 'text-[#9db1a1]'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {p.isReady
                          ? isAr
                            ? 'جاهز'
                            : 'Ready'
                          : isAr
                            ? 'غير جاهز'
                            : 'Not Ready'}
                      </span>
                    )}
                    {isLocalHost && !p.isLocal && (
                      <button
                        type="button"
                        onClick={() => void service.kickPlayer(p.id)}
                        title={isAr ? 'طرد اللاعب' : 'Kick player'}
                        className="p-1.5 rounded-lg bg-[#2a1618] hover:bg-[#3c2023] border border-[#e05a47]/40 text-[#f28b7d] cursor-pointer"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* LAN Lobby Chat */}
          <RoomChatPanel
            lang={lang}
            service={service}
            currentRoom={activeRoom}
            compact
          />

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {isLocalHost ? (
              <button
                type="button"
                disabled={startingGame}
                onClick={() => void handleStartLanGame()}
                data-testid="lan-start-game-btn"
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#276d46] hover:bg-[#318656] disabled:opacity-60 border border-[#7fe094]/60 text-white font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4" />
                <span>
                  {startingGame
                    ? isAr
                      ? 'جاري بدء العالم...'
                      : 'Starting World...'
                    : isAr
                      ? 'بدء اللعبة'
                      : 'START GAME'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleToggleReady()}
                className={`flex-1 min-h-[46px] px-4 rounded-xl border font-display font-bold text-sm flex items-center justify-center gap-2 cursor-pointer ${
                  localPlayer?.isReady
                    ? 'bg-[#173222] border-[#7fe094] text-[#9ef0b0]'
                    : 'bg-[#2a2313] border-[#e5a93c] text-[#f7d488]'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {localPlayer?.isReady
                    ? isAr
                      ? 'جاهز ✓'
                      : 'READY ✓'
                    : isAr
                      ? 'اضغط للاستعداد'
                      : 'READY'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleLeaveLanRoom()}
              data-testid="lan-leave-btn"
              className="min-h-[46px] px-4 rounded-xl bg-[#2a1618] hover:bg-[#3a1f22] border border-[#e05a47]/45 text-xs sm:text-sm font-semibold text-[#f6d5d0] cursor-pointer"
            >
              {isLocalHost
                ? isAr
                  ? 'إغلاق اللعبة'
                  : 'CLOSE LAN GAME'
                : isAr
                  ? 'مغادرة'
                  : 'LEAVE'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
