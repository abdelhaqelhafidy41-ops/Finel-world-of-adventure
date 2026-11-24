import React, { useState } from 'react';
import type { Language } from '../game/i18n/translations';
import type {
  NewWorldOptions,
  SaveGameData,
  SaveGameMeta,
  SaveSlotId,
} from '../game/save/saveTypes';
import type {
  GameSettings,
  MobileControlSettings,
} from '../game/types';
import type { GraphicsSettings } from '../game/engine/GraphicsQualityManager';
import type {
  AudioSettings,
  ExtendedGameSettings,
} from '../game/settings/GameSettingsStore';
import { MainMenu } from './menu/MainMenu';
import { CreateWorldScreen } from './menu/CreateWorldScreen';
import { WorldSelectionScreen } from './menu/WorldSelectionScreen';
import { SettingsScreen } from './menu/SettingsScreen';
import { MultiplayerScreen } from './menu/MultiplayerScreen';
import { ExitConfirmationDialog } from './menu/ExitConfirmationDialog';
import type {
  IMultiplayerService,
  MultiplayerGameStartInfo,
} from '../game/multiplayer/multiplayerTypes';

import menuBgLand1376Avif from '../assets/images/menu_bg_land_1376.avif';
import menuBgLand960Avif from '../assets/images/menu_bg_land_960.avif';
import menuBgLand640Avif from '../assets/images/menu_bg_land_640.avif';
import menuBgLand1376Webp from '../assets/images/menu_bg_land_1376.webp';
import menuBgLand960Webp from '../assets/images/menu_bg_land_960.webp';
import menuBgLand640Webp from '../assets/images/menu_bg_land_640.webp';

import menuBgPort520Avif from '../assets/images/menu_bg_port_520.avif';
import menuBgPort360Avif from '../assets/images/menu_bg_port_360.avif';
import menuBgPort520Webp from '../assets/images/menu_bg_port_520.webp';
import menuBgPort360Webp from '../assets/images/menu_bg_port_360.webp';

export type TitleSubScreen =
  | 'main'
  | 'newWorld'
  | 'loadWorld'
  | 'multiplayer'
  | 'settings'
  | 'mods'
  | 'exit';

