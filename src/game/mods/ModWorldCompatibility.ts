import { parseNamespacedId } from './ModNamespaceRegistry';
import { satisfiesSemverRange } from './modSemver';
import type { SaveGameData } from '../save/saveTypes';
import {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  MOD_CONTENT_SCHEMA_VERSION,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  type ModCompatibilityEvaluation,
  type ModCompatibilityIssue,
  type ModDependency,
  type ModMultiplayerCompatibility,
  type ModRecord,
  type ModsSnapshot,
  type OrphanedModContentSummary,
  type WorldModInspectionResult,
  type WorldModMetadataEntry,
  type WorldModMetadataSnapshot,
  type WorldModSelectionEntry,
  type WorldSaveModInspectEntry,
  type WorldSaveModInspectStatus,
} from './modTypes';

const CLIENT_ONLY_CATEGORIES = new Set([
  'textures',
  'sounds',
  'music',
  'localization',
  'assets',
  'models',
]);

const HARD_ERROR_STATUSES = new Set<ModRecord['status']>([
  'incompatible',
  'corrupted',
  'incomplete',
  'unsafe',
  'duplicate',
  'missing_dependency',
  'circular_dependency',
]);

export interface CaptureWorldModMetadataOptions {
  selectionMode?: 'vanilla' | 'custom';
  configuredEntries?: WorldModSelectionEntry[];
  preservedEntries?: WorldModMetadataEntry[];
  gameVersion?: string;
}

/**
 * Determines whether a mod is required across multiplayer peers or is client-only.
 */
export function resolveEffectiveMultiplayerCompatibility(
  record: Pick<ModRecord, 'manifest' | 'parsedContentFiles' | 'assets'>,
): ModMultiplayerCompatibility {
  if (record.manifest.multiplayerCompatibility) {
    return record.manifest.multiplayerCompatibility;
  }

  const hasContent = record.parsedContentFiles.length > 0;
  const hasAssets = record.assets.length > 0;
  if (!hasContent && !hasAssets) {
    return 'client_only';
  }

  const allCosmetic =
    record.parsedContentFiles.every((f) =>
      CLIENT_ONLY_CATEGORIES.has(f.category.toLowerCase()),
    ) &&
    record.assets.every((a) =>
      CLIENT_ONLY_CATEGORIES.has(a.category.toLowerCase()),
    );

  return allCosmetic ? 'client_only' : 'required';
}

function buildDiscoveredModLookup(snapshot: ModsSnapshot): Map<string, ModRecord> {
  const byId = new Map<string, ModRecord>();
  for (const rec of snapshot.mods) {
    const id = rec.manifest.modId;
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || (!prev.hasValidManifest && rec.hasValidManifest) || (!prev.loaded && rec.loaded)) {
      byId.set(id, rec);
    }
  }
  return byId;
}

/**
 * Captures world mod metadata to persist inside world saves and broadcast to LAN/Online peers.
 */
