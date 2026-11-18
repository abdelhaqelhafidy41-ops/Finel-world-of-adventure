import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Compass,
  Crown,
  Flame,
  Heart,
  LogOut,
  MapPin,
  Plus,
  Shield,
  ShieldAlert,
  Sword,
  Target,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  BossEncounterState,
  CoopObjectiveType,
  PartyInviteRecord,
  PartyMemberRecord,
  PartyStateSnapshot,
} from '../../../shared/multiplayerProtocol';
import type { QuestView } from '../../game/quest/questTypes';
import type { FriendRecord } from '../../../shared/profileTypes';
import {
  CARDINAL_LABELS,
  UI_TEXT,
  type Language,
} from '../../game/i18n/translations';
import type {
  IMultiplayerService,
  MultiplayerPlayer,
  MultiplayerRoomState,
} from '../../game/multiplayer/multiplayerTypes';
import { ProfileManager } from '../../game/profile/ProfileManager';
import type { MapPlayerPin } from '../../game/world/MapManager';
import { AvatarBadge } from '../profile/AvatarBadge';

export interface PartyPanelProps {
  lang: Language;
  service: IMultiplayerService;
  currentRoom: MultiplayerRoomState | null;
  partyState: PartyStateSnapshot;
  localPlayerId: string | null;
  playerX?: number;
  playerZ?: number;
  mapPlayers?: MapPlayerPin[];
  coopQuestsList?: QuestView[];
  bossEncounters?: BossEncounterState[];
  onStartCoopQuest?: (questId: string) => void;
  onCompleteCoopQuest?: (questId: string) => void;
  onClose: () => void;
  onNotice?: (message: string) => void;
}

const COOP_OPTION_DEFS: Array<{
  type: CoopObjectiveType;
  targetCount: number;
  offsetX: number;
  offsetZ: number;
  atOrigin?: boolean;
}> = [
  { type: 'kill_boss', targetCount: 3, offsetX: 55, offsetZ: -45 },
  { type: 'protect_village', targetCount: 4, offsetX: 0, offsetZ: 0, atOrigin: true },
  { type: 'collect_resources', targetCount: 6, offsetX: -48, offsetZ: 36 },
  { type: 'escort_npc', targetCount: 1, offsetX: 0, offsetZ: 0, atOrigin: true },
  { type: 'explore_location', targetCount: 1, offsetX: 72, offsetZ: 58 },
  { type: 'open_dungeon', targetCount: 2, offsetX: -68, offsetZ: -64 },
];

