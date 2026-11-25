import {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  MOD_CONTENT_SCHEMA_VERSION,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  type ModCompatibilityEvaluation,
  type ModCompatibilityIssue,
  type ModMultiplayerCompatibility,
  type ModRecord,
  type ModsSnapshot,
  type WorldModMetadataEntry,
  type WorldModMetadataSnapshot,
} from './modTypes';

const CLIENT_ONLY_CATEGORIES = new Set([
  'textures',
  'sounds',
  'music',
  'localization',
  'assets',
  'models',
]);

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

/**
 * Captures active mod metadata to persist inside world saves and broadcast to LAN/Online peers.
 */
export function captureWorldModMetadata(
  snapshot: ModsSnapshot,
  gameVersion: string = CURRENT_GAME_VERSION,
): WorldModMetadataSnapshot {
  const activeSet = new Set(snapshot.activeModIds);
  const mods: WorldModMetadataEntry[] = [];

  for (const mod of snapshot.mods) {
    if (!mod.loaded || !activeSet.has(mod.manifest.modId)) continue;
    mods.push({
      modId: mod.manifest.modId,
      name: mod.manifest.name,
      version: mod.manifest.version,
      modApiVersion: mod.manifest.modApiVersion ?? MOD_API_VERSION,
      schemaVersion: mod.manifest.schemaVersion ?? MOD_CONTENT_SCHEMA_VERSION,
      multiplayerCompatibility: resolveEffectiveMultiplayerCompatibility(mod),
    });
  }

  mods.sort((a, b) => a.modId.localeCompare(b.modId));

  return {
    modApiVersion: snapshot.modApiVersion ?? MOD_API_VERSION,
    schemaVersion: snapshot.schemaVersion ?? MOD_CONTENT_SCHEMA_VERSION,
    savedAtGameVersion: gameVersion,
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
  const discoveredById = new Map<string, ModRecord>();

  for (const rec of snapshot.mods) {
    const id = rec.manifest.modId;
    if (!discoveredById.has(id)) {
      discoveredById.set(id, rec);
    }
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
  if (!saveModMeta || !Array.isArray(saveModMeta.mods)) {
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
    saveModIds.add(savedMod.modId);
    const active = activeById.get(savedMod.modId);
    if (!active) {
      const discovered = discoveredById.get(savedMod.modId);
      if (discovered) {
        issues.push({
          modId: savedMod.modId,
          modName: savedMod.name,
          code: 'disabled_mod',
          severity: 'warning',
          expectedVersion: savedMod.version,
          actualVersion: discovered.manifest.version,
          message: `Mod "${savedMod.name}" (${savedMod.modId}) is installed but not active.`,
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
  const remoteRequiredIds = new Set<string>();

  if (remoteMeta && remoteMeta.modApiVersion > MOD_API_VERSION) {
    issues.push({
      modId: '__mod_api__',
      code: 'api_version_mismatch',
      severity: 'error',
      expectedVersion: `<= v${MOD_API_VERSION}`,
      actualVersion: `v${remoteMeta.modApiVersion}`,
      message: `Host requires Mod API v${remoteMeta.modApiVersion} (local is v${MOD_API_VERSION}).`,
    });
  }

  for (const remoteMod of remoteMods) {
    const compat = remoteMod.multiplayerCompatibility ?? 'required';
    if (compat === 'client_only') {
      continue;
    }

    remoteRequiredIds.add(remoteMod.modId);
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
        expectedVersion: remoteMod.version,
        actualVersion: installed?.manifest.version,
        message: installed
          ? `Host uses mod "${remoteMod.name}" (${remoteMod.modId} v${remoteMod.version}), which is disabled locally.`
          : `Host requires mod "${remoteMod.name}" (${remoteMod.modId} v${remoteMod.version}), which is not installed.`,
      });
      continue;
    }

    if (active.manifest.version !== remoteMod.version) {
      issues.push({
        modId: remoteMod.modId,
        modName: remoteMod.name,
        code: 'version_mismatch',
        severity,
        expectedVersion: remoteMod.version,
        actualVersion: active.manifest.version,
        message: `Mod "${remoteMod.name}" version differs (host v${remoteMod.version}, local v${active.manifest.version}).`,
      });
    }
  }

  for (const [activeId, rec] of activeById.entries()) {
    const localCompat = resolveEffectiveMultiplayerCompatibility(rec);
    if (localCompat === 'client_only') continue;
    if (!remoteRequiredIds.has(activeId) && localCompat === 'required') {
      issues.push({
        modId: activeId,
        modName: rec.manifest.name,
        code: 'extra_active_mod',
        severity: mode === 'online' ? 'warning' : 'warning',
        actualVersion: rec.manifest.version,
        message: `Local gameplay mod "${rec.manifest.name}" (${activeId}) is not active on the host.`,
      });
    }
  }

  return {
    compatible: !issues.some((i) => i.severity === 'error'),
    hasWarnings: issues.some((i) => i.severity === 'warning' || i.severity === 'error'),
    issues,
  };
}
