/**
 * Deterministic Natural Valley Exit & Terrain Accessibility System.
 *
 * Lazily detects enclosed deep valleys / steep basins per 120m world cell
 * (matching CHUNK_SIZE) from the raw terrain heightfield, validates whether
 * naturally climbable exit routes exist, and smoothly blends organic,
 * biome-consistent mountain paths / gentle slopes into the terrain heightfield
 * so players and NPCs can never become permanently trapped in a valley.
 *
 * Zero Three.js dependencies, 100% deterministic from worldSeed, O(1) cached
 * lookup with near-zero overhead on flat terrain.
 */

export type RawHeightSampler = (x: number, z: number) => number;

export interface ValleyExitWaypoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

export interface ValleyExitPath {
  readonly id: string;
  readonly originCx: number;
  readonly originCz: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly coreHalfWidth: number;
  readonly blendHalfWidth: number;
  readonly waypoints: readonly ValleyExitWaypoint[];
  readonly totalLength: number;
  readonly maxGrade: number;
}

const CELL_SIZE = 120;
const WATER_LEVEL = 0.0;
const PLAYABLE_LIMIT = 3280;
const SPAWN_PROTECT_RADIUS = 38;

// Maximum climbable grade for generated valley exits (~20°), comfortably below
// Player MAX_WALKABLE_SLOPE_TAN (0.88 / ~41°), NPC (0.40), Animal (0.42), Enemy (0.44).
const MAX_EXIT_GRADE = 0.36;
const NATURAL_EXIT_SLOPE_LIMIT = 0.48;

const ownExitsCache = new Map<number, ValleyExitPath[] | null>();
const neighborhoodCache = new Map<number, ValleyExitPath[] | null>();
let cachedSeed = 0;

function cellKey(cx: number, cz: number): number {
  return ((cx + 1024) << 12) ^ (cz + 1024);
}