interface TitleScreenProps {
  lang: Language;
  subScreen: TitleSubScreen;
  latestSave: SaveGameMeta | null;
  savedWorlds: SaveGameMeta[];
  showMobileControls: boolean;
  muted: boolean;
  graphicsSettings: GraphicsSettings;
  extendedSettings: ExtendedGameSettings;
  gameSettings: GameSettings;
  mobileSettings: MobileControlSettings;
  onChangeSubScreen: (next: TitleSubScreen) => void;
  onToggleLanguage: () => void;
  onToggleMute: () => void;
  onContinue: () => void;
  onCreateWorld: (options: NewWorldOptions) => void;
  onPlayWorld: (slotId: SaveSlotId) => void;
  canHostLan?: boolean;
  onHostWorldLan?: (slotId: SaveSlotId) => void;
  onDeleteWorld: (slotId: SaveSlotId) => void;
  onApplySettings: (payload: {
    lang: Language;
    graphics: GraphicsSettings;
    extended: ExtendedGameSettings;
    game: GameSettings;
    mobile: MobileControlSettings;
  }) => void;
  onPreviewAudio?: (audio: AudioSettings) => void;
  onResetAllSettings: () => void;
  onOpenCustomizeControls: () => void;
  multiplayerService?: IMultiplayerService;
  initialJoinCode?: string | null;
  onConsumeInitialJoinCode?: () => void;
  initialLanHostSlotId?: SaveSlotId | null;
  onConsumeInitialLanHostSlotId?: () => void;
  onPrepareHostWorld?: (info: {
    hostWorldSlotId: SaveSlotId | null;
    savedWorldData: SaveGameData | null;
  }) => void;
  onStartMultiplayerWorld?: (info: MultiplayerGameStartInfo) => void;
  onOpenProfile?: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  lang,
  subScreen,
  latestSave,
  savedWorlds,
  showMobileControls,
  muted,
  graphicsSettings,
  extendedSettings,
  gameSettings,
  mobileSettings,
  onChangeSubScreen,
  onToggleLanguage,
  onToggleMute,
  onContinue,
  onCreateWorld,
  onPlayWorld,
  canHostLan = false,
  onHostWorldLan,
  onDeleteWorld,
  onApplySettings,
  onPreviewAudio,
  onResetAllSettings,
  onOpenCustomizeControls,
  multiplayerService,
  initialJoinCode,
  onConsumeInitialJoinCode,
  initialLanHostSlotId = null,
  onConsumeInitialLanHostSlotId,
  onPrepareHostWorld,
  onStartMultiplayerWorld,
  onOpenProfile,
}) => {
  const [bgFailed, setBgFailed] = useState(false);

  return (
    <div
      data-testid="title-screen-2d-bg"
      className="fixed inset-0 z-30 pointer-events-none bg-gradient-to-b from-[#233830] via-[#13221a] to-[#08100c]"
    >
      {/* Lightweight responsive 2D open-world artwork background (zero 3D/WebGL initialized in menu) */}
      {!bgFailed && (
        <picture className="absolute inset-0 block w-full h-full select-none pointer-events-none">
          <source
            media="(orientation: portrait)"
            type="image/avif"
            srcSet={`${menuBgPort360Avif} 360w, ${menuBgPort520Avif} 520w`}
            sizes="100vw"
          />
          <source
            media="(orientation: portrait)"
            type="image/webp"
            srcSet={`${menuBgPort360Webp} 360w, ${menuBgPort520Webp} 520w`}
            sizes="100vw"
          />
          <source
            type="image/avif"
            srcSet={`${menuBgLand640Avif} 640w, ${menuBgLand960Avif} 960w, ${menuBgLand1376Avif} 1376w`}
            sizes="100vw"
          />
          <source
            type="image/webp"
            srcSet={`${menuBgLand640Webp} 640w, ${menuBgLand960Webp} 960w, ${menuBgLand1376Webp} 1376w`}
            sizes="100vw"
          />
          <img
            src={menuBgLand960Webp}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            decoding="async"
            fetchPriority="high"
            onError={() => setBgFailed(true)}
            className="w-full h-full object-cover object-center select-none pointer-events-none"
          />
        </picture>
      )}
      {/* Atmospheric scrim preserving sky/mountains/village glow while keeping UI text crisp */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 70% 40%, rgba(10,18,14,0.06) 0%, rgba(8,16,12,0.44) 68%, rgba(6,12,9,0.78) 100%), linear-gradient(90deg, rgba(7,14,10,0.74) 0%, rgba(8,16,12,0.34) 48%, rgba(7,14,10,0.20) 100%)',
        }}
      />

      <MainMenu
        lang={lang}
        latestSave={latestSave}
        muted={muted}
        showMobileControls={showMobileControls}
        isModalBlocking={subScreen !== 'main'}
        onToggleLanguage={onToggleLanguage}
        onToggleMute={onToggleMute}
        onNewWorld={() => onChangeSubScreen('newWorld')}
        onContinue={onContinue}
        onLoadWorld={() => onChangeSubScreen('loadWorld')}
        onMultiplayer={() => onChangeSubScreen('multiplayer')}
        onSettings={() => onChangeSubScreen('settings')}
        onExitGame={() => onChangeSubScreen('exit')}
        onOpenProfile={onOpenProfile}
        onOpenMods={() => onChangeSubScreen('mods')}
      />

      {subScreen === 'newWorld' && (
        <CreateWorldScreen
          lang={lang}
          defaultDifficulty={extendedSettings.gameplay.difficulty}
          onCreateWorld={onCreateWorld}
          onBack={() => onChangeSubScreen('main')}
        />
      )}

      {subScreen === 'loadWorld' && (
        <WorldSelectionScreen
          lang={lang}
          worlds={savedWorlds}
          canHostLan={canHostLan}
          onPlayWorld={onPlayWorld}
          onHostWorldLan={onHostWorldLan}
          onDeleteWorld={onDeleteWorld}
          onCreateNewWorld={() => onChangeSubScreen('newWorld')}
          onBack={() => onChangeSubScreen('main')}
        />
      )}

      {subScreen === 'multiplayer' && (
        <MultiplayerScreen
          lang={lang}
          service={multiplayerService}
          savedWorlds={savedWorlds}
          initialLanHostSlotId={initialLanHostSlotId}
          onConsumeInitialLanHostSlotId={onConsumeInitialLanHostSlotId}
          onPrepareHostWorld={onPrepareHostWorld}
          initialJoinCode={initialJoinCode}
          onConsumeInitialJoinCode={onConsumeInitialJoinCode}
          onStartMultiplayerWorld={onStartMultiplayerWorld}
          onBack={() => onChangeSubScreen('main')}
        />
      )}

      {(subScreen === 'settings' || subScreen === 'mods') && (
        <SettingsScreen
          lang={lang}
          initialTab={subScreen === 'mods' ? 'mods' : 'graphics'}
          graphicsSettings={graphicsSettings}
          extendedSettings={extendedSettings}
          gameSettings={gameSettings}
          mobileSettings={mobileSettings}
          showMobileControls={showMobileControls}
          onApply={onApplySettings}
          onPreviewAudio={onPreviewAudio}
          onResetAll={onResetAllSettings}
          onOpenCustomizeControls={onOpenCustomizeControls}
          onBack={() => onChangeSubScreen('main')}
        />
      )}

      {subScreen === 'exit' && (
        <ExitConfirmationDialog
          lang={lang}
          onClose={() => onChangeSubScreen('main')}
        />
      )}
    </div>
  );
};
