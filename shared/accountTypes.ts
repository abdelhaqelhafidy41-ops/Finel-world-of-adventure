import type { AvatarConfig, FavoriteGameMode, PlayerPrivacySettings, PlayerProfileStats } from './profileTypes';

export const CLOUD_SAVE_SCHEMA_VERSION = 1;

export type CloudSyncState =
  | 'idle'
  | 'synced'
  | 'syncing'
  | 'offline'
  | 'failed'
  | 'conflict';

export interface CloudAccountInfo {
  accountId: string;
  publicProfileId: string;
  email: string;
  displayName: string;
  playerTag: string;
  avatar: AvatarConfig;
  bio: string;
  country: string;
  favoriteGameMode: FavoriteGameMode;
  privacy: PlayerPrivacySettings;
  stats: PlayerProfileStats;
  emailVerified: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number;
}

export interface CloudPlayerProgressData {
  level: number;
  xp: number;
  xpToNextLevel: number;
  coins: number;
  secondaryCurrencies: Record<string, number>;
  maxHealth: number;
  maxStamina: number;
  unlockedCharacters: string[];
  unlockedAbilities: string[];
  skills: Record<string, number>;
  stats: PlayerProfileStats;
}

export interface CloudPlayerSavePayload {
  saveVersion: number;
  revision: number;
  updatedAt: number;
  progress: CloudPlayerProgressData;
  inventory: Record<string, unknown>;
  quests: Record<string, unknown>;
  achievements: string[];
  settings: Record<string, unknown>;
}

export interface CloudWorldSaveRecord {
  worldId: string;
  worldName: string;
  worldSeed: number;
  worldMode: 'normal' | 'adventure' | 'survival' | 'creative';
  difficulty: 'easy' | 'normal' | 'hard';
  saveVersion: number;
  revision: number;
  playTimeSeconds: number;
  level: number;
  updatedAt: number;
  createdAt: number;
  data: Record<string, unknown>;
}

export interface CloudWorldSaveSummary {
  worldId: string;
  worldName: string;
  worldSeed: number;
  worldMode: 'normal' | 'adventure' | 'survival' | 'creative';
  difficulty: 'easy' | 'normal' | 'hard';
  saveVersion: number;
  revision: number;
  playTimeSeconds: number;
  level: number;
  updatedAt: number;
  createdAt: number;
}

export interface AuthTokenBundle {
  sessionToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
}

export interface AuthResponsePayload {
  ok: boolean;
  error?: string;
  message?: string;
  account?: CloudAccountInfo;
  tokens?: AuthTokenBundle;
  playerSave?: CloudPlayerSavePayload | null;
  worldSaves?: CloudWorldSaveSummary[];
}

export interface CloudSaveConflictError {
  code: 'SAVE_CONFLICT';
  serverRevision: number;
  serverUpdatedAt: number;
  serverSave?: CloudPlayerSavePayload | CloudWorldSaveRecord;
}