function worldToCell(v: number): number {
  return Math.floor((v + CELL_SIZE * 0.5) / CELL_SIZE);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep01(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function hashCell(seed: number, cx: number, cz: number, salt: number): number {
  let n =
    Math.imul(cx, 374761393) +
    Math.imul(cz, 668265263) +
    Math.imul(seed, 1442695041) +
    Math.imul(salt, 2246822519);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function clearValleyExitCache(seed: number): void {
  cachedSeed = seed >>> 0;
  ownExitsCache.clear();
  neighborhoodCache.clear();
}

/**
 * Checks whether a natural climbable route already exists along azimuth `angle`
 * from `(vx, vz, hStart)` using small steps up to `maxDist`.
 */
function hasNaturalClimbableExitAlongAngle(
  vx: number,
  vz: number,
  hStart: number,
  angle: number,
  rawHeight: RawHeightSampler,
): boolean {
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const stepDist = 4.0;
  const maxSteps = 12; // 48m reach
  let prevH = hStart;
  let climbed = 0;

  for (let s = 1; s <= maxSteps; s++) {
    const px = vx + dirX * (s * stepDist);
    const pz = vz + dirZ * (s * stepDist);
    const h = rawHeight(px, pz);
    if (h < WATER_LEVEL + 0.35) return false;
    const grade = (h - prevH) / stepDist;
    if (grade > NATURAL_EXIT_SLOPE_LIMIT) return false;
    climbed = Math.max(climbed, h - hStart);
    prevH = h;
    if (s >= 6 && climbed >= 5.5) {
      // Check that the top isn't immediately blocked by a vertical wall
      const aheadH = rawHeight(px + dirX * 4, pz + dirZ * 4);
      if ((aheadH - h) / 4 <= NATURAL_EXIT_SLOPE_LIMIT + 0.08) {
        return true;
      }
    }
  }
  return climbed >= 4.5;
}

/**
 * Builds a single natural curved mountain trail / ramp polyline from a valley
 * floor `(vx, vz, hStart)` toward azimuth `angle`, capped at `MAX_EXIT_GRADE`.
 */
function buildExitPathAlongAngle(
  id: string,
  cx: number,
  cz: number,
  vx: number,
  vz: number,
  hStart: number,
  angle: number,
  targetDist: number,
  swaySign: number,
  swayMag: number,
  rawHeight: RawHeightSampler,
): ValleyExitPath | null {
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const perpX = -dirZ;
  const perpZ = dirX;

  const numPts = 6;
  const rawPts: Array<{ x: number; z: number; rawY: number }> = [];

  for (let i = 0; i < numPts; i++) {
    const t = i / (numPts - 1);
    const along = t * targetDist;
    // Organic S-curve or gentle bow so paths look like natural mountain trails
    const sway = Math.sin(t * Math.PI) * swayMag * swaySign;
    const px = vx + dirX * along + perpX * sway;
    const pz = vz + dirZ * along + perpZ * sway;
    if (Math.hypot(px, pz) > PLAYABLE_LIMIT) return null;
    if (Math.hypot(px, pz - 4) < SPAWN_PROTECT_RADIUS) return null;
    const py = rawHeight(px, pz);
    if (py < WATER_LEVEL + 0.45) return null;
    rawPts.push({ x: px, z: pz, rawY: py });
  }

  // Compute cumulative arc lengths
  const cumLen: number[] = [0];
  for (let i = 1; i < numPts; i++) {
    const seg = Math.hypot(
      rawPts[i].x - rawPts[i - 1].x,
      rawPts[i].z - rawPts[i - 1].z,
    );
    cumLen.push(cumLen[i - 1] + seg);
  }
  const totalLength = cumLen[numPts - 1];
  if (totalLength < 18) return null;

  const hEndRaw = rawPts[numPts - 1].rawY;
  const neededRise = hEndRaw - hStart;
  // Clamp end height if terrain rises faster than MAX_EXIT_GRADE over this path
  const maxRise = totalLength * MAX_EXIT_GRADE;
  const clampedEndY =
    neededRise > maxRise
      ? hStart + maxRise
      : neededRise < -maxRise
        ? hStart - maxRise
        : hEndRaw;

  const waypoints: ValleyExitWaypoint[] = [];
  let maxGrade = 0;

  for (let i = 0; i < numPts; i++) {
    const u = cumLen[i] / totalLength;
    // Smooth eased ramp profile that meets both ends cleanly
    const easedU = u * 0.72 + smoothstep01(u) * 0.28;
    let y = hStart + (clampedEndY - hStart) * easedU;

    // Preserve natural local contour gently where it stays within climbable grade
    if (i > 0 && i < numPts - 1) {
      const blended = y * 0.78 + rawPts[i].rawY * 0.22;
      const prevY = waypoints[i - 1].y;
      const segLen = cumLen[i] - cumLen[i - 1];
      const maxDelta = segLen * MAX_EXIT_GRADE;
      y = clamp(blended, prevY - maxDelta, prevY + maxDelta);
    }

    if (i > 0) {
      const segLen = cumLen[i] - cumLen[i - 1];
      const prevY = waypoints[i - 1].y;
      const maxDelta = segLen * MAX_EXIT_GRADE;
      y = clamp(y, prevY - maxDelta, prevY + maxDelta);
      const grade = Math.abs(y - prevY) / Math.max(0.001, segLen);
      if (grade > maxGrade) maxGrade = grade;
    }

    waypoints.push({ x: rawPts[i].x, z: rawPts[i].z, y });
  }

  const coreHalfWidth = 3.5;
  const blendHalfWidth = 10.5;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    if (w.x < minX) minX = w.x;
    if (w.x > maxX) maxX = w.x;
    if (w.z < minZ) minZ = w.z;
    if (w.z > maxZ) maxZ = w.z;
  }

  return {
    id,
    originCx: cx,
    originCz: cz,
    minX: minX - blendHalfWidth,
    maxX: maxX + blendHalfWidth,
    minZ: minZ - blendHalfWidth,
    maxZ: maxZ + blendHalfWidth,
    coreHalfWidth,
    blendHalfWidth,
    waypoints,
    totalLength,
    maxGrade,
  };
}

/**
 * Lazily detects deep valleys / enclosed basins in cell `(cx, cz)` and creates
 * deterministic, validated climbable exit paths.
 */
function computeOwnCellExits(
  cx: number,
  cz: number,
  rawHeight: RawHeightSampler,
): ValleyExitPath[] | null {
  const key = cellKey(cx, cz);
  const existing = ownExitsCache.get(key);
  if (existing !== undefined) return existing;

  const centerX = cx * CELL_SIZE;
  const centerZ = cz * CELL_SIZE;

  // Skip cells outside playable world
  if (Math.hypot(centerX, centerZ) > PLAYABLE_LIMIT + CELL_SIZE * 0.5) {
    ownExitsCache.set(key, null);
    return null;
  }

  // Coarse 6x6 height scan across cell (step 20m)
  const GRID = 6;
  const STEP = CELL_SIZE / GRID; // 20m
  const startX = centerX - CELL_SIZE * 0.5 + STEP * 0.5;
  const startZ = centerZ - CELL_SIZE * 0.5 + STEP * 0.5;
  const heights = new Float32Array(GRID * GRID);

  let minH = Infinity;
  let maxH = -Infinity;
  for (let gz = 0; gz < GRID; gz++) {
    const wz = startZ + gz * STEP;
    for (let gx = 0; gx < GRID; gx++) {
      const wx = startX + gx * STEP;
      const h = rawHeight(wx, wz);
      heights[gz * GRID + gx] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  // Fast early-out: flat plains, coastal beaches, gentle meadows need zero valley exits
  if (maxH - minH < 7.5 || maxH < 9.0) {
    ownExitsCache.set(key, null);
    return null;
  }

  // Find candidate deep valley floor points (local minima surrounded by taller/steeper terrain)
  const candidates: Array<{ x: number; z: number; h: number; depth: number; blockedDirs: number }> = [];

  for (let gz = 1; gz < GRID - 1; gz++) {
    for (let gx = 1; gx < GRID - 1; gx++) {
      const idx = gz * GRID + gx;
      const h = heights[idx];
      if (h < WATER_LEVEL + 0.65) continue;

      const wx = startX + gx * STEP;
      const wz = startZ + gz * STEP;
      if (Math.hypot(wx, wz - 4) < SPAWN_PROTECT_RADIUS + 18) continue;

      // Must be near-minimal among its 8 immediate grid neighbors
      let lowerNeighbors = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (heights[(gz + dz) * GRID + (gx + dx)] < h - 0.8) {
            lowerNeighbors++;
          }
        }
      }
      if (lowerNeighbors > 1) continue;

      // Probe 12 directions at 24m and 44m to evaluate enclosure & rim height
      let rimSum = 0;
      let blockedDirs = 0;
      for (let d = 0; d < 12; d++) {
        const a = (d / 12) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const h1 = rawHeight(wx + c * 22, wz + s * 22);
        const h2 = rawHeight(wx + c * 42, wz + s * 42);
        const rim = Math.max(h1, h2);
        rimSum += rim;
        const slope1 = (h1 - h) / 22;
        const slope2 = (h2 - h1) / 20;
        if (slope1 > 0.42 || slope2 > 0.48 || h1 < WATER_LEVEL + 0.2) {
          blockedDirs++;
        }
      }

      const avgRim = rimSum / 12;
      const depth = avgRim - h;

      // Deep valley or enclosed steep pocket
      if (depth >= 5.5 && blockedDirs >= 5) {
        candidates.push({ x: wx, z: wz, h, depth, blockedDirs });
      }
    }
  }

  if (candidates.length === 0) {
    ownExitsCache.set(key, null);
    return null;
  }

  // Sort deepest / most enclosed first and keep up to 2 distinct basins per 120m cell
  candidates.sort((a, b) => b.depth * 1.2 + b.blockedDirs - (a.depth * 1.2 + a.blockedDirs));

  const exits: ValleyExitPath[] = [];
  const chosenBasins: Array<{ x: number; z: number }> = [];

  for (let ci = 0; ci < candidates.length && chosenBasins.length < 2; ci++) {
    const basin = candidates[ci];
    let tooClose = false;
    for (let bi = 0; bi < chosenBasins.length; bi++) {
      if (Math.hypot(basin.x - chosenBasins[bi].x, basin.z - chosenBasins[bi].z) < 42) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    chosenBasins.push({ x: basin.x, z: basin.z });

    // Validate how many naturally climbable exits already exist around this basin
    let existingNaturalExits = 0;
    const naturalAngles: number[] = [];
    for (let d = 0; d < 12; d++) {
      const a = (d / 12) * Math.PI * 2;
      if (hasNaturalClimbableExitAlongAngle(basin.x, basin.z, basin.h, a, rawHeight)) {
        // Count distinct angular sectors (>= 60 deg apart)
        let distinct = true;
        for (let k = 0; k < naturalAngles.length; k++) {
          let diff = Math.abs(a - naturalAngles[k]);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff < 1.05) {
            distinct = false;
            break;
          }
        }
        if (distinct) {
          naturalAngles.push(a);
          existingNaturalExits++;
        }
      }
    }

    // Large/deep valleys require at least 2-3 accessible exits; normal enclosed valleys require >= 1-2
    const desiredTotalExits = basin.depth >= 13.0 ? 3 : basin.depth >= 8.5 ? 2 : 1;
    const exitsNeeded = Math.max(0, desiredTotalExits - existingNaturalExits);
    if (exitsNeeded === 0) continue;

    // Score 16 candidate azimuths for best natural saddle / escape route
    const scoredDirs: Array<{ angle: number; score: number; dist: number }> = [];
    for (let d = 0; d < 16; d++) {
      const a = (d / 16) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const h24 = rawHeight(basin.x + c * 24, basin.z + s * 24);
      const h44 = rawHeight(basin.x + c * 44, basin.z + s * 44);
      const h60 = rawHeight(basin.x + c * 60, basin.z + s * 60);
      if (h24 < WATER_LEVEL + 0.5 || h44 < WATER_LEVEL + 0.5) continue;

      // Prefer directions that rise to higher terrain via the lowest saddle (least excavation!)
      const rise44 = h44 - basin.h;
      const rise60 = h60 - basin.h;
      const bestDist = rise44 >= 4.0 && rise44 <= 18.0 ? 46 : 60;
      const targetRise = bestDist === 46 ? rise44 : rise60;

      // Penalize excessive steepness and reward connecting toward spawn/world center slightly
      const toCenterX = -basin.x;
      const toCenterZ = -basin.z;
      const toCenterLen = Math.hypot(toCenterX, toCenterZ) || 1;
      const centerAlign = (c * toCenterX + s * toCenterZ) / toCenterLen;

      const idealRise = Math.max(5.0, basin.depth * 0.85);
      const risePenalty = Math.abs(targetRise - idealRise) * 0.45;
      const score = 10 - risePenalty + centerAlign * 1.8;
      scoredDirs.push({ angle: a, score, dist: bestDist });
    }

    scoredDirs.sort((a, b) => b.score - a.score);

    const usedAngles = [...naturalAngles];
    let created = 0;
    for (let di = 0; di < scoredDirs.length && created < exitsNeeded; di++) {
      const cand = scoredDirs[di];
      // Ensure exits are well-separated around the valley perimeter
      let tooCloseAngle = false;
      for (let k = 0; k < usedAngles.length; k++) {
        let diff = Math.abs(cand.angle - usedAngles[k]);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < 1.35) {
          tooCloseAngle = true;
          break;
        }
      }
      if (tooCloseAngle) continue;

      const swaySeed = hashCell(cachedSeed, cx, cz, ci * 31 + di * 17 + 7);
      const swaySign = swaySeed > 0.5 ? 1 : -1;
      const swayMag = 3.2 + hashCell(cachedSeed, cx, cz, ci * 19 + di * 29 + 13) * 4.5;

      const path = buildExitPathAlongAngle(
        `vexit_${cx}_${cz}_${ci}_${created}`,
        cx,
        cz,
        basin.x,
        basin.z,
        basin.h,
        cand.angle,
        cand.dist,
        swaySign,
        swayMag,
        rawHeight,
      );
      if (path) {
        exits.push(path);
        usedAngles.push(cand.angle);
        created++;
      }
    }
  }

  const result = exits.length > 0 ? exits : null;
  ownExitsCache.set(key, result);
  return result;
}

/**
 * Returns all valley exit paths from the 3x3 cell neighborhood whose AABB
 * overlaps cell `(cx, cz)`, cached for O(1) lookup.
 */
function getNeighborhoodExits(
  cx: number,
  cz: number,
  rawHeight: RawHeightSampler,
): ValleyExitPath[] | null {
  const key = cellKey(cx, cz);
  const cached = neighborhoodCache.get(key);
  if (cached !== undefined) return cached;

  const cellMinX = cx * CELL_SIZE - CELL_SIZE * 0.5;
  const cellMaxX = cx * CELL_SIZE + CELL_SIZE * 0.5;
  const cellMinZ = cz * CELL_SIZE - CELL_SIZE * 0.5;
  const cellMaxZ = cz * CELL_SIZE + CELL_SIZE * 0.5;

  let merged: ValleyExitPath[] | null = null;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const own = computeOwnCellExits(cx + dx, cz + dz, rawHeight);
      if (!own) continue;
      for (let i = 0; i < own.length; i++) {
        const p = own[i];
        if (
          p.maxX < cellMinX ||
          p.minX > cellMaxX ||
          p.maxZ < cellMinZ ||
          p.minZ > cellMaxZ
        ) {
          continue;
        }
        if (!merged) merged = [];
        merged.push(p);
      }
    }
  }

  neighborhoodCache.set(key, merged);
  return merged;
}