export function captureWorldModMetadata(
  snapshot: ModsSnapshot,
  gameVersionOrOptions: string | CaptureWorldModMetadataOptions = CURRENT_GAME_VERSION,
): WorldModMetadataSnapshot {
  const modApiVersion = snapshot.modApiVersion ?? MOD_API_VERSION;
  const schemaVersion = snapshot.schemaVersion ?? MOD_CONTENT_SCHEMA_VERSION;

  if (typeof gameVersionOrOptions === 'string') {
    const activeSet = new Set(snapshot.activeModIds);
    const activeMods = snapshot.mods
      .filter((mod) => mod.loaded && activeSet.has(mod.manifest.modId))
      .sort(
        (a, b) =>
          (a.loadOrderIndex ?? a.manifest.loadPriority ?? 0) -
            (b.loadOrderIndex ?? b.manifest.loadPriority ?? 0) ||
          a.manifest.modId.localeCompare(b.manifest.modId),
      );

    const mods: WorldModMetadataEntry[] = activeMods.map((mod, idx) => ({
      modId: mod.manifest.modId,
      name: mod.manifest.name,
      version: mod.manifest.version,
      loadOrder: idx,
      enabled: true,
      supportedGameVersion: mod.manifest.supportedGameVersion,
      ...(mod.manifest.compatibilityVersion
        ? { compatibilityVersion: mod.manifest.compatibilityVersion }
        : {}),
      ...(mod.manifest.dependencies.length > 0
        ? {
            dependencies: mod.manifest.dependencies.map((d) => ({
              modId: d.modId,
              ...(d.versionRange ? { versionRange: d.versionRange } : {}),
              ...(d.optional ? { optional: true } : {}),
            })),
          }
        : {}),
      compatible: mod.gameCompatible && mod.hasValidManifest,
      modApiVersion: mod.manifest.modApiVersion ?? modApiVersion,
      schemaVersion: mod.manifest.schemaVersion ?? schemaVersion,
      multiplayerCompatibility: resolveEffectiveMultiplayerCompatibility(mod),
    }));

    return {
      modApiVersion,
      schemaVersion,
      savedAtGameVersion: gameVersionOrOptions,
      selectionMode: mods.length > 0 ? 'custom' : 'vanilla',
      mods,
    };
  }

  const options = gameVersionOrOptions;
  const gameVersion = options.gameVersion ?? CURRENT_GAME_VERSION;
  const selectionMode: 'vanilla' | 'custom' =
    options.selectionMode === 'vanilla' ? 'vanilla' : 'custom';
  const configuredEntries = [...(options.configuredEntries ?? [])].sort(
    (a, b) => a.loadOrder - b.loadOrder || a.modId.localeCompare(b.modId),
  );

  if (selectionMode === 'vanilla' && configuredEntries.length === 0) {
    return {
      modApiVersion,
      schemaVersion,
      savedAtGameVersion: gameVersion,
      selectionMode: 'vanilla',
      mods: [],
    };
  }

  const discoveredById = buildDiscoveredModLookup(snapshot);
  const preservedById = new Map<string, WorldModMetadataEntry>(
    (options.preservedEntries ?? []).map((e) => [e.modId, e]),
  );

  const mods: WorldModMetadataEntry[] = configuredEntries.map((entry, idx) => {
    const installed = discoveredById.get(entry.modId);
    const preserved = preservedById.get(entry.modId);
    const deps = installed?.manifest.dependencies?.length
      ? installed.manifest.dependencies.map((d) => ({
          modId: d.modId,
          ...(d.versionRange ? { versionRange: d.versionRange } : {}),
          ...(d.optional ? { optional: true } : {}),
        }))
      : preserved?.dependencies;
    const compatibilityVersion =
      installed?.manifest.compatibilityVersion ?? preserved?.compatibilityVersion;
    return {
      modId: entry.modId,
      name: installed?.manifest.name ?? preserved?.name ?? entry.modId,
      version: installed?.manifest.version ?? preserved?.version ?? '0.0.0',
      loadOrder: idx,
      enabled: entry.enabled,
      supportedGameVersion:
        installed?.manifest.supportedGameVersion ?? preserved?.supportedGameVersion,
      ...(compatibilityVersion ? { compatibilityVersion } : {}),
      ...(deps && deps.length > 0 ? { dependencies: deps } : {}),
      compatible: installed
        ? installed.gameCompatible &&
          installed.hasValidManifest &&
          !HARD_ERROR_STATUSES.has(installed.status)
        : preserved?.compatible ?? false,
      modApiVersion:
        installed?.manifest.modApiVersion ?? preserved?.modApiVersion ?? modApiVersion,
      schemaVersion:
        installed?.manifest.schemaVersion ?? preserved?.schemaVersion ?? schemaVersion,
      multiplayerCompatibility: installed
        ? resolveEffectiveMultiplayerCompatibility(installed)
        : preserved?.multiplayerCompatibility,
    };
  });

  const hasEnabled = mods.some((m) => m.enabled !== false);
  return {
    modApiVersion,
    schemaVersion,
    savedAtGameVersion: gameVersion,
    selectionMode: selectionMode === 'vanilla' && !hasEnabled ? 'vanilla' : 'custom',
    mods,
  };
}

function buildLocalActiveLookup(
  snapshot: ModsSnapshot,
): {
  activeById: Map<string, ModRecord>;
  discoveredById: Map<string, ModRecord>;
} {
  const activeSet = new Set(snapshot.activeModIds);
  const activeById = new Map<string, ModRecord>();
  const discoveredById = buildDiscoveredModLookup(snapshot);

  for (const rec of snapshot.mods) {
    const id = rec.manifest.modId;
    if (rec.loaded && activeSet.has(id)) {
      activeById.set(id, rec);
    }
  }

  return { activeById, discoveredById };
}

