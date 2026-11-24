export const CURRENT_GAME_VERSION = '1.0.0';
export const MOD_PACKAGE_EXTENSION = '.woamod';

export type ModInstallKind = 'development' | 'woamod';

export const STANDARD_MOD_FOLDERS = [
  'assets',
  'models',
  'textures',
  'sounds',
  'music',
  'items',
  'weapons',
  'characters',
  'creatures',
  'npcs',
  'buildings',
  'quests',
  'recipes',
  'localization',
] as const;

export type StandardModFolder = (typeof STANDARD_MOD_FOLDERS)[number];

export type ModCategory = StandardModFolder | 'gameplay' | 'world' | 'ui' | 'other';

export interface ModDependency {
  modId: string;
  versionRange?: string;
  optional?: boolean;
}

export interface ModManifest {
  modId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  supportedGameVersion: string;
  modTypes: string[];
  categories: string[];
  dependencies: ModDependency[];
  loadPriority: number;
  icon?: string;
}

export type ModValidationStatus =
  | 'ready'
  | 'disabled'
  | 'incompatible'
  | 'missing_dependency'
  | 'dependency_disabled'
  | 'circular_dependency'
  | 'duplicate'
  | 'corrupted'
  | 'incomplete'
  | 'unsafe';

export type ModDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ModDiagnostic {
  code: string;
  severity: ModDiagnosticSeverity;
  message: string;
  detail?: string;
}

export interface ModAssetIndexEntry {
  modId: string;
  sourceId: string;
  category: string;
  relativePath: string;
  sizeBytes: number;
}

export interface IncompatibleModAsset {
  category: string;
  relativePath: string;
  sizeBytes: number;
  reason: 'unsupported_format' | 'wrong_category' | 'too_large';
}

export interface ParsedModContentFile {
  category: string;
  relativePath: string;
  data: unknown;
}

export interface ModRecord {
  /** Deterministic key for UI rendering (unique even across duplicate modIds) */
  entryKey: string;
  /** Folder name or archive file name inside Mods/ */
  sourceId: string;
  sourceType: 'folder' | 'archive';
  installKind: ModInstallKind;
  packageFileName?: string;
  installedAtMs?: number;
  sourcePath: string;
  modifiedAtMs: number;
  /** Parsed manifest (partial/synthesized if mod.json was invalid/missing) */
  manifest: ModManifest;
  hasValidManifest: boolean;
  gameCompatible: boolean;
  presentFolders: string[];
  missingStandardFolders: StandardModFolder[];
  contentFileCount: number;
  assetFileCount: number;
  loadedEntriesCount: number;
  parsedContentFiles: ParsedModContentFile[];
  assets: ModAssetIndexEntry[];
  incompatibleAssets: IncompatibleModAsset[];
  enabled: boolean;
  loaded: boolean;
  effectivePriority: number;
  status: ModValidationStatus;
  diagnostics: ModDiagnostic[];
  loadOrderIndex: number | null;
}

export interface ModStateConfig {
  version: number;
  enabledByModId: Record<string, boolean>;
  priorityByModId: Record<string, number>;
  updatedAtMs?: number;
}

export type ModLogLevel = 'info' | 'warn' | 'error';

export interface ModLogEntry {
  id: string;
  timestampMs: number;
  level: ModLogLevel;
  modId?: string;
  sourceId?: string;
  message: string;
}

export interface ModLoadContext {
  modId: string;
  sourceId: string;
  manifest: ModManifest;
  files: ParsedModContentFile[];
  assets: ModAssetIndexEntry[];
}

export interface ModContentHandlerResult {
  loadedCount: number;
  diagnostics: ModDiagnostic[];
}

export interface ModContentHandler {
  /** Logical content category handled (e.g. 'items', 'weapons', 'recipes', 'quests', etc.) */
  readonly contentType: string;
  validateAndLoad(context: ModLoadContext): ModContentHandlerResult;
  unloadMod(modId: string): void;
  clearAll(): void;
}

export type ModInstallStage =
  | 'reading'
  | 'validating'
  | 'extracting'
  | 'finalizing'
  | 'cleaning_up'
  | 'completed'
  | 'failed';

export interface ModInstallProgress {
  active: boolean;
  fileName: string;
  stage: ModInstallStage;
  percent: number;
  processedBytes: number;
  totalBytes: number;
  entriesDone?: number;
  entriesTotal?: number;
  currentEntry?: string;
  message?: string;
}

export interface ModsSnapshot {
  initialized: boolean;
  scanning: boolean;
  modsDir: string;
  writable: boolean;
  platform: 'electron' | 'android' | 'web';
  gameVersion: string;
  mods: ModRecord[];
  activeModIds: string[];
  loadOrder: string[];
  logs: ModLogEntry[];
  lastScanAtMs: number | null;
  reloadedAtMs: number | null;
  lastError: string | null;
  installProgress: ModInstallProgress | null;
}