/**
 * Evaluates closest distance and interpolated trail Y along a polyline.
 * Zero-GC scalar helper.
 */
function evalPathAt(
  path: ValleyExitPath,
  x: number,
  z: number,
  out: { weight: number; targetY: number; coreMask: number },
): boolean {
  if (x < path.minX || x > path.maxX || z < path.minZ || z > path.maxZ) {
    return false;
  }

  const pts = path.waypoints;
  let bestDistSq = Infinity;
  let bestY = 0;
  let bestTGlobal = 0;
  const segCount = pts.length - 1;

  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const abLenSq = abx * abx + abz * abz;
    if (abLenSq < 0.0001) continue;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / abLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const dx = x - px;
    const dz = z - pz;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestY = a.y + (b.y - a.y) * t;
      bestTGlobal = (i + t) / segCount;
    }
  }

  const maxR = path.blendHalfWidth;
  if (bestDistSq >= maxR * maxR) return false;

  const dist = Math.sqrt(bestDistSq);
  // Smooth end-cap taper so entrance and exit merge seamlessly into natural ground
  const endFade =
    smoothstep01(bestTGlobal / 0.14) * smoothstep01((1 - bestTGlobal) / 0.14);

  let lateralW: number;
  if (dist <= path.coreHalfWidth) {
    lateralW = 1.0;
  } else {
    const u = (dist - path.coreHalfWidth) / (maxR - path.coreHalfWidth);
    lateralW = 1.0 - smoothstep01(u);
  }

  const weight = lateralW * (0.35 + 0.65 * endFade);
  if (weight <= 0.001) return false;

  const coreMask =
    dist <= path.coreHalfWidth
      ? 1.0 - (dist / path.coreHalfWidth) * 0.25
      : Math.max(0, 1.0 - (dist - path.coreHalfWidth) / 2.2) * 0.75;

  out.weight = weight;
  out.targetY = bestY;
  out.coreMask = coreMask * endFade;
  return true;
}

