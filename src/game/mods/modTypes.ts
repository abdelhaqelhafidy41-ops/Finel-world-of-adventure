export const CURRENT_GAME_VERSION = '1.1.25';
export const MOD_API_VERSION = 1;
export const MOD_CONTENT_SCHEMA_VERSION = 2;
export const SUPPORTED_MOD_SCHEMA_VERSIONS: readonly number[] = [1, 2];
export const MOD_PACKAGE_EXTENSION = '.woamod';

export type ModInstallKind = 'development' | 'woamod';
export type ModMultiplayerCompatibility = 'required' | 'optional' | 'client_only';

export const MOD_CONTENT_TYPES = [
  'items',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'resources',
  'recipes',
  'characters',
  'animals',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'quests',
  'loot_tables',
  'sounds',
  'music',
  'textures',
  'models',
  'localization',
  'spawns',
] as const;

export type ModContentType = (typeof MOD_CONTENT_TYPES)[number];

export const STANDARD_MOD_FOLDERS = [
  'assets',
  'models',
  'textures',
  'sounds',
  'music',
  'items',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'resources',
  'recipes',
  'characters',
  'animals',
  'creatures',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'quests',
  'loot_tables',
  'localization',
  'spawns',
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
  compatibilityVersion?: string;
  minGameVersion?: string;
  maxGameVersion?: string;
  modApiVersion?: number;
  schemaVersion?: number;
  multiplayerCompatibility?: ModMultiplayerCompatibility;
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

export interface Woa3dAssetMetadata {
  schemaVersion: number;
  type: '3d-model';
  category: string;
  modCategory: string;
  canonicalCategory: string;
  id?: string;
  name?: string;
}

export interface ModAssetIndexEntry {
  modId: string;
  sourceId: string;
  category: string;
  relativePath: string;
  sizeBytes: number;
  woa3dMetadata?: Woa3dAssetMetadata;
  rawText?: string;
}

export interface IncompatibleModAsset {
  category: string;
  relativePath: string;
  sizeBytes: number;
  reason: 'unsupported_format' | 'wrong_category' | 'too_large';
  detail?: string;
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

export interface WorldModSelectionEntry {
  modId: string;
  enabled: boolean;
  loadOrder: number;
}

export interface WorldModMetadataEntry {
  modId: string;
  name: string;
  version: string;
  loadOrder?: number;
  enabled?: boolean;
  supportedGameVersion?: string;
  compatibilityVersion?: string;
  dependencies?: ModDependency[];
  compatible?: boolean;
  modApiVersion?: number;
  schemaVersion?: number;
  multiplayerCompatibility?: ModMultiplayerCompatibility;
}

export interface WorldModMetadataSnapshot {
  modApiVersion: number;
  schemaVersion: number;
  savedAtGameVersion: string;
  selectionMode?: 'vanilla' | 'custom';
  mods: WorldModMetadataEntry[];
}

export interface ModCompatibilityIssue {
  modId: string;
  modName?: string;
  code:
    | 'missing_mod'
    | 'disabled_mod'
    | 'version_mismatch'
    | 'missing_dependency'
    | 'unsupported_mod'
    | 'api_version_mismatch'
    | 'schema_version_mismatch'
    | 'extra_active_mod';
  severity: 'error' | 'warning' | 'info';
  expectedVersion?: string;
  actualVersion?: string;
  dependencyModId?: string;
  message: string;
}

export interface ModCompatibilityEvaluation {
  compatible: boolean;
  hasWarnings: boolean;
  issues: ModCompatibilityIssue[];
}

export type WorldSaveModInspectStatus =
  | 'ready'
  | 'missing'
  | 'incompatible'
  | 'version_changed'
  | 'disabled_globally'
  | 'disabled_world';

export interface WorldSaveModInspectEntry {
  modId: string;
  name: string;
  savedVersion: string;
  installedVersion?: string;
  savedEnabled: boolean;
  status: WorldSaveModInspectStatus;
  diagnosticMessages: string[];
}

export interface OrphanedModContentSummary {
  unknownItemIds: string[];
  unknownQuestIds: string[];
  unknownBuildingIds: string[];
  unknownRecipeIds: string[];
  totalUnknownReferences: number;
}

export interface WorldModInspectionResult {
  evaluation: ModCompatibilityEvaluation;
  entries: WorldSaveModInspectEntry[];
  requiresWarningBeforeLoad: boolean;
  orphanedContent: OrphanedModContentSummary;
}

export interface ModsSnapshot {
  initialized: boolean;
  scanning: boolean;
  modsDir: string;
  writable: boolean;
  platform: 'electron' | 'android' | 'web';
  gameVersion: string;
  modApiVersion: number;
  schemaVersion: number;
  mods: ModRecord[];
  activeModIds: string[];
  loadOrder: string[];
  logs: ModLogEntry[];
  lastScanAtMs: number | null;
  reloadedAtMs: number | null;
  lastError: string | null;
  installProgress: ModInstallProgress | null;
}

export interface ModLootDropEntry {
  itemId: string;
  minCount: number;
  maxCount: number;
  chance: number;
  weight?: number;
}

export interface ModLootTableDescriptor {
  id: string;
  modId: string;
  sourceFile: string;
  rolls: number;
  entries: ModLootDropEntry[];
}

export interface ModSoundDescriptor {
  id: string;
  modId: string;
  sourceFile: string;
  audioPath: string;
  bus: 'effects' | 'ambient' | 'ui' | 'voice';
  volume: number;
  pitchVariance: number;
  minIntervalMs: number;
  maxDistance: number;
  looping: boolean;
}

export interface ModMusicDescriptor {
  id: string;
  modId: string;
  sourceFile: string;
  audioPath: string;
  title: string;
  titleAr: string;
  context: 'menu' | 'explore' | 'combat' | 'village' | 'night' | 'boss';
  biome?: string;
  volume: number;
  loop: boolean;
  fadeSeconds: number;
}

export interface ModTextureDescriptor {
  id: string;
  modId: string;
  sourceFile: string;
  texturePath: string;
  targetCategory: string;
  targetId?: string;
  repeatX: number;
  repeatY: number;
}

export interface ModGenericEntityDescriptor {
  id: string;
  modId: string;
  category: ModContentType;
  sourceFile: string;
  name: string;
  nameAr: string;
  texturePath?: string;
  modelPath?: string;
  lootTableId?: string;
  raw: Record<string, unknown>;
}

export interface Woa3dModelDescriptor {
  id: string;
  modId: string;
  relativePath: string;
  canonicalRef: string;
  category: string;
  type: '3d-model';
  modCategory: string;
  canonicalCategory: string;
  schemaVersion: number;
  name: string;
  sizeBytes: number;
  raw?: Record<string, unknown>;
}