/**
 * Checks save compatibility without breaking legacy worlds or worlds lacking mod metadata.
 */
export function evaluateSaveModCompatibility(
  saveModMeta: WorldModMetadataSnapshot | undefined,
  localSnapshot: ModsSnapshot,
): ModCompatibilityEvaluation {
  if (
    !saveModMeta ||
    !Array.isArray(saveModMeta.mods) ||
    (saveModMeta.selectionMode === 'vanilla' &&
      !saveModMeta.mods.some((m) => m.enabled !== false))
  ) {
    return {
      compatible: true,
      hasWarnings: false,
      issues: [],
    };
  }

  const issues: ModCompatibilityIssue[] = [];
  const { activeById, discoveredById } = buildLocalActiveLookup(localSnapshot);
  const saveModIds = new Set<string>();

  if (saveModMeta.modApiVersion > MOD_API_VERSION) {
    issues.push({
      modId: '__mod_api__',
      code: 'api_version_mismatch',
      severity: 'warning',
      expectedVersion: `<= v${MOD_API_VERSION}`,
      actualVersion: `v${saveModMeta.modApiVersion}`,
      message: `World was saved with newer Mod API v${saveModMeta.modApiVersion} (current v${MOD_API_VERSION}).`,
    });
  }

  if (
    typeof saveModMeta.schemaVersion === 'number' &&
    !SUPPORTED_MOD_SCHEMA_VERSIONS.includes(saveModMeta.schemaVersion)
  ) {
    issues.push({
      modId: '__mod_schema__',
      code: 'schema_version_mismatch',
      severity: 'warning',
      expectedVersion: SUPPORTED_MOD_SCHEMA_VERSIONS.join(', '),
      actualVersion: String(saveModMeta.schemaVersion),
      message: `World uses unsupported mod schema v${saveModMeta.schemaVersion}.`,
    });
  }

  for (const savedMod of saveModMeta.mods) {
    if (savedMod.enabled === false) {
      saveModIds.add(savedMod.modId);
      continue;
    }
    saveModIds.add(savedMod.modId);
    const active = activeById.get(savedMod.modId);
    if (!active) {
      const discovered = discoveredById.get(savedMod.modId);
      if (discovered) {
        issues.push({
          modId: savedMod.modId,
          modName: savedMod.name,
          code: 'disabled_mod',
          severity: 'info',
          expectedVersion: savedMod.version,
          actualVersion: discovered.manifest.version,
          message: `Mod "${savedMod.name}" (${savedMod.modId}) is installed locally and will be enabled for this world.`,
        });
      } else {
        issues.push({
          modId: savedMod.modId,
          modName: savedMod.name,
          code: 'missing_mod',
          severity: 'warning',
          expectedVersion: savedMod.version,
          message: `World references mod "${savedMod.name}" (${savedMod.modId} v${savedMod.version}), which is missing.`,
        });
      }
      continue;
    }

    if (active.manifest.version !== savedMod.version) {
      issues.push({
        modId: savedMod.modId,
        modName: savedMod.name,
        code: 'version_mismatch',
        severity: 'warning',
        expectedVersion: savedMod.version,
        actualVersion: active.manifest.version,
        message: `Mod "${savedMod.name}" version mismatch (saved v${savedMod.version}, local v${active.manifest.version}).`,
      });
    }
  }

  for (const [activeId, rec] of activeById.entries()) {
    if (!saveModIds.has(activeId)) {
      const compat = resolveEffectiveMultiplayerCompatibility(rec);
      if (compat !== 'client_only') {
        issues.push({
          modId: activeId,
          modName: rec.manifest.name,
          code: 'extra_active_mod',
          severity: 'info',
          actualVersion: rec.manifest.version,
          message: `Active gameplay mod "${rec.manifest.name}" (${activeId}) was not part of this save previously.`,
        });
      }
    }
  }

  return {
    compatible: !issues.some((i) => i.severity === 'error'),
    hasWarnings: issues.some((i) => i.severity === 'warning' || i.severity === 'error'),
    issues,
  };
}

