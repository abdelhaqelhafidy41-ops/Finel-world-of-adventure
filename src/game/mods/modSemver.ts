export interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(input: string): SemverVersion | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = SEMVER_RE.exec(trimmed);
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

  return {
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
  };
}

export function compareSemver(a: SemverVersion, b: SemverVersion): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function matchSingleComparator(version: SemverVersion, token: string): boolean {
  const clean = token.trim();
  if (!clean || clean === '*' || clean.toLowerCase() === 'x') return true;

  if (clean.startsWith('^')) {
    const base = parseSemver(clean.slice(1));
    if (!base) return false;
    if (compareSemver(version, base) < 0) return false;
    if (base.major > 0) {
      return version.major === base.major;
    }
    if (base.minor > 0) {
      return version.major === 0 && version.minor === base.minor;
    }
    return version.major === 0 && version.minor === 0 && version.patch === base.patch;
  }

  if (clean.startsWith('~')) {
    const rawBody = clean.slice(1).trim();
    const parts = rawBody.replace(/^v/, '').split('.');
    const base = parseSemver(rawBody);
    if (!base) return false;
    if (compareSemver(version, base) < 0) return false;
    if (parts.length <= 1) {
      return version.major === base.major;
    }
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
    if (wMajor !== 'x' && wMajor !== '*' && version.major !== Number(wMajor)) {
      return false;
    }
    if (
      wMinor !== undefined &&
      wMinor !== 'x' &&
      wMinor !== '*' &&
      version.minor !== Number(wMinor)
    ) {
      return false;
    }
    if (
      wPatch !== undefined &&
      wPatch !== 'x' &&
      wPatch !== '*' &&
      version.patch !== Number(wPatch)
    ) {
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

  const target = parseSemver(verStr);
  if (!target) return false;
  const cmp = compareSemver(version, target);

  switch (op) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    case '=':
    default:
      return cmp === 0;
  }
}

/**
 * Evaluates a SemVer range expression against a concrete version.
 * Supports OR (`||`), space-separated AND comparators, `^`, `~`, `>=`, `<=`, `>`, `<`, `=`, wildcards (`1.x`, `1.0`, `*`), and exact versions.
 */
export function satisfiesSemverRange(versionStr: string, rangeExpr: string): boolean {
  const version = parseSemver(versionStr);
  if (!version) return false;
  if (typeof rangeExpr !== 'string' || !rangeExpr.trim()) return false;

  const orClauses = rangeExpr
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean);
  if (orClauses.length === 0) return false;

  return orClauses.some((clause) => {
    // Support hyphen ranges like "1.0.0 - 1.5.0"
    const hyphenMatch = /^(.+?)\s+-\s+(.+)$/.exec(clause);
    if (hyphenMatch) {
      return (
        matchSingleComparator(version, `>=${hyphenMatch[1].trim()}`) &&
        matchSingleComparator(version, `<=${hyphenMatch[2].trim()}`)
      );
    }

    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => matchSingleComparator(version, tok));
  });
}

export function isValidSemverRangeSyntax(rangeExpr: string): boolean {
  if (typeof rangeExpr !== 'string' || !rangeExpr.trim()) return false;
  const orClauses = rangeExpr
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean);
  if (orClauses.length === 0) return false;

  return orClauses.every((clause) => {
    const hyphenMatch = /^(.+?)\s+-\s+(.+)$/.exec(clause);
    if (hyphenMatch) {
      return Boolean(parseSemver(hyphenMatch[1]) && parseSemver(hyphenMatch[2]));
    }
    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every((tok) => {
      if (tok === '*' || tok.toLowerCase() === 'x') return true;
      return (
        parseSemver(tok.replace(/^[~^=<>]+/, '')) !== null ||
        /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.test(tok)
      );
    });
  });
}
