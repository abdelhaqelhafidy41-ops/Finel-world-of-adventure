import {
  formatProtocolModCompatibilityMessage,
  sanitizeProtocolWorldModMetadata,
  verifyMultiplayerModCompatibility,
  type ProtocolModCompatibilityReport,
  type ProtocolRoomModCompatibilityStatus,
  type ProtocolWorldModMetadata,
} from '../../../shared/multiplayerProtocol';
import { getModManager } from './ModManager';
import { evaluateMultiplayerModCompatibility } from './ModWorldCompatibility';
import type { ModCompatibilityEvaluation, ModsSnapshot, WorldModMetadataSnapshot } from './modTypes';

/**
 * Dedicated multiplayer mod compatibility facade built cleanly over the existing
 * ModManager, ModWorldCompatibility, and shared/multiplayerProtocol verification layer.
 * Exchanges ONLY safe metadata & compatibility identifiers — never executables,
 * scripts, asset archives, or player progression/currency/account data.
 */
export function buildSafeMultiplayerModMetadata(
  worldMetaOverride?: WorldModMetadataSnapshot | ProtocolWorldModMetadata | null,
): ProtocolWorldModMetadata | undefined {
  if (worldMetaOverride) {
    return sanitizeProtocolWorldModMetadata(worldMetaOverride) ?? undefined;
  }
  const mm = getModManager();
  return sanitizeProtocolWorldModMetadata(mm.getActiveWorldModMetadata()) ?? undefined;
}

export async function resolveLocalMultiplayerModMetadata(
  overrideMeta?: WorldModMetadataSnapshot | ProtocolWorldModMetadata | null,
): Promise<ProtocolWorldModMetadata | undefined> {
  if (overrideMeta) {
    return sanitizeProtocolWorldModMetadata(overrideMeta) ?? undefined;
  }
  const mm = getModManager();
  await mm.initialize();
  return sanitizeProtocolWorldModMetadata(mm.getActiveWorldModMetadata()) ?? undefined;
}

export function evaluateMultiplayerHostClientCompatibility(
  hostMeta: ProtocolWorldModMetadata | WorldModMetadataSnapshot | null | undefined,
  clientMeta: ProtocolWorldModMetadata | WorldModMetadataSnapshot | null | undefined,
  gameVersion?: string,
): ProtocolModCompatibilityReport {
  return verifyMultiplayerModCompatibility(
    hostMeta as ProtocolWorldModMetadata | null | undefined,
    clientMeta as ProtocolWorldModMetadata | null | undefined,
    gameVersion,
  );
}

export function evaluateLocalClientCompatibilityForMode(
  mode: 'singleplayer' | 'lan' | 'online',
  hostMeta: WorldModMetadataSnapshot | ProtocolWorldModMetadata | undefined,
  localSnapshot?: ModsSnapshot,
): ModCompatibilityEvaluation {
  const snap = localSnapshot ?? getModManager().getSnapshot();
  return evaluateMultiplayerModCompatibility(
    mode,
    hostMeta as WorldModMetadataSnapshot | undefined,
    snap,
  );
}

export function enrichProtocolReportWithLocalDiscovery(
  report: ProtocolModCompatibilityReport,
  localSnapshot?: ModsSnapshot,
): ProtocolModCompatibilityReport {
  const localMods = (localSnapshot ?? getModManager().getSnapshot()).mods;
  const discoveredById = new Map(localMods.map((m) => [m.manifest.modId, m]));
  const enrichedIssues = report.issues.map((issue) => {
    const localRec = discoveredById.get(issue.modId);
    if (issue.code === 'missing_mod' && localRec) {
      return {
        ...issue,
        code: 'disabled_mod' as const,
        actualVersion: localRec.manifest.version ?? issue.actualVersion,
        message: `Host requires mod "${issue.modName ?? issue.modId}" (${issue.modId} v${issue.expectedVersion ?? '?'}), which is installed locally but disabled.`,
      };
    }
    return issue;
  });
  const updated: ProtocolModCompatibilityReport = {
    ...report,
    issues: enrichedIssues,
  };
  updated.summary = formatProtocolModCompatibilityMessage(updated);
  return updated;
}

export function formatMultiplayerModRejectionMessage(
  report: ProtocolModCompatibilityReport,
): string {
  return formatProtocolModCompatibilityMessage(report);
}

export function buildFallbackHostCompatibilityStatus(
  modMetadata: ProtocolWorldModMetadata | undefined,
  players: Array<{ id: string; displayName: string; isHost: boolean }>,
  existing?: ProtocolRoomModCompatibilityStatus,
): ProtocolRoomModCompatibilityStatus {
  if (existing) return existing;
  return {
    requiredMods: (modMetadata?.mods ?? []).filter(
      (m) => (m.multiplayerCompatibility ?? 'required') !== 'client_only',
    ),
    compatiblePlayers: players.map((p) => ({
      playerId: p.id,
      displayName: p.displayName,
      isHost: p.isHost,
    })),
    incompatiblePlayers: [],
  };
}