function collectDefinedIdsFromContentFile(
  modId: string,
  data: unknown,
  containerKeys: string[],
  out: Set<string>,
): void {
  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of containerKeys) {
      if (Array.isArray(record[key])) {
        list = record[key] as unknown[];
        break;
      }
    }
    if (list.length === 0 && typeof record.id === 'string') {
      list = [record];
    }
  }

  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rawId = (entry as Record<string, unknown>).id;
    if (typeof rawId !== 'string') continue;
    const trimmed = rawId.trim();
    if (!trimmed) continue;
    out.add(trimmed.includes(':') ? trimmed : `${modId}:${trimmed}`);
  }
}

/**
 * Inspects a world save's persisted mod configuration and saved modded object references
 * against locally installed mods without altering the save or dropping orphaned data.
 */
export function inspectWorldSaveMods(
  saveData: SaveGameData,
  localSnapshot: ModsSnapshot,
): WorldModInspectionResult {
  const evaluation = evaluateSaveModCompatibility(saveData.modMetadata, localSnapshot);
  const discoveredById = buildDiscoveredModLookup(localSnapshot);

  const savedMods = [...(saveData.modMetadata?.mods ?? [])].sort(
    (a, b) => (a.loadOrder ?? 0) - (b.loadOrder ?? 0) || a.modId.localeCompare(b.modId),
  );

  const entries: WorldSaveModInspectEntry[] = [];
  const availableModsForWorld = new Set<string>();
  let hasEntryWarning = false;

  for (const savedMod of savedMods) {
    const savedEnabled = savedMod.enabled !== false;
    const installed = discoveredById.get(savedMod.modId);
    const diagnosticMessages: string[] = [];
    let status: WorldSaveModInspectStatus;

    if (!savedEnabled) {
      status = 'disabled_world';
    } else if (!installed) {
      status = 'missing';
      hasEntryWarning = true;
      diagnosticMessages.push(
        `Mod "${savedMod.name}" (${savedMod.modId} v${savedMod.version}) is not installed.`,
      );
    } else if (
      !installed.hasValidManifest ||
      !installed.gameCompatible ||
      HARD_ERROR_STATUSES.has(installed.status)
    ) {
      status = 'incompatible';
      hasEntryWarning = true;
      const errDiag = installed.diagnostics.find((d) => d.severity === 'error');
      diagnosticMessages.push(
        errDiag?.message ??
          `Installed mod "${installed.manifest.name}" failed compatibility or validation (${installed.status}).`,
      );
    } else {
      availableModsForWorld.add(savedMod.modId);
      if (installed.manifest.version !== savedMod.version) {
        status = 'version_changed';
        hasEntryWarning = true;
        diagnosticMessages.push(
          `Saved with v${savedMod.version}; installed version is v${installed.manifest.version}.`,
        );
      } else if (!installed.enabled || installed.status === 'disabled') {
        status = 'disabled_globally';
      } else {
        status = 'ready';
      }
    }

    entries.push({
      modId: savedMod.modId,
      name: installed?.manifest.name ?? savedMod.name ?? savedMod.modId,
      savedVersion: savedMod.version,
      installedVersion: installed?.manifest.version,
      savedEnabled,
      status,
      diagnosticMessages,
    });
  }

  // Build known namespaced IDs contributed by compatible, enabled mods for this world
  const knownItemIds = new Set<string>();
  const knownQuestIds = new Set<string>();
  const knownBuildingIds = new Set<string>();
  const knownRecipeIds = new Set<string>();
  const availableWithoutFiles = new Set<string>();

  for (const modId of availableModsForWorld) {
    const rec = discoveredById.get(modId);
    if (!rec) continue;
    if (rec.parsedContentFiles.length === 0) {
      availableWithoutFiles.add(modId);
      continue;
    }
    for (const file of rec.parsedContentFiles) {
      const cat = file.category.toLowerCase();
      if (
        cat === 'items' ||
        cat === 'weapons' ||
        cat === 'armor' ||
        cat === 'tools' ||
        cat === 'consumables' ||
        cat === 'resources'
      ) {
        collectDefinedIdsFromContentFile(modId, file.data, ['items', cat], knownItemIds);
      } else if (cat === 'quests') {
        collectDefinedIdsFromContentFile(modId, file.data, ['quests'], knownQuestIds);
      } else if (cat === 'buildings' || cat === 'decorations') {
        collectDefinedIdsFromContentFile(
          modId,
          file.data,
          ['buildings', 'decorations', 'blueprints'],
          knownBuildingIds,
        );
      } else if (cat === 'recipes') {
        collectDefinedIdsFromContentFile(modId, file.data, ['recipes'], knownRecipeIds);
      }
    }
  }

  const isNamespacedKnown = (id: string, set: Set<string>): boolean => {
    const parsed = parseNamespacedId(id);
    if (!parsed) return true; // Non-namespaced (core/vanilla) reference
    if (set.has(id)) return true;
    return availableWithoutFiles.has(parsed.modId);
  };

  const unknownItemSet = new Set<string>();
  for (const slot of saveData.inventory?.slots ?? []) {
    if (slot?.itemId && !isNamespacedKnown(slot.itemId, knownItemIds)) {
      unknownItemSet.add(slot.itemId);
    }
  }
  for (const eqId of Object.values(saveData.inventory?.equippedBySlot ?? {})) {
    if (typeof eqId === 'string' && eqId && !isNamespacedKnown(eqId, knownItemIds)) {
      unknownItemSet.add(eqId);
    }
  }
  for (const pickup of saveData.world?.droppedPickups ?? []) {
    if (pickup?.itemId && !isNamespacedKnown(pickup.itemId, knownItemIds)) {
      unknownItemSet.add(pickup.itemId);
    }
  }
  for (const building of saveData.world?.playerBuildings ?? []) {
    for (const stItem of building.storageItems ?? []) {
      if (stItem?.itemId && !isNamespacedKnown(stItem.itemId, knownItemIds)) {
        unknownItemSet.add(stItem.itemId);
      }
    }
  }

  const unknownQuestSet = new Set<string>();
  for (const q of saveData.quests?.active ?? []) {
    if (q?.questId && !isNamespacedKnown(q.questId, knownQuestIds)) {
      unknownQuestSet.add(q.questId);
    }
  }
  for (const qId of saveData.quests?.completed ?? []) {
    if (qId && !isNamespacedKnown(qId, knownQuestIds)) {
      unknownQuestSet.add(qId);
    }
  }
  if (
    saveData.quests?.trackedQuestId &&
    !isNamespacedKnown(saveData.quests.trackedQuestId, knownQuestIds)
  ) {
    unknownQuestSet.add(saveData.quests.trackedQuestId);
  }

  const unknownBuildingSet = new Set<string>();
  for (const b of saveData.world?.playerBuildings ?? []) {
    if (b?.blueprintId && !isNamespacedKnown(b.blueprintId, knownBuildingIds)) {
      unknownBuildingSet.add(b.blueprintId);
    }
  }

  const unknownRecipeSet = new Set<string>();
  for (const rId of saveData.crafting?.craftedRecipeIds ?? []) {
    if (rId && !isNamespacedKnown(rId, knownRecipeIds)) {
      unknownRecipeSet.add(rId);
    }
  }
  for (const rId of saveData.crafting?.unlockedRecipeIds ?? []) {
    if (rId && !isNamespacedKnown(rId, knownRecipeIds)) {
      unknownRecipeSet.add(rId);
    }
  }

  const unknownItemIds = Array.from(unknownItemSet);
  const unknownQuestIds = Array.from(unknownQuestSet);
  const unknownBuildingIds = Array.from(unknownBuildingSet);
  const unknownRecipeIds = Array.from(unknownRecipeSet);
  const totalUnknownReferences =
    unknownItemIds.length +
    unknownQuestIds.length +
    unknownBuildingIds.length +
    unknownRecipeIds.length;

  const hasApiOrSchemaWarning = evaluation.issues.some(
    (i) => i.code === 'api_version_mismatch' || i.code === 'schema_version_mismatch',
  );

  const orphanedContent: OrphanedModContentSummary = {
    unknownItemIds,
    unknownQuestIds,
    unknownBuildingIds,
    unknownRecipeIds,
    totalUnknownReferences,
  };

  return {
    evaluation,
    entries,
    requiresWarningBeforeLoad:
      hasEntryWarning || hasApiOrSchemaWarning || totalUnknownReferences > 0,
    orphanedContent,
  };
}

