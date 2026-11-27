export {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  MOD_CONTENT_SCHEMA_VERSION,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  MOD_PACKAGE_EXTENSION,
  MOD_CONTENT_TYPES,
  STANDARD_MOD_FOLDERS,
  type IncompatibleModAsset,
  type ModAssetIndexEntry,
  type ModCategory,
  type ModCompatibilityEvaluation,
  type ModCompatibilityIssue,
  type ModContentHandler,
  type ModContentHandlerResult,
  type ModContentType,
  type ModDependency,
  type ModDiagnostic,
  type ModDiagnosticSeverity,
  type ModGenericEntityDescriptor,
  type ModInstallKind,
  type ModInstallProgress,
  type ModInstallStage,
  type ModLoadContext,
  type ModLogEntry,
  type ModLogLevel,
  type ModLootDropEntry,
  type ModLootTableDescriptor,
  type ModManifest,
  type ModMultiplayerCompatibility,
  type ModMusicDescriptor,
  type ModRecord,
  type ModSoundDescriptor,
  type ModsSnapshot,
  type ModStateConfig,
  type ModTextureDescriptor,
  type ModValidationStatus,
  type OrphanedModContentSummary,
  type ParsedModContentFile,
  type StandardModFolder,
  type WorldModInspectionResult,
  type WorldModMetadataEntry,
  type WorldModMetadataSnapshot,
  type WorldModSelectionEntry,
  type WorldSaveModInspectEntry,
  type WorldSaveModInspectStatus,
  type Woa3dAssetMetadata,
  type Woa3dModelDescriptor,
} from './modTypes';

export {
  compareSemver,
  isValidSemverRangeSyntax,
  parseSemver,
  satisfiesSemverRange,
  type SemverVersion,
} from './modSemver';

export {
  CORE_PROTECTED_IDS,
  MOD_ID_SEGMENT_PATTERN,
  NAMESPACED_ID_PATTERN,
  NamespacedContentRegistry,
  formatNamespacedId,
  parseNamespacedId,
  resolveModCrossReference,
  resolveModObjectIdentifier,
  type ParsedNamespacedId,
  type RegisteredModEntry,
  type RegistryRegisterResult,
  type ResolveModIdentifierResult,
} from './ModNamespaceRegistry';

export {
  ModAssetResolver,
  normalizeModAssetPath,
  parseCanonicalAssetRef,
  type InvalidAssetPathResult,
  type ModAssetByteReader,
  type ModAssetPathNormalization,
  type NormalizedAssetPathResult,
} from './ModAssetResolver';

export {
  captureWorldModMetadata,
  evaluateMultiplayerModCompatibility,
  evaluateSaveModCompatibility,
  inspectWorldSaveMods,
  resolveEffectiveMultiplayerCompatibility,
} from './ModWorldCompatibility';

export { validateDiscoveredMods, type ValidationPipelineResult } from './ModValidator';
export {
  validateWoamodArchiveBytes,
  readFileChunksWithProgress,
  buildInstallFolderName,
  FORBIDDEN_MOD_PACKAGE_EXTENSIONS,
  type WoamodValidationResult,
  type WoamodExtractedAssetPreview,
} from './WoamodPackageValidator';
export {
  extractModelReferenceFromContent,
  isWoa3dCompatibleWithContent,
  normalizeModRelativeAssetPathForLookup,
  normalizeWoa3dModCategory,
  parseAndValidateWoa3dText,
  type CanonicalWoa3dCategory,
  type Woa3dValidationOutcome,
} from './woa3dMetadata';
export { ModContentRegistry } from './ModContentRegistry';
export { ModStorageAdapter, type ModStorageInfo } from './ModStorageAdapter';
export {
  DefaultModContentStore,
  type ModContentRegistryMap,
  type ModDescriptorEntry,
  type ModLocalizationEntry,
} from './handlers/defaultModHandlers';
export { ModManager, getModManager } from './ModManager';
export {
  buildFallbackHostCompatibilityStatus,
  buildSafeMultiplayerModMetadata,
  enrichProtocolReportWithLocalDiscovery,
  evaluateLocalClientCompatibilityForMode,
  evaluateMultiplayerHostClientCompatibility,
  formatMultiplayerModRejectionMessage,
  resolveLocalMultiplayerModMetadata,
} from './ModMultiplayerCompatibility';
export {
  extractInlineSpawnDefinitions,
  normalizeModSpawnContentType,
  normalizeModSpawnMode,
  sanitizeModSpawnDefinition,
  type ModSpawnAreaConfig,
  type ModSpawnConditions,
  type ModSpawnContentType,
  type ModSpawnDiagnosticEntry,
  type ModSpawnDefinition,
  type ModSpawnMode,
  type ModSpawnPositionConfig,
  type ModSpawnRuntimeStatus,
  type ModSpawnVec3,
} from './ModSpawnConfig';
export {
  buildGroupFromWoa3dModel,
  resolveExternalWoa3dModel,
  setExternalWoa3dModelProvider,
  type BuiltWoa3dModelResult,
} from './Woa3dModelBuilder';
export { ModWorldSpawner, type ModWorldSpawnerDeps } from './ModWorldSpawner';
