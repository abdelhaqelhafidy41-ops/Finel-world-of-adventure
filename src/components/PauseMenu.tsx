import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Copy,
  FolderOpen,
  Home,
  Languages,
  LogOut,
  Map as MapIcon,
  Moon,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Settings,
  Sliders,
  Smartphone,
  Sun,
  Sunrise,
  Sunset,
  Users,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import type { GameSettings } from '../game/types';
import type { WorldSettingsPermission } from '../../shared/multiplayerProtocol';
import type { TimePreset, TimeSnapshot } from '../game/world/TimeManager';
import {
  WEATHER_LABELS,
  WEATHER_STATES,
  type WeatherQuality,
  type WeatherSnapshot,
  type WeatherState,
} from '../game/world/WeatherManager';
import { UI_TEXT, type Language } from '../game/i18n/translations';
import { useMenuNavigation } from '../hooks/useMenuNavigation';
import { useScreenOrientation } from '../utils/screenOrientation';
import { copyTextToClipboard } from '../game/multiplayer/inviteUtils';
import { ExitConfirmationDialog } from './menu/ExitConfirmationDialog';

interface PauseMenuProps {
  settings: GameSettings;
  showMobileControls: boolean;
  lang: Language;
  activeWorldName: string;
  hasUnsavedProgress: boolean;
  timeSnapshot?: TimeSnapshot;
  weatherSnapshot?: WeatherSnapshot;
  onToggleLanguage: () => void;
  onResume: () => void;
  onOpenMap?: () => void;
  onSaveWorld: () => void;
  onOpenSettings: () => void;
  onReturnToMainMenu: (saveFirst: boolean) => void;
  onResetPosition: () => void;
  onOpenSaveSlots: () => void;
  onUpdateSettings: (partial: Partial<GameSettings>) => void;
  onOpenGraphicsSettings: () => void;
  graphicsSummaryLabel?: string;
  onOpenMobileSettings: () => void;
  onJumpToTimePreset?: (preset: TimePreset) => void;
  onSetDayDuration?: (seconds: number) => void;
  onSetWeatherState?: (state: WeatherState) => void;
  onSetWeatherDynamic?: (enabled: boolean) => void;
  onSetWeatherTransitionDuration?: (seconds: number) => void;
  onSetWeatherQuality?: (quality: WeatherQuality) => void;
  isMultiplayer?: boolean;
  isHost?: boolean;
  canSaveWorld?: boolean;
  worldSettingsPermission?: WorldSettingsPermission;
  canControlWorldSettings?: boolean;
  onSetWorldSettingsPermission?: (permission: WorldSettingsPermission) => void;
  friendlyFire?: boolean;
  onSetFriendlyFire?: (enabled: boolean) => void;
  onOpenParty?: () => void;
  partyMemberCount?: number;
  pendingPartyInvitesCount?: number;
  lanServerInfo?: {
    address: string;
    roomCode: string;
  } | null;
  onBeforeExit?: () => void | Promise<void>;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({
  settings,
  showMobileControls,
  lang,
  activeWorldName,
  hasUnsavedProgress,
  timeSnapshot,
  weatherSnapshot,
  onToggleLanguage,
  onResume,
  onOpenMap,
  onSaveWorld,
  onOpenSettings,
  onReturnToMainMenu,
  onResetPosition,
  onOpenSaveSlots,
  onUpdateSettings,
  onOpenGraphicsSettings,
  graphicsSummaryLabel,
  onOpenMobileSettings,
  onJumpToTimePreset,
  onSetDayDuration,
  onSetWeatherState,
  onSetWeatherDynamic,
  onSetWeatherTransitionDuration,
  onSetWeatherQuality,
  isMultiplayer = false,
  isHost = false,
  canSaveWorld = true,
  worldSettingsPermission = 'HOST_ONLY',
  onBeforeExit,
  canControlWorldSettings = true,
  onSetWorldSettingsPermission,
  friendlyFire = false,
  onSetFriendlyFire,
  onOpenParty,
  partyMemberCount = 0,
  pendingPartyInvitesCount = 0,
  lanServerInfo = null,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [copiedLanAddress, setCopiedLanAddress] = useState(false);
  const [copiedLanCode, setCopiedLanCode] = useState(false);
  const { orientation, showOrientationToggle, toggleOrientation } =
    useScreenOrientation();

  const handleCopyLanAddress = async () => {
    if (!lanServerInfo?.address) return;
    if (await copyTextToClipboard(lanServerInfo.address)) {
      setCopiedLanAddress(true);
      window.setTimeout(() => setCopiedLanAddress(false), 1800);
    }
  };

  const handleCopyLanCode = async () => {
    if (!lanServerInfo?.roomCode) return;
    if (await copyTextToClipboard(lanServerInfo.roomCode)) {
      setCopiedLanCode(true);
      window.setTimeout(() => setCopiedLanCode(false), 1800);
    }
  };

  const dayDurationSec = timeSnapshot?.fullDayDurationSeconds ?? 360;
  const weatherTarget = weatherSnapshot?.targetState ?? 'clear';
  const weatherDynamic = weatherSnapshot?.dynamicEnabled ?? true;
  const weatherTransitionSec = weatherSnapshot?.transitionDurationSeconds ?? 14;
  const weatherQuality = weatherSnapshot?.quality ?? 'medium';

  const handleMainMenuClick = () => {
    if (canSaveWorld && hasUnsavedProgress) {
      setUnsavedPromptOpen(true);
    } else {
      onReturnToMainMenu(false);
    }
  };

  const pauseActions: Array<() => void> = [onResume];
  const mapNavIndex = onOpenMap ? pauseActions.push(() => onOpenMap()) - 1 : -1;
  const saveNavIndex = canSaveWorld ? pauseActions.push(onSaveWorld) - 1 : -1;
  const settingsNavIndex = pauseActions.push(onOpenSettings) - 1;
  const mainMenuNavIndex = pauseActions.push(handleMainMenuClick) - 1;
  const exitNavIndex = pauseActions.push(() => setExitPromptOpen(true)) - 1;

  const { focusedIndex, setFocusedIndex, registerItem } = useMenuNavigation({
    enabled: !unsavedPromptOpen && !exitPromptOpen,
    itemCount: pauseActions.length,
    orientation: 'vertical',
    onActivate: (idx) => pauseActions[idx]?.(),
    onBack: onResume,
  });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/72 backdrop-blur-sm p-3 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
      data-testid="pause-menu"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="woa-surface w-full max-w-md max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-2xl bg-[#101c16]/95 border border-[#2a3f33] p-5 sm:p-7 text-[#f1f5ee] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 mb-5">
          <div className="min-w-0">
            <h2
              id="pause-title"
              className="font-display text-2xl font-bold tracking-tight"
            >
              {t.gamePaused}
            </h2>
            <p className="woa-muted-text text-xs text-[#9cb0a0] mt-0.5 truncate">
              {activeWorldName || t.gameTitle}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="pause-language-toggle"
              onClick={onToggleLanguage}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#192b22] hover:bg-[#22392d] border border-[#2f493b] text-xs font-medium transition-colors cursor-pointer"
            >
              <Languages className="w-3.5 h-3.5 text-[#e5a93c]" />
              <span>{lang === 'en' ? 'العربية' : 'English'}</span>
            </button>

            {showOrientationToggle && (
              <button
                type="button"
                data-testid="pause-orientation-toggle"
                onClick={toggleOrientation}
                aria-label={
                  orientation === 'landscape'
                    ? lang === 'ar'
                      ? 'التبديل إلى الوضع العمودي'
                      : 'Switch to Portrait'
                    : lang === 'ar'
                      ? 'التبديل إلى الوضع الأفقي'
                      : 'Switch to Landscape'
                }
                title={
                  orientation === 'landscape'
                    ? lang === 'ar'
                      ? 'التبديل إلى الوضع العمودي'
                      : 'Switch to Portrait'
                    : lang === 'ar'
                      ? 'التبديل إلى الوضع الأفقي'
                      : 'Switch to Landscape'
                }
                className="min-h-[40px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#192b22] hover:bg-[#22392d] border border-[#2f493b] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCw className="w-3.5 h-3.5 text-[#e5a93c]" />
                <span>
                  {orientation === 'landscape'
                    ? lang === 'ar'
                      ? 'عمودي'
                      : 'Portrait'
                    : lang === 'ar'
                      ? 'أفقي'
                      : 'Landscape'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onUpdateSettings({ muted: !settings.muted })}
              aria-label={settings.muted ? t.muted : t.audioOn}
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center px-2.5 py-1.5 rounded-xl bg-[#192b22] hover:bg-[#22392d] border border-[#2f493b] text-xs font-medium transition-colors cursor-pointer"
            >
              {settings.muted ? (
                <VolumeX className="w-4 h-4 text-[#f28b7d]" />
              ) : (
                <Volume2 className="w-4 h-4 text-[#7ec879]" />
              )}
            </button>
          </div>
        </div>

        {/* Active Offline LAN Server Info (IP + LAN Code) */}
        {lanServerInfo && (
          <div
            data-testid="pause-lan-server-info"
            className="mb-4 p-3 rounded-xl bg-[#0b1611] border border-[#2d4c3b] space-y-2"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-display font-bold uppercase tracking-wider text-[#9ef0b0]">
              <Wifi className="w-3.5 h-3.5 text-[#7fe094] shrink-0" />
              <span>
                {lang === 'ar'
                  ? 'معلومات خادم الشبكة المحلية (LAN)'
                  : 'Offline LAN Server Info'}
              </span>
            </div>

            <div className="space-y-1.5">
              {lanServerInfo.address && (
                <div className="px-2.5 py-2 rounded-lg bg-[#08100c] border border-white/10 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] text-[#8fa594]">
                      {lang === 'ar'
                        ? 'عنوان خادم الشبكة المحلية'
                        : 'LAN Server Address'}
                    </div>
                    <div
                      dir="ltr"
                      data-testid="pause-lan-address"
                      className="font-mono-num text-xs font-bold text-[#e9f7ed] truncate"
                    >
                      {lanServerInfo.address}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="pause-copy-lan-address"
                    onClick={() => void handleCopyLanAddress()}
                    className="min-h-[32px] px-2.5 rounded-lg bg-[#16291f] hover:bg-[#1f392b] border border-[#345443] text-[11px] font-semibold text-[#dce5d8] inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedLanAddress ? (
                      <Check className="w-3 h-3 text-[#7fe094]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>
                      {copiedLanAddress
                        ? lang === 'ar'
                          ? 'تم النسخ'
                          : 'Copied'
                        : lang === 'ar'
                          ? 'نسخ العنوان'
                          : 'Copy Address'}
                    </span>
                  </button>
                </div>
              )}

              {lanServerInfo.roomCode && (
                <div className="px-2.5 py-2 rounded-lg bg-[#08100c] border border-white/10 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] text-[#8fa594]">
                      {lang === 'ar' ? 'رمز LAN' : 'LAN Code'}
                    </div>
                    <div
                      dir="ltr"
                      data-testid="pause-lan-code"
                      className="font-mono-num text-xs font-bold tracking-widest text-[#e5a93c]"
                    >
                      {lanServerInfo.roomCode}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="pause-copy-lan-code"
                    onClick={() => void handleCopyLanCode()}
                    className="min-h-[32px] px-2.5 rounded-lg bg-[#16291f] hover:bg-[#1f392b] border border-[#345443] text-[11px] font-semibold text-[#dce5d8] inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedLanCode ? (
                      <Check className="w-3 h-3 text-[#7fe094]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>
                      {copiedLanCode
                        ? lang === 'ar'
                          ? 'تم النسخ'
                          : 'Copied'
                        : lang === 'ar'
                          ? 'نسخ الرمز'
                          : 'Copy Code'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Primary Pause Menu Buttons */}
        <div className="flex flex-col gap-2.5 mb-5">
          <button
            ref={registerItem(0)}
            type="button"
            data-testid="pause-btn-resume"
            onClick={() => {
              setFocusedIndex(0);
              onResume();
            }}
            className={`w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985] ${
              focusedIndex === 0 ? 'ring-2 ring-white/80' : ''
            }`}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>{t.pauseResume}</span>
          </button>

          {onOpenMap && (
            <button
              ref={registerItem(mapNavIndex)}
              type="button"
              data-testid="pause-btn-map"
              onClick={() => {
                setFocusedIndex(mapNavIndex);
                onOpenMap();
              }}
              className={`w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#162a20] hover:bg-[#1f3b2c] border border-[#355c47] text-[#eef5ec] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985] ${
                focusedIndex === mapNavIndex ? 'ring-2 ring-[#e5a93c]' : ''
              }`}
            >
              <MapIcon className="w-4 h-4 text-[#38bdf8]" />
              <span>{t.pauseMap}</span>
            </button>
          )}

          {isMultiplayer && onOpenParty && (
            <button
              type="button"
              data-testid="pause-btn-party"
              onClick={onOpenParty}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#162a20] hover:bg-[#1f3b2c] border border-[#355c47] text-[#eef5ec] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985]"
            >
              <Users className="w-4 h-4 text-[#7fe094]" />
              <span>{t.partyTitle}</span>
              {partyMemberCount > 0 && (
                <span dir="ltr" className="font-mono-num text-xs text-[#9ef0b0]">
                  ({partyMemberCount})
                </span>
              )}
              {pendingPartyInvitesCount > 0 && (
                <span
                  dir="ltr"
                  className="px-1.5 py-0.5 rounded bg-[#e5a93c] text-[#111914] font-mono-num text-[10px] font-extrabold"
                >
                  +{pendingPartyInvitesCount}
                </span>
              )}
            </button>
          )}

          {canSaveWorld && (
            <button
              ref={registerItem(saveNavIndex)}
              type="button"
              data-testid="pause-btn-save-world"
              onClick={() => {
                setFocusedIndex(saveNavIndex);
                onSaveWorld();
              }}
              className={`w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#1a3124] hover:bg-[#234131] border border-[#355c47] text-[#eef5ec] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985] ${
                focusedIndex === saveNavIndex ? 'ring-2 ring-[#e5a93c]' : ''
              }`}
            >
              <Save className="w-4 h-4 text-[#7fe094]" />
              <span>{t.pauseSaveWorld}</span>
            </button>
          )}

          <button
            ref={registerItem(settingsNavIndex)}
            type="button"
            data-testid="pause-btn-settings"
            onClick={() => {
              setFocusedIndex(settingsNavIndex);
              onOpenSettings();
            }}
            className={`w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#16271e] hover:bg-[#1e3529] border border-[#2f493b] text-[#e4ece1] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985] ${
              focusedIndex === settingsNavIndex ? 'ring-2 ring-[#e5a93c]' : ''
            }`}
          >
            <Settings className="w-4 h-4 text-[#e5a93c]" />
            <span>{t.pauseSettings}</span>
          </button>

          <button
            ref={registerItem(mainMenuNavIndex)}
            type="button"
            data-testid="pause-btn-main-menu"
            onClick={() => {
              setFocusedIndex(mainMenuNavIndex);
              handleMainMenuClick();
            }}
            className={`w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#16271e] hover:bg-[#1e3529] border border-[#2f493b] text-[#e4ece1] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985] ${
              focusedIndex === mainMenuNavIndex ? 'ring-2 ring-[#e5a93c]' : ''
            }`}
          >
            <Home className="w-4 h-4 text-[#9cc6e8]" />
            <span>{t.pauseMainMenu}</span>
          </button>

          <button
            ref={registerItem(exitNavIndex)}
            type="button"
            data-testid="pause-btn-exit"
            onClick={() => {
              setFocusedIndex(exitNavIndex);
              setExitPromptOpen(true);
            }}
            className={`w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-[#271516] hover:bg-[#381d1f] border border-[#e05a47]/40 text-[#f5ddd9] font-display font-bold text-sm tracking-wide transition-all cursor-pointer active:scale-[0.985] ${
              focusedIndex === exitNavIndex ? 'ring-2 ring-[#e5a93c]' : ''
            }`}
          >
            <LogOut className="w-4 h-4 text-[#f28b7d]" />
            <span>{t.pauseExitGame}</span>
          </button>
        </div>

        {/* Collapsible World, Time & Weather Tools */}
        <div className="pt-3 border-t border-[#24382d]">
          <button
            type="button"
            data-testid="pause-tools-toggle"
            onClick={() => setToolsExpanded((o) => !o)}
            className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-[#13221a] hover:bg-[#192d22] border border-white/10 text-xs font-semibold text-[#cde0ce] flex items-center justify-between cursor-pointer"
          >
            <span>{t.worldAndTimeTools}</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                toolsExpanded ? 'rotate-180' : ''
              }`}
            />
          </button>

          {toolsExpanded && (
            <div className="mt-3 space-y-4">
              <div className={`grid grid-cols-1 ${canSaveWorld ? 'sm:grid-cols-2' : ''} gap-2`}>
                <button
                  type="button"
                  onClick={onResetPosition}
                  className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#192a21] hover:bg-[#21362b] border border-[#2f493b] text-xs font-medium text-[#e4ece1] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="truncate">{t.returnToSpawn}</span>
                </button>

                {canSaveWorld && (
                  <button
                    type="button"
                    data-testid="open-save-slots-btn"
                    onClick={onOpenSaveSlots}
                    className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#192a21] hover:bg-[#21362b] border border-[#2f493b] text-xs font-medium text-[#e4ece1] cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#e5a93c]" />
                    <span className="truncate">{t.saveLoadTitle}</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="open-graphics-settings-btn"
                  onClick={onOpenGraphicsSettings}
                  className="min-h-[40px] inline-flex items-center justify-between px-3 py-2 rounded-xl bg-[#16261d] hover:bg-[#1e3328] border border-[#2c4637] text-xs font-medium text-[#e4ece1] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Sliders className="w-3.5 h-3.5 text-[#7fe094] shrink-0" />
                    <span className="truncate">{t.graphicsSettingsTitle}</span>
                  </span>
                  {graphicsSummaryLabel && (
                    <span className="text-[11px] text-[#f5d282] font-medium shrink-0 ms-1">
                      {graphicsSummaryLabel}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  data-testid="open-mobile-settings-btn"
                  onClick={onOpenMobileSettings}
                  className="min-h-[40px] inline-flex items-center justify-between px-3 py-2 rounded-xl bg-[#16261d] hover:bg-[#1e3328] border border-[#2c4637] text-xs font-medium text-[#e4ece1] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Smartphone className="w-3.5 h-3.5 text-[#e5a93c] shrink-0" />
                    <span className="truncate">{t.mobileTouchSettings}</span>
                  </span>
                  <span className="text-[11px] text-[#9cb0a0] shrink-0 ms-1">
                    {showMobileControls ? t.activeStatus : t.desktopStatus}
                  </span>
                </button>
              </div>

              {/* Multiplayer Time & Weather Permission Controls */}
              {isMultiplayer && (
                <div className="pt-3 border-t border-[#24382d] space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#f1f5ee]">
                    <span>{t.mpWorldSettingsPermissionLabel}</span>
                    {!isHost && (
                      <span className="text-[11px] font-medium text-[#e5a93c]">
                        {worldSettingsPermission === 'ALL_PLAYERS'
                          ? t.mpWorldSettingsAllPlayers
                          : t.mpWorldSettingsHostOnly}
                      </span>
                    )}
                  </div>
                  {isHost && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        data-testid="pause-world-perm-host-only"
                        onClick={() => onSetWorldSettingsPermission?.('HOST_ONLY')}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                          worldSettingsPermission === 'HOST_ONLY'
                            ? 'bg-[#22392c] border-[#e5a93c]/85 text-[#ffffff]'
                            : 'bg-[#16261d] hover:bg-[#1e3328] border-[#2c4637] text-[#cddacb]'
                        }`}
                      >
                        {t.mpWorldSettingsHostOnly}
                      </button>
                      <button
                        type="button"
                        data-testid="pause-world-perm-all-players"
                        onClick={() => onSetWorldSettingsPermission?.('ALL_PLAYERS')}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                          worldSettingsPermission === 'ALL_PLAYERS'
                            ? 'bg-[#22392c] border-[#e5a93c]/85 text-[#ffffff]'
                            : 'bg-[#16261d] hover:bg-[#1e3328] border-[#2c4637] text-[#cddacb]'
                        }`}
                      >
                        {t.mpWorldSettingsAllPlayers}
                      </button>
                    </div>
                  )}
                  {!canControlWorldSettings && (
                    <div
                      data-testid="pause-world-settings-locked-notice"
                      className="px-2.5 py-1.5 rounded-lg bg-[#231d11] border border-[#e5a93c]/30 text-[11px] text-[#f3c66c]"
                    >
                      {t.mpWorldSettingsHostOnlyNotice}
                    </div>
                  )}

                  {/* Party Friendly Fire ON/OFF Room Setting */}
                  <div className="pt-2.5 border-t border-[#24382d]/80 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#f1f5ee]">
                      <span>{t.partyFriendlyFireLabel}</span>
                      {!isHost && (
                        <span
                          data-testid="pause-friendly-fire-status"
                          className={`text-[11px] font-bold ${
                            friendlyFire ? 'text-[#f4b1a7]' : 'text-[#9ef0b0]'
                          }`}
                        >
                          {friendlyFire ? t.mpToggleOn : t.mpToggleOff}
                        </span>
                      )}
                    </div>
                    {isHost && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          data-testid="pause-friendly-fire-on"
                          aria-pressed={friendlyFire}
                          onClick={() => onSetFriendlyFire?.(true)}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                            friendlyFire
                              ? 'bg-[#2a1618] border-[#e05a47]/80 text-[#ffffff]'
                              : 'bg-[#16261d] hover:bg-[#1e3328] border-[#2c4637] text-[#cddacb]'
                          }`}
                        >
                          {t.mpToggleOn}
                        </button>
                        <button
                          type="button"
                          data-testid="pause-friendly-fire-off"
                          aria-pressed={!friendlyFire}
                          onClick={() => onSetFriendlyFire?.(false)}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                            !friendlyFire
                              ? 'bg-[#22392c] border-[#e5a93c]/85 text-[#ffffff]'
                              : 'bg-[#16261d] hover:bg-[#1e3328] border-[#2c4637] text-[#cddacb]'
                          }`}
                        >
                          {t.mpToggleOff}
                        </button>
                      </div>
                    )}
                    <p className="text-[11px] text-[#9cb0a0]">
                      {friendlyFire ? t.partyFriendlyFireOnDesc : t.partyFriendlyFireOffDesc}
                    </p>
                  </div>
                </div>
              )}

              {/* Day & Night Cycle Settings */}
              {timeSnapshot && (
                <div className="pt-3 border-t border-[#24382d] space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#f1f5ee]">
                    <span>{t.timeControlsTitle}</span>
                    <span className="font-mono-num text-[#e5a93c]" dir="ltr">
                      {timeSnapshot.formattedTime} · {t.dayLabel} {timeSnapshot.dayCount}
                    </span>
                  </div>

                  <div className={isMultiplayer && !canControlWorldSettings ? 'opacity-50' : ''}>
                    <div className="flex items-center justify-between text-xs text-[#cddacb] mb-1">
                      <label htmlFor="day-length-slider">{t.dayLengthLabel}</label>
                      <span className="font-mono-num text-[#f1f5ee]" dir="ltr">
                        {dayDurationSec >= 120
                          ? `${Math.round(dayDurationSec / 60)}${t.minutesShort} (${dayDurationSec}${t.secondsShort})`
                          : `${dayDurationSec}${t.secondsShort}`}
                      </span>
                    </div>
                    <input
                      id="day-length-slider"
                      type="range"
                      min={60}
                      max={1200}
                      step={30}
                      disabled={isMultiplayer && !canControlWorldSettings}
                      value={dayDurationSec}
                      onChange={(e) =>
                        onSetDayDuration?.(parseInt(e.target.value, 10))
                      }
                      className="w-full accent-[#e5a93c] cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isMultiplayer && !canControlWorldSettings}
                      onClick={() => onJumpToTimePreset?.('sunrise')}
                      className="px-2.5 py-1.5 rounded-lg bg-[#16261d] hover:bg-[#1e3328] disabled:opacity-45 disabled:cursor-not-allowed border border-[#2c4637] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sunrise className="w-3.5 h-3.5 text-[#f29f66] shrink-0" />
                      <span className="truncate">{t.presetSunrise}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isMultiplayer && !canControlWorldSettings}
                      onClick={() => onJumpToTimePreset?.('noon')}
                      className="px-2.5 py-1.5 rounded-lg bg-[#16261d] hover:bg-[#1e3328] disabled:opacity-45 disabled:cursor-not-allowed border border-[#2c4637] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sun className="w-3.5 h-3.5 text-[#f2c464] shrink-0" />
                      <span className="truncate">{t.presetNoon}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isMultiplayer && !canControlWorldSettings}
                      onClick={() => onJumpToTimePreset?.('sunset')}
                      className="px-2.5 py-1.5 rounded-lg bg-[#16261d] hover:bg-[#1e3328] disabled:opacity-45 disabled:cursor-not-allowed border border-[#2c4637] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sunset className="w-3.5 h-3.5 text-[#eb7844] shrink-0" />
                      <span className="truncate">{t.presetSunset}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isMultiplayer && !canControlWorldSettings}
                      onClick={() => onJumpToTimePreset?.('midnight')}
                      className="px-2.5 py-1.5 rounded-lg bg-[#16261d] hover:bg-[#1e3328] disabled:opacity-45 disabled:cursor-not-allowed border border-[#2c4637] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      <Moon className="w-3.5 h-3.5 text-[#92b4ed] shrink-0" />
                      <span className="truncate">{t.presetMidnight}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Dynamic Weather Settings */}
              {weatherSnapshot && (
                <div className="pt-3 border-t border-[#24382d] space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#f1f5ee]">
                    <span>{t.weatherControlsTitle}</span>
                    <button
                      type="button"
                      disabled={isMultiplayer && !canControlWorldSettings}
                      onClick={() => onSetWeatherDynamic?.(!weatherDynamic)}
                      className={`px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                        weatherDynamic
                          ? 'bg-[#1c3226] border-[#7fe094]/45 text-[#9ee8ae]'
                          : 'bg-[#18281f] border-[#2c4637] text-[#e5a93c]'
                      }`}
                    >
                      {weatherDynamic ? t.weatherAutoOn : t.weatherAutoOff}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {WEATHER_STATES.map((state) => {
                      const active = weatherTarget === state;
                      return (
                        <button
                          key={state}
                          type="button"
                          disabled={isMultiplayer && !canControlWorldSettings}
                          onClick={() => onSetWeatherState?.(state)}
                          className={`px-2 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                            active
                              ? 'bg-[#22392c] border-[#e5a93c]/85 text-[#ffffff]'
                              : 'bg-[#16261d] hover:bg-[#1e3328] border-[#2c4637] text-[#cddacb]'
                          }`}
                        >
                          <PauseWeatherIcon state={state} />
                          <span className="truncate">
                            {WEATHER_LABELS[lang][state]}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className={isMultiplayer && !canControlWorldSettings ? 'opacity-50' : ''}>
                    <div className="flex items-center justify-between text-xs text-[#cddacb] mb-1">
                      <label htmlFor="weather-transition-slider">
                        {t.weatherTransitionLabel}
                      </label>
                      <span className="font-mono-num text-[#f1f5ee]" dir="ltr">
                        {weatherTransitionSec}
                        {t.secondsShort}
                      </span>
                    </div>
                    <input
                      id="weather-transition-slider"
                      type="range"
                      min={2}
                      max={40}
                      step={2}
                      disabled={isMultiplayer && !canControlWorldSettings}
                      value={weatherTransitionSec}
                      onChange={(e) =>
                        onSetWeatherTransitionDuration?.(
                          parseInt(e.target.value, 10),
                        )
                      }
                      className="w-full accent-[#e5a93c] cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {(['low', 'medium', 'high'] as WeatherQuality[]).map((q) => {
                      const label =
                        q === 'low'
                          ? t.weatherQualityLow
                          : q === 'high'
                            ? t.weatherQualityHigh
                            : t.weatherQualityMedium;
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => onSetWeatherQuality?.(q)}
                          className={`py-1 rounded-md border text-xs font-medium cursor-pointer ${
                            weatherQuality === q
                              ? 'bg-[#22392c] border-[#e5a93c]/80 text-[#ffffff]'
                              : 'bg-[#16261d] border-[#2c4637] text-[#b7c8b8] hover:bg-[#1e3328]'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Controls Reference */}
              <div className="pt-3 border-t border-[#24382d] grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-[#9cb0a0]">
                <div className="flex justify-between">
                  <span>{t.controlsMove}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    WASD
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsCamera}</span>
                  <span className="font-mono-num text-[#dce5d8]">
                    {t.mouseWord}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsJump}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    Space
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsSprint}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    Shift
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsInteract}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    E
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsAttack}</span>
                  <span className="font-mono-num text-[#dce5d8]">
                    {t.clickWord}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsPackMap}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    I / J / M
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.controlsPause}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    Esc / P
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t.btnCameraLabel}</span>
                  <span className="font-mono-num text-[#dce5d8]" dir="ltr">
                    V
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unsaved Progress Confirmation Dialog before returning to Main Menu */}
      {canSaveWorld && unsavedPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#060d09]/80 backdrop-blur-sm p-4 mobile-hud-safe"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="unsaved-main-menu-title"
          data-testid="unsaved-main-menu-dialog"
        >
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="woa-surface w-full max-w-sm rounded-2xl bg-[#101c16] border border-[#2d4638] p-6 text-[#f1f5ee] shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#e5a93c]/15 text-[#e5a93c] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3
                  id="unsaved-main-menu-title"
                  className="font-display text-lg font-bold text-[#f7faf5]"
                >
                  {t.unsavedMainMenuTitle}
                </h3>
                <p className="woa-muted-text text-xs sm:text-sm text-[#a8bba9] mt-1 leading-relaxed">
                  {t.unsavedMainMenuDesc}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-5">
              <button
                type="button"
                data-testid="save-and-exit-menu-btn"
                onClick={() => {
                  setUnsavedPromptOpen(false);
                  onReturnToMainMenu(true);
                }}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] font-display font-bold text-sm cursor-pointer"
              >
                {t.saveAndExitBtn}
              </button>
              <button
                type="button"
                data-testid="discard-and-exit-menu-btn"
                onClick={() => {
                  setUnsavedPromptOpen(false);
                  onReturnToMainMenu(false);
                }}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#291718] hover:bg-[#3a1d20] border border-[#e05a47]/40 text-[#f4b1a7] font-display font-semibold text-sm cursor-pointer"
              >
                {t.discardAndExitBtn}
              </button>
              <button
                type="button"
                data-testid="cancel-main-menu-btn"
                onClick={() => setUnsavedPromptOpen(false)}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#192b22] hover:bg-[#233a2e] border border-[#2f493b] text-sm font-medium text-[#e4ece1] cursor-pointer"
              >
                {t.cancelBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Confirmation Dialog from Pause Menu */}
      {exitPromptOpen && (
        <ExitConfirmationDialog
          lang={lang}
          onClose={() => setExitPromptOpen(false)}
          onBeforeExit={onBeforeExit}
        />
      )}
    </div>
  );
};

const PauseWeatherIcon: React.FC<{ state: WeatherState }> = ({ state }) => {
  switch (state) {
    case 'cloudy':
      return <Cloud className="w-3.5 h-3.5 text-[#c5d4e2] shrink-0" />;
    case 'rain':
      return <CloudRain className="w-3.5 h-3.5 text-[#7fb7eb] shrink-0" />;
    case 'storm':
      return <CloudLightning className="w-3.5 h-3.5 text-[#92b4ed] shrink-0" />;
    case 'fog':
      return <CloudFog className="w-3.5 h-3.5 text-[#b7c8ce] shrink-0" />;
    case 'clear':
    default:
      return <Sun className="w-3.5 h-3.5 text-[#f2c464] shrink-0" />;
  }
};
