'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const os = require('node:os');

const MAX_LAN_PLAYERS = 4;
const DEFAULT_LAN_PORT = 41234;
const DISCOVERY_PORT = 41235;
const DISCOVERY_MAGIC = 'WOA_LAN_V1';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_HTTP_BODY_BYTES = 32_768;
const MAX_WS_PAYLOAD_BYTES = 65_536;
const CURRENT_MOD_API_VERSION = 1;
const SUPPORTED_MOD_SCHEMA_VERSIONS = new Set([1, 2]);
const VALID_MOD_COMPAT_MODES = new Set(['required', 'optional', 'client_only']);
const SAFE_MOD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const MAX_MOD_METADATA_BYTES = 16_384;
const MAX_MODS_PER_METADATA = 64;
const MAX_DEPS_PER_MOD = 32;
const LAN_SEMVER_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_MOD_METADATA_KEYS = new Set([
  'script',
  'scripts',
  'code',
  'eval',
  'executable',
  'executables',
  'binary',
  'binaries',
  'payload',
  'file',
  'files',
  'archive',
  'archivebytes',
  'dataurl',
  'filepath',
  'sourcepath',
  'assets',
  'models',
  'textures',
  'sounds',
  'music',
  'dll',
  'so',
  'wasm',
  'native',
  'buffer',
  'bytes',
  'base64',
  'content',
  'contents',
  'entry',
  'main',
]);
const FORBIDDEN_PATH_OR_EXEC_PATTERN =
  /(?:\.\.|[/\\]|%2e|\0|\.(?:js|mjs|cjs|ts|tsx|jsx|exe|dll|so|dylib|apk|dex|jar|bat|cmd|ps1|sh|wasm|py|rb|php)$)/i;

function parseLanSemver(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 48) return null;
  const match = LAN_SEMVER_RE.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  const patch = match[3] !== undefined ? Number(match[3]) : 0;
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    major < 0 ||
    minor < 0 ||
    patch < 0
  ) {
    return null;
  }
  return { major, minor, patch, prerelease: match[4] ?? null };
}

function compareLanSemver(a, b) {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function matchSingleLanComparator(version, token) {
  const clean = token.trim();
  if (!clean || clean === '*' || clean.toLowerCase() === 'x') return true;
  if (clean.startsWith('^')) {
    const base = parseLanSemver(clean.slice(1));
    if (!base || compareLanSemver(version, base) < 0) return false;
    if (base.major > 0) return version.major === base.major;
    if (base.minor > 0) return version.major === 0 && version.minor === base.minor;
    return version.major === 0 && version.minor === 0 && version.patch === base.patch;
  }
  if (clean.startsWith('~')) {
    const rawBody = clean.slice(1).trim();
    const parts = rawBody.replace(/^v/, '').split('.');
    const base = parseLanSemver(rawBody);
    if (!base || compareLanSemver(version, base) < 0) return false;
    if (parts.length <= 1) return version.major === base.major;
    return version.major === base.major && version.minor === base.minor;
  }
  const wildcardMatch = /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(clean);
  if (
    wildcardMatch &&
    (wildcardMatch[1] === 'x' ||
      wildcardMatch[1] === '*' ||
      wildcardMatch[2] === 'x' ||
      wildcardMatch[2] === '*' ||
      wildcardMatch[3] === 'x' ||
      wildcardMatch[3] === '*' ||
      wildcardMatch[2] === undefined ||
      wildcardMatch[3] === undefined)
  ) {
    const wMajor = wildcardMatch[1];
    const wMinor = wildcardMatch[2];
    const wPatch = wildcardMatch[3];
    if (wMajor !== 'x' && wMajor !== '*' && version.major !== Number(wMajor)) return false;
    if (wMinor !== undefined && wMinor !== 'x' && wMinor !== '*' && version.minor !== Number(wMinor)) {
      return false;
    }
    if (wPatch !== undefined && wPatch !== 'x' && wPatch !== '*' && version.patch !== Number(wPatch)) {
      return false;
    }
    return true;
  }
  let op = '=';
  let verStr = clean;
  if (clean.startsWith('>=')) {
    op = '>=';
    verStr = clean.slice(2);
  } else if (clean.startsWith('<=')) {
    op = '<=';
    verStr = clean.slice(2);
  } else if (clean.startsWith('>')) {
    op = '>';
    verStr = clean.slice(1);
  } else if (clean.startsWith('<')) {
    op = '<';
    verStr = clean.slice(1);
  } else if (clean.startsWith('=')) {
    op = '=';
    verStr = clean.slice(1);
  }
  const target = parseLanSemver(verStr);
  if (!target) return false;
  const cmp = compareLanSemver(version, target);
  if (op === '>=') return cmp >= 0;
  if (op === '<=') return cmp <= 0;
  if (op === '>') return cmp > 0;
  if (op === '<') return cmp < 0;
  return cmp === 0;
}

function isValidLanSemverRange(rangeExpr) {
  if (typeof rangeExpr !== 'string' || !rangeExpr.trim() || rangeExpr.length > 48) {
    return false;
  }
  const orClauses = rangeExpr.split('||').map((s) => s.trim()).filter(Boolean);
  if (orClauses.length === 0) return false;
  return orClauses.every((clause) => {
    const hyphenMatch = /^(.+?)\s+-\s+(.+)$/.exec(clause);
    if (hyphenMatch) {
      return Boolean(parseLanSemver(hyphenMatch[1]) && parseLanSemver(hyphenMatch[2]));
    }
    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => {
      if (tok === '*' || tok.toLowerCase() === 'x') return true;
      return (
        parseLanSemver(tok.replace(/^[~^=<>]+/, '')) !== null ||
        /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.test(tok)
      );
    });
  });
}

function satisfiesLanSemverRange(versionStr, rangeExpr) {
  const version = parseLanSemver(versionStr);
  if (!version) return false;
  if (typeof rangeExpr !== 'string' || !rangeExpr.trim() || rangeExpr.length > 48) {
    return false;
  }
  const orClauses = rangeExpr.split('||').map((s) => s.trim()).filter(Boolean);
  if (orClauses.length === 0) return false;
  return orClauses.some((clause) => {
    const hyphenMatch = /^(.+?)\s+-\s+(.+)$/.exec(clause);
    if (hyphenMatch) {
      return (
        matchSingleLanComparator(version, `>=${hyphenMatch[1].trim()}`) &&
        matchSingleLanComparator(version, `<=${hyphenMatch[2].trim()}`)
      );
    }
    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => matchSingleLanComparator(version, tok));
  });
}

function sanitizeLanModText(raw, maxLen, fallback) {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen);
}

function sanitizeLanModDependencies(rawDeps) {
  if (!Array.isArray(rawDeps) || rawDeps.length === 0) return undefined;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < rawDeps.length && out.length < MAX_DEPS_PER_MOD; i += 1) {
    const dep = rawDeps[i];
    if (typeof dep === 'string') {
      const modId = dep.trim().slice(0, 64);
      if (!modId || !SAFE_MOD_ID_PATTERN.test(modId) || seen.has(modId)) continue;
      seen.add(modId);
      out.push({ modId });
      continue;
    }
    if (!dep || typeof dep !== 'object' || Array.isArray(dep)) continue;
    const modId = typeof dep.modId === 'string' ? dep.modId.trim().slice(0, 64) : '';
    if (!modId || !SAFE_MOD_ID_PATTERN.test(modId) || seen.has(modId)) continue;
    const rawRange =
      typeof dep.versionRange === 'string' ? dep.versionRange.trim().slice(0, 32) : undefined;
    const versionRange = rawRange && isValidLanSemverRange(rawRange) ? rawRange : undefined;
    seen.add(modId);
    out.push({
      modId,
      ...(versionRange ? { versionRange } : {}),
      ...(dep.optional === true ? { optional: true } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function hasForbiddenLanModFieldOrTraversal(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_MOD_METADATA_KEYS.has(k.toLowerCase())) {
      return `Forbidden mod metadata field "${k}" is not allowed.`;
    }
    if (typeof v === 'string' && FORBIDDEN_PATH_OR_EXEC_PATTERN.test(v)) {
      return `Unsafe path or executable reference in "${k}".`;
    }
  }
  return null;
}

function validateUntrustedLanModMetadata(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata must be a JSON object.',
    };
  }
  try {
    const byteLen = Buffer.byteLength(JSON.stringify(raw), 'utf8');
    if (byteLen > MAX_MOD_METADATA_BYTES) {
      return {
        ok: false,
        status: 413,
        error: 'MOD_METADATA_TOO_LARGE',
        message: `Mod metadata exceeds maximum size (${MAX_MOD_METADATA_BYTES} bytes).`,
      };
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata is not serializable.',
    };
  }
  const rootViolation = hasForbiddenLanModFieldOrTraversal(raw);
  if (rootViolation) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: rootViolation,
    };
  }
  if (
    raw.savedAtGameVersion !== undefined &&
    (typeof raw.savedAtGameVersion !== 'string' ||
      !isValidLanSemverRange(raw.savedAtGameVersion.trim()))
  ) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata contains an invalid savedAtGameVersion.',
    };
  }
  if (
    raw.modApiVersion !== undefined &&
    (typeof raw.modApiVersion !== 'number' || !Number.isFinite(raw.modApiVersion) || raw.modApiVersion < 1)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata contains an invalid modApiVersion.',
    };
  }
  if (
    raw.schemaVersion !== undefined &&
    (typeof raw.schemaVersion !== 'number' || !Number.isFinite(raw.schemaVersion) || raw.schemaVersion < 1)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata contains an invalid schemaVersion.',
    };
  }
  if (raw.mods !== undefined && !Array.isArray(raw.mods)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_MOD_METADATA',
      message: 'Mod metadata "mods" field must be an array.',
    };
  }
  const rawMods = Array.isArray(raw.mods) ? raw.mods : [];
  if (rawMods.length > MAX_MODS_PER_METADATA) {
    return {
      ok: false,
      status: 413,
      error: 'MOD_METADATA_TOO_LARGE',
      message: `Mod metadata exceeds maximum limit of ${MAX_MODS_PER_METADATA} mods.`,
    };
  }
  for (let i = 0; i < rawMods.length; i += 1) {
    const entry = rawMods[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Mod entry at mods[${i}] must be an object.`,
      };
    }
    const entryViolation = hasForbiddenLanModFieldOrTraversal(entry);
    if (entryViolation) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `mods[${i}]: ${entryViolation}`,
      };
    }
    const modId = typeof entry.modId === 'string' ? entry.modId.trim() : '';
    if (!modId || !SAFE_MOD_ID_PATTERN.test(modId) || FORBIDDEN_PATH_OR_EXEC_PATTERN.test(modId)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid modId at mods[${i}].`,
      };
    }
    const version = typeof entry.version === 'string' ? entry.version.trim() : '';
    if (!version || !parseLanSemver(version)) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid version "${version || 'missing'}" for mod "${modId}".`,
      };
    }
    if (
      entry.compatibilityVersion !== undefined &&
      (typeof entry.compatibilityVersion !== 'string' ||
        !isValidLanSemverRange(entry.compatibilityVersion.trim()))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid compatibilityVersion for mod "${modId}".`,
      };
    }
    if (
      entry.supportedGameVersion !== undefined &&
      (typeof entry.supportedGameVersion !== 'string' ||
        !isValidLanSemverRange(entry.supportedGameVersion.trim()))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid supportedGameVersion for mod "${modId}".`,
      };
    }
    if (
      entry.multiplayerCompatibility !== undefined &&
      (typeof entry.multiplayerCompatibility !== 'string' ||
        !VALID_MOD_COMPAT_MODES.has(entry.multiplayerCompatibility.trim()))
    ) {
      return {
        ok: false,
        status: 400,
        error: 'INVALID_MOD_METADATA',
        message: `Invalid multiplayerCompatibility mode for mod "${modId}".`,
      };
    }
    if (entry.dependencies !== undefined) {
      if (!Array.isArray(entry.dependencies)) {
        return {
          ok: false,
          status: 400,
          error: 'INVALID_MOD_METADATA',
          message: `Mod "${modId}" dependencies must be an array.`,
        };
      }
      if (entry.dependencies.length > MAX_DEPS_PER_MOD) {
        return {
          ok: false,
          status: 413,
          error: 'MOD_METADATA_TOO_LARGE',
          message: `Mod "${modId}" exceeds maximum dependencies (${MAX_DEPS_PER_MOD}).`,
        };
      }
      for (const dep of entry.dependencies) {
        if (typeof dep === 'string') {
          const dId = dep.trim();
          if (!dId || !SAFE_MOD_ID_PATTERN.test(dId) || FORBIDDEN_PATH_OR_EXEC_PATTERN.test(dId)) {
            return {
              ok: false,
              status: 400,
              error: 'INVALID_MOD_METADATA',
              message: `Invalid dependency id in mod "${modId}".`,
            };
          }
          continue;
        }
        if (!dep || typeof dep !== 'object' || Array.isArray(dep)) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Invalid dependency entry in mod "${modId}".`,
          };
        }
        const depViolation = hasForbiddenLanModFieldOrTraversal(dep);
        if (depViolation) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Dependency in "${modId}": ${depViolation}`,
          };
        }
        const dId = typeof dep.modId === 'string' ? dep.modId.trim() : '';
        if (!dId || !SAFE_MOD_ID_PATTERN.test(dId) || FORBIDDEN_PATH_OR_EXEC_PATTERN.test(dId)) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Invalid dependency modId in mod "${modId}".`,
          };
        }
        if (
          dep.versionRange !== undefined &&
          (typeof dep.versionRange !== 'string' || !isValidLanSemverRange(dep.versionRange.trim()))
        ) {
          return {
            ok: false,
            status: 400,
            error: 'INVALID_MOD_METADATA',
            message: `Invalid dependency versionRange for "${dId}" in "${modId}".`,
          };
        }
      }
    }
  }
  return { ok: true, value: sanitizeLanModMetadata(raw) };
}

function sanitizeLanModMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const modApiVersion =
    typeof raw.modApiVersion === 'number' && Number.isFinite(raw.modApiVersion)
      ? Math.max(1, Math.min(999, Math.round(raw.modApiVersion)))
      : CURRENT_MOD_API_VERSION;
  const schemaVersion =
    typeof raw.schemaVersion === 'number' && Number.isFinite(raw.schemaVersion)
      ? Math.max(1, Math.min(999, Math.round(raw.schemaVersion)))
      : 1;
  const savedAtGameVersion = sanitizeLanModText(raw.savedAtGameVersion, 24, '1.1.25');
  const rawMods = Array.isArray(raw.mods) ? raw.mods : [];
  const modsById = new Map();
  for (let i = 0; i < rawMods.length && modsById.size < MAX_MODS_PER_METADATA; i += 1) {
    const entry = rawMods[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const modId = typeof entry.modId === 'string' ? entry.modId.trim().slice(0, 64) : '';
    if (!modId || !SAFE_MOD_ID_PATTERN.test(modId)) continue;
    const compatRaw =
      typeof entry.multiplayerCompatibility === 'string'
        ? entry.multiplayerCompatibility.trim()
        : 'required';
    const multiplayerCompatibility = VALID_MOD_COMPAT_MODES.has(compatRaw)
      ? compatRaw
      : 'required';
    const entryApiVersion =
      typeof entry.modApiVersion === 'number' && Number.isFinite(entry.modApiVersion)
        ? Math.max(1, Math.min(999, Math.round(entry.modApiVersion)))
        : modApiVersion;
    const entrySchemaVersion =
      typeof entry.schemaVersion === 'number' && Number.isFinite(entry.schemaVersion)
        ? Math.max(1, Math.min(999, Math.round(entry.schemaVersion)))
        : schemaVersion;
    const rawSupportedGame =
      typeof entry.supportedGameVersion === 'string'
        ? entry.supportedGameVersion.trim().slice(0, 32)
        : '';
    const supportedGameVersion =
      rawSupportedGame && isValidLanSemverRange(rawSupportedGame)
        ? rawSupportedGame
        : undefined;
    const rawCompatVer =
      typeof entry.compatibilityVersion === 'string'
        ? entry.compatibilityVersion.trim().slice(0, 32)
        : '';
    const compatibilityVersion =
      rawCompatVer && isValidLanSemverRange(rawCompatVer) ? rawCompatVer : undefined;
    const dependencies = sanitizeLanModDependencies(entry.dependencies);

    modsById.set(modId, {
      modId,
      name: sanitizeLanModText(entry.name, 64, modId),
      version: sanitizeLanModText(entry.version, 32, '1.0.0'),
      ...(supportedGameVersion ? { supportedGameVersion } : {}),
      ...(compatibilityVersion ? { compatibilityVersion } : {}),
      ...(dependencies ? { dependencies } : {}),
      modApiVersion: entryApiVersion,
      schemaVersion: entrySchemaVersion,
      multiplayerCompatibility,
    });
  }
  const mods = Array.from(modsById.values()).sort((a, b) => a.modId.localeCompare(b.modId));
  return { modApiVersion, schemaVersion, savedAtGameVersion, mods };
}

function areLanModVersionsCompatible(hostMod, clientMod) {
  const hostRange = hostMod.compatibilityVersion ? hostMod.compatibilityVersion.trim() : '';
  const clientRange = clientMod.compatibilityVersion ? clientMod.compatibilityVersion.trim() : '';
  if (hostRange || clientRange) {
    const hostOk = hostRange ? satisfiesLanSemverRange(clientMod.version, hostRange) : true;
    const clientOk = clientRange ? satisfiesLanSemverRange(hostMod.version, clientRange) : true;
    return {
      ok: hostOk && clientOk,
      expectedLabel: hostRange ? `${hostRange} (host ${hostMod.version})` : hostMod.version,
    };
  }
  return { ok: clientMod.version === hostMod.version, expectedLabel: hostMod.version };
}

function formatLanModCompatibilityMessage(report) {
  if (report.compatible || report.issues.length === 0) {
    return report.hostModCount === 0 ? 'Vanilla compatible.' : 'Mod configuration is compatible.';
  }
  const missingLines = [];
  const dependencyLines = [];
  const incompatibleLines = [];
  const unsupportedLines = [];
  const extraLines = [];
  for (const issue of report.issues) {
    const label = issue.modName || issue.modId;
    if (issue.code === 'missing_mod' || issue.code === 'disabled_mod') {
      missingLines.push(`- ${label} (${issue.expectedVersion || issue.modId})`);
    } else if (issue.code === 'missing_dependency') {
      dependencyLines.push(
        `- ${label}${issue.dependencyModId ? ` -> ${issue.dependencyModId}` : ''}${issue.expectedVersion ? ` (${issue.expectedVersion})` : ''}`,
      );
    } else if (issue.code === 'unsupported_mod') {
      unsupportedLines.push(`- ${label}: ${issue.message}`);
    } else if (issue.code === 'extra_active_mod') {
      extraLines.push(`- ${label} (${issue.modId}${issue.actualVersion ? ` ${issue.actualVersion}` : ''})`);
    } else {
      incompatibleLines.push(
        issue.expectedVersion || issue.actualVersion
          ? `- ${label}\n  Required: ${issue.expectedVersion || 'unknown'}\n  Installed: ${issue.actualVersion || 'unknown'}`
          : `- ${label}: ${issue.message}`,
      );
    }
  }
  const lines = ['Cannot join this world.'];
  if (missingLines.length > 0) lines.push('Missing required mods:', ...missingLines);
  if (dependencyLines.length > 0) lines.push('Missing dependencies:', ...dependencyLines);
  if (incompatibleLines.length > 0) lines.push('Incompatible mods:', ...incompatibleLines);
  if (unsupportedLines.length > 0) lines.push('Unsupported mods:', ...unsupportedLines);
  if (extraLines.length > 0) lines.push('Extra active mods not enabled on host:', ...extraLines);
  return lines.join('\n');
}