export const PartyPanel: React.FC<PartyPanelProps> = ({
  lang,
  service,
  currentRoom,
  partyState,
  localPlayerId,
  playerX = 0,
  playerZ = 0,
  mapPlayers,
  coopQuestsList = [],
  bossEncounters = [],
  onStartCoopQuest,
  onCompleteCoopQuest,
  onClose,
  onNotice,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const [friends, setFriends] = useState<FriendRecord[]>(
    () => ProfileManager.getSnapshot().friends,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [invitedFriendIds, setInvitedFriendIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const unsub = ProfileManager.subscribe((snap) => {
      setFriends(snap.friends);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const party = partyState.party;
  const resolvedLocalId = localPlayerId ?? service.getLocalPlayerId() ?? '';
  const isPartyLeader = Boolean(party && party.leaderPlayerId === resolvedLocalId);
  const myMember = party?.members.find((m) => m.playerId === resolvedLocalId) ?? null;
  const isRoomHost = Boolean(
    currentRoom &&
      (currentRoom.hostId === resolvedLocalId ||
        currentRoom.players.some((p) => p.isLocal && p.isHost)),
  );
  const friendlyFireEnabled = Boolean(currentRoom?.worldSettings?.friendlyFire);

  const friendProfileIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of friends) {
      if (f.publicProfileId) set.add(f.publicProfileId.toUpperCase());
    }
    return set;
  }, [friends]);

  const computeDistanceAndDirection = (
    member: PartyMemberRecord,
  ): { distance: number | null; direction: string | null } => {
    if (member.playerId === resolvedLocalId) {
      return { distance: 0, direction: null };
    }
    const pin = mapPlayers?.find((p) => p.id === member.playerId);
    if (pin && typeof pin.distanceMeters === 'number') {
      return {
        distance: Math.round(pin.distanceMeters),
        direction: pin.directionLabel ?? null,
      };
    }
    const roomPlayer = currentRoom?.players.find((p) => p.id === member.playerId);
    if (roomPlayer?.state) {
      const dx = roomPlayer.state.x - playerX;
      const dz = roomPlayer.state.z - playerZ;
      const distance = Math.round(Math.hypot(dx, dz));
      if (distance <= 1) {
        return { distance, direction: null };
      }
      const angleDeg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      const dir = CARDINAL_LABELS[lang][Math.round(angleDeg / 45) % 8] ?? null;
      return { distance, direction: dir };
    }
    return { distance: null, direction: null };
  };

  const pendingOutgoingByPlayerId = useMemo(() => {
    const set = new Set<string>();
    for (const inv of partyState.outgoingInvites) {
      if (inv.status === 'pending') {
        set.add(inv.toPlayerId);
      }
    }
    return set;
  }, [partyState.outgoingInvites]);

  const partyMemberIds = useMemo(
    () => new Set(party?.members.map((m) => m.playerId) ?? []),
    [party],
  );

  // Room players available for Party Invite (friends sorted first)
  const roomInviteCandidates = useMemo(() => {
    if (!currentRoom) return [];
    const list = currentRoom.players.filter(
      (p) =>
        p.id !== resolvedLocalId &&
        !p.isLocal &&
        !partyMemberIds.has(p.id) &&
        (!p.partyId || p.partyId === party?.partyId),
    );
    return [...list].sort((a, b) => {
      const aFriend = a.publicProfileId
        ? friendProfileIds.has(a.publicProfileId.toUpperCase())
          ? 1
          : 0
        : 0;
      const bFriend = b.publicProfileId
        ? friendProfileIds.has(b.publicProfileId.toUpperCase())
          ? 1
          : 0
        : 0;
      return bFriend - aFriend;
    });
  }, [currentRoom, friendProfileIds, party?.partyId, partyMemberIds, resolvedLocalId]);

  // Friends outside the current room who can be invited to the room
  const externalFriends = useMemo(() => {
    if (!currentRoom) return friends;
    const roomProfileIds = new Set(
      currentRoom.players
        .map((p) => p.publicProfileId?.toUpperCase())
        .filter((x): x is string => Boolean(x)),
    );
    const roomNames = new Set(
      currentRoom.players.map((p) => p.displayName.toLowerCase()),
    );
    return friends.filter(
      (f) =>
        !roomProfileIds.has(f.publicProfileId.toUpperCase()) &&
        !roomNames.has(f.displayName.toLowerCase()),
    );
  }, [currentRoom, friends]);

  const objectiveLabel = (type: CoopObjectiveType): string => {
    switch (type) {
      case 'kill_boss':
        return t.coopTypeKillBoss;
      case 'protect_village':
        return t.coopTypeProtectVillage;
      case 'collect_resources':
        return t.coopTypeCollectResources;
      case 'escort_npc':
        return t.coopTypeEscortNpc;
      case 'explore_location':
        return t.coopTypeExploreLocation;
      case 'open_dungeon':
        return t.coopTypeOpenDungeon;
    }
  };

  const handleToggleFriendlyFire = async () => {
    if (!isRoomHost || !currentRoom || busyKey) return;
    const next = !friendlyFireEnabled;
    setBusyKey('ff');
    try {
      await service.updateRoomSettings({ friendlyFire: next });
      const msg = next ? t.partyFriendlyFireOnDesc : t.partyFriendlyFireOffDesc;
      setFeedback(msg);
      onNotice?.(msg);
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateParty = () => {
    const ok = service.createParty?.();
    if (ok) {
      setFeedback(t.partyCreatedNotice);
      onNotice?.(t.partyCreatedNotice);
    }
  };

  const handleInviteRoomPlayer = (target: MultiplayerPlayer) => {
    if (!party || !isPartyLeader) return;
    if (pendingOutgoingByPlayerId.has(target.id)) {
      setFeedback(t.partyDuplicateInviteNotice);
      return;
    }
    const ok = service.inviteToParty?.({
      targetPlayerId: target.id,
      targetPublicProfileId: target.publicProfileId,
      targetPlayerName: target.displayName,
    });
    if (ok) {
      const msg = t.mpInviteSentNotice(target.displayName);
      setFeedback(msg);
      onNotice?.(msg);
    }
  };

  const handleInviteFriendToRoom = async (friend: FriendRecord) => {
    if (!currentRoom || busyKey) return;
    if (invitedFriendIds.has(friend.publicProfileId)) {
      setFeedback(t.partyDuplicateInviteNotice);
      return;
    }
    setBusyKey(`room-inv-${friend.publicProfileId}`);
    try {
      await service.sendInvite(
        friend.displayName,
        friend.publicProfileId,
        party?.partyId,
      );
      setInvitedFriendIds((prev) => {
        const next = new Set(prev);
        next.add(friend.publicProfileId);
        return next;
      });
      const msg = t.mpInviteSentNotice(friend.displayName);
      setFeedback(msg);
      onNotice?.(msg);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.mpStatusServerUnavailable);
    } finally {
      setBusyKey(null);
    }
  };

  const handleAcceptInvite = (inv: PartyInviteRecord) => {
    const ok = service.acceptPartyInvite?.(inv.inviteId);
    if (ok) {
      setFeedback(t.partyJoinedNotice);
      onNotice?.(t.partyJoinedNotice);
    }
  };

  const handleDeclineInvite = (inv: PartyInviteRecord) => {
    service.declinePartyInvite?.(inv.inviteId);
  };

  const handleStartObjective = (def: (typeof COOP_OPTION_DEFS)[number]) => {
    if (!isPartyLeader) return;
    const title = objectiveLabel(def.type);
    const targetX = def.atOrigin ? 0 : Math.round(playerX + def.offsetX);
    const targetZ = def.atOrigin ? 0 : Math.round(playerZ + def.offsetZ);
    const ok = service.startCoopObjective?.({
      type: def.type,
      title,
      targetX,
      targetZ,
      targetCount: def.targetCount,
    });
    if (ok) {
      const msg = t.coopObjectiveStartedNotice(title);
      setFeedback(msg);
      onNotice?.(msg);
    }
  };

  const partyAtMax = Boolean(
    party && party.members.length >= Math.min(party.maxMembers, currentRoom?.maxPlayers ?? party.maxMembers),
  );

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/72 backdrop-blur-sm p-3 sm:p-5 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="party-panel-title"
      data-testid="party-panel-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl bg-[#101c16] border border-[#2f4b3c] text-[#f2f6ef] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/10 bg-[#0c1611] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Users className="w-5 h-5 text-[#e5a93c] shrink-0" />
              <h2
                id="party-panel-title"
                className="font-display font-bold text-lg sm:text-xl text-white"
              >
                {t.partyTitle}
              </h2>
              {party && (
                <span
                  data-testid="party-member-count-badge"
                  className="px-2 py-0.5 rounded bg-[#182c21] border border-[#325241] font-mono-num text-xs font-bold text-[#9ef0b0]"
                >
                  {t.partyMembersCount(
                    party.members.length,
                    Math.min(party.maxMembers, currentRoom?.maxPlayers ?? party.maxMembers),
                  )}
                </span>
              )}
            </div>
            <p className="text-xs text-[#9db1a1] mt-1">{t.partySubtitle}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentRoom && (
              <button
                type="button"
                disabled={!isRoomHost || busyKey === 'ff'}
                data-testid="party-friendly-fire-toggle"
                onClick={() => void handleToggleFriendlyFire()}
                title={
                  friendlyFireEnabled
                    ? t.partyFriendlyFireOnDesc
                    : t.partyFriendlyFireOffDesc
                }
                className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-display font-bold inline-flex items-center gap-1.5 transition-colors ${
                  friendlyFireEnabled
                    ? 'bg-[#2a1719] border-[#e05a47]/65 text-[#f6b8ae]'
                    : 'bg-[#162920] border-[#7fe094]/45 text-[#9ef0b0]'
                } ${isRoomHost ? 'cursor-pointer hover:brightness-110' : 'opacity-85 cursor-default'}`}
              >
                {friendlyFireEnabled ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-[#e05a47]" />
                ) : (
                  <Shield className="w-3.5 h-3.5 text-[#7fe094]" />
                )}
                <span>
                  {t.partyFriendlyFireLabel}:{' '}
                  {friendlyFireEnabled ? t.mpToggleOn : t.mpToggleOff}
                </span>
              </button>
            )}

            <button
              type="button"
              data-testid="party-panel-close"
              onClick={onClose}
              className="p-2 rounded-xl bg-[#182920] hover:bg-[#22392d] border border-white/10 text-[#dce5d8] cursor-pointer"
              aria-label={t.closeBtn}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {feedback && (
          <div
            role="status"
            className="px-4 sm:px-5 py-2 bg-[#13241c] border-b border-[#e5a93c]/30 text-xs text-[#e8efe5] shrink-0"
          >
            {feedback}
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Pending Incoming Party Invitations */}
          {partyState.pendingInvites.length > 0 && (
            <section
              data-testid="party-pending-invites-section"
              className="p-3.5 rounded-xl bg-[#19261d] border border-[#e5a93c]/45 space-y-2.5"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-[#e5a93c]">
                {t.partyPendingInvitesTitle}
              </div>
              <div className="space-y-2">
                {partyState.pendingInvites.map((inv) => (
                  <div
                    key={inv.inviteId}
                    data-testid={`party-invite-row-${inv.inviteId}`}
                    className="p-2.5 rounded-lg bg-[#0d1712] border border-white/10 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-display font-bold text-sm text-white">
                        {inv.fromPlayerName}
                      </span>
                      {inv.fromPlayerTag && (
                        <span dir="ltr" className="ms-1.5 font-mono-num text-xs text-[#9db1a1]">
                          #{inv.fromPlayerTag}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`party-invite-accept-${inv.inviteId}`}
                        onClick={() => handleAcceptInvite(inv)}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-xs inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{t.mpAcceptBtn}</span>
                      </button>
                      <button
                        type="button"
                        data-testid={`party-invite-decline-${inv.inviteId}`}
                        onClick={() => handleDeclineInvite(inv)}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#192920] hover:bg-[#23382c] border border-white/15 text-xs font-semibold text-[#dce5d8] cursor-pointer"
                      >
                        {t.mpDeclineBtn}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* No Party State */}
          {!party && (
            <section
              data-testid="party-empty-state"
              className="p-5 rounded-xl bg-[#0c1611] border border-[#294034] text-center space-y-3"
            >
              <Users className="w-9 h-9 text-[#e5a93c] mx-auto opacity-85" />
              <div>
                <h3 className="font-display font-bold text-base text-white">
                  {t.partyNoPartyTitle}
                </h3>
                <p className="text-xs sm:text-sm text-[#9db1a1] mt-1 max-w-md mx-auto">
                  {t.partyNoPartyDesc}
                </p>
              </div>
              <button
                type="button"
                data-testid="party-create-btn"
                onClick={handleCreateParty}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t.partyCreateBtn}</span>
              </button>
            </section>
          )}

          {/* Active Party Controls & Roster */}
          {party && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="party-ready-toggle-btn"
                    aria-pressed={Boolean(myMember?.isReady)}
                    onClick={() => service.setPartyReady?.(!(myMember?.isReady ?? false))}
                    className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-display font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                      myMember?.isReady
                        ? 'bg-[#1d3b29] border-[#7fe094]/60 text-[#a5f3b6]'
                        : 'bg-[#16261d] hover:bg-[#1e3428] border-[#2f4b3c] text-[#e8efe5]'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{myMember?.isReady ? t.partyReadyActive : t.partyReadyBtn}</span>
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="party-leave-btn"
                  onClick={() => {
                    service.leaveParty?.();
                    setFeedback(t.partyLeftNotice);
                    onNotice?.(t.partyLeftNotice);
                  }}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#2a1618] hover:bg-[#3a1d20] border border-[#e05a47]/45 text-xs sm:text-sm font-display font-bold text-[#f4b1a7] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>{t.partyLeaveBtn}</span>
                </button>
              </div>

              {/* Member Roster */}
              <section className="space-y-2" data-testid="party-member-list">
                {party.members.map((member) => {
                  const isLeader = member.playerId === party.leaderPlayerId;
                  const isSelf = member.playerId === resolvedLocalId;
                  const maxHp = Math.max(1, member.maxHealth || 100);
                  const hpPct = Math.max(0, Math.min(100, (member.health / maxHp) * 100));
                  const { distance, direction } = computeDistanceAndDirection(member);

                  return (
                    <div
                      key={member.playerId}
                      data-testid={`party-member-row-${member.playerId}`}
                      className="p-3 rounded-xl bg-[#0c1611] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {/* Distinct Marker Color & Index Badge */}
                        <div className="relative shrink-0">
                          <AvatarBadge
                            avatar={member.avatar}
                            seed={member.publicProfileId ?? member.playerId}
                            displayName={member.displayName}
                            size="sm"
                            status={member.online ? 'online' : 'offline'}
                          />
                          <span
                            dir="ltr"
                            className="absolute -top-1.5 -left-1.5 px-1 py-0.5 rounded text-[9px] font-mono-num font-extrabold text-[#0b130e] border border-[#0b130e] leading-none"
                            style={{ backgroundColor: member.markerColor }}
                          >
                            P{member.markerIndex + 1}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-display font-bold text-sm text-white truncate">
                              {member.displayName}
                            </span>
                            {member.playerTag && (
                              <span dir="ltr" className="font-mono-num text-xs text-[#9db1a1]">
                                #{member.playerTag}
                              </span>
                            )}
                            <span
                              dir="ltr"
                              className="font-mono-num text-[10px] text-[#7e9583]"
                            >
                              {member.publicProfileId ?? member.playerId}
                            </span>
                            {isSelf && (
                              <span className="px-1.5 py-0.5 rounded bg-[#1b2e24] text-[10px] font-semibold text-[#c7d6c8]">
                                {t.mpYouLabel}
                              </span>
                            )}
                            {isLeader && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2d2312] border border-[#e5a93c]/45 text-[10px] font-semibold text-[#f3c66c]">
                                <Crown className="w-2.5 h-2.5" />
                                {t.partyLeaderBadge}
                              </span>
                            )}
                          </div>

                          {/* Level, Health Bar, Status, Distance & Direction */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#b7cab9]">
                            <span className="font-mono-num font-semibold text-[#e5a93c]">
                              {t.levelShort}
                              {member.level}
                            </span>

                            <div className="flex items-center gap-1.5 min-w-[110px]">
                              <Heart className="w-3 h-3 text-[#e05a47] shrink-0" />
                              <div className="w-16 h-1.5 rounded-full bg-[#1a2a21] overflow-hidden">
                                <div
                                  className="h-full bg-[#e05a47] transition-[width] duration-150"
                                  style={{ width: `${hpPct}%` }}
                                />
                              </div>
                              <span dir="ltr" className="font-mono-num text-[10px]">
                                {Math.round(member.health)}/{Math.round(maxHp)}
                              </span>
                            </div>

                            <span
                              className={
                                member.online ? 'text-[#8ff0a4]' : 'text-[#8d9a90]'
                              }
                            >
                              {member.online ? t.profileStatusOnline : t.profileStatusOffline}
                            </span>

                            <span
                              className={
                                member.isReady ? 'text-[#9ef0b0] font-semibold' : 'text-[#9db1a1]'
                              }
                            >
                              {member.isReady ? t.partyReadyActive : t.partyNotReady}
                            </span>

                            {!isSelf && distance !== null && (
                              <span
                                dir="ltr"
                                className="inline-flex items-center gap-1 font-mono-num text-[#7dd3fc]"
                              >
                                <Compass className="w-3 h-3" />
                                {t.partyDistanceMeters(distance)}
                                {direction ? ` ${direction}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {isPartyLeader && !isSelf && (
                        <div className="flex items-center gap-1.5 shrink-0 justify-end">
                          <button
                            type="button"
                            data-testid={`party-transfer-leader-${member.playerId}`}
                            onClick={() => {
                              service.transferPartyLeader?.(member.playerId);
                              const msg = t.partyLeaderTransferredNotice(member.displayName);
                              setFeedback(msg);
                              onNotice?.(msg);
                            }}
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#241f12] hover:bg-[#332b18] border border-[#e5a93c]/40 text-[11px] font-display font-bold text-[#f3c66c] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Crown className="w-3 h-3" />
                            <span>{t.partyTransferLeaderBtn}</span>
                          </button>

                          <button
                            type="button"
                            data-testid={`party-kick-member-${member.playerId}`}
                            onClick={() => service.removePartyMember?.(member.playerId)}
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#2a1618] hover:bg-[#3c1d21] border border-[#e05a47]/40 text-[11px] font-display font-bold text-[#f4b1a7] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <UserMinus className="w-3 h-3" />
                            <span>{t.partyKickBtn}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>

              {/* Invite Room Players & Friends */}
              <section className="p-3.5 rounded-xl bg-[#0c1611] border border-[#273d31] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#9db1a1]">
                    {t.partyInviteTitle}
                  </h3>
                  {partyAtMax && (
                    <span className="text-[11px] text-[#e5a93c] font-semibold">
                      {t.partyFullNotice}
                    </span>
                  )}
                </div>

                {roomInviteCandidates.length === 0 && externalFriends.length === 0 ? (
                  <p className="text-xs text-[#7e9583]">{t.mpNoFriendsDesc}</p>
                ) : (
                  <div className="space-y-1.5">
                    {roomInviteCandidates.map((cand) => {
                      const alreadyInvited = pendingOutgoingByPlayerId.has(cand.id);
                      const isFriend = Boolean(
                        cand.publicProfileId &&
                          friendProfileIds.has(cand.publicProfileId.toUpperCase()),
                      );
                      const disabled = !isPartyLeader || alreadyInvited || partyAtMax;
                      return (
                        <div
                          key={cand.id}
                          className="px-3 py-2 rounded-lg bg-[#111f18] border border-white/10 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <AvatarBadge
                              avatar={cand.avatar}
                              seed={cand.publicProfileId ?? cand.id}
                              displayName={cand.displayName}
                              size="xs"
                            />
                            <span className="text-xs sm:text-sm font-semibold text-white truncate">
                              {cand.displayName}
                            </span>
                            {cand.playerTag && (
                              <span dir="ltr" className="font-mono-num text-[11px] text-[#9db1a1]">
                                #{cand.playerTag}
                              </span>
                            )}
                            {isFriend && (
                              <span className="px-1.5 py-0.5 rounded bg-[#183124] text-[10px] font-semibold text-[#9ef0b0]">
                                {t.mpBadgeFriend}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={disabled}
                            data-testid={`party-invite-player-${cand.id}`}
                            onClick={() => handleInviteRoomPlayer(cand)}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] disabled:opacity-45 disabled:cursor-not-allowed text-[#111914] font-display font-bold text-xs inline-flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>
                              {alreadyInvited ? t.partyInvitedBadge : t.partyInviteBtn}
                            </span>
                          </button>
                        </div>
                      );
                    })}

                    {externalFriends.map((friend) => {
                      const alreadyInvitedExternal = invitedFriendIds.has(
                        friend.publicProfileId,
                      );
                      return (
                        <div
                          key={friend.publicProfileId}
                          className="px-3 py-2 rounded-lg bg-[#0f1b15] border border-white/8 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <AvatarBadge
                              avatar={friend.avatar}
                              seed={friend.publicProfileId}
                              displayName={friend.displayName}
                              size="xs"
                              status={friend.presenceStatus}
                            />
                            <span className="text-xs sm:text-sm font-semibold text-[#dce5d8] truncate">
                              {friend.displayName}
                            </span>
                            {friend.playerTag && (
                              <span dir="ltr" className="font-mono-num text-[11px] text-[#9db1a1]">
                                #{friend.playerTag}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={
                              !currentRoom ||
                              partyAtMax ||
                              alreadyInvitedExternal ||
                              busyKey === `room-inv-${friend.publicProfileId}`
                            }
                            data-testid={`party-invite-friend-room-${friend.publicProfileId}`}
                            onClick={() => void handleInviteFriendToRoom(friend)}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-[#192c22] hover:bg-[#233d2f] disabled:opacity-45 disabled:cursor-not-allowed border border-[#325241] text-[#e8efe5] font-display font-bold text-xs inline-flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <UserPlus className="w-3.5 h-3.5 text-[#e5a93c]" />
                            <span>
                              {alreadyInvitedExternal ? t.partyInvitedBadge : t.partyInviteBtn}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Cooperative Objectives */}
              <section
                data-testid="coop-objectives-section"
                className="p-3.5 rounded-xl bg-[#0c1611] border border-[#273d31] space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#e5a93c]" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#e5a93c]">
                      {t.coopObjectiveTitle}
                    </h3>
                  </div>
                  {!isPartyLeader && (
                    <span className="text-[11px] text-[#9db1a1]">
                      {t.coopObjectiveLeaderOnlyHint}
                    </span>
                  )}
                </div>

                {party.activeObjective && party.activeObjective.status === 'active' ? (
                  <div
                    data-testid="coop-active-objective-card"
                    className="p-3.5 rounded-xl bg-[#14231b] border border-[#e5a93c]/45 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#e5a93c]">
                          {t.coopObjectiveActiveLabel}
                        </div>
                        <h4 className="font-display font-bold text-sm sm:text-base text-white mt-0.5">
                          {party.activeObjective.title}
                        </h4>
                        <p className="text-xs text-[#b7cab9] mt-0.5">
                          {party.activeObjective.description}
                        </p>
                      </div>
                      {isPartyLeader && (
                        <button
                          type="button"
                          data-testid="coop-cancel-objective-btn"
                          onClick={() => service.cancelCoopObjective?.()}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#2a1618] hover:bg-[#3c1d21] border border-[#e05a47]/45 text-xs font-semibold text-[#f4b1a7] cursor-pointer shrink-0"
                        >
                          {t.coopObjectiveCancelBtn}
                        </button>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono-num font-bold text-[#9ef0b0]">
                          {party.activeObjective.progress} /{' '}
                          {party.activeObjective.targetCount}
                        </span>
                        {typeof party.activeObjective.targetX === 'number' &&
                          typeof party.activeObjective.targetZ === 'number' && (
                            <span
                              dir="ltr"
                              className="inline-flex items-center gap-1 font-mono-num text-[11px] text-[#7dd3fc]"
                            >
                              <MapPin className="w-3 h-3" />
                              X {Math.round(party.activeObjective.targetX)}, Z{' '}
                              {Math.round(party.activeObjective.targetZ)}
                            </span>
                          )}
                      </div>
                      <div className="h-2 rounded-full bg-[#0a140f] overflow-hidden">
                        <div
                          className="h-full bg-[#7fe094] transition-[width] duration-200"
                          style={{
                            width: `${Math.min(
                              100,
                              (party.activeObjective.progress /
                                Math.max(1, party.activeObjective.targetCount)) *
                                100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {COOP_OPTION_DEFS.map((def) => (
                      <button
                        key={def.type}
                        type="button"
                        disabled={!isPartyLeader}
                        data-testid={`coop-start-${def.type}`}
                        onClick={() => handleStartObjective(def)}
                        className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#13221a] hover:bg-[#1b3126] disabled:opacity-50 disabled:cursor-not-allowed border border-[#2f4b3c] text-start flex items-center justify-between gap-2 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {def.type === 'kill_boss' || def.type === 'protect_village' ? (
                            <Sword className="w-4 h-4 text-[#e05a47] shrink-0" />
                          ) : def.type === 'collect_resources' ? (
                            <Flame className="w-4 h-4 text-[#e5a93c] shrink-0" />
                          ) : (
                            <Compass className="w-4 h-4 text-[#7dd3fc] shrink-0" />
                          )}
                          <span className="text-xs sm:text-sm font-display font-bold text-[#f2f6ef] truncate">
                            {objectiveLabel(def.type)}
                          </span>
                        </div>
                        <span className="font-mono-num text-[11px] font-semibold text-[#e5a93c] shrink-0">
                          ×{def.targetCount}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Cooperative Party Quests & Boss Encounters */}
              {(coopQuestsList.length > 0 || bossEncounters.some((b) => !b.isDead)) && (
                <section
                  data-testid="party-coop-quests-section"
                  className="p-3.5 rounded-xl bg-[#0c1611] border border-[#273d31] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#2dd4bf]">
                      {t.coopQuestsSectionTitle}
                    </h3>
                    <span className="text-[11px] text-[#99f6e4]">
                      {t.questCoopActiveHint}
                    </span>
                  </div>

                  {bossEncounters
                    .filter((b) => !b.isDead)
                    .map((boss) => (
                      <div
                        key={boss.bossId}
                        className="px-3 py-2 rounded-lg bg-[#1d1113] border border-[#e5a93c]/40 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Crown className="w-3.5 h-3.5 text-[#e5a93c] shrink-0" />
                          <span className="font-bold text-[#fef3c7] truncate">
                            {boss.archetype}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#3b1c1c] text-[10px] text-[#fca5a5]">
                            {t.bossPhaseLabel(boss.phase)}
                          </span>
                        </div>
                        <span dir="ltr" className="font-mono-num text-[#fde68a]">
                          {boss.hp}/{boss.maxHp}
                        </span>
                      </div>
                    ))}

                  <div className="space-y-2">
                    {coopQuestsList.map((cq) => {
                      const mainObj = cq.objectives[0];
                      const cur = mainObj?.current ?? 0;
                      const tgt = Math.max(1, mainObj?.target ?? 1);
                      return (
                        <div
                          key={cq.id}
                          data-testid={`party-coop-quest-${cq.id}`}
                          className="p-3 rounded-xl bg-[#12221b] border border-[#2dd4bf]/30 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display font-bold text-xs sm:text-sm text-[#f2f6ef] truncate">
                              {cq.title}
                            </span>
                            {cq.status === 'available' && onStartCoopQuest ? (
                              <button
                                type="button"
                                disabled={!isPartyLeader}
                                onClick={() => onStartCoopQuest(cq.id)}
                                className="px-2.5 py-1 rounded-lg bg-[#2dd4bf] hover:bg-[#5eead4] disabled:opacity-45 disabled:cursor-not-allowed text-[#091915] font-display font-bold text-[11px] cursor-pointer shrink-0"
                              >
                                {t.questStartCoopBtn}
                              </button>
                            ) : cq.status === 'ready' && !cq.coopClaimed && onCompleteCoopQuest ? (
                              <button
                                type="button"
                                onClick={() => onCompleteCoopQuest(cq.id)}
                                className="px-2.5 py-1 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-[11px] cursor-pointer shrink-0"
                              >
                                {t.questClaimRewardBtn}
                              </button>
                            ) : (
                              <span dir="ltr" className="font-mono-num text-[11px] font-bold text-[#9ef0b0] shrink-0">
                                {cur}/{tgt}
                              </span>
                            )}
                          </div>
                          {cq.status !== 'available' && (
                            <div className="h-1.5 rounded-full bg-[#0a140f] overflow-hidden">
                              <div
                                className="h-full bg-[#2dd4bf] transition-[width] duration-200"
                                style={{ width: `${Math.min(100, (cur / tgt) * 100)}%` }}
                              />
                            </div>
                          )}
                          <div className="text-[11px] text-[#e5a93c]">{cq.rewardSummary}</div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