/**
 * Evaluates local active mods against a remote LAN/Online multiplayer host's mod metadata.
 * `client_only` mods are always allowed without remote peer parity.
 */
export function evaluateMultiplayerModCompatibility(
  mode: 'singleplayer' | 'lan' | 'online',
  remoteMeta: WorldModMetadataSnapshot | undefined,
  localSnapshot: ModsSnapshot,
): ModCompatibilityEvaluation {
  if (mode === 'singleplayer') {
    return { compatible: true, hasWarnings: false, issues: [] };
  }

  const issues: ModCompatibilityIssue[] = [];
  const { activeById, discoveredById } = buildLocalActiveLookup(localSnapshot);
  const remoteMods = remoteMeta?.mods ?? [];
  const remoteAllowedClientIds = new Set<string>();
  const effectiveGameVersion =
    remoteMeta?.savedAtGameVersion || localSnapshot.gameVersion || CURRENT_GAME_VERSION;

  if (remoteMeta) {
    if (remoteMeta.modApiVersion > MOD_API_VERSION) {
      issues.push({
        modId: '__mod_api__',
        code: 'api_version_mismatch',
        severity: 'error',
        expectedVersion: `<= v${MOD_API_VERSION}`,
        actualVersion: `v${remoteMeta.modApiVersion}`,
        message: `Host requires Mod API v${remoteMeta.modApiVersion} (local is v${MOD_API_VERSION}).`,
      });
    }
    if (
      typeof remoteMeta.schemaVersion === 'number' &&
      !SUPPORTED_MOD_SCHEMA_VERSIONS.includes(remoteMeta.schemaVersion)
    ) {
      issues.push({
        modId: '__mod_schema__',
        code: 'schema_version_mismatch',
        severity: 'error',
        expectedVersion: SUPPORTED_MOD_SCHEMA_VERSIONS.join(', '),
        actualVersion: String(remoteMeta.schemaVersion),
        message: `Host uses unsupported mod schema v${remoteMeta.schemaVersion}.`,
      });
    }
  }

  for (const remoteMod of remoteMods) {
    const compat = remoteMod.multiplayerCompatibility ?? 'required';
    if (compat === 'client_only') {
      continue;
    }

    remoteAllowedClientIds.add(remoteMod.modId);
    for (const dep of remoteMod.dependencies ?? []) {
      if (dep.optional !== true) {
        remoteAllowedClientIds.add(dep.modId);
      }
    }
    const active = activeById.get(remoteMod.modId);
    const severity: 'error' | 'warning' =
      compat === 'required' ? 'error' : 'warning';

    if (!active) {
      const installed = discoveredById.get(remoteMod.modId);
      issues.push({
        modId: remoteMod.modId,
        modName: remoteMod.name,
        code: installed ? 'disabled_mod' : 'missing_mod',
        severity,
        expectedVersion: remoteMod.compatibilityVersion ?? remoteMod.version,
        actualVersion: installed?.manifest.version,
        message: installed
          ? `Host requires mod "${remoteMod.name}" (${remoteMod.modId} v${remoteMod.version}), which is disabled locally.`
          : `Host requires mod "${remoteMod.name}" (${remoteMod.modId} v${remoteMod.version}), which is not installed.`,
      });
      continue;
    }

    const hostRange = remoteMod.compatibilityVersion?.trim();
    const localRange = active.manifest.compatibilityVersion?.trim();
    const versionOk =
      hostRange || localRange
        ? (hostRange ? satisfiesSemverRange(active.manifest.version, hostRange) : true) &&
          (localRange ? satisfiesSemverRange(remoteMod.version, localRange) : true)
        : active.manifest.version === remoteMod.version;

    if (!versionOk) {
      const expectedVersion = hostRange
        ? `${hostRange} (host ${remoteMod.version})`
        : remoteMod.version;
      issues.push({
        modId: remoteMod.modId,
        modName: remoteMod.name,
        code: 'version_mismatch',
        severity,
        expectedVersion,
        actualVersion: active.manifest.version,
        message: `Mod "${remoteMod.name}" version incompatible (Required: ${expectedVersion}, Installed: ${active.manifest.version}).`,
      });
    }

    if (
      compat === 'required' &&
      active.manifest.supportedGameVersion &&
      !satisfiesSemverRange(effectiveGameVersion, active.manifest.supportedGameVersion)
    ) {
      issues.push({
        modId: remoteMod.modId,
        modName: remoteMod.name,
        code: 'unsupported_mod',
        severity,
        expectedVersion: effectiveGameVersion,
        actualVersion: active.manifest.supportedGameVersion,
        message: `Mod "${remoteMod.name}" does not support game version ${effectiveGameVersion} (supports ${active.manifest.supportedGameVersion}).`,
      });
    }

    if (
      typeof remoteMod.modApiVersion === 'number' &&
      active.manifest.modApiVersion !== undefined &&
      active.manifest.modApiVersion !== remoteMod.modApiVersion
    ) {
      issues.push({
        modId: remoteMod.modId,
        modName: remoteMod.name,
        code: 'api_version_mismatch',
        severity,
        expectedVersion: `v${remoteMod.modApiVersion}`,
        actualVersion: `v${active.manifest.modApiVersion}`,
        message: `Mod "${remoteMod.name}" API version differs (host v${remoteMod.modApiVersion}, local v${active.manifest.modApiVersion}).`,
      });
    }

    if (
      typeof remoteMod.schemaVersion === 'number' &&
      active.manifest.schemaVersion !== undefined &&
      active.manifest.schemaVersion !== remoteMod.schemaVersion
    ) {
      issues.push({
        modId: remoteMod.modId,
        modName: remoteMod.name,
        code: 'schema_version_mismatch',
        severity,
        expectedVersion: `v${remoteMod.schemaVersion}`,
        actualVersion: `v${active.manifest.schemaVersion}`,
        message: `Mod "${remoteMod.name}" schema version differs (host v${remoteMod.schemaVersion}, local v${active.manifest.schemaVersion}).`,
      });
    }

    const depCandidates: ModDependency[] = [
      ...(remoteMod.dependencies ?? []),
      ...(active.manifest.dependencies ?? []),
    ];
    const checkedDepIds = new Set<string>();
    for (const dep of depCandidates) {
      if (dep.optional === true || checkedDepIds.has(dep.modId)) continue;
      checkedDepIds.add(dep.modId);
      const activeDep = activeById.get(dep.modId);
      if (!activeDep) {
        issues.push({
          modId: remoteMod.modId,
          modName: remoteMod.name,
          code: 'missing_dependency',
          severity,
          dependencyModId: dep.modId,
          expectedVersion: dep.versionRange,
          message: `Mod "${remoteMod.name}" requires dependency "${dep.modId}"${dep.versionRange ? ` (${dep.versionRange})` : ''}.`,
        });
      } else if (
        dep.versionRange &&
        !satisfiesSemverRange(activeDep.manifest.version, dep.versionRange)
      ) {
        issues.push({
          modId: remoteMod.modId,
          modName: remoteMod.name,
          code: 'missing_dependency',
          severity,
          dependencyModId: dep.modId,
          expectedVersion: dep.versionRange,
          actualVersion: activeDep.manifest.version,
          message: `Mod "${remoteMod.name}" requires dependency "${dep.modId}" (${dep.versionRange}), installed v${activeDep.manifest.version}.`,
        });
      }
    }
  }

  for (const [activeId, rec] of activeById.entries()) {
    const localCompat = resolveEffectiveMultiplayerCompatibility(rec);
    if (localCompat === 'client_only') continue;
    if (!remoteAllowedClientIds.has(activeId) && localCompat === 'required') {
      issues.push({
        modId: activeId,
        modName: rec.manifest.name,
        code: 'extra_active_mod',
        severity: 'error',
        expectedVersion: remoteAllowedClientIds.size === 0 ? 'Vanilla (None)' : undefined,
        actualVersion: rec.manifest.version,
        message:
          remoteAllowedClientIds.size === 0
            ? `Host is running a Vanilla world. Disable active gameplay mod "${rec.manifest.name}" (${activeId}) to join.`
            : `Local gameplay mod "${rec.manifest.name}" (${activeId}) is not active on the host.`,
      });
    }
  }

  return {
    compatible: !issues.some((i) => i.severity === 'error'),
    hasWarnings: issues.some((i) => i.severity === 'warning' || i.severity === 'error'),
    issues,
  };
}