function verifyLanModCompatibility(rawHostMeta, rawClientMeta, currentGameVersion = '1.1.25') {
  const hostMeta = sanitizeLanModMetadata(rawHostMeta);
  const clientMeta = sanitizeLanModMetadata(rawClientMeta);
  const issues = [];
  const hostMods = hostMeta ? hostMeta.mods : [];
  const clientMods = clientMeta ? clientMeta.mods : [];
  const hostRequiredCount = hostMods.filter(
    (m) => (m.multiplayerCompatibility || 'required') !== 'client_only',
  ).length;
  const effectiveGameVersion = (hostMeta && hostMeta.savedAtGameVersion) || currentGameVersion;
  const clientById = new Map();
  for (const cm of clientMods) clientById.set(cm.modId, cm);

  if (hostMeta) {
    if (hostMeta.modApiVersion > CURRENT_MOD_API_VERSION) {
      issues.push({
        modId: '__mod_api__',
        code: 'api_version_mismatch',
        expectedVersion: `<= v${CURRENT_MOD_API_VERSION}`,
        actualVersion: `v${hostMeta.modApiVersion}`,
        message: `Host requires Mod API v${hostMeta.modApiVersion} (supported <= v${CURRENT_MOD_API_VERSION}).`,
      });
    }
    if (!SUPPORTED_MOD_SCHEMA_VERSIONS.has(hostMeta.schemaVersion)) {
      issues.push({
        modId: '__mod_schema__',
        code: 'schema_version_mismatch',
        expectedVersion: Array.from(SUPPORTED_MOD_SCHEMA_VERSIONS).join(', '),
        actualVersion: String(hostMeta.schemaVersion),
        message: `Host uses unsupported mod schema v${hostMeta.schemaVersion}.`,
      });
    }
  }

  const hostRequiredIds = new Set();
  const hostAllowedClientIds = new Set();
  for (const hostMod of hostMods) {
    const compat = hostMod.multiplayerCompatibility || 'required';
    if (compat === 'client_only') continue;
    hostRequiredIds.add(hostMod.modId);
    hostAllowedClientIds.add(hostMod.modId);
    for (const dep of hostMod.dependencies || []) {
      if (dep.optional !== true) {
        hostAllowedClientIds.add(dep.modId);
      }
    }
    const clientMod = clientById.get(hostMod.modId);
    if (!clientMod) {
      if (compat === 'required') {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'missing_mod',
          expectedVersion: hostMod.compatibilityVersion || hostMod.version,
          message: `Missing required mod "${hostMod.name}" (${hostMod.modId} v${hostMod.version}).`,
        });
      }
      continue;
    }
    if (compat === 'required') {
      const versionCheck = areLanModVersionsCompatible(hostMod, clientMod);
      if (!versionCheck.ok) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'version_mismatch',
          expectedVersion: versionCheck.expectedLabel,
          actualVersion: clientMod.version,
          message: `Mod "${hostMod.name}" version incompatible (Required: ${versionCheck.expectedLabel}, Installed: ${clientMod.version}).`,
        });
      }
      if (
        clientMod.supportedGameVersion &&
        !satisfiesLanSemverRange(effectiveGameVersion, clientMod.supportedGameVersion)
      ) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'unsupported_mod',
          expectedVersion: effectiveGameVersion,
          actualVersion: clientMod.supportedGameVersion,
          message: `Mod "${hostMod.name}" does not support game version ${effectiveGameVersion} (supports ${clientMod.supportedGameVersion}).`,
        });
      }
    }
    if (
      typeof hostMod.modApiVersion === 'number' &&
      typeof clientMod.modApiVersion === 'number' &&
      hostMod.modApiVersion !== clientMod.modApiVersion
    ) {
      issues.push({
        modId: hostMod.modId,
        modName: hostMod.name,
        code: 'api_version_mismatch',
        expectedVersion: `v${hostMod.modApiVersion}`,
        actualVersion: `v${clientMod.modApiVersion}`,
        message: `Mod "${hostMod.name}" API version mismatch (host v${hostMod.modApiVersion}, local v${clientMod.modApiVersion}).`,
      });
    }
    if (
      typeof hostMod.schemaVersion === 'number' &&
      typeof clientMod.schemaVersion === 'number' &&
      hostMod.schemaVersion !== clientMod.schemaVersion
    ) {
      issues.push({
        modId: hostMod.modId,
        modName: hostMod.name,
        code: 'schema_version_mismatch',
        expectedVersion: `v${hostMod.schemaVersion}`,
        actualVersion: `v${clientMod.schemaVersion}`,
        message: `Mod "${hostMod.name}" schema version mismatch (host v${hostMod.schemaVersion}, local v${clientMod.schemaVersion}).`,
      });
    }
    const depCandidates = [...(hostMod.dependencies || []), ...(clientMod.dependencies || [])];
    const checkedDepIds = new Set();
    for (const dep of depCandidates) {
      if (dep.optional === true || checkedDepIds.has(dep.modId)) continue;
      checkedDepIds.add(dep.modId);
      const installedDep = clientById.get(dep.modId);
      if (!installedDep) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'missing_dependency',
          dependencyModId: dep.modId,
          expectedVersion: dep.versionRange,
          message: `Mod "${hostMod.name}" requires dependency "${dep.modId}"${dep.versionRange ? ` (${dep.versionRange})` : ''}.`,
        });
      } else if (
        dep.versionRange &&
        !satisfiesLanSemverRange(installedDep.version, dep.versionRange)
      ) {
        issues.push({
          modId: hostMod.modId,
          modName: hostMod.name,
          code: 'missing_dependency',
          dependencyModId: dep.modId,
          expectedVersion: dep.versionRange,
          actualVersion: installedDep.version,
          message: `Mod "${hostMod.name}" requires dependency "${dep.modId}" (${dep.versionRange}), installed v${installedDep.version}.`,
        });
      }
    }
  }

  for (const clientMod of clientMods) {
    const compat = clientMod.multiplayerCompatibility || 'required';
    if (compat !== 'required') continue;
    if (!hostAllowedClientIds.has(clientMod.modId)) {
      issues.push({
        modId: clientMod.modId,
        modName: clientMod.name,
        code: 'extra_active_mod',
        expectedVersion: hostRequiredCount === 0 ? 'Vanilla (None)' : undefined,
        actualVersion: clientMod.version,
        message:
          hostRequiredCount === 0
            ? `Host is running a Vanilla world. Disable active gameplay mod "${clientMod.name}" (${clientMod.modId}) to join.`
            : `Local gameplay mod "${clientMod.name}" (${clientMod.modId} v${clientMod.version}) is not active on the host.`,
      });
    }
  }

  const compatible = issues.length === 0;
  const report = { compatible, summary: '', hostModCount: hostRequiredCount, issues };
  report.summary = formatLanModCompatibilityMessage(report);
  return report;
}

const AVATAR_COLORS = ['#6ab06e', '#e5a93c', '#58b4d1', '#d96b6b'];
const PARTY_MARKER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
const TIME_PRESET_HOURS = {
  sunrise: 6.0,
  noon: 12.0,
  sunset: 18.0,
  midnight: 0.0,
};
const VALID_WEATHER_STATES = new Set(['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog']);
const VALID_MOVEMENT_STATES = new Set(['idle', 'walking', 'running', 'jumping', 'falling']);
const TIME_SYNC_INTERVAL_MS = 5000;
const MAX_PLAYER_COINS = 99999;
const MAX_PLAYER_LEVEL = 50;

const LAN_WEAPON_SPECS = {
  unarmed: { id: 'unarmed', baseDamage: 9, range: 2.1, cooldownMs: 300, isRanged: false, critMult: 1.0, critChance: 0 },
  'ranger-sword': { id: 'ranger-sword', baseDamage: 26, range: 2.85, cooldownMs: 340, isRanged: false, critMult: 1.5, critChance: 0.18 },
  'wooden-sword': { id: 'wooden-sword', baseDamage: 16, range: 2.6, cooldownMs: 320, isRanged: false, critMult: 1.5, critChance: 0.12 },
  'iron-sword': { id: 'iron-sword', baseDamage: 34, range: 2.95, cooldownMs: 360, isRanged: false, critMult: 1.5, critChance: 0.2 },
  'steel-sword': { id: 'steel-sword', baseDamage: 44, range: 3.05, cooldownMs: 320, isRanged: false, critMult: 1.5, critChance: 0.26 },
  'woodland-axe': { id: 'woodland-axe', baseDamage: 42, range: 2.95, cooldownMs: 580, isRanged: false, critMult: 1.75, critChance: 0.15 },
  'battle-axe': { id: 'battle-axe', baseDamage: 52, range: 3.1, cooldownMs: 620, isRanged: false, critMult: 1.75, critChance: 0.18 },
  'hunter-knife': { id: 'hunter-knife', baseDamage: 22, range: 2.25, cooldownMs: 210, isRanged: false, critMult: 1.75, critChance: 0.34 },
  spear: { id: 'spear', baseDamage: 36, range: 3.85, cooldownMs: 440, isRanged: false, critMult: 1.6, critChance: 0.22 },
  'stone-club': { id: 'stone-club', baseDamage: 22, range: 2.65, cooldownMs: 620, isRanged: false, critMult: 1.5, critChance: 0.12 },
  'copper-sword': { id: 'copper-sword', baseDamage: 24, range: 2.8, cooldownMs: 410, isRanged: false, critMult: 1.5, critChance: 0.17 },
  'bronze-spear': { id: 'bronze-spear', baseDamage: 30, range: 3.7, cooldownMs: 520, isRanged: false, critMult: 1.6, critChance: 0.2 },
  'silver-sword': { id: 'silver-sword', baseDamage: 40, range: 3.0, cooldownMs: 390, isRanged: false, critMult: 1.5, critChance: 0.24 },
  'hunter-bow': {
    id: 'hunter-bow',
    baseDamage: 32,
    minDamage: 10,
    maxDamage: 50,
    range: 52,
    cooldownMs: 360,
    isRanged: true,
    critMult: 1.65,
    critChance: 0.24,
    headshotMult: 2.0,
    minSpeed: 15,
    maxSpeed: 45,
    gravity: 9.8,
  },
  crossbow: {
    id: 'crossbow',
    baseDamage: 46,
    minDamage: 16,
    maxDamage: 66,
    range: 58,
    cooldownMs: 560,
    isRanged: true,
    critMult: 1.65,
    critChance: 0.28,
    headshotMult: 2.0,
    minSpeed: 22,
    maxSpeed: 56,
    gravity: 6.2,
  },
};

const MOD_WEAPON_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}:[a-z0-9][a-z0-9._-]{0,63}$/i;

function resolveLanWeaponSpec(weaponId) {
  if (typeof weaponId !== 'string' || !weaponId) return null;
  if (Object.prototype.hasOwnProperty.call(LAN_WEAPON_SPECS, weaponId)) {
    return LAN_WEAPON_SPECS[weaponId];
  }
  if (weaponId.length <= 96 && MOD_WEAPON_ID_PATTERN.test(weaponId)) {
    const isBow = /bow|crossbow/i.test(weaponId);
    if (isBow) {
      return {
        id: weaponId,
        baseDamage: 32,
        minDamage: 10,
        maxDamage: 50,
        range: 52,
        cooldownMs: 420,
        isRanged: true,
        critMult: 1.6,
        critChance: 0.2,
        headshotMult: 2.0,
        minSpeed: 15,
        maxSpeed: 45,
        gravity: 9.8,
      };
    }
    return {
      id: weaponId,
      baseDamage: 28,
      range: 3.1,
      cooldownMs: 380,
      isRanged: false,
      critMult: 1.5,
      critChance: 0.16,
    };
  }
  return null;
}

const LAN_ENEMY_MAX_HP = {
  bandit_scout: 65,
  thorn_stalker: 50,
  stone_sentinel: 120,
  ancient_monster: 95,
  ancient_guardian: 420,
};

const LAN_ANIMAL_MAX_HP = {
  deer: 55,
  rabbit: 22,
  wolf: 68,
  bear: 135,
  bird: 14,
  cow: 80,
  sheep: 45,
  chicken: 16,
};

const LAN_NPC_MAX_HP = {
  guard: 140,
  default: 100,
};

const LAN_ENEMY_ATTACK_MAX_DAMAGE = {
  bandit_scout: 18,
  thorn_stalker: 16,
  stone_sentinel: 32,
  ancient_monster: 30,
  ancient_guardian: 58,
  wolf: 15,
  bear: 28,
  default: 30,
};

const LAN_ENEMY_REWARDS = {
  bandit_scout: { xp: 28, coins: 14 },
  thorn_stalker: { xp: 24, coins: 10 },
  stone_sentinel: { xp: 48, coins: 28 },
  ancient_monster: { xp: 42, coins: 22 },
  ancient_guardian: { xp: 180, coins: 95 },
};

const LAN_ENEMY_LOOT_TABLES = {
  bandit_scout: {
    archetype: 'bandit_scout',
    isBoss: false,
    personal: { xp: 28, coins: 14, items: [{ itemId: 'arrow', count: 3, chance: 0.7 }] },
    shared: null,
    worldDrops: [{ itemId: 'hearth-loaf', count: 1, label: 'Sunstone Hearth Loaf', chance: 0.45 }],
  },
  thorn_stalker: {
    archetype: 'thorn_stalker',
    isBoss: false,
    personal: { xp: 24, coins: 10, items: [{ itemId: 'meadow-herb', count: 1, chance: 0.65 }] },
    shared: null,
    worldDrops: [{ itemId: 'mushroom', count: 1, label: 'Forest Mushroom', chance: 0.5 }],
  },
  stone_sentinel: {
    archetype: 'stone_sentinel',
    isBoss: false,
    personal: { xp: 48, coins: 28, items: [{ itemId: 'iron-ore', count: 2, chance: 0.85 }] },
    shared: { xpPool: 24, coinsPool: 16, items: [{ itemId: 'coal', count: 2 }] },
    worldDrops: [{ itemId: 'rare-mineral', count: 1, label: 'Sunstone Crystal', chance: 0.65 }],
  },
  ancient_monster: {
    archetype: 'ancient_monster',
    isBoss: false,
    personal: { xp: 42, coins: 22, items: [{ itemId: 'iron-ore', count: 1, chance: 0.75 }] },
    shared: { xpPool: 20, coinsPool: 14, items: [] },
    worldDrops: [{ itemId: 'apothecary-tonic', count: 1, label: 'Apothecary Vitality Tonic', chance: 0.4 }],
  },
  ancient_guardian: {
    archetype: 'ancient_guardian',
    isBoss: true,
    personal: { xp: 180, coins: 95, items: [{ itemId: 'apothecary-tonic', count: 1, chance: 1 }] },
    shared: { xpPool: 120, coinsPool: 80, items: [{ itemId: 'rare-mineral', count: 2 }] },
    worldDrops: [
      { itemId: 'gold-ore', count: 3, label: 'Gold Ore Cache', chance: 1 },
      { itemId: 'steel-sword', count: 1, label: 'Tempered Steel Blade', chance: 0.5 },
    ],
  },
};

function resolveEntityMaxHp(kind, archetype) {
  if (kind === 'enemy') {
    return LAN_ENEMY_MAX_HP[archetype] || 80;
  }
  if (kind === 'animal') {
    return LAN_ANIMAL_MAX_HP[archetype] || 50;
  }
  return LAN_NPC_MAX_HP[archetype] || LAN_NPC_MAX_HP.default;
}

function isBossArchetypeOrFlag(kind, archetype, isBossFlag) {
  return Boolean(isBossFlag || (kind === 'enemy' && archetype === 'ancient_guardian'));
}

function deterministicLootRoll(seedKey) {
  const digest = crypto.createHash('sha256').update(String(seedKey)).digest();
  const val = digest.readUInt32BE(0);
  return val / 4294967296;
}

function getLocalIpv4Addresses() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!Array.isArray(list)) continue;
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Prefer private RFC1918 Wi-Fi/Ethernet LAN addresses
      const isPrivate =
        info.address.startsWith('192.168.') ||
        info.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(info.address);
      candidates.push({ name, address: info.address, isPrivate });
    }
  }
  candidates.sort((a, b) => Number(b.isPrivate) - Number(a.isPrivate));
  return candidates.map((c) => c.address);
}

function getPrimaryLanIp() {
  const ips = getLocalIpv4Addresses();
  return ips[0] || '127.0.0.1';
}

function randomId(prefix, bytes = 8) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
}

function generateLanCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(4);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += chars[buf[i] % chars.length];
  }
  return out;
}