const _evalScratch = { weight: 0, targetY: 0, coreMask: 0 };

/**
 * Applies any cached local natural valley exit paths to the raw terrain height.
 * Extremely fast O(1) fast-path for flat/open cells (single Map lookup -> null).
 */
export function applyValleyExitsToHeight(
  x: number,
  z: number,
  rawH: number,
  rawHeight: RawHeightSampler,
): number {
  const cx = worldToCell(x);
  const cz = worldToCell(z);
  const paths = getNeighborhoodExits(cx, cz, rawHeight);
  if (!paths) return rawH;

  let weightedY = 0;
  let totalW = 0;
  let maxW = 0;

  for (let i = 0; i < paths.length; i++) {
    if (evalPathAt(paths[i], x, z, _evalScratch)) {
      const w = _evalScratch.weight;
      weightedY += _evalScratch.targetY * w;
      totalW += w;
      if (w > maxW) maxW = w;
    }
  }

  if (totalW <= 0.0001) return rawH;
  const targetY = weightedY / totalW;
  const blend = clamp(maxW, 0, 1);
  return rawH + (targetY - rawH) * blend;
}

/**
 * Returns a 0..1 mask indicating whether `(x, z)` lies on a natural valley exit
 * dirt/rocky trail. Used for subtle biome-matched terrain tinting and keeping
 * trees/boulders clear of the walkable exit path.
 */
export function getValleyExitMaskAt(
  x: number,
  z: number,
  rawHeight: RawHeightSampler,
): number {
  const cx = worldToCell(x);
  const cz = worldToCell(z);
  const paths = getNeighborhoodExits(cx, cz, rawHeight);
  if (!paths) return 0;

  let bestMask = 0;
  for (let i = 0; i < paths.length; i++) {
    if (evalPathAt(paths[i], x, z, _evalScratch)) {
      if (_evalScratch.coreMask > bestMask) {
        bestMask = _evalScratch.coreMask;
      }
    }
  }
  return bestMask;
}

/**
 * Returns all deterministic valley exit paths originating in chunk `(cx, cz)`.
 */
export function getValleyExitsForCell(
  cx: number,
  cz: number,
  rawHeight: RawHeightSampler,
): readonly ValleyExitPath[] {
  return computeOwnCellExits(cx, cz, rawHeight) ?? [];
}