function sanitizeText(raw, maxLen, fallback = '') {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

function encodeWsFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodeWsCloseFrame(code = 1000, reason = '') {
  const reasonBuf = Buffer.from(String(reason).slice(0, 100), 'utf8');
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  const header = Buffer.alloc(2);
  header[0] = 0x88;
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

function createWsSocketWrapper(rawSocket) {
  let recvBuffer = Buffer.alloc(0);
  let closed = false;
  const listeners = { message: [], close: [] };

  function emitClose(code, reason) {
    if (closed) return;
    closed = true;
    for (const fn of listeners.close) {
      try {
        fn(code, reason);
      } catch {
        // Ignore handler errors
      }
    }
  }

  rawSocket.on('data', (chunk) => {
    if (closed) return;
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 2) {
      const b0 = recvBuffer[0];
      const b1 = recvBuffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (recvBuffer.length < 4) return;
        payloadLen = recvBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (recvBuffer.length < 10) return;
        const bigLen = recvBuffer.readBigUInt64BE(2);
        if (bigLen > BigInt(MAX_WS_PAYLOAD_BYTES)) {
          wrapper.close(1009, 'Message too large');
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      if (payloadLen > MAX_WS_PAYLOAD_BYTES) {
        wrapper.close(1009, 'Message too large');
        return;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = offset + maskLen + payloadLen;
      if (recvBuffer.length < totalLen) return;

      let payload = recvBuffer.subarray(offset + maskLen, totalLen);
      if (masked) {
        const maskKey = recvBuffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i & 3];
        }
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }

      recvBuffer = recvBuffer.subarray(totalLen);

      if (opcode === 0x8) {
        // Close frame
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        try {
          rawSocket.write(encodeWsCloseFrame(1000, ''));
        } catch {
          // Ignore
        }
        rawSocket.end();
        emitClose(code, reason);
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        try {
          rawSocket.write(encodeWsFrame(payload.toString('utf8'), 0x0a));
        } catch {
          // Ignore
        }
      } else if (opcode === 0x1) {
        const text = payload.toString('utf8');
        for (const fn of listeners.message) {
          try {
            fn(text);
          } catch {
            // Ignore handler errors
          }
        }
      }
    }
  });

  rawSocket.on('close', () => emitClose(1006, 'Socket closed'));
  rawSocket.on('error', () => emitClose(1006, 'Socket error'));

  const wrapper = {
    isOpen: () => !closed && !rawSocket.destroyed && rawSocket.writable,
    send(obj) {
      if (!wrapper.isOpen()) return false;
      try {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
        rawSocket.write(encodeWsFrame(text, 0x1));
        return true;
      } catch {
        return false;
      }
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      try {
        rawSocket.write(encodeWsCloseFrame(code, reason));
      } catch {
        // Ignore
      }
      try {
        rawSocket.end();
      } catch {
        // Ignore
      }
      emitClose(code, reason);
    },
    onMessage(fn) {
      listeners.message.push(fn);
    },
    onClose(fn) {
      listeners.close.push(fn);
    },
  };

  return wrapper;
}

class OfflineLanServer {
  constructor() {
    this.httpServer = null;
    this.discoverySocket = null;
    this.timeSyncTimer = null;
    this.port = DEFAULT_LAN_PORT;
    this.room = null;
    this.sessions = new Map(); // playerId -> { token, ws, player }
    this.chatHistory = [];
    this.seqCounter = 0;
  }

  materializeWorldTime(now = Date.now()) {
    if (!this.room || !this.room.worldTime) {
      return {
        worldHours: 8.5,
        dayCount: 1,
        timeScale: 1,
        paused: false,
        fullDayDurationSeconds: 360,
        anchorServerMs: now,
      };
    }
    const wt = this.room.worldTime;
    const fullDaySec =
      typeof wt.fullDayDurationSeconds === 'number' && Number.isFinite(wt.fullDayDurationSeconds)
        ? Math.max(30, Math.min(1800, wt.fullDayDurationSeconds))
        : 360;
    const timeScale =
      typeof wt.timeScale === 'number' && Number.isFinite(wt.timeScale)
        ? Math.max(0, Math.min(10, wt.timeScale))
        : 1;
    let worldHours =
      typeof wt.worldHours === 'number' && Number.isFinite(wt.worldHours)
        ? ((wt.worldHours % 24) + 24) % 24
        : 8.5;
    let dayCount =
      typeof wt.dayCount === 'number' && Number.isFinite(wt.dayCount)
        ? Math.max(1, Math.floor(wt.dayCount))
        : 1;
    const anchorMs =
      typeof wt.anchorServerMs === 'number' && Number.isFinite(wt.anchorServerMs)
        ? wt.anchorServerMs
        : now;

    if (!wt.paused && timeScale > 0 && fullDaySec > 0 && now > anchorMs) {
      const elapsedSec = Math.max(0, (now - anchorMs) / 1000);
      const total = worldHours + elapsedSec * (24 / fullDaySec) * timeScale;
      if (total >= 24) {
        dayCount += Math.floor(total / 24);
      }
      worldHours = ((total % 24) + 24) % 24;
    }

    wt.worldHours = Math.round(worldHours * 1000) / 1000;
    wt.dayCount = dayCount;
    wt.timeScale = timeScale;
    wt.paused = Boolean(wt.paused);
    wt.fullDayDurationSeconds = fullDaySec;
    wt.anchorServerMs = now;
    return { ...wt };
  }

  startTimeSyncLoop() {
    this.stopTimeSyncLoop();
    this.timeSyncTimer = setInterval(() => {
      if (!this.room || this.room.status !== 'in-game') return;
      let hasOpenSocket = false;
      for (const sess of this.sessions.values()) {
        if (sess.ws && sess.ws.isOpen()) {
          hasOpenSocket = true;
          break;
        }
      }
      if (!hasOpenSocket) return;
      const now = Date.now();
      const worldTime = this.materializeWorldTime(now);
      this.broadcast('WORLD_TIME_CHANGED', 'server', {
        worldTime,
        serverTimestamp: now,
        updatedBy: this.room.hostId,
      });
    }, TIME_SYNC_INTERVAL_MS);
    if (typeof this.timeSyncTimer.unref === 'function') {
      this.timeSyncTimer.unref();
    }
  }

  stopTimeSyncLoop() {
    if (this.timeSyncTimer) {
      clearInterval(this.timeSyncTimer);
      this.timeSyncTimer = null;
    }
  }

  buildPartySnapshotForPlayer(playerId) {
    if (!this.room) {
      return { party: null, pendingInvites: [], outgoingInvites: [] };
    }
    const player = this.room.players.get(playerId);
    const party = player && player.partyId ? this.room.parties.get(player.partyId) || null : null;
    const pendingInvites = [];
    const outgoingInvites = [];
    for (const inv of this.room.partyInvites.values()) {
      if (inv.status !== 'pending') continue;
      if (inv.toPlayerId === playerId) pendingInvites.push({ ...inv });
      if (inv.fromPlayerId === playerId) outgoingInvites.push({ ...inv });
    }
    return {
      party: party ? this.serializeParty(party) : null,
      pendingInvites,
      outgoingInvites,
    };
  }

  serializeParty(party) {
    return {
      partyId: party.partyId,
      roomId: party.roomId,
      leaderPlayerId: party.leaderPlayerId,
      maxMembers: MAX_LAN_PLAYERS,
      createdAt: party.createdAt,
      activeObjective: party.activeObjective ? { ...party.activeObjective } : null,
      members: party.memberIds
        .map((pid, idx) => {
          const p = this.room ? this.room.players.get(pid) : null;
          if (!p) return null;
          return {
            playerId: p.playerId,
            displayName: p.displayName,
            avatarColor: p.avatarColor,
            level: p.level ?? 1,
            health: p.health ?? 100,
            maxHealth: p.maxHealth ?? 100,
            isDead: Boolean(p.isDead),
            online: true,
            isReady: Boolean(p.partyReady),
            joinedAt: p.partyJoinedAt ?? p.joinedAt,
            markerIndex: idx,
            markerColor: PARTY_MARKER_COLORS[idx % PARTY_MARKER_COLORS.length],
          };
        })
        .filter(Boolean),
    };
  }

  broadcastAllPartyStates() {
    if (!this.room) return;
    for (const pid of this.room.players.keys()) {
      this.sendTo(pid, 'PARTY_STATE', this.buildPartySnapshotForPlayer(pid));
    }
  }

  removePlayerFromParty(playerId) {
    if (!this.room) return;
    const player = this.room.players.get(playerId);
    // Clean up any pending invites involving this player
    for (const [invId, inv] of this.room.partyInvites.entries()) {
      if (inv.fromPlayerId === playerId || inv.toPlayerId === playerId) {
        this.room.partyInvites.delete(invId);
      }
    }
    if (!player || !player.partyId) return;
    const party = this.room.parties.get(player.partyId);
    player.partyId = null;
    player.partyReady = false;
    if (!party) return;
    party.memberIds = party.memberIds.filter((id) => id !== playerId);
    if (party.memberIds.length === 0) {
      this.room.parties.delete(party.partyId);
    } else if (party.leaderPlayerId === playerId) {
      party.leaderPlayerId = party.memberIds[0];
    }
  }

  buildWorldSnapshotForPlayer(playerId, now = Date.now()) {
    if (!this.room) return null;
    const worldTime = this.materializeWorldTime(now);
    const player = this.room.players.get(playerId);
    const deadEntities = [];
    const entityStates = [];
    for (const ent of this.room.entities.values()) {
      if (ent.isDead) {
        deadEntities.push({ id: ent.id, kind: ent.kind });
      }
      entityStates.push({
        id: ent.id,
        kind: ent.kind,
        archetype: ent.archetype,
        x: ent.x,
        y: ent.y,
        z: ent.z,
        yaw: ent.yaw,
        state: ent.state,
        hp: ent.hp,
        maxHp: ent.maxHp,
        isDead: ent.isDead,
        alive: !ent.isDead,
        ...(ent.targetPlayerId ? { targetPlayerId: ent.targetPlayerId } : {}),
        ...(ent.isBoss ? { isBoss: true, bossPhase: ent.bossPhase ?? 1 } : {}),
        ...(ent.attackState ? { attackState: ent.attackState } : {}),
      });
    }
    const bossEncounters = Array.from(this.room.bossEncounters.values()).map((b) => ({
      ...b,
      damageByPlayer: { ...(b.damageByPlayer || {}) },
    }));
    const droppedItems = Array.from(this.room.droppedItems.values()).map((d) => ({ ...d }));

    return {
      openedChests: Array.from(this.room.openedChests || []),
      collectedPickups: Array.from(this.room.collectedPickups || []),
      depletedResources: Array.from((this.room.depletedResources || new Map()).values()).map((r) => ({ ...r })),
      doors: Array.from((this.room.doors || new Map()).entries()).map(([id, isOpen]) => ({
        id,
        isOpen: Boolean(isOpen),
      })),
      placedBeds: Array.from((this.room.placedBeds || new Map()).values()).map((b) => ({ ...b })),
      placedStations: Array.from((this.room.placedStations || new Map()).values()).map((s) => ({ ...s })),
      playerBuildings: Array.from((this.room.playerBuildings || new Map()).values()).map((b) => ({ ...b })),
      villagesDev: Array.from((this.room.villagesDev || new Map()).values()).map((v) => ({
        ...v,
        completedRepairIds: Array.isArray(v.completedRepairIds) ? [...v.completedRepairIds] : [],
        completedProjectIds: Array.isArray(v.completedProjectIds) ? [...v.completedProjectIds] : [],
      })),
      droppedItems,
      quests: [],
      discoveredLandmarks:
        this.room.discoveredLandmarks && this.room.discoveredLandmarks.size > 0
          ? Array.from(this.room.discoveredLandmarks)
          : ['spawn-glade'],
      deadEntities,
      entityStates,
      worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
      worldSettings: {
        worldType: this.room.worldType,
        difficulty: this.room.difficulty,
        pvpEnabled: false,
        friendlyFire: Boolean(this.room.friendlyFire),
        staminaUnlimited: this.room.worldType === 'creative',
        spawnX: 0,
        spawnY: 0,
        spawnZ: 4,
      },
      worldTime,
      worldWeather: { ...this.room.worldWeather },
      serverTimestamp: now,
      partyState: this.buildPartySnapshotForPlayer(playerId),
      coopQuests: [],
      bossEncounters,
      ...(this.room.modMetadata ? { modMetadata: this.room.modMetadata } : {}),
      ...(Array.isArray(this.room.modSpawns) && this.room.modSpawns.length > 0
        ? {
            modSpawns: this.room.modSpawns.map((entry) => {
              const collectors = this.room.perPlayerPickups?.get(entry.instanceId);
              return collectors && collectors.has(playerId)
                ? { ...entry, collectedByPlayers: [playerId] }
                : { ...entry };
            }),
          }
        : {}),
      ...(player
        ? {
            coins: player.coins ?? 0,
            xp: player.xp ?? 0,
            level: player.level ?? 1,
            playerPosition: { ...(player.position || { x: 0, y: 0, z: 4, yaw: 0 }) },
            playerVitals: {
              playerId: player.playerId,
              networkEntityId: player.networkEntityId,
              health: player.health ?? 100,
              maxHealth: player.maxHealth ?? 100,
              isDead: Boolean(player.isDead),
              reviveAtMs: player.reviveAtMs ?? null,
            },
          }
        : {}),
    };
  }

  recordWorldStateGameEvent(eventName, data, playerId, now) {
    if (!this.room || !data || typeof data !== 'object') return;
    switch (eventName) {
      case 'CHEST_OPENED': {
        if (typeof data.chestId === 'string' && data.chestId) {
          this.room.openedChests.add(data.chestId);
        }
        break;
      }
      case 'PLAYER_COLLECTED_RESOURCE': {
        if (typeof data.nodeId === 'string' && data.nodeId) {
          this.room.depletedResources.set(data.nodeId, {
            id: data.nodeId,
            usesRemaining: typeof data.usesRemaining === 'number' ? data.usesRemaining : 0,
            regenAtMs: now + 90_000,
          });
        }
        break;
      }
      case 'ITEM_DROPPED': {
        if (typeof data.dropId === 'string' && typeof data.itemId === 'string') {
          this.room.droppedItems.set(data.dropId, {
            id: data.dropId,
            itemId: data.itemId,
            count: typeof data.count === 'number' ? Math.max(1, Math.round(data.count)) : 1,
            label: typeof data.label === 'string' ? data.label : data.itemId,
            x: Number(data.x) || 0,
            y: Number(data.y) || 0,
            z: Number(data.z) || 0,
            droppedBy: playerId,
          });
        }
        break;
      }
      case 'ITEM_PICKED_UP': {
        const pickupId = typeof data.pickupId === 'string' ? data.pickupId : '';
        if (pickupId) {
          if (data.isPlayerDrop) {
            this.room.droppedItems.delete(pickupId);
          } else if (data.perPlayer) {
            if (!this.room.perPlayerPickups) {
              this.room.perPlayerPickups = new Map();
            }
            let set = this.room.perPlayerPickups.get(pickupId);
            if (!set) {
              set = new Set();
              this.room.perPlayerPickups.set(pickupId, set);
            }
            set.add(playerId);
          } else {
            this.room.collectedPickups.add(pickupId);
            if (Array.isArray(this.room.modSpawns)) {
              const entry = this.room.modSpawns.find((m) => m.instanceId === pickupId);
              if (entry) entry.collected = true;
            }
          }
        }
        break;
      }
      case 'MOD_SPAWNS_SYNC': {
        if (playerId !== this.room.hostId) break;
        const list = Array.isArray(data.modSpawns) ? data.modSpawns : null;
        if (!list) break;
        const replace = data.replace !== false;
        const sanitized = [];
        for (const item of list.slice(0, 64)) {
          if (!item || typeof item !== 'object') continue;
          if (
            typeof item.instanceId !== 'string' ||
            typeof item.modId !== 'string' ||
            typeof item.spawnId !== 'string' ||
            typeof item.contentId !== 'string' ||
            typeof item.contentType !== 'string' ||
            typeof item.x !== 'number' ||
            typeof item.y !== 'number' ||
            typeof item.z !== 'number'
          ) {
            continue;
          }
          const instanceId = item.instanceId.slice(0, 128);
          const perPlayer = Boolean(item.perPlayer);
          const rawQty =
            typeof item.count === 'number' && Number.isFinite(item.count)
              ? item.count
              : typeof item.quantity === 'number' && Number.isFinite(item.quantity)
                ? item.quantity
                : undefined;
          const safeQty =
            rawQty !== undefined && rawQty >= 1
              ? Math.min(999, Math.trunc(rawQty))
              : undefined;
          sanitized.push({
            instanceId,
            modId: item.modId.slice(0, 64),
            spawnId: item.spawnId.slice(0, 64),
            contentId: item.contentId.slice(0, 96),
            contentType: item.contentType.slice(0, 32),
            ...(safeQty !== undefined ? { count: safeQty, quantity: safeQty } : {}),
            x: item.x,
            y: item.y,
            z: item.z,
            rotationX: typeof item.rotationX === 'number' ? item.rotationX : 0,
            rotationY: typeof item.rotationY === 'number' ? item.rotationY : 0,
            rotationZ: typeof item.rotationZ === 'number' ? item.rotationZ : 0,
            scaleX: typeof item.scaleX === 'number' ? item.scaleX : 1,
            scaleY: typeof item.scaleY === 'number' ? item.scaleY : 1,
            scaleZ: typeof item.scaleZ === 'number' ? item.scaleZ : 1,
            ...(perPlayer ? { perPlayer: true } : {}),
            collected:
              Boolean(item.collected) ||
              (!perPlayer && this.room.collectedPickups.has(instanceId)),
            defeated: Boolean(item.defeated),
            ...(typeof item.modelPath === 'string'
              ? { modelPath: item.modelPath.slice(0, 200) }
              : {}),
            ...(typeof item.label === 'string' ? { label: item.label.slice(0, 96) } : {}),
          });
        }
        if (replace) {
          this.room.modSpawns = sanitized;
        } else {
          const existing = Array.isArray(this.room.modSpawns) ? this.room.modSpawns : [];
          const byId = new Map(existing.map((e) => [e.instanceId, e]));
          for (const item of sanitized) {
            byId.set(item.instanceId, item);
          }
          this.room.modSpawns = Array.from(byId.values()).slice(0, 256);
        }
        break;
      }
      case 'DOOR_OPENED':
      case 'DOOR_CLOSED': {
        if (typeof data.doorId === 'string' && data.doorId) {
          this.room.doors.set(data.doorId, eventName === 'DOOR_OPENED');
        }
        break;
      }
      case 'BED_PLACED': {
        if (typeof data.bedId === 'string' && data.bedId) {
          this.room.placedBeds.set(data.bedId, {
            id: data.bedId,
            x: Number(data.x) || 0,
            y: Number(data.y) || 0,
            z: Number(data.z) || 0,
            yaw: Number(data.yaw) || 0,
            ownerId: typeof data.ownerId === 'string' ? data.ownerId : playerId,
          });
        }
        break;
      }
      case 'STATION_PLACED': {
        if (typeof data.stationId === 'string' && data.stationId) {
          this.room.placedStations.set(data.stationId, {
            id: data.stationId,
            stationType: data.stationType === 'furnace' ? 'furnace' : 'crafting_table',
            x: Number(data.x) || 0,
            y: Number(data.y) || 0,
            z: Number(data.z) || 0,
            yaw: Number(data.yaw) || 0,
            ownerId: typeof data.ownerId === 'string' ? data.ownerId : playerId,
          });
        }
        break;
      }
      case 'WORLD_EVENT': {
        if (data.kind === 'landmark_discovered' && typeof data.landmarkId === 'string') {
          this.room.discoveredLandmarks.add(data.landmarkId);
        }
        break;
      }
      case 'PLAYER_BUILD_PLACE': {
        if (typeof data.structureId === 'string' && typeof data.blueprintId === 'string') {
          this.room.playerBuildings.set(data.structureId, {
            id: data.structureId,
            blueprintId: data.blueprintId,
            x: Number(data.x) || 0,
            y: Number(data.y) || 0,
            z: Number(data.z) || 0,
            yaw: Number(data.yaw) || 0,
            structureHp: typeof data.structureHp === 'number' ? data.structureHp : 100,
            maxStructureHp: typeof data.maxStructureHp === 'number' ? data.maxStructureHp : 100,
            ownerId: typeof data.ownerId === 'string' ? data.ownerId : playerId,
            ownerName: typeof data.ownerName === 'string' ? data.ownerName : 'Explorer',
            permissionScope: typeof data.permissionScope === 'string' ? data.permissionScope : 'owner',
            createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : now,
          });
        }
        break;
      }
      case 'PLAYER_BUILD_REPAIR': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st && typeof data.structureHp === 'number') {
          st.structureHp = data.structureHp;
        }
        break;
      }
      case 'PLAYER_BUILD_UPGRADE': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st && typeof data.blueprintId === 'string') {
          st.blueprintId = data.blueprintId;
        }
        break;
      }
      case 'PLAYER_BUILD_PERMS': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st && typeof data.permissionScope === 'string') {
          st.permissionScope = data.permissionScope;
        }
        break;
      }
      case 'PLAYER_BUILD_DEMOLISH': {
        if (typeof data.structureId === 'string') {
          this.room.playerBuildings.delete(data.structureId);
        }
        break;
      }
      case 'PLAYER_FARM_TILL': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st) {
          st.farmSoilPrepared = true;
          st.farmStage = 1;
        }
        break;
      }
      case 'PLAYER_FARM_PLANT': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st && typeof data.cropId === 'string') {
          st.farmCropId = data.cropId;
          st.farmStage = 2;
        }
        break;
      }
      case 'PLAYER_FARM_WATER': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st) {
          st.farmWaterLevel = 1;
        }
        break;
      }
      case 'PLAYER_FARM_HARVEST': {
        const st = typeof data.structureId === 'string' ? this.room.playerBuildings.get(data.structureId) : null;
        if (st) {
          st.farmStage = 1;
          st.farmProgress = 0;
          st.farmCropId = null;
        }
        break;
      }
      case 'VILLAGE_REPAIR':
      case 'VILLAGE_PROJECT':
      case 'VILLAGE_DEFENSE_WON':
      case 'MERCHANT_BUY':
      case 'MERCHANT_SELL': {
        const villageId = typeof data.villageId === 'string' ? data.villageId : '';
        if (!villageId) break;
        let rec = this.room.villagesDev.get(villageId);
        if (!rec) {
          rec = {
            villageId,
            level: 1,
            progressXp: 0,
            reputationPoints: 0,
            completedRepairIds: [],
            completedProjectIds: [],
            cropsHarvestedCount: 0,
            tradesCompletedCount: 0,
            defensesWonCount: 0,
          };
          this.room.villagesDev.set(villageId, rec);
        }
        if (typeof data.villageXp === 'number') rec.progressXp = Math.max(rec.progressXp, data.villageXp);
        if (typeof data.villageRep === 'number') rec.reputationPoints = Math.max(rec.reputationPoints, data.villageRep);
        if (eventName === 'VILLAGE_REPAIR' && typeof data.repairId === 'string' && !rec.completedRepairIds.includes(data.repairId)) {
          rec.completedRepairIds.push(data.repairId);
        }
        if (eventName === 'VILLAGE_PROJECT' && typeof data.projectId === 'string' && !rec.completedProjectIds.includes(data.projectId)) {
          rec.completedProjectIds.push(data.projectId);
        }
        if (eventName === 'VILLAGE_DEFENSE_WON' && typeof data.defensesWonCount === 'number') {
          rec.defensesWonCount = Math.max(rec.defensesWonCount, data.defensesWonCount);
        }
        break;
      }
      default:
        break;
    }
  }

  getStatus() {
    const ip = getPrimaryLanIp();
    return {
      running: Boolean(this.httpServer && this.httpServer.listening),
      ip,
      allIps: getLocalIpv4Addresses(),
      port: this.port,
      address: `${ip}:${this.port}`,
      baseUrl: `http://${ip}:${this.port}`,
      room: this.room ? this.buildRoomSnapshot() : null,
    };
  }

  buildRoomSnapshot() {
    if (!this.room) return null;
    const now = Date.now();
    const worldTime = this.materializeWorldTime(now);
    return {
      roomId: this.room.roomId,
      roomCode: this.room.roomCode,
      roomName: this.room.roomName,
      hostId: this.room.hostId,
      hostName: this.room.hostName,
      maxPlayers: MAX_LAN_PLAYERS,
      status: this.room.status,
      createdAt: this.room.createdAt,
      lastActivityAt: now,
      serverTimestamp: now,
      worldTime,
      worldWeather: { ...this.room.worldWeather },
      players: Array.from(this.room.players.values()).map((p) => ({
        playerId: p.playerId,
        networkEntityId: p.networkEntityId,
        displayName: p.displayName,
        isHost: p.playerId === this.room.hostId,
        isReady: p.isReady,
        joinedAt: p.joinedAt,
        avatarColor: p.avatarColor,
        pingMs: p.pingMs ?? 2,
        connectionQuality: 'excellent',
        level: p.level ?? 1,
        partyId: p.partyId ?? null,
        health: p.health ?? 100,
        maxHealth: p.maxHealth ?? 100,
        isDead: Boolean(p.isDead),
        state: p.state,
      })),
      gameState: {
        worldName: this.room.worldName,
        worldType: this.room.worldType,
        difficulty: this.room.difficulty,
        seed: this.room.seed,
        privacy: 'public',
        isPrivate: false,
        allowFriends: true,
        requireAllReady: false,
        worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
        worldSettings: {
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          pvpEnabled: false,
          friendlyFire: Boolean(this.room.friendlyFire),
          staminaUnlimited: this.room.worldType === 'creative',
          spawnX: 0,
          spawnY: 0,
          spawnZ: 4,
        },
        locked: false,
        hasPassword: false,
        ...(this.room.modMetadata ? { modMetadata: this.room.modMetadata } : {}),
        modCompatibilityStatus: {
          requiredMods: (
            (this.room.modMetadata && this.room.modMetadata.mods) ||
            []
          ).filter((m) => (m.multiplayerCompatibility || 'required') !== 'client_only'),
          compatiblePlayers: Array.from(this.room.players.values()).map((p) => ({
            playerId: p.playerId,
            displayName: p.displayName,
            isHost: p.playerId === this.room.hostId,
          })),
          incompatiblePlayers: (this.room.incompatibleJoinAttempts || []).slice(-20),
        },
      },
    };
  }

  createEnvelope(type, playerId, payload) {
    return {
      type,
      roomId: this.room ? this.room.roomId : '',
      playerId,
      seq: ++this.seqCounter,
      timestamp: Date.now(),
      payload,
    };
  }

  broadcast(type, senderId, payload, excludePlayerId = null) {
    const env = this.createEnvelope(type, senderId, payload);
    const json = JSON.stringify(env);
    for (const [pid, sess] of this.sessions.entries()) {
      if (excludePlayerId && pid === excludePlayerId) continue;
      if (sess.ws && sess.ws.isOpen()) {
        sess.ws.send(json);
      }
    }
  }

  sendTo(playerId, type, payload) {
    const sess = this.sessions.get(playerId);
    if (!sess || !sess.ws || !sess.ws.isOpen()) return;
    sess.ws.send(this.createEnvelope(type, 'server', payload));
  }

  initRoom(options = {}) {
    const hostName = sanitizeText(options.playerName, 24, 'Host');
    const roomName = sanitizeText(options.roomName, 36, 'World of Adventure LAN');
    const worldName = sanitizeText(options.worldName, 36, roomName);
    const allowedWorldTypes = ['normal', 'survival', 'adventure', 'creative'];
    const worldType = allowedWorldTypes.includes(options.worldType)
      ? options.worldType
      : 'normal';
    const difficulty =
      options.difficulty === 'easy' || options.difficulty === 'hard'
        ? options.difficulty
        : 'normal';
    const seed =
      typeof options.seed === 'number' && Number.isFinite(options.seed) && options.seed > 0
        ? Math.floor(Math.abs(options.seed))
        : Math.floor(100000 + Math.random() * 899999);

    const roomId = randomId('lan', 9);
    const roomCode = generateLanCode();
    const hostId = randomId('pl', 8);
    const hostToken = randomId('tok', 16);
    const now = Date.now();

    const optTime = options.worldTime && typeof options.worldTime === 'object' ? options.worldTime : null;
    let initHours = optTime && typeof optTime.worldHours === 'number' && Number.isFinite(optTime.worldHours)
      ? optTime.worldHours
      : 8.5;
    initHours = ((initHours % 24) + 24) % 24;
    const initDayCount =
      optTime && typeof optTime.dayCount === 'number' && Number.isFinite(optTime.dayCount)
        ? Math.max(1, Math.round(optTime.dayCount))
        : 1;
    const initFullDaySec =
      optTime && typeof optTime.fullDayDurationSeconds === 'number' && Number.isFinite(optTime.fullDayDurationSeconds) && optTime.fullDayDurationSeconds > 0
        ? optTime.fullDayDurationSeconds
        : 360;
    const initTimeScale =
      optTime && typeof optTime.timeScale === 'number' && Number.isFinite(optTime.timeScale)
        ? Math.max(0, Math.min(10, optTime.timeScale))
        : 1;
    const initPaused = Boolean(optTime && optTime.paused);

    const optWeather = options.worldWeather && typeof options.worldWeather === 'object' ? options.worldWeather : null;
    const validWeathers = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog'];
    const initCurrentWeather =
      optWeather && validWeathers.includes(optWeather.currentState)
        ? optWeather.currentState
        : 'clear';
    const initTargetWeather =
      optWeather && validWeathers.includes(optWeather.targetState)
        ? optWeather.targetState
        : initCurrentWeather;

    const initialCoins = worldType === 'creative' ? 500 : 0;
    const hostPlayer = {
      playerId: hostId,
      networkEntityId: `net_${hostId}`,
      displayName: hostName,
      isHost: true,
      isReady: true,
      joinedAt: now,
      avatarColor: AVATAR_COLORS[0],
      pingMs: 1,
      level: 1,
      xp: 0,
      coins: initialCoins,
      partyId: null,
      partyReady: false,
      partyJoinedAt: now,
      health: 100,
      maxHealth: 100,
      isDead: false,
      reviveAtMs: null,
      lastDamageAtMs: 0,
      lastAttackAtMs: 0,
      lastSwingId: null,
      lastSwingWeaponId: null,
      lastSwingAtMs: 0,
      lastSwingTargetIds: [],
      lastEnemyAttackAtBySource: new Map(),
      claimedRewardIds: [],
      position: { x: 0, y: 0, z: 4, yaw: 0 },
      state: {
        x: 0,
        y: 0,
        z: 4,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        movementState: 'idle',
        crouching: false,
        grounded: true,
        networkEntityId: `net_${hostId}`,
        health: 100,
        maxHealth: 100,
        isDead: false,
        serverTime: now,
      },
    };

    const openedChests = new Set();
    const collectedPickups = new Set();
    const depletedResources = new Map();
    const doors = new Map();
    const placedBeds = new Map();
    const placedStations = new Map();
    const playerBuildings = new Map();
    const villagesDev = new Map();
    const discoveredLandmarks = new Set(['spawn-glade']);
    const droppedItems = new Map();
    const entities = new Map();

    const savedState =
      options.savedWorldState && typeof options.savedWorldState === 'object'
        ? options.savedWorldState
        : null;
    if (savedState) {
      if (Array.isArray(savedState.openedChests)) {
        for (const id of savedState.openedChests) {
          if (typeof id === 'string' && id) openedChests.add(id);
        }
      }
      if (Array.isArray(savedState.collectedPickups)) {
        for (const id of savedState.collectedPickups) {
          if (typeof id === 'string' && id) collectedPickups.add(id);
        }
      }
      if (Array.isArray(savedState.depletedResources)) {
        for (const r of savedState.depletedResources) {
          if (r && typeof r.id === 'string' && r.id) {
            depletedResources.set(r.id, { ...r });
          }
        }
      }
      if (Array.isArray(savedState.doors)) {
        for (const d of savedState.doors) {
          if (d && typeof d.id === 'string' && d.id) {
            doors.set(d.id, Boolean(d.isOpen));
          }
        }
      }
      if (Array.isArray(savedState.placedBeds)) {
        for (const b of savedState.placedBeds) {
          if (b && typeof b.id === 'string' && b.id) {
            placedBeds.set(b.id, { ...b });
          }
        }
      }
      if (Array.isArray(savedState.placedStations)) {
        for (const s of savedState.placedStations) {
          if (s && typeof s.id === 'string' && s.id) {
            placedStations.set(s.id, { ...s });
          }
        }
      }
      if (Array.isArray(savedState.playerBuildings)) {
        for (const pb of savedState.playerBuildings) {
          if (pb && typeof pb.id === 'string' && pb.id) {
            playerBuildings.set(pb.id, { ...pb });
          }
        }
      }
      if (Array.isArray(savedState.villagesDev)) {
        for (const vd of savedState.villagesDev) {
          if (vd && typeof vd.villageId === 'string' && vd.villageId) {
            villagesDev.set(vd.villageId, {
              ...vd,
              completedRepairIds: Array.isArray(vd.completedRepairIds) ? [...vd.completedRepairIds] : [],
              completedProjectIds: Array.isArray(vd.completedProjectIds) ? [...vd.completedProjectIds] : [],
            });
          }
        }
      }
      if (Array.isArray(savedState.discoveredLandmarks)) {
        for (const lm of savedState.discoveredLandmarks) {
          if (typeof lm === 'string' && lm) discoveredLandmarks.add(lm);
        }
      }
      if (Array.isArray(savedState.droppedItems)) {
        for (const di of savedState.droppedItems) {
          if (di && typeof di.id === 'string' && di.id) {
            droppedItems.set(di.id, { ...di });
          }
        }
      }
      if (Array.isArray(savedState.deadEntities)) {
        for (const de of savedState.deadEntities) {
          if (de && typeof de.id === 'string' && de.id) {
            entities.set(de.id, {
              id: de.id,
              kind: de.kind === 'animal' ? 'animal' : 'enemy',
              archetype: 'default',
              maxHp: 100,
              hp: 0,
              isDead: true,
              diedAtMs: now,
              x: 0,
              y: 0,
              z: 0,
              yaw: 0,
              state: 'dead',
              lastUpdatedAtMs: now,
            });
          }
        }
      }
    }

    const modMetaCheck = validateUntrustedLanModMetadata(options.modMetadata);
    if (!modMetaCheck.ok) {
      return {
        ok: false,
        status: modMetaCheck.status,
        error: modMetaCheck.error,
        message: modMetaCheck.message,
      };
    }

    this.room = {
      roomId,
      roomCode,
      roomName,
      worldName,
      worldType,
      difficulty,
      seed,
      hostId,
      hostName,
      status: 'waiting',
      createdAt: now,
      worldSettingsPermission: 'HOST_ONLY',
      friendlyFire: false,
      modMetadata: modMetaCheck.value,
      incompatibleJoinAttempts: [],
      players: new Map([[hostId, hostPlayer]]),
      parties: new Map(),
      partyInvites: new Map(),
      entities,
      activeArrows: new Map(),
      bossEncounters: new Map(),
      droppedItems,
      openedChests,
      collectedPickups,
      depletedResources,
      doors,
      placedBeds,
      placedStations,
      playerBuildings,
      villagesDev,
      discoveredLandmarks,
      modSpawns: [],
      perPlayerPickups: new Map(),
      worldTime: {
        worldHours: initHours,
        dayCount: initDayCount,
        fullDayDurationSeconds: initFullDaySec,
        timeScale: initTimeScale,
        paused: initPaused,
        anchorServerMs: now,
      },
      worldWeather: {
        currentState: initCurrentWeather,
        targetState: initTargetWeather,
        intensity:
          optWeather && typeof optWeather.intensity === 'number' && Number.isFinite(optWeather.intensity)
            ? Math.max(0, Math.min(1, optWeather.intensity))
            : 0,
        dynamicEnabled: optWeather ? optWeather.dynamicEnabled !== false : true,
        transitionDurationSeconds:
          optWeather && typeof optWeather.transitionDurationSeconds === 'number' && Number.isFinite(optWeather.transitionDurationSeconds)
            ? Math.max(2, Math.min(120, optWeather.transitionDurationSeconds))
            : 14,
        startMs: now,
        durationMs: 240_000,
        endMs: now + 240_000,
      },
    };

    this.sessions.clear();
    this.sessions.set(hostId, { token: hostToken, ws: null, player: hostPlayer });
    this.chatHistory = [];
    this.startTimeSyncLoop();

    return {
      ok: true,
      room: this.buildRoomSnapshot(),
      playerId: hostId,
      sessionToken: hostToken,
      wsPath: `/api/multiplayer/ws?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(hostId)}&token=${encodeURIComponent(hostToken)}`,
    };
  }

  joinPlayer(options = {}) {
    if (!this.room) {
      return { status: 404, body: { ok: false, error: 'ROOM_NOT_FOUND', message: 'LAN game not found.' } };
    }
    const codeOrId = String(options.roomCodeOrId || '').trim();
    if (
      codeOrId &&
      codeOrId.toUpperCase() !== this.room.roomCode.toUpperCase() &&
      codeOrId !== this.room.roomId
    ) {
      return { status: 404, body: { ok: false, error: 'ROOM_NOT_FOUND', message: 'Invalid LAN code.' } };
    }
    if (this.room.players.size >= MAX_LAN_PLAYERS) {
      return {
        status: 409,
        body: { ok: false, error: 'ROOM_FULL', message: 'LAN GAME FULL (4 / 4 players).' },
      };
    }

    const attemptName = sanitizeText(
      options.playerName,
      24,
      `Player ${this.room.players.size + 1}`,
    );
    const clientModCheck = validateUntrustedLanModMetadata(options.clientModMetadata);
    if (!clientModCheck.ok) {
      if (!Array.isArray(this.room.incompatibleJoinAttempts)) {
        this.room.incompatibleJoinAttempts = [];
      }
      this.room.incompatibleJoinAttempts.push({
        playerName: attemptName,
        attemptedAt: Date.now(),
        reason: clientModCheck.message,
        issues: [],
      });
      if (this.room.incompatibleJoinAttempts.length > 20) {
        this.room.incompatibleJoinAttempts.splice(
          0,
          this.room.incompatibleJoinAttempts.length - 20,
        );
      }
      this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
      return {
        status: clientModCheck.status,
        body: {
          ok: false,
          error: clientModCheck.error,
          message: clientModCheck.message,
        },
      };
    }

    const modCompatibility = verifyLanModCompatibility(
      this.room.modMetadata,
      clientModCheck.value,
    );
    if (!modCompatibility.compatible) {
      if (!Array.isArray(this.room.incompatibleJoinAttempts)) {
        this.room.incompatibleJoinAttempts = [];
      }
      this.room.incompatibleJoinAttempts.push({
        playerName: attemptName,
        attemptedAt: Date.now(),
        reason: modCompatibility.summary,
        issues: modCompatibility.issues,
      });
      if (this.room.incompatibleJoinAttempts.length > 20) {
        this.room.incompatibleJoinAttempts.splice(
          0,
          this.room.incompatibleJoinAttempts.length - 20,
        );
      }
      this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
      return {
        status: 409,
        body: {
          ok: false,
          error: 'MOD_INCOMPATIBLE',
          message: modCompatibility.summary,
          modCompatibility,
          ...(this.room.modMetadata ? { hostModMetadata: this.room.modMetadata } : {}),
        },
      };
    }

    const displayName = sanitizeText(options.playerName, 24, `Player ${this.room.players.size + 1}`);
    const playerId = randomId('pl', 8);
    if (this.room.players.has(playerId)) {
      return { status: 409, body: { ok: false, error: 'DUPLICATE_PLAYER_ID', message: 'Duplicate player ID.' } };
    }
    const token = randomId('tok', 16);
    const now = Date.now();
    const colorIdx = this.room.players.size % AVATAR_COLORS.length;
    const spawnOffset = (this.room.players.size - 1) * 2.2;

    const initialCoins = this.room.worldType === 'creative' ? 500 : 0;
    const player = {
      playerId,
      networkEntityId: `net_${playerId}`,
      displayName,
      isHost: false,
      isReady: false,
      joinedAt: now,
      avatarColor: AVATAR_COLORS[colorIdx],
      pingMs: 4,
      level: 1,
      xp: 0,
      coins: initialCoins,
      partyId: null,
      partyReady: false,
      partyJoinedAt: now,
      health: 100,
      maxHealth: 100,
      isDead: false,
      reviveAtMs: null,
      lastDamageAtMs: 0,
      lastAttackAtMs: 0,
      lastSwingId: null,
      lastSwingWeaponId: null,
      lastSwingAtMs: 0,
      lastSwingTargetIds: [],
      lastEnemyAttackAtBySource: new Map(),
      claimedRewardIds: [],
      position: { x: spawnOffset, y: 0, z: 4, yaw: 0 },
      state: {
        x: spawnOffset,
        y: 0,
        z: 4,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        movementState: 'idle',
        crouching: false,
        grounded: true,
        networkEntityId: `net_${playerId}`,
        health: 100,
        maxHealth: 100,
        isDead: false,
        serverTime: now,
      },
    };

    this.room.players.set(playerId, player);
    this.sessions.set(playerId, { token, ws: null, player });

    const snap = this.buildRoomSnapshot();
    this.broadcast('PLAYER_JOIN', playerId, {
      player: snap.players.find((p) => p.playerId === playerId),
      room: snap,
    }, playerId);
    this.broadcast('ROOM_STATE', 'server', snap);

    return {
      status: 200,
      body: {
        ok: true,
        room: snap,
        playerId,
        sessionToken: token,
        wsPath: `/api/multiplayer/ws?roomId=${encodeURIComponent(this.room.roomId)}&playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`,
      },
    };
  }

  removePlayer(playerId, reason = 'disconnected') {
    if (!this.room || !this.room.players.has(playerId)) return;
    const isHost = playerId === this.room.hostId;
    this.removePlayerFromParty(playerId);
    const sess = this.sessions.get(playerId);
    if (sess && sess.ws && sess.ws.isOpen()) {
      sess.ws.close(1000, reason);
    }
    this.sessions.delete(playerId);
    this.room.players.delete(playerId);

    if (isHost) {
      this.stopTimeSyncLoop();
      // Gracefully close LAN session when host leaves so no client crashes or corrupts saves
      this.broadcast('ROOM_CLOSED', 'server', {
        reason: 'LAN host ended the session.',
      });
      for (const [, other] of this.sessions.entries()) {
        if (other.ws && other.ws.isOpen()) {
          other.ws.close(4000, 'LAN host ended the session.');
        }
      }
      this.sessions.clear();
      this.room = null;
      return;
    }

    const snap = this.buildRoomSnapshot();
    this.broadcast('PLAYER_LEAVE', playerId, { playerId, reason, room: snap });
    this.broadcast('ROOM_STATE', 'server', snap);
    this.broadcastAllPartyStates();
  }

  grantProgression(playerId, deltaXp, deltaCoins, reason) {
    if (!this.room) return null;
    const player = this.room.players.get(playerId);
    if (!player) return null;
    if (deltaCoins !== 0) {
      player.coins = Math.max(0, Math.min(MAX_PLAYER_COINS, Math.round((player.coins || 0) + deltaCoins)));
    }
    if (deltaXp > 0 && (player.level || 1) < MAX_PLAYER_LEVEL) {
      player.xp = (player.xp || 0) + Math.round(deltaXp);
      while (player.level < MAX_PLAYER_LEVEL && player.xp >= player.level * 100) {
        player.xp -= player.level * 100;
        player.level += 1;
      }
      if (player.level >= MAX_PLAYER_LEVEL) {
        player.level = MAX_PLAYER_LEVEL;
        player.xp = 0;
      }
    }
    const payload = {
      playerId,
      coins: player.coins,
      xp: player.xp,
      level: player.level,
      xpToNextLevel: player.level * 100,
      reason,
    };
    this.sendTo(playerId, 'PROGRESSION_UPDATED', payload);
    return payload;
  }

  grantIdempotentReward(playerId, grantId, opts) {
    if (!this.room) return false;
    const player = this.room.players.get(playerId);
    if (!player) return false;
    if (!Array.isArray(player.claimedRewardIds)) {
      player.claimedRewardIds = [];
    }
    if (player.claimedRewardIds.includes(grantId)) {
      return false;
    }
    player.claimedRewardIds.push(grantId);
    if (player.claimedRewardIds.length > 256) {
      player.claimedRewardIds = player.claimedRewardIds.slice(-256);
    }

    const grantedItems = [];
    for (const item of opts.items || []) {
      if (!item || !item.itemId || !(item.count > 0)) continue;
      grantedItems.push({ itemId: item.itemId, count: Math.round(item.count) });
    }
    const xpAmt = Math.max(0, Math.round(opts.xp || 0));
    const coinsAmt = Math.max(0, Math.round(opts.coins || 0));
    this.grantProgression(playerId, xpAmt, coinsAmt, opts.reason || 'reward');

    this.sendTo(playerId, 'LOOT_GRANTED', {
      grantId,
      playerId,
      mode: opts.mode || 'personal',
      sourceKind: opts.sourceKind || 'enemy',
      sourceId: opts.sourceId || '',
      ...(opts.archetype ? { archetype: opts.archetype } : {}),
      xp: xpAmt,
      coins: coinsAmt,
      items: grantedItems,
      reason: opts.reason || 'reward',
      timestamp: opts.now || Date.now(),
    });
    return true;
  }

  syncBossEncounterFromEntity(entity, fallbackTargetId, broadcastIfChanged, now) {
    if (!this.room || !isBossArchetypeOrFlag(entity.kind, entity.archetype, entity.isBoss)) {
      return null;
    }
    entity.isBoss = true;
    const phase = entity.hp <= Math.floor(entity.maxHp * 0.5) ? 2 : 1;
    entity.bossPhase = phase;
    const prev = this.room.bossEncounters.get(entity.id) || null;
    const nextAttackState = entity.attackState || (prev && prev.attackState) || 'idle';
    const nextTargetId =
      entity.targetPlayerId !== undefined
        ? entity.targetPlayerId
        : (prev && prev.targetPlayerId !== undefined ? prev.targetPlayerId : fallbackTargetId);

    const next = {
      bossId: entity.id,
      archetype: entity.archetype,
      hp: entity.hp,
      maxHp: entity.maxHp,
      isDead: entity.isDead,
      state: entity.state,
      attackState: nextAttackState,
      phase,
      targetPlayerId: entity.isDead ? null : nextTargetId,
      damageByPlayer: { ...(entity.damageByPlayer || (prev && prev.damageByPlayer) || {}) },
      x: entity.x,
      y: entity.y,
      z: entity.z,
      yaw: entity.yaw,
      killSeq: entity.killSeq || (prev && prev.killSeq) || 0,
      updatedAtMs: now,
    };

    const significantChange =
      !prev ||
      prev.hp !== next.hp ||
      prev.maxHp !== next.maxHp ||
      prev.isDead !== next.isDead ||
      prev.phase !== next.phase ||
      prev.attackState !== next.attackState ||
      prev.targetPlayerId !== next.targetPlayerId ||
      prev.state !== next.state;

    this.room.bossEncounters.set(entity.id, next);
    if (broadcastIfChanged && significantChange) {
      this.broadcast('BOSS_STATE_UPDATED', this.room.hostId || 'server', {
        ...next,
        damageByPlayer: { ...next.damageByPlayer },
      });
    }
    return next;
  }

  resolveEnemyOrBossLoot(entity, killerId, now) {
    if (!this.room) return;
    entity.killSeq = (entity.killSeq || 0) + 1;
    const killSeq = entity.killSeq;
    const table = LAN_ENEMY_LOOT_TABLES[entity.archetype] || LAN_ENEMY_LOOT_TABLES.bandit_scout;
    const isBoss = isBossArchetypeOrFlag(entity.kind, entity.archetype, entity.isBoss || table.isBoss);

    const killerPersonalItems = [];
    for (const drop of table.personal.items || []) {
      const chance = drop.chance !== undefined ? drop.chance : 1;
      const roll = deterministicLootRoll(`${entity.id}:k${killSeq}:${drop.itemId}:personal`);
      if (roll <= chance) {
        killerPersonalItems.push({ itemId: drop.itemId, count: drop.count });
      }
    }

    this.grantIdempotentReward(killerId, `loot:${entity.id}:k${killSeq}:${killerId}:personal`, {
      mode: 'personal',
      sourceKind: isBoss ? 'boss' : 'enemy',
      sourceId: entity.id,
      archetype: entity.archetype,
      xp: table.personal.xp,
      coins: table.personal.coins,
      items: killerPersonalItems,
      reason: isBoss ? `boss_killed:${entity.archetype}` : 'enemy_killed',
      now,
    });

    const dmgMap = entity.damageByPlayer || {};
    const contributors = Object.keys(dmgMap).filter(
      (pid) => dmgMap[pid] > 0 && this.room.players.has(pid),
    );
    if (!contributors.includes(killerId)) {
      contributors.push(killerId);
    }

    if (isBoss) {
      for (const pid of contributors) {
        if (pid === killerId) continue;
        this.grantIdempotentReward(pid, `loot:${entity.id}:k${killSeq}:${pid}:personal`, {
          mode: 'personal',
          sourceKind: 'boss',
          sourceId: entity.id,
          archetype: entity.archetype,
          xp: Math.max(10, Math.round(table.personal.xp * 0.5)),
          coins: Math.max(5, Math.round(table.personal.coins * 0.5)),
          items: killerPersonalItems,
          reason: `boss_assist:${entity.archetype}`,
          now,
        });
      }
    }

    if (table.shared && contributors.length > 0) {
      const killer = this.room.players.get(killerId);
      const killerParty = killer && killer.partyId ? this.room.parties.get(killer.partyId) : null;
      const partyRecipients = killerParty
        ? killerParty.memberIds.filter((pid) => this.room.players.has(pid))
        : [];
      const sharedRecipients = Array.from(new Set([...contributors, ...partyRecipients]));
      const divisor = Math.max(1, sharedRecipients.length);
      const sharedXpEach = Math.max(5, Math.round(table.shared.xpPool / divisor));
      const sharedCoinsEach = Math.max(3, Math.round(table.shared.coinsPool / divisor));
      const sharedItems = (table.shared.items || []).map((it) => ({
        itemId: it.itemId,
        count: it.count,
      }));

      for (const pid of sharedRecipients) {
        this.grantIdempotentReward(pid, `loot:${entity.id}:k${killSeq}:${pid}:shared`, {
          mode: 'shared',
          sourceKind: isBoss ? 'boss' : 'enemy',
          sourceId: entity.id,
          archetype: entity.archetype,
          xp: sharedXpEach,
          coins: sharedCoinsEach,
          items: sharedItems,
          reason: `shared_loot:${entity.archetype}`,
          now,
        });
      }
    }

    if (table.worldDrops && table.worldDrops.length > 0) {
      for (let i = 0; i < table.worldDrops.length; i++) {
        const wd = table.worldDrops[i];
        const chance = wd.chance !== undefined ? wd.chance : 1;
        const roll = deterministicLootRoll(`${entity.id}:k${killSeq}:${wd.itemId}:world:${i}`);
        if (roll > chance) continue;
        const dropId = `drop_loot_${entity.id}_k${killSeq}_${i}`.slice(0, 64);
        if (this.room.droppedItems.has(dropId)) continue;
        const offsetX = (i - (table.worldDrops.length - 1) * 0.5) * 0.65;
        const dropRecord = {
          id: dropId,
          itemId: wd.itemId,
          count: wd.count,
          label: wd.label || wd.itemId,
          x: Math.round((entity.x + offsetX) * 100) / 100,
          y: Math.round(entity.y * 100) / 100,
          z: Math.round((entity.z + 0.35) * 100) / 100,
          droppedBy: entity.id,
        };
        this.room.droppedItems.set(dropId, dropRecord);
        if (this.room.droppedItems.size > 200) {
          const oldestKey = this.room.droppedItems.keys().next().value;
          if (oldestKey) this.room.droppedItems.delete(oldestKey);
        }
        this.broadcast('GAME_EVENT', killerId, {
          event: 'ITEM_DROPPED',
          data: {
            dropId,
            itemId: wd.itemId,
            count: wd.count,
            label: dropRecord.label,
            x: dropRecord.x,
            y: dropRecord.y,
            z: dropRecord.z,
            droppedBy: entity.id,
            mode: 'world_drop',
          },
          actorId: killerId,
          serverTimestamp: now,
        });
      }
    }
  }

  applyAuthoritativeDamage(
    attackerId,
    targetKind,
    targetId,
    archetype,
    damage,
    isCritOrHeadshot,
    hitX,
    hitY,
    hitZ,
    now,
  ) {
    if (!this.room) return false;
    const attacker = this.room.players.get(attackerId);
    if (!attacker) return false;

    if (targetKind === 'player') {
      if (targetId === attackerId) return false;
      const targetPlayer = this.room.players.get(targetId);
      if (!targetPlayer || targetPlayer.isDead) return false;
      const sameParty = Boolean(
        attacker.partyId && targetPlayer.partyId && attacker.partyId === targetPlayer.partyId,
      );
      if (sameParty) {
        if (!this.room.friendlyFire) {
          this.sendTo(attackerId, 'ERROR', {
            code: 'FRIENDLY_FIRE_DISABLED',
            message: 'Friendly fire is disabled for party members.',
          });
          return false;
        }
      } else {
        return false;
      }
      const targetPos = targetPlayer.position || { x: 0, y: 0, z: 4, yaw: 0 };
      if (Math.hypot(hitX - targetPos.x, hitZ - targetPos.z) > 6.5 || Math.abs(hitY - targetPos.y) > 5.5) {
        this.sendTo(attackerId, 'ERROR', {
          code: 'TARGET_POSITION_MISMATCH',
          message: 'Hit rejected: target player is not at that location.',
        });
        return false;
      }
      targetPlayer.health = Math.max(0, (targetPlayer.health ?? 100) - damage);
      targetPlayer.lastDamageAtMs = now;
      if (targetPlayer.health <= 0) {
        targetPlayer.isDead = true;
        targetPlayer.reviveAtMs = now + 2000;
      }
      if (targetPlayer.state) {
        targetPlayer.state.health = targetPlayer.health;
        targetPlayer.state.isDead = targetPlayer.isDead;
      }
      this.broadcast('PLAYER_VITALS', targetId, {
        playerId: targetId,
        networkEntityId: targetPlayer.networkEntityId,
        health: targetPlayer.health,
        maxHealth: targetPlayer.maxHealth ?? 100,
        isDead: targetPlayer.isDead,
        reviveAtMs: targetPlayer.reviveAtMs,
      });
      if (targetPlayer.isDead) {
        this.broadcast('GAME_EVENT', attackerId, {
          event: 'PLAYER_DIED',
          data: {
            playerId: targetId,
            killerId: attackerId,
            displayName: targetPlayer.displayName,
            x: hitX,
            y: hitY,
            z: hitZ,
          },
          actorId: attackerId,
          serverTimestamp: now,
        });
      }
      return true;
    }

    if (targetKind !== 'npc' && targetKind !== 'animal' && targetKind !== 'enemy') {
      return false;
    }

    let entity = this.room.entities.get(targetId);
    if (!entity) {
      // Auto-seed entity if host hasn't synced this chunk/entity yet (e.g. distant guest or early hit)
      const resolvedArch = sanitizeText(archetype, 48, 'default');
      const maxHp = resolveEntityMaxHp(targetKind, resolvedArch);
      const isBoss = isBossArchetypeOrFlag(targetKind, resolvedArch, false);
      entity = {
        id: targetId,
        kind: targetKind,
        archetype: resolvedArch,
        maxHp,
        hp: maxHp,
        isDead: false,
        diedAtMs: 0,
        x: hitX,
        y: hitY,
        z: hitZ,
        yaw: 0,
        state: 'idle',
        lastUpdatedAtMs: now,
        killSeq: 0,
        damageByPlayer: {},
        targetPlayerId: attackerId,
        isBoss,
        bossPhase: 1,
        attackState: 'idle',
      };
      this.room.entities.set(targetId, entity);
    }

    if (entity.kind !== targetKind) {
      return false;
    }

    const syncStale = now - (entity.lastUpdatedAtMs || 0) > 1500;
    const horizDelta = Math.hypot(hitX - entity.x, hitZ - entity.z);
    const vertDelta = Math.abs(hitY - entity.y);
    if (syncStale && horizDelta <= 24.0 && vertDelta <= 10.0) {
      entity.x = hitX;
      entity.y = hitY;
      entity.z = hitZ;
      entity.lastUpdatedAtMs = now;
    } else if (horizDelta > 6.5 || vertDelta > 5.5) {
      return false;
    }

    if (entity.isDead) {
      return false;
    }

    const actualDamage = Math.min(entity.hp, Math.max(1, damage));
    entity.hp = Math.max(0, entity.hp - damage);
    if (!entity.damageByPlayer) {
      entity.damageByPlayer = {};
    }
    entity.damageByPlayer[attackerId] = (entity.damageByPlayer[attackerId] || 0) + actualDamage;
    entity.targetPlayerId = attackerId;

    const killed = entity.hp <= 0;
    if (killed) {
      entity.isDead = true;
      entity.diedAtMs = now;
    }

    const bossEncounter = this.syncBossEncounterFromEntity(entity, attackerId, true, now);

    const damagedEvent =
      targetKind === 'npc'
        ? 'NPC_DAMAGED'
        : targetKind === 'animal'
          ? 'ANIMAL_DAMAGED'
          : 'ENEMY_DAMAGED';
    const diedEvent =
      targetKind === 'npc'
        ? 'NPC_DIED'
        : targetKind === 'animal'
          ? 'ANIMAL_DIED'
          : 'ENEMY_DIED';

    this.broadcast('GAME_EVENT', attackerId, {
      event: damagedEvent,
      data: {
        targetId,
        archetype: entity.archetype,
        attackerId,
        damage,
        hp: entity.hp,
        maxHp: entity.maxHp,
        isCrit: isCritOrHeadshot,
        isBoss: Boolean(bossEncounter),
        ...(bossEncounter ? { bossPhase: bossEncounter.phase } : {}),
        x: hitX,
        y: hitY,
        z: hitZ,
      },
      actorId: attackerId,
      serverTimestamp: now,
    });

    if (killed) {
      if (targetKind === 'enemy') {
        this.resolveEnemyOrBossLoot(entity, attackerId, now);
        this.broadcast('GAME_EVENT', attackerId, {
          event: diedEvent,
          data: {
            targetId,
            archetype: entity.archetype,
            killerId: attackerId,
            isBoss: Boolean(bossEncounter),
            x: entity.x,
            y: entity.y,
            z: entity.z,
          },
          actorId: attackerId,
          serverTimestamp: now,
        });
      } else {
        if (targetKind === 'animal') {
          this.grantProgression(attackerId, 12, 0, 'animal_hunted');
        }
        this.broadcast('GAME_EVENT', attackerId, {
          event: diedEvent,
          data: {
            targetId,
            archetype: entity.archetype,
            killerId: attackerId,
            x: entity.x,
            y: entity.y,
            z: entity.z,
          },
          actorId: attackerId,
          serverTimestamp: now,
        });
      }
    }

    return true;
  }

  handleWsMessage(playerId, rawText) {
    if (!this.room || !this.room.players.has(playerId)) return;
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const player = this.room.players.get(playerId);
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};

    switch (msg.type) {
      case 'CONNECT': {
        if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
          player.displayName = sanitizeText(payload.displayName, 24, player.displayName);
        }
        const now = Date.now();
        const snap = this.buildRoomSnapshot();
        this.sendTo(playerId, 'CONNECT', {
          playerId,
          room: snap,
        });
        this.broadcast('ROOM_STATE', 'server', snap);
        this.sendTo(playerId, 'PLAYER_VITALS', {
          playerId,
          networkEntityId: player.networkEntityId,
          health: player.health ?? 100,
          maxHealth: player.maxHealth ?? 100,
          isDead: Boolean(player.isDead),
          reviveAtMs: player.reviveAtMs ?? null,
        });
        this.sendTo(playerId, 'PROGRESSION_UPDATED', {
          playerId,
          coins: player.coins ?? 0,
          xp: player.xp ?? 0,
          level: player.level ?? 1,
          xpToNextLevel: (player.level ?? 1) * 100,
          reason: 'reconnect',
        });
        const worldSnap = this.buildWorldSnapshotForPlayer(playerId, now);
        if (worldSnap) {
          this.sendTo(playerId, 'WORLD_SNAPSHOT', worldSnap);
        }
        this.sendTo(playerId, 'CHAT_HISTORY', {
          messages: this.chatHistory.slice(),
        });
        this.sendTo(playerId, 'PARTY_STATE', this.buildPartySnapshotForPlayer(playerId));
        if (this.room.status === 'in-game') {
          this.sendTo(playerId, 'START_GAME', {
            roomId: this.room.roomId,
            roomCode: this.room.roomCode,
            roomName: this.room.roomName,
            seed: this.room.seed,
            worldName: this.room.worldName,
            worldType: this.room.worldType,
            difficulty: this.room.difficulty,
            hostId: this.room.hostId,
            worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
            worldSettings: snap.gameState.worldSettings,
            worldTime: snap.worldTime,
            worldWeather: snap.worldWeather,
            requireAllReady: false,
            ...(this.room.modMetadata ? { modMetadata: this.room.modMetadata } : {}),
            room: snap,
          });
        }
        break;
      }

      case 'PING': {
        this.sendTo(playerId, 'PONG', {
          clientSentAt: typeof payload.clientSentAt === 'number' ? payload.clientSentAt : Date.now(),
          serverTimestamp: Date.now(),
        });
        break;
      }

      case 'READY': {
        player.isReady = Boolean(payload.ready);
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'START_GAME': {
        if (playerId !== this.room.hostId) return;
        const now = Date.now();
        this.room.status = 'in-game';
        // Anchor world time cleanly at game start
        this.materializeWorldTime(now);
        const snap = this.buildRoomSnapshot();
        this.broadcast('ROOM_STATE', 'server', snap);
        for (const [pid, pl] of this.room.players.entries()) {
          this.sendTo(pid, 'PLAYER_VITALS', {
            playerId: pid,
            networkEntityId: pl.networkEntityId,
            health: pl.health ?? 100,
            maxHealth: pl.maxHealth ?? 100,
            isDead: Boolean(pl.isDead),
            reviveAtMs: pl.reviveAtMs ?? null,
          });
          this.sendTo(pid, 'PROGRESSION_UPDATED', {
            playerId: pid,
            coins: pl.coins ?? 0,
            xp: pl.xp ?? 0,
            level: pl.level ?? 1,
            xpToNextLevel: (pl.level ?? 1) * 100,
            reason: 'start_game',
          });
          const wsSnap = this.buildWorldSnapshotForPlayer(pid, now);
          if (wsSnap) this.sendTo(pid, 'WORLD_SNAPSHOT', wsSnap);
        }
        this.broadcast('START_GAME', playerId, {
          roomId: this.room.roomId,
          roomCode: this.room.roomCode,
          roomName: this.room.roomName,
          seed: this.room.seed,
          worldName: this.room.worldName,
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          hostId: this.room.hostId,
          worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
          worldSettings: snap.gameState.worldSettings,
          worldTime: snap.worldTime,
          worldWeather: snap.worldWeather,
          requireAllReady: false,
          ...(this.room.modMetadata ? { modMetadata: this.room.modMetadata } : {}),
          room: snap,
        });
        break;
      }

      case 'PLAYER_STATE': {
        const x = Number(payload.x);
        const y = Number(payload.y);
        const z = Number(payload.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        const now = Date.now();
        const roundedX = Math.round(x * 1000) / 1000;
        const roundedY = Math.round(y * 1000) / 1000;
        const roundedZ = Math.round(z * 1000) / 1000;
        const roundedYaw = Number.isFinite(Number(payload.yaw)) ? Math.round(Number(payload.yaw) * 1000) / 1000 : 0;
        player.position = { x: roundedX, y: roundedY, z: roundedZ, yaw: roundedYaw };
        const flatState = {
          x: roundedX,
          y: roundedY,
          z: roundedZ,
          yaw: roundedYaw,
          vx: Number.isFinite(Number(payload.vx)) ? Math.round(Number(payload.vx) * 100) / 100 : 0,
          vy: Number.isFinite(Number(payload.vy)) ? Math.round(Number(payload.vy) * 100) / 100 : 0,
          vz: Number.isFinite(Number(payload.vz)) ? Math.round(Number(payload.vz) * 100) / 100 : 0,
          movementState: VALID_MOVEMENT_STATES.has(payload.movementState) ? payload.movementState : 'idle',
          sprinting: Boolean(payload.sprinting),
          jumping: Boolean(payload.jumping),
          crouching: Boolean(payload.crouching),
          grounded: payload.grounded !== false,
          networkEntityId: player.networkEntityId,
          health: player.health ?? 100,
          maxHealth: player.maxHealth ?? 100,
          isDead: Boolean(player.isDead),
          serverTime: now,
        };
        if (Number.isFinite(Number(payload.aimYaw))) {
          flatState.aimYaw = Math.round(Number(payload.aimYaw) * 1000) / 1000;
        }
        if (Number.isFinite(Number(payload.pitch))) {
          flatState.pitch = Math.round(Number(payload.pitch) * 1000) / 1000;
        }
        if (typeof payload.animState === 'string' && payload.animState.length > 0) {
          flatState.animState = payload.animState.slice(0, 32);
        }
        if (payload.weaponId === null) {
          flatState.weaponId = null;
        } else if (typeof payload.weaponId === 'string' && payload.weaponId.length > 0) {
          flatState.weaponId = payload.weaponId.slice(0, 96);
        }
        if (typeof payload.bowCharging === 'boolean') {
          flatState.bowCharging = payload.bowCharging;
        }
        if (Number.isFinite(Number(payload.bowCharge))) {
          flatState.bowCharge = Math.max(0, Math.min(1, Math.round(Number(payload.bowCharge) * 100) / 100));
        }
        if (typeof payload.shooting === 'boolean') {
          flatState.shooting = payload.shooting;
        }
        if (typeof payload.reloading === 'boolean') {
          flatState.reloading = payload.reloading;
        }
        if (typeof payload.seq === 'number' && Number.isInteger(payload.seq) && payload.seq >= 0) {
          flatState.seq = payload.seq;
        }
        player.state = flatState;
        // Relay flat PlayerNetworkState directly so parseRelayedPlayerStatePayload accepts it
        this.broadcast('PLAYER_STATE', playerId, flatState, playerId);
        break;
      }

      case 'ENTITY_SYNC': {
        // Only authoritative LAN host broadcasts shared NPC/enemy/animal states
        if (playerId !== this.room.hostId) return;
        if (this.room.status !== 'in-game') return;
        if (!Array.isArray(payload.entities)) return;
        const now = Date.now();
        const relayedEntities = [];

        for (const delta of payload.entities) {
          if (!delta || typeof delta.id !== 'string' || !delta.id) continue;
          const kind = delta.kind;
          if (kind !== 'enemy' && kind !== 'animal' && kind !== 'npc') continue;
          const archetype = sanitizeText(delta.archetype, 48, 'default');
          const capMaxHp = resolveEntityMaxHp(kind, archetype);
          const isBoss = isBossArchetypeOrFlag(kind, archetype, delta.isBoss);
          const dx = Number.isFinite(Number(delta.x)) ? Number(delta.x) : 0;
          const dy = Number.isFinite(Number(delta.y)) ? Number(delta.y) : 0;
          const dz = Number.isFinite(Number(delta.z)) ? Number(delta.z) : 0;
          const dyaw = Number.isFinite(Number(delta.yaw)) ? Number(delta.yaw) : 0;
          const dstate = typeof delta.state === 'string' && delta.state ? delta.state.slice(0, 32) : 'idle';

          let tracked = this.room.entities.get(delta.id);
          if (!tracked) {
            const initMaxHp =
              typeof delta.maxHp === 'number' && Number.isFinite(delta.maxHp)
                ? Math.max(1, Math.min(capMaxHp, delta.maxHp))
                : capMaxHp;
            const initHp =
              typeof delta.hp === 'number' && Number.isFinite(delta.hp)
                ? Math.max(0, Math.min(initMaxHp, delta.hp))
                : initMaxHp;
            const deadInit = Boolean(delta.isDead || initHp <= 0);
            tracked = {
              id: delta.id,
              kind,
              archetype,
              maxHp: initMaxHp,
              hp: deadInit ? 0 : initHp,
              isDead: deadInit,
              diedAtMs: deadInit ? now : 0,
              x: dx,
              y: dy,
              z: dz,
              yaw: dyaw,
              state: dstate,
              lastUpdatedAtMs: now,
              killSeq: 0,
              damageByPlayer: {},
              ...(delta.targetPlayerId !== undefined ? { targetPlayerId: delta.targetPlayerId } : {}),
              ...(isBoss ? { isBoss: true, bossPhase: delta.bossPhase ?? 1 } : {}),
              ...(delta.attackState !== undefined ? { attackState: delta.attackState } : {}),
              ...(delta.dialogueState !== undefined ? { dialogueState: delta.dialogueState } : {}),
              ...(delta.dialoguePlayerId !== undefined ? { dialoguePlayerId: delta.dialoguePlayerId } : {}),
              ...(delta.questState !== undefined ? { questState: delta.questState } : {}),
              ...(delta.schedulePeriod !== undefined ? { schedulePeriod: delta.schedulePeriod } : {}),
              ...(delta.worldId !== undefined ? { worldId: delta.worldId } : {}),
              ...(delta.chunkId !== undefined ? { chunkId: delta.chunkId } : {}),
              alive: !deadInit,
              ...(delta.loaded !== undefined ? { loaded: delta.loaded } : {}),
              ...(delta.questTarget !== undefined ? { questTarget: delta.questTarget } : {}),
            };
            this.room.entities.set(delta.id, tracked);
          } else {
            tracked.x = dx;
            tracked.y = dy;
            tracked.z = dz;
            tracked.yaw = dyaw;
            tracked.state = dstate;
            tracked.lastUpdatedAtMs = now;
            if (delta.worldId !== undefined) tracked.worldId = delta.worldId;
            if (delta.chunkId !== undefined) tracked.chunkId = delta.chunkId;
            if (delta.loaded !== undefined) tracked.loaded = delta.loaded;
            if (delta.questTarget !== undefined) {
              tracked.questTarget = tracked.isDead
                ? { ...delta.questTarget, lifecycle: 'DEFEATED' }
                : delta.questTarget;
            }
            if (delta.targetPlayerId !== undefined) {
              tracked.targetPlayerId = delta.targetPlayerId;
            } else if (kind === 'enemy' && dstate === 'patrol') {
              tracked.targetPlayerId = null;
            }
            if (isBoss) {
              tracked.isBoss = true;
              if (delta.attackState !== undefined) tracked.attackState = delta.attackState;
            }
            if (kind === 'npc') {
              if (delta.dialogueState !== undefined) tracked.dialogueState = delta.dialogueState;
              if (delta.dialoguePlayerId !== undefined) tracked.dialoguePlayerId = delta.dialoguePlayerId;
              if (delta.questState !== undefined) tracked.questState = delta.questState;
              if (delta.schedulePeriod !== undefined) tracked.schedulePeriod = delta.schedulePeriod;
            }
            if (
              tracked.isDead &&
              delta.isDead === false &&
              (typeof delta.hp !== 'number' || delta.hp > 0) &&
              now - (tracked.diedAtMs || 0) >= 15_000
            ) {
              tracked.isDead = false;
              tracked.hp = tracked.maxHp;
              tracked.diedAtMs = 0;
              tracked.damageByPlayer = {};
            }
          }

          tracked.alive = !tracked.isDead;
          if (tracked.isDead && tracked.questTarget) {
            tracked.questTarget = { ...tracked.questTarget, lifecycle: 'DEFEATED' };
          }
          if (isBoss) {
            this.syncBossEncounterFromEntity(tracked, tracked.targetPlayerId ?? null, true, now);
          }

          relayedEntities.push({
            ...delta,
            hp: tracked.hp,
            maxHp: tracked.maxHp,
            isDead: tracked.isDead,
            alive: !tracked.isDead,
            loaded: tracked.loaded ?? true,
            ...(tracked.worldId ? { worldId: tracked.worldId } : {}),
            ...(tracked.chunkId ? { chunkId: tracked.chunkId } : {}),
            ...(tracked.questTarget ? { questTarget: tracked.questTarget } : {}),
            ...(tracked.isBoss ? { isBoss: true, bossPhase: tracked.bossPhase ?? 1 } : {}),
            ...(tracked.targetPlayerId ? { targetPlayerId: tracked.targetPlayerId } : {}),
            ...(tracked.attackState ? { attackState: tracked.attackState } : {}),
            ...(tracked.dialogueState ? { dialogueState: tracked.dialogueState } : {}),
            ...(tracked.dialoguePlayerId ? { dialoguePlayerId: tracked.dialoguePlayerId } : {}),
            ...(tracked.questState ? { questState: tracked.questState } : {}),
            ...(tracked.schedulePeriod ? { schedulePeriod: tracked.schedulePeriod } : {}),
          });
        }

        const worldTime = this.materializeWorldTime(now);
        this.broadcast(
          'ENTITY_SYNC',
          playerId,
          {
            entities: relayedEntities,
            worldHours: worldTime.worldHours,
            weather: this.room.worldWeather.currentState,
          },
          playerId,
        );
        break;
      }

      case 'WORLD_SETTINGS_UPDATE': {
        const isHost = playerId === this.room.hostId;
        if (payload.worldSettingsPermission !== undefined && isHost) {
          if (payload.worldSettingsPermission === 'HOST_ONLY' || payload.worldSettingsPermission === 'ALL_PLAYERS') {
            this.room.worldSettingsPermission = payload.worldSettingsPermission;
          }
        }
        if (typeof payload.friendlyFire === 'boolean' && isHost) {
          this.room.friendlyFire = payload.friendlyFire;
        }
        if (!isHost && this.room.worldSettingsPermission !== 'ALL_PLAYERS') {
          this.sendTo(playerId, 'ERROR', {
            code: 'FORBIDDEN_WORLD_SETTINGS',
            message: 'Host currently restricts world time and weather controls.',
          });
          return;
        }
        const now = Date.now();
        this.materializeWorldTime(now);
        const wt = this.room.worldTime;
        let timeChanged = false;

        if (typeof payload.preset === 'string' && Object.prototype.hasOwnProperty.call(TIME_PRESET_HOURS, payload.preset)) {
          wt.worldHours = TIME_PRESET_HOURS[payload.preset];
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.worldHours === 'number' && Number.isFinite(payload.worldHours)) {
          wt.worldHours = Math.round((((payload.worldHours % 24) + 24) % 24) * 1000) / 1000;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.dayCount === 'number' && Number.isFinite(payload.dayCount)) {
          wt.dayCount = Math.max(1, Math.floor(payload.dayCount));
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.timeScale === 'number' && Number.isFinite(payload.timeScale)) {
          wt.timeScale = Math.max(0, Math.min(10, payload.timeScale));
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.paused === 'boolean') {
          wt.paused = payload.paused;
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (typeof payload.fullDayDurationSeconds === 'number' && Number.isFinite(payload.fullDayDurationSeconds)) {
          wt.fullDayDurationSeconds = Math.max(30, Math.min(1800, payload.fullDayDurationSeconds));
          wt.anchorServerMs = now;
          timeChanged = true;
        }
        if (payload.worldTime && typeof payload.worldTime === 'object') {
          if (typeof payload.worldTime.worldHours === 'number' && Number.isFinite(payload.worldTime.worldHours)) {
            wt.worldHours = Math.round((((payload.worldTime.worldHours % 24) + 24) % 24) * 1000) / 1000;
            wt.anchorServerMs = now;
            timeChanged = true;
          }
        }

        const ww = this.room.worldWeather;
        if (typeof payload.weatherState === 'string' && VALID_WEATHER_STATES.has(payload.weatherState)) {
          ww.currentState = payload.weatherState;
          ww.targetState = payload.weatherState;
          ww.startMs = now;
          const dur =
            typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
              ? Math.max(30_000, Math.min(900_000, payload.durationMs))
              : ww.durationMs || 240_000;
          ww.durationMs = dur;
          ww.endMs = now + dur;
        }
        if (typeof payload.targetWeatherState === 'string' && VALID_WEATHER_STATES.has(payload.targetWeatherState)) {
          ww.targetState = payload.targetWeatherState;
          ww.startMs = now;
          const dur =
            typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
              ? Math.max(30_000, Math.min(900_000, payload.durationMs))
              : ww.durationMs || 240_000;
          ww.durationMs = dur;
          ww.endMs = now + dur;
        }
        if (typeof payload.weatherIntensity === 'number' && Number.isFinite(payload.weatherIntensity)) {
          ww.intensity = Math.max(0, Math.min(1, payload.weatherIntensity));
        }
        if (typeof payload.dynamicEnabled === 'boolean') {
          ww.dynamicEnabled = payload.dynamicEnabled;
        }
        if (typeof payload.transitionDurationSeconds === 'number' && Number.isFinite(payload.transitionDurationSeconds)) {
          ww.transitionDurationSeconds = Math.max(2, Math.min(120, payload.transitionDurationSeconds));
        }

        const worldTimeOut = { ...wt };
        const worldWeatherOut = { ...ww };
        this.broadcast('WORLD_SETTINGS_UPDATED', playerId, {
          worldSettingsPermission: this.room.worldSettingsPermission || 'HOST_ONLY',
          friendlyFire: Boolean(this.room.friendlyFire),
          worldTime: worldTimeOut,
          worldWeather: worldWeatherOut,
          triggerLightning: Boolean(payload.triggerLightning),
          serverTimestamp: now,
          updatedBy: playerId,
        });
        if (timeChanged) {
          this.broadcast('WORLD_TIME_CHANGED', playerId, {
            worldTime: worldTimeOut,
            serverTimestamp: now,
            updatedBy: playerId,
          });
        }
        break;
      }

      case 'ENEMY_ATTACK_PLAYER': {
        if (this.room.status !== 'in-game') return;
        if (playerId !== this.room.hostId) {
          this.sendTo(playerId, 'ERROR', {
            code: 'FORBIDDEN_HOST_ONLY',
            message: 'Only the room host can submit NPC/enemy attacks.',
          });
          return;
        }
        if (this.room.worldType === 'creative') return;
        const targetPlayerId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        const rawDamage = Number(payload.damage);
        if (!targetPlayerId || !sourceId || !Number.isFinite(rawDamage)) return;
        const targetPlayer = this.room.players.get(targetPlayerId);
        if (!targetPlayer || targetPlayer.isDead) return;

        const now = Date.now();
        const lastSrcHit = targetPlayer.lastEnemyAttackAtBySource.get(sourceId) || 0;
        if (now - lastSrcHit < 650) return;

        const sourceEntity = this.room.entities.get(sourceId);
        if (sourceEntity && sourceEntity.isDead) return;

        const resolvedArchetype =
          (sourceEntity && sourceEntity.archetype) ||
          (typeof payload.archetype === 'string' ? payload.archetype : 'default');
        const maxArchetypeDamage =
          LAN_ENEMY_ATTACK_MAX_DAMAGE[resolvedArchetype] || LAN_ENEMY_ATTACK_MAX_DAMAGE.default;
        const damage = Math.max(1, Math.min(maxArchetypeDamage, Math.round(rawDamage)));

        const ax = Number(payload.x);
        const az = Number(payload.z);
        if (Number.isFinite(ax) && Number.isFinite(az)) {
          const isBossSource = Boolean(
            (sourceEntity && sourceEntity.isBoss) || resolvedArchetype === 'ancient_guardian',
          );
          const maxReach = isBossSource ? 13.5 : 9.5;
          const tPos = targetPlayer.position || { x: 0, y: 0, z: 4, yaw: 0 };
          if (Math.hypot(ax - tPos.x, az - tPos.z) > maxReach) return;
          if (sourceEntity) {
            sourceEntity.targetPlayerId = targetPlayerId;
            if (isBossSource) {
              this.syncBossEncounterFromEntity(sourceEntity, targetPlayerId, true, now);
            }
          }
        }

        targetPlayer.lastEnemyAttackAtBySource.set(sourceId, now);
        targetPlayer.health = Math.max(0, (targetPlayer.health ?? 100) - damage);
        targetPlayer.lastDamageAtMs = now;
        if (targetPlayer.health <= 0) {
          targetPlayer.isDead = true;
          targetPlayer.reviveAtMs = now + 2000;
        }
        if (targetPlayer.state) {
          targetPlayer.state.health = targetPlayer.health;
          targetPlayer.state.isDead = targetPlayer.isDead;
        }
        this.broadcast('PLAYER_VITALS', targetPlayerId, {
          playerId: targetPlayerId,
          networkEntityId: targetPlayer.networkEntityId,
          health: targetPlayer.health,
          maxHealth: targetPlayer.maxHealth ?? 100,
          isDead: targetPlayer.isDead,
          reviveAtMs: targetPlayer.reviveAtMs,
        });
        if (targetPlayer.isDead) {
          const tPos = targetPlayer.position || { x: 0, y: 0, z: 4, yaw: 0 };
          this.broadcast('GAME_EVENT', playerId, {
            event: 'PLAYER_DIED',
            data: {
              playerId: targetPlayerId,
              killerId: sourceId,
              displayName: targetPlayer.displayName,
              x: tPos.x,
              y: tPos.y,
              z: tPos.z,
            },
            actorId: playerId,
            serverTimestamp: now,
          });
        }
        break;
      }

      case 'REPAIR_WEAPONS': {
        if (this.room.status !== 'in-game') return;
        const rawCost = Number(payload.costCoins);
        if (!Number.isFinite(rawCost) || rawCost <= 0) return;
        const cost = this.room.worldType === 'creative' ? 0 : Math.max(1, Math.min(500, Math.round(rawCost)));
        if ((player.coins || 0) < cost) {
          this.sendTo(playerId, 'ERROR', {
            code: 'INSUFFICIENT_COINS',
            message: 'Not enough coins to repair weapons.',
          });
          return;
        }
        this.grantProgression(playerId, 0, -cost, 'weapons_repaired');
        break;
      }

      case 'GAME_EVENT': {
        if (typeof payload.event !== 'string') return;
        if (this.room.status !== 'in-game') return;
        const now = Date.now();
        const eventName = payload.event.slice(0, 64);
        const eventData = payload.data && typeof payload.data === 'object' ? payload.data : {};

        if (eventName === 'player:damage-taken') {
          if (this.room.worldType === 'creative' || player.isDead) return;
          if (now - (player.lastDamageAtMs || 0) < 240) return;
          const rawAmount =
            typeof eventData.amount === 'number' && Number.isFinite(eventData.amount)
              ? eventData.amount
              : 0;
          const clampedDamage = Math.max(1, Math.min(55, Math.round(rawAmount)));
          player.health = Math.max(0, (player.health ?? 100) - clampedDamage);
          player.lastDamageAtMs = now;
          if (player.health <= 0) {
            player.isDead = true;
            player.reviveAtMs = now + 2000;
          }
          if (player.state) {
            player.state.health = player.health;
            player.state.isDead = player.isDead;
          }
          this.broadcast('PLAYER_VITALS', playerId, {
            playerId,
            networkEntityId: player.networkEntityId,
            health: player.health,
            maxHealth: player.maxHealth ?? 100,
            isDead: player.isDead,
            reviveAtMs: player.reviveAtMs,
          });
          if (player.isDead) {
            const pPos = player.position || { x: 0, y: 0, z: 4 };
            this.broadcast('GAME_EVENT', playerId, {
              event: 'PLAYER_DIED',
              data: {
                playerId,
                displayName: player.displayName,
                x: pPos.x,
                y: pPos.y,
                z: pPos.z,
              },
              actorId: playerId,
              serverTimestamp: now,
            });
          }
          break;
        }

        if (eventName === 'player:respawn') {
          const spawnX = 0;
          const spawnY = 0;
          const spawnZ = 4;
          player.health = player.maxHealth ?? 100;
          player.isDead = false;
          player.reviveAtMs = null;
          player.position = { x: spawnX, y: spawnY, z: spawnZ, yaw: (player.position && player.position.yaw) || 0 };
          if (player.state) {
            player.state.x = spawnX;
            player.state.y = spawnY;
            player.state.z = spawnZ;
            player.state.health = player.health;
            player.state.isDead = false;
          }
          this.broadcast('PLAYER_VITALS', playerId, {
            playerId,
            networkEntityId: player.networkEntityId,
            health: player.health,
            maxHealth: player.maxHealth ?? 100,
            isDead: false,
            reviveAtMs: null,
          });
          this.sendTo(playerId, 'POSITION_CORRECTION', {
            x: spawnX,
            y: spawnY,
            z: spawnZ,
            yaw: player.position.yaw || 0,
            reason: 'RESPAWN',
          });
          break;
        }

        if (eventName === 'ARROW_FIRED') {
          if (player.isDead) return;
          const weaponId =
            typeof eventData.weaponId === 'string' && eventData.weaponId.length > 0
              ? eventData.weaponId
              : 'hunter-bow';
          const spec = resolveLanWeaponSpec(weaponId);
          if (!spec || !spec.isRanged) {
            this.sendTo(playerId, 'ERROR', {
              code: 'INVALID_WEAPON',
              message: 'Weapon is not a ranged projectile weapon.',
            });
            return;
          }
          if (now - (player.lastAttackAtMs || 0) < spec.cooldownMs * 0.65) {
            this.sendTo(playerId, 'ERROR', {
              code: 'WEAPON_COOLDOWN',
              message: 'Bow fire rate exceeds weapon cooldown.',
            });
            return;
          }
          const pPos = player.position || { x: 0, y: 0, z: 4 };
          const originX =
            typeof eventData.originX === 'number' && Number.isFinite(eventData.originX)
              ? eventData.originX
              : pPos.x;
          const originY =
            typeof eventData.originY === 'number' && Number.isFinite(eventData.originY)
              ? eventData.originY
              : pPos.y + 1.45;
          const originZ =
            typeof eventData.originZ === 'number' && Number.isFinite(eventData.originZ)
              ? eventData.originZ
              : pPos.z;
          if (
            Math.hypot(originX - pPos.x, originZ - pPos.z) > 4.2 ||
            Math.abs(originY - (pPos.y + 1.45)) > 3.5
          ) {
            this.sendTo(playerId, 'ERROR', {
              code: 'INVALID_ORIGIN',
              message: 'Arrow launch origin too far from player position.',
            });
            return;
          }
          const rawDirX = typeof eventData.dirX === 'number' ? eventData.dirX : 0;
          const rawDirY = typeof eventData.dirY === 'number' ? eventData.dirY : 0;
          const rawDirZ = typeof eventData.dirZ === 'number' ? eventData.dirZ : 1;
          const dirLen = Math.hypot(rawDirX, rawDirY, rawDirZ);
          if (
            !Number.isFinite(rawDirX) ||
            !Number.isFinite(rawDirY) ||
            !Number.isFinite(rawDirZ) ||
            dirLen < 0.5 ||
            dirLen > 1.5
          ) {
            this.sendTo(playerId, 'ERROR', {
              code: 'INVALID_DIRECTION',
              message: 'Projectile launch direction vector is invalid.',
            });
            return;
          }
          const dirX = Math.round((rawDirX / dirLen) * 1000) / 1000;
          const dirY = Math.round((rawDirY / dirLen) * 1000) / 1000;
          const dirZ = Math.round((rawDirZ / dirLen) * 1000) / 1000;
          const arrowId =
            typeof eventData.arrowId === 'string' && eventData.arrowId.length > 0
              ? eventData.arrowId.slice(0, 48)
              : `arr_${playerId}_${now}`;
          if (this.room.activeArrows.has(arrowId)) {
            this.sendTo(playerId, 'ERROR', {
              code: 'DUPLICATE_ARROW_ID',
              message: 'Arrow network ID already exists.',
            });
            return;
          }
          const charge =
            typeof eventData.bowCharge === 'number' && Number.isFinite(eventData.bowCharge)
              ? Math.max(0, Math.min(1, eventData.bowCharge))
              : 1;
          const speed = (spec.minSpeed || 15) + charge * ((spec.maxSpeed || 45) - (spec.minSpeed || 15));
          const gravity = spec.gravity || 9.8;
          player.lastAttackAtMs = now;

          if (this.room.activeArrows.size > 160) {
            for (const [k, v] of this.room.activeArrows.entries()) {
              if (now - v.createdAtMs > 6000 || v.consumed) {
                this.room.activeArrows.delete(k);
              }
            }
          }

          this.room.activeArrows.set(arrowId, {
            arrowId,
            shooterId: playerId,
            weaponId,
            charge,
            originX,
            originY,
            originZ,
            dirX,
            dirY,
            dirZ,
            speed,
            gravity,
            createdAtMs: now,
            consumed: false,
          });

          this.broadcast('GAME_EVENT', playerId, {
            event: 'ARROW_FIRED',
            data: {
              arrowId,
              shooterId: playerId,
              weaponId,
              originX,
              originY,
              originZ,
              dirX,
              dirY,
              dirZ,
              speed,
              gravity,
              bowCharge: charge,
            },
            actorId: playerId,
            serverTimestamp: now,
          });
          break;
        }

        if (eventName === 'PROJECTILE_HIT') {
          if (player.isDead) return;
          const arrowId = typeof eventData.arrowId === 'string' ? eventData.arrowId : '';
          const arrow = this.room.activeArrows.get(arrowId);
          if (!arrow || arrow.consumed || arrow.shooterId !== playerId) {
            this.sendTo(playerId, 'ERROR', {
              code: 'INVALID_PROJECTILE',
              message: 'Arrow does not exist or already resolved.',
            });
            return;
          }
          if (now - arrow.createdAtMs > 6500) {
            this.room.activeArrows.delete(arrowId);
            return;
          }
          const spec = resolveLanWeaponSpec(arrow.weaponId);
          if (!spec) {
            this.room.activeArrows.delete(arrowId);
            return;
          }
          const hitX = typeof eventData.x === 'number' && Number.isFinite(eventData.x) ? eventData.x : arrow.originX;
          const hitY = typeof eventData.y === 'number' && Number.isFinite(eventData.y) ? eventData.y : arrow.originY;
          const hitZ = typeof eventData.z === 'number' && Number.isFinite(eventData.z) ? eventData.z : arrow.originZ;
          const flightDist = Math.hypot(hitX - arrow.originX, hitY - arrow.originY, hitZ - arrow.originZ);
          if (flightDist > spec.range + 10) {
            this.sendTo(playerId, 'ERROR', {
              code: 'OUT_OF_RANGE',
              message: 'Projectile hit exceeds maximum weapon range.',
            });
            return;
          }
          if (flightDist > 2.0) {
            const tEst = flightDist / Math.max(8, arrow.speed);
            const dx = hitX - arrow.originX;
            const dy = hitY - arrow.originY + 0.5 * arrow.gravity * tEst * tEst;
            const dz = hitZ - arrow.originZ;
            const compLen = Math.hypot(dx, dy, dz) || 1;
            const dot = (dx / compLen) * arrow.dirX + (dy / compLen) * arrow.dirY + (dz / compLen) * arrow.dirZ;
            if (dot < 0.15) {
              arrow.consumed = true;
              this.room.activeArrows.delete(arrowId);
              this.sendTo(playerId, 'ERROR', {
                code: 'INVALID_PROJECTILE_TRAJECTORY',
                message: 'Projectile impact point contradicts launch direction.',
              });
              return;
            }
          }

          arrow.consumed = true;
          this.room.activeArrows.delete(arrowId);

          const targetKind = typeof eventData.targetKind === 'string' ? eventData.targetKind : 'world';
          const targetId = typeof eventData.targetId === 'string' ? eventData.targetId : '';
          if (targetKind === 'world' || !targetId) {
            this.broadcast('GAME_EVENT', playerId, {
              event: 'PROJECTILE_HIT',
              data: {
                arrowId,
                shooterId: playerId,
                targetKind: 'world',
                targetId: '',
                x: hitX,
                y: hitY,
                z: hitZ,
                isHeadshot: false,
              },
              actorId: playerId,
              serverTimestamp: now,
            });
            break;
          }

          let isHeadshot = false;
          if (eventData.isHeadshot) {
            let targetBaseY = 0;
            if (targetKind === 'player') {
              const tp = this.room.players.get(targetId);
              targetBaseY = (tp && tp.position && tp.position.y) || 0;
            } else {
              const tracked = this.room.entities.get(targetId);
              targetBaseY = (tracked && tracked.y) || 0;
            }
            isHeadshot = hitY >= targetBaseY + 0.9;
          }

          const minD = spec.minDamage ?? spec.baseDamage;
          const maxD = spec.maxDamage ?? spec.baseDamage;
          const baseDmg = minD + arrow.charge * (maxD - minD);
          const damage = Math.max(1, Math.round(baseDmg * (isHeadshot ? (spec.headshotMult || 2.0) : 1)));

          const applied = this.applyAuthoritativeDamage(
            playerId,
            targetKind,
            targetId,
            typeof eventData.archetype === 'string' ? eventData.archetype : 'default',
            damage,
            isHeadshot,
            hitX,
            hitY,
            hitZ,
            now,
          );
          if (applied) {
            this.broadcast('GAME_EVENT', playerId, {
              event: 'PROJECTILE_HIT',
              data: {
                arrowId,
                shooterId: playerId,
                targetKind,
                targetId,
                x: hitX,
                y: hitY,
                z: hitZ,
                isHeadshot,
              },
              actorId: playerId,
              serverTimestamp: now,
            });
          }
          break;
        }

        if (eventName === 'COMBAT_HIT') {
          if (player.isDead) {
            this.sendTo(playerId, 'ERROR', {
              code: 'PLAYER_DEAD',
              message: 'Downed players cannot attack.',
            });
            return;
          }
          const weaponId =
            typeof eventData.weaponId === 'string' && eventData.weaponId.length > 0
              ? eventData.weaponId
              : 'unarmed';
          const spec = resolveLanWeaponSpec(weaponId);
          if (!spec || spec.isRanged) {
            this.sendTo(playerId, 'ERROR', {
              code: 'INVALID_WEAPON',
              message: 'Invalid melee weapon for COMBAT_HIT.',
            });
            return;
          }
          const targetKind = typeof eventData.targetKind === 'string' ? eventData.targetKind : '';
          const targetId = typeof eventData.targetId === 'string' ? eventData.targetId : '';
          if (
            (targetKind !== 'enemy' && targetKind !== 'animal' && targetKind !== 'npc' && targetKind !== 'player') ||
            !targetId
          ) {
            return;
          }
          const attackId =
            typeof eventData.attackId === 'string' && eventData.attackId.length > 0
              ? eventData.attackId.slice(0, 64)
              : null;
          const isSameSwingCleave = Boolean(
            attackId &&
              player.lastSwingId === attackId &&
              player.lastSwingWeaponId === weaponId &&
              now - (player.lastSwingAtMs || 0) <= 320 &&
              Array.isArray(player.lastSwingTargetIds) &&
              !player.lastSwingTargetIds.includes(targetId) &&
              player.lastSwingTargetIds.length < 4,
          );
          if (!isSameSwingCleave && now - (player.lastAttackAtMs || 0) < spec.cooldownMs * 0.65) {
            this.sendTo(playerId, 'ERROR', {
              code: 'WEAPON_COOLDOWN',
              message: 'Attack speed exceeds weapon cooldown.',
            });
            return;
          }
          const pPos = player.position || { x: 0, y: 0, z: 4 };
          const hitX = typeof eventData.x === 'number' && Number.isFinite(eventData.x) ? eventData.x : pPos.x;
          const hitY = typeof eventData.y === 'number' && Number.isFinite(eventData.y) ? eventData.y : pPos.y;
          const hitZ = typeof eventData.z === 'number' && Number.isFinite(eventData.z) ? eventData.z : pPos.z;
          const distToTarget = Math.hypot(hitX - pPos.x, hitZ - pPos.z);
          if (distToTarget > spec.range + 3.4) {
            this.sendTo(playerId, 'ERROR', {
              code: 'OUT_OF_RANGE',
              message: 'Target is out of melee reach.',
            });
            return;
          }

          if (isSameSwingCleave) {
            player.lastSwingTargetIds.push(targetId);
          } else {
            player.lastAttackAtMs = now;
            player.lastSwingId = attackId;
            player.lastSwingWeaponId = weaponId;
            player.lastSwingAtMs = now;
            player.lastSwingTargetIds = [targetId];
          }

          const isCrit = Math.random() < (spec.critChance ?? 0.1);
          const damage = Math.max(1, Math.round(spec.baseDamage * (isCrit ? spec.critMult : 1)));

          this.applyAuthoritativeDamage(
            playerId,
            targetKind,
            targetId,
            typeof eventData.archetype === 'string' ? eventData.archetype : 'default',
            damage,
            isCrit,
            hitX,
            hitY,
            hitZ,
            now,
          );
          break;
        }

        this.recordWorldStateGameEvent(eventName, eventData, playerId, now);
        // Relay non-combat gameplay events (doors, chests, beds, drops, gathering, buildings, farming, etc.)
        this.broadcast('GAME_EVENT', playerId, {
          event: eventName,
          data: eventData,
          actorId: playerId,
          serverTimestamp: now,
        }, playerId);
        break;
      }

      case 'ROOM_CHAT': {
        const text = sanitizeText(payload.message, 240, '');
        if (!text) return;
        const chatMsg = {
          id: randomId('chat', 6),
          playerId,
          playerName: player.displayName,
          message: text,
          timestamp: Date.now(),
        };
        this.chatHistory.push(chatMsg);
        if (this.chatHistory.length > 40) {
          this.chatHistory.shift();
        }
        this.broadcast('ROOM_CHAT', playerId, chatMsg);
        break;
      }

      case 'PARTY_CREATE': {
        if (player.partyId && this.room.parties.has(player.partyId)) {
          this.sendTo(playerId, 'PARTY_STATE', this.buildPartySnapshotForPlayer(playerId));
          break;
        }
        const now = Date.now();
        const partyId = randomId('party', 6);
        const party = {
          partyId,
          roomId: this.room.roomId,
          leaderPlayerId: playerId,
          memberIds: [playerId],
          createdAt: now,
          activeObjective: null,
        };
        this.room.parties.set(partyId, party);
        player.partyId = partyId;
        player.partyReady = true;
        player.partyJoinedAt = now;
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_INVITE': {
        let targetPlayer = null;
        if (typeof payload.targetPlayerId === 'string' && payload.targetPlayerId) {
          targetPlayer = this.room.players.get(payload.targetPlayerId) || null;
        } else if (typeof payload.targetPlayerName === 'string' && payload.targetPlayerName.trim()) {
          const needle = payload.targetPlayerName.trim().toLowerCase();
          for (const p of this.room.players.values()) {
            if (p.displayName.toLowerCase() === needle) {
              targetPlayer = p;
              break;
            }
          }
        }
        if (!targetPlayer || targetPlayer.playerId === playerId) return;

        // Auto-create party for inviter if not already in one
        let party = player.partyId ? this.room.parties.get(player.partyId) : null;
        const now = Date.now();
        if (!party) {
          const partyId = randomId('party', 6);
          party = {
            partyId,
            roomId: this.room.roomId,
            leaderPlayerId: playerId,
            memberIds: [playerId],
            createdAt: now,
            activeObjective: null,
          };
          this.room.parties.set(partyId, party);
          player.partyId = partyId;
          player.partyReady = true;
          player.partyJoinedAt = now;
        }
        if (party.leaderPlayerId !== playerId) {
          this.sendTo(playerId, 'ERROR', {
            code: 'FORBIDDEN_PARTY_LEADER',
            message: 'Only the party leader can invite players.',
          });
          return;
        }
        if (party.memberIds.length >= MAX_LAN_PLAYERS) {
          this.sendTo(playerId, 'ERROR', {
            code: 'PARTY_FULL',
            message: 'Party is full.',
          });
          return;
        }
        if (party.memberIds.includes(targetPlayer.playerId)) return;

        // Avoid duplicate pending invite
        for (const existing of this.room.partyInvites.values()) {
          if (
            existing.status === 'pending' &&
            existing.partyId === party.partyId &&
            existing.toPlayerId === targetPlayer.playerId
          ) {
            this.sendTo(playerId, 'ERROR', {
              code: 'DUPLICATE_PARTY_INVITE',
              message: 'Invite already sent to this player.',
            });
            return;
          }
        }

        const invite = {
          inviteId: randomId('pinv', 6),
          partyId: party.partyId,
          roomId: this.room.roomId,
          fromPlayerId: playerId,
          fromPlayerName: player.displayName,
          toPlayerId: targetPlayer.playerId,
          toPlayerName: targetPlayer.displayName,
          createdAt: now,
          status: 'pending',
        };
        this.room.partyInvites.set(invite.inviteId, invite);
        this.sendTo(targetPlayer.playerId, 'PARTY_INVITE_RECEIVED', invite);
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_ACCEPT_INVITE': {
        const inviteId = typeof payload.inviteId === 'string' ? payload.inviteId : '';
        const invite = this.room.partyInvites.get(inviteId);
        if (!invite || invite.status !== 'pending' || invite.toPlayerId !== playerId) return;
        const party = this.room.parties.get(invite.partyId);
        if (!party) {
          this.room.partyInvites.delete(inviteId);
          this.broadcastAllPartyStates();
          return;
        }
        if (party.memberIds.length >= MAX_LAN_PLAYERS) {
          this.sendTo(playerId, 'ERROR', { code: 'PARTY_FULL', message: 'Party is full.' });
          return;
        }
        if (player.partyId && player.partyId !== party.partyId) {
          this.removePlayerFromParty(playerId);
        }
        invite.status = 'accepted';
        this.room.partyInvites.delete(inviteId);
        if (!party.memberIds.includes(playerId)) {
          party.memberIds.push(playerId);
        }
        player.partyId = party.partyId;
        player.partyReady = false;
        player.partyJoinedAt = Date.now();
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_DECLINE_INVITE': {
        const inviteId = typeof payload.inviteId === 'string' ? payload.inviteId : '';
        const invite = this.room.partyInvites.get(inviteId);
        if (!invite || invite.toPlayerId !== playerId) return;
        this.room.partyInvites.delete(inviteId);
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_LEAVE': {
        this.removePlayerFromParty(playerId);
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_KICK': {
        const targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || targetId === playerId || !player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId) return;
        if (!party.memberIds.includes(targetId)) return;
        this.removePlayerFromParty(targetId);
        this.broadcastAllPartyStates();
        this.broadcast('ROOM_STATE', 'server', this.buildRoomSnapshot());
        break;
      }

      case 'PARTY_TRANSFER_LEADER': {
        const targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || !player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId || !party.memberIds.includes(targetId)) return;
        party.leaderPlayerId = targetId;
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_SET_READY': {
        if (!player.partyId) return;
        player.partyReady = Boolean(payload.ready);
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_START_OBJECTIVE': {
        if (!player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId) return;
        const now = Date.now();
        const obj = {
          objectiveId: randomId('pobj', 6),
          partyId: party.partyId,
          type: typeof payload.type === 'string' ? payload.type : 'explore',
          title: sanitizeText(payload.title, 64, 'Team Objective'),
          targetId: typeof payload.targetId === 'string' ? payload.targetId : undefined,
          targetX: Number.isFinite(Number(payload.targetX)) ? Number(payload.targetX) : undefined,
          targetZ: Number.isFinite(Number(payload.targetZ)) ? Number(payload.targetZ) : undefined,
          targetCount: Number.isFinite(Number(payload.targetCount)) ? Math.max(1, Math.floor(Number(payload.targetCount))) : 1,
          currentCount: 0,
          status: 'active',
          startedAt: now,
          contributions: {},
          rewardsByPlayer: {},
        };
        party.activeObjective = obj;
        for (const memberId of party.memberIds) {
          this.sendTo(memberId, 'PARTY_OBJECTIVE_UPDATED', obj);
        }
        this.broadcastAllPartyStates();
        break;
      }

      case 'PARTY_CANCEL_OBJECTIVE': {
        if (!player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || party.leaderPlayerId !== playerId) return;
        party.activeObjective = null;
        this.broadcastAllPartyStates();
        break;
      }

      case 'COOP_OBJECTIVE_PROGRESS': {
        if (!player.partyId) return;
        const party = this.room.parties.get(player.partyId);
        if (!party || !party.activeObjective || party.activeObjective.status !== 'active') return;
        const obj = party.activeObjective;
        if (typeof payload.objectiveId === 'string' && payload.objectiveId && payload.objectiveId !== obj.objectiveId) return;
        const inc = Number.isFinite(Number(payload.amount)) ? Math.max(1, Math.floor(Number(payload.amount))) : 1;
        obj.currentCount = Math.min(obj.targetCount, obj.currentCount + inc);
        const completed = obj.currentCount >= obj.targetCount;
        if (completed) {
          obj.status = 'completed';
          obj.completedAt = Date.now();
        }
        const evType = completed ? 'PARTY_OBJECTIVE_COMPLETED' : 'PARTY_OBJECTIVE_UPDATED';
        for (const memberId of party.memberIds) {
          this.sendTo(memberId, evType, obj);
        }
        this.broadcastAllPartyStates();
        break;
      }

      case 'LEAVE_ROOM':
      case 'DISCONNECT': {
        this.removePlayer(playerId, 'left');
        break;
      }

      case 'KICK_PLAYER': {
        if (playerId !== this.room.hostId) return;
        const targetId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
        if (!targetId || targetId === this.room.hostId || !this.room.players.has(targetId)) return;
        this.sendTo(targetId, 'PLAYER_KICKED', {
          targetPlayerId: targetId,
          reason: 'Removed by LAN host.',
        });
        this.removePlayer(targetId, 'kicked');
        break;
      }

      case 'CLOSE_ROOM': {
        if (playerId === this.room.hostId) {
          this.removePlayer(playerId, 'closed');
        }
        break;
      }

      default:
        break;
    }
  }

  readJsonBody(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_HTTP_BODY_BYTES) {
          resolve({ ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({ ok: true, data: {} });
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            resolve({ ok: false, status: 400, error: 'INVALID_JSON_BODY' });
            return;
          }
          resolve({ ok: true, data: parsed });
        } catch {
          resolve({ ok: false, status: 400, error: 'INVALID_JSON_BODY' });
        }
      });
      req.on('error', () => resolve({ ok: false, status: 400, error: 'READ_ERROR' }));
    });
  }

  sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  async start(preferredPort = DEFAULT_LAN_PORT, roomOptions = null) {
    if (this.httpServer && this.httpServer.listening) {
      const hostInfo = roomOptions ? this.initRoom(roomOptions) : null;
      return { ok: true, ...this.getStatus(), hostSession: hostInfo };
    }

    this.port = Number(preferredPort) > 1024 && Number(preferredPort) < 65535
      ? Math.floor(Number(preferredPort))
      : DEFAULT_LAN_PORT;

    const server = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        this.sendJson(res, 200, {
          ok: true,
          service: 'world-of-adventure-lan',
          mode: 'offline-lan',
          maxPlayers: MAX_LAN_PLAYERS,
          playerCount: this.room ? this.room.players.size : 0,
          roomCode: this.room ? this.room.roomCode : null,
          roomName: this.room ? this.room.roomName : null,
          hostName: this.room ? this.room.hostName : null,
          status: this.room ? this.room.status : 'idle',
          ...(this.room && this.room.modMetadata ? { modMetadata: this.room.modMetadata } : {}),
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/multiplayer/rooms') {
        const snap = this.buildRoomSnapshot();
        this.sendJson(res, 200, { ok: true, rooms: snap ? [snap] : [] });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/multiplayer/rooms/verify') {
        if (!this.room) {
          this.sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND', message: 'LAN game not found.' });
          return;
        }
        const codeOrId = (url.searchParams.get('codeOrId') || '').trim();
        if (
          codeOrId &&
          codeOrId.toUpperCase() !== this.room.roomCode.toUpperCase() &&
          codeOrId !== this.room.roomId
        ) {
          this.sendJson(res, 404, { ok: false, error: 'ROOM_NOT_FOUND', message: 'Invalid LAN code.' });
          return;
        }
        if (this.room.players.size >= MAX_LAN_PLAYERS) {
          this.sendJson(res, 409, {
            ok: false,
            error: 'ROOM_FULL',
            message: 'LAN GAME FULL (4 / 4 players).',
          });
          return;
        }
        this.sendJson(res, 200, { ok: true, room: this.buildRoomSnapshot() });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/multiplayer/rooms') {
        const parsed = await this.readJsonBody(req);
        if (!parsed.ok) {
          this.sendJson(res, parsed.status, { ok: false, error: parsed.error });
          return;
        }
        const created = this.initRoom(parsed.data);
        if (!created || !created.ok) {
          this.sendJson(res, (created && created.status) || 400, created);
          return;
        }
        this.sendJson(res, 200, created);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/multiplayer/rooms/join') {
        const parsed = await this.readJsonBody(req);
        if (!parsed.ok) {
          this.sendJson(res, parsed.status, { ok: false, error: parsed.error });
          return;
        }
        const result = this.joinPlayer(parsed.data);
        this.sendJson(res, result.status, result.body);
        return;
      }

      this.sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
    });

    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
      if (url.pathname !== '/api/multiplayer/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const roomId = url.searchParams.get('roomId') || '';
      const playerId = url.searchParams.get('playerId') || '';
      const token = url.searchParams.get('token') || '';
      const sess = this.sessions.get(playerId);

      if (!this.room || this.room.roomId !== roomId || !sess || sess.token !== token) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64');

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey}`,
          '\r\n',
        ].join('\r\n'),
      );

      if (sess.ws && sess.ws.isOpen()) {
        sess.ws.close(4002, 'Replaced by newer connection');
      }

      const ws = createWsSocketWrapper(socket);
      sess.ws = ws;
      ws.onMessage((text) => this.handleWsMessage(playerId, text));
      ws.onClose(() => {
        if (sess.ws === ws) {
          this.removePlayer(playerId, 'disconnected');
        }
      });
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        if (err && err.code === 'EADDRINUSE' && this.port === DEFAULT_LAN_PORT) {
          // Retry on an ephemeral port if 41234 is already occupied
          this.port = 0;
          server.listen(0, '0.0.0.0');
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      };
      server.on('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, '0.0.0.0');
    });

    this.httpServer = server;
    this.startDiscoveryResponder();

    const hostSession = roomOptions ? this.initRoom(roomOptions) : null;
    return {
      ok: true,
      ...this.getStatus(),
      hostSession,
    };
  }

  startDiscoveryResponder() {
    if (this.discoverySocket) return;
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => {
        // Non-fatal if another instance holds UDP discovery port
      });
      sock.on('message', (msg, rinfo) => {
        if (!this.room) return;
        const text = msg.toString('utf8').trim();
        if (!text.startsWith(`${DISCOVERY_MAGIC}:DISCOVER`)) return;
        const announcement = JSON.stringify({
          magic: DISCOVERY_MAGIC,
          type: 'ANNOUNCE',
          ip: getPrimaryLanIp(),
          port: this.port,
          roomId: this.room.roomId,
          roomCode: this.room.roomCode,
          roomName: this.room.roomName,
          hostName: this.room.hostName,
          worldName: this.room.worldName,
          worldType: this.room.worldType,
          difficulty: this.room.difficulty,
          playerCount: this.room.players.size,
          maxPlayers: MAX_LAN_PLAYERS,
          status: this.room.status,
          ...(this.room.modMetadata ? { modMetadata: this.room.modMetadata } : {}),
        });
        const buf = Buffer.from(announcement, 'utf8');
        sock.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {});
      });
      sock.bind(DISCOVERY_PORT, '0.0.0.0', () => {
        try {
          sock.setBroadcast(true);
        } catch {
          // Ignore
        }
      });
      this.discoverySocket = sock;
    } catch {
      // Non-fatal; manual IP join still works
    }
  }

  async stop() {
    this.stopTimeSyncLoop();
    if (this.room) {
      this.broadcast('ROOM_CLOSED', 'server', { reason: 'LAN server stopped.' });
    }
    for (const [, sess] of this.sessions.entries()) {
      if (sess.ws && sess.ws.isOpen()) {
        sess.ws.close(4000, 'LAN server stopped.');
      }
    }
    this.sessions.clear();
    this.room = null;

    if (this.discoverySocket) {
      try {
        this.discoverySocket.close();
      } catch {
        // Ignore
      }
      this.discoverySocket = null;
    }

    if (this.httpServer) {
      const srv = this.httpServer;
      this.httpServer = null;
      await new Promise((resolve) => {
        srv.close(() => resolve());
      });
    }
    return { ok: true };
  }
}

function discoverLanHosts(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const found = new Map();
    let finished = false;
    let sock;

    const done = () => {
      if (finished) return;
      finished = true;
      if (sock) {
        try {
          sock.close();
        } catch {
          // Ignore
        }
      }
      resolve(Array.from(found.values()));
    };

    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => done());
      sock.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString('utf8'));
          if (data && data.magic === DISCOVERY_MAGIC && data.type === 'ANNOUNCE' && data.roomId) {
            const hostIp = rinfo.address || data.ip;
            found.set(`${hostIp}:${data.port}`, {
              ip: hostIp,
              port: Number(data.port) || DEFAULT_LAN_PORT,
              address: `${hostIp}:${Number(data.port) || DEFAULT_LAN_PORT}`,
              baseUrl: `http://${hostIp}:${Number(data.port) || DEFAULT_LAN_PORT}`,
              roomId: String(data.roomId),
              roomCode: String(data.roomCode || ''),
              roomName: String(data.roomName || 'World of Adventure'),
              hostName: String(data.hostName || 'Host'),
              worldName: String(data.worldName || 'World of Adventure'),
              worldType: ['normal', 'survival', 'adventure', 'creative'].includes(data.worldType)
                ? data.worldType
                : 'normal',
              difficulty: String(data.difficulty || 'normal'),
              playerCount: Number(data.playerCount) || 1,
              maxPlayers: MAX_LAN_PLAYERS,
              status: String(data.status || 'waiting'),
              ...(data.modMetadata ? { modMetadata: sanitizeLanModMetadata(data.modMetadata) } : {}),
            });
          }
        } catch {
          // Ignore malformed UDP datagrams
        }
      });

      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          // Ignore
        }
        const probe = Buffer.from(`${DISCOVERY_MAGIC}:DISCOVER`, 'utf8');
        sock.send(probe, 0, probe.length, DISCOVERY_PORT, '255.255.255.255', () => {});
        sock.send(probe, 0, probe.length, DISCOVERY_PORT, '127.0.0.1', () => {});
        // Also probe subnet broadcast addresses for multi-homed Wi-Fi routers
        for (const ip of getLocalIpv4Addresses()) {
          const parts = ip.split('.');
          if (parts.length === 4) {
            const bcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
            sock.send(probe, 0, probe.length, DISCOVERY_PORT, bcast, () => {});
          }
        }
      });

      setTimeout(done, Math.max(400, Math.min(4000, timeoutMs)));
    } catch {
      done();
    }
  });
}

module.exports = {
  OfflineLanServer,
  discoverLanHosts,
  getPrimaryLanIp,
  getLocalIpv4Addresses,
  MAX_LAN_PLAYERS,
  DEFAULT_LAN_PORT,
  DISCOVERY_PORT,
};
