import * as THREE from 'three';
import {
  WATER_LEVEL,
  groundHeightAt,
  groundSlopeAt,
  seededRandom,
} from '../math/noise';
import type { BoxCollider } from '../types';
import { isLand, isNearWater, isWater } from './WorldPlacementValidator';

export type RoofStyle = 'flat' | 'sloped' | 'fantasy' | 'biome';

export type BuildingValidationStatus = 'valid' | 'warning' | 'invalid';

export type BuildingValidationCheckKey =
  | 'walls'
  | 'floor'
  | 'roof'
  | 'doors'
  | 'windows'
  | 'interior'
  | 'collision'
  | 'entrance'
  | 'navigation';

export interface BuildingValidationIssue {
  check: BuildingValidationCheckKey;
  severity: 'error' | 'warning';
  message: string;
}

export interface BuildingValidationDebugBounds {
  cx: number;
  cz: number;
  anchorY: number;
  yaw: number;
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
  roofMinLocalY: number;
  roofMaxLocalY: number;
  roofWidth: number;
  roofDepth: number;
  doorWorldPos: { x: number; y: number; z: number };
  doorEntryWorldPos: { x: number; y: number; z: number };
  doorThresholdWorldPos: { x: number; y: number; z: number };
  colliders: BoxCollider[];
}

export interface BuildingValidationReport {
  villageId: string;
  buildingId: string;
  status: BuildingValidationStatus;
  valid: boolean;
  attempt: number;
  roofStyleResolved: Exclude<RoofStyle, 'biome'>;
  checks: Record<BuildingValidationCheckKey, boolean>;
  issues: BuildingValidationIssue[];
  debug: BuildingValidationDebugBounds;
}

export interface BuildingValidationInput {
  villageId: string;
  buildingId: string;
  attempt: number;
  cx: number;
  cz: number;
  anchorY: number;
  minGroundY: number;
  maxGroundY: number;
  yaw: number;
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
  roofStyleResolved: Exclude<RoofStyle, 'biome'>;
  wallThickness: number;
  floorTopLocalY: number;
  doorWidth: number;
  doorHeight: number;
  hasCeilingDeck: boolean;
  hasGableClosure: boolean;
  roofWidth: number;
  roofDepth: number;
  roofMinLocalY: number;
  roofMaxLocalY: number;
  windowPositionsLocal: ReadonlyArray<{ x: number; y: number; z: number }>;
  doorLocalPos: THREE.Vector3;
  doorEntryLocal: THREE.Vector3;
  doorThresholdLocal: THREE.Vector3;
  bedLocalPos: THREE.Vector3;
  wallMeshes: ReadonlyArray<THREE.Object3D>;
  floorMeshes: ReadonlyArray<THREE.Object3D>;
  roofMeshes: ReadonlyArray<THREE.Object3D>;
  doorMesh: THREE.Object3D;
  windowMeshes: ReadonlyArray<THREE.Object3D>;
  boxCollidersLocal: ReadonlyArray<Omit<BoxCollider, 'kind' | 'x' | 'z' | 'yaw'> & { lx: number; lz: number; yawOffset?: number }>;
  worldColliders: ReadonlyArray<BoxCollider>;
  doorWorldPos: THREE.Vector3;
  doorEntryWorldPos: THREE.Vector3;
  doorThresholdWorldPos: THREE.Vector3;
  bedWorldPos: THREE.Vector3;
  skipTerrainChecks?: boolean;
}

const _tmpBox = new THREE.Box3();
const _tmpSize = new THREE.Vector3();

function hashIds(worldSeed: number, villageId: string, buildingId: string, attempt: number): number {
  let h = (worldSeed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < villageId.length; i++) {
    h ^= villageId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= 0x85ebca6b;
  for (let i = 0; i < buildingId.length; i++) {
    h ^= buildingId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= Math.imul(attempt + 1, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function createDeterministicBuildingRng(
  worldSeed: number,
  villageId: string,
  buildingId: string,
  attempt: number,
): () => number {
  return seededRandom(hashIds(worldSeed, villageId, buildingId, attempt));
}

function measureLocalMeshesBounds(
  meshes: ReadonlyArray<THREE.Object3D>,
): { valid: boolean; box: THREE.Box3 } {
  const combined = new THREE.Box3();
  if (meshes.length === 0) {
    return { valid: false, box: combined };
  }
  let anyValid = false;
  for (let i = 0; i < meshes.length; i++) {
    const obj = meshes[i];
    obj.updateMatrixWorld(true);
    _tmpBox.setFromObject(obj);
    if (_tmpBox.isEmpty()) {
      return { valid: false, box: combined };
    }
    _tmpBox.getSize(_tmpSize);
    if (
      !Number.isFinite(_tmpSize.x) ||
      !Number.isFinite(_tmpSize.y) ||
      !Number.isFinite(_tmpSize.z) ||
      _tmpSize.x <= 0.001 ||
      _tmpSize.y <= 0.001 ||
      _tmpSize.z <= 0.001
    ) {
      return { valid: false, box: combined };
    }
    if (
      !Number.isFinite(_tmpBox.min.x) ||
      !Number.isFinite(_tmpBox.min.y) ||
      !Number.isFinite(_tmpBox.min.z) ||
      !Number.isFinite(_tmpBox.max.x) ||
      !Number.isFinite(_tmpBox.max.y) ||
      !Number.isFinite(_tmpBox.max.z)
    ) {
      return { valid: false, box: combined };
    }
    combined.union(_tmpBox);
    anyValid = true;
  }
  return { valid: anyValid && !combined.isEmpty(), box: combined };
}

function pointInsideLocalBox2D(
  px: number,
  pz: number,
  box: { lx: number; lz: number; halfW: number; halfD: number; yawOffset?: number },
  pad: number,
): boolean {
  const dx = px - box.lx;
  const dz = pz - box.lz;
  const yaw = box.yawOffset ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = dx * c - dz * s;
  const rz = dx * s + dz * c;
  return Math.abs(rx) < box.halfW + pad && Math.abs(rz) < box.halfD + pad;
}

function segmentIntersectsBox2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  box: { lx: number; lz: number; halfW: number; halfD: number; yawOffset?: number },
  pad: number,
): boolean {
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    if (pointInsideLocalBox2D(px, pz, box, pad)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates every structural, geometrical, collision, and navigational requirement
 * for a procedural or curated building before committing it to the world.
 */
export function validateBuilding(input: BuildingValidationInput): BuildingValidationReport {
  const issues: BuildingValidationIssue[] = [];
  const checks: Record<BuildingValidationCheckKey, boolean> = {
    walls: true,
    floor: true,
    roof: true,
    doors: true,
    windows: true,
    interior: true,
    collision: true,
    entrance: true,
    navigation: true,
  };

  const fail = (check: BuildingValidationCheckKey, message: string) => {
    checks[check] = false;
    issues.push({ check, severity: 'error', message });
  };
  const warn = (check: BuildingValidationCheckKey, message: string) => {
    issues.push({ check, severity: 'warning', message });
  };

  // 1. Walls check: finite dims, >= 4 enclosing segments (back, left, right, 2 front + lintel), valid bounds
  const wallMeasure = measureLocalMeshesBounds(input.wallMeshes);
  if (
    !wallMeasure.valid ||
    input.wallMeshes.length < 5 ||
    input.width < 4.0 ||
    input.depth < 3.6 ||
    input.wallHeight < 2.55 ||
    input.wallThickness < 0.16
  ) {
    fail('walls', 'Wall geometry missing, malformed, or insufficient wall height/count.');
  } else {
    const wallSpanX = wallMeasure.box.max.x - wallMeasure.box.min.x;
    const wallSpanZ = wallMeasure.box.max.z - wallMeasure.box.min.z;
    if (wallSpanX < input.width - 0.15 || wallSpanZ < input.depth - 0.15) {
      fail('walls', 'Walls do not enclose full building footprint.');
    }
  }

  // 2. Floor check: complete interior floor mesh + terrain elevation sanity
  const floorMeasure = measureLocalMeshesBounds(input.floorMeshes);
  if (!floorMeasure.valid) {
    fail('floor', 'Floor or foundation mesh missing/degenerate.');
  } else {
    const fSpanX = floorMeasure.box.max.x - floorMeasure.box.min.x;
    const fSpanZ = floorMeasure.box.max.z - floorMeasure.box.min.z;
    if (fSpanX < input.width - 0.5 || fSpanZ < input.depth - 0.5) {
      fail('floor', 'Floor does not span interior footprint.');
    }
  }
  const terrainRelief = input.maxGroundY - input.minGroundY;
  if (!input.skipTerrainChecks && terrainRelief > 2.4) {
    warn('floor', `High foundation slope relief (${terrainRelief.toFixed(2)}m).`);
  }

  // 3. Roof check: 100% XZ footprint coverage, no open ceiling, finite height & style
  const roofMeasure = measureLocalMeshesBounds(input.roofMeshes);
  if (!roofMeasure.valid) {
    fail('roof', 'Roof geometry missing or degenerate.');
  } else {
    const rSpanX = roofMeasure.box.max.x - roofMeasure.box.min.x;
    const rSpanZ = roofMeasure.box.max.z - roofMeasure.box.min.z;
    if (rSpanX < input.width - 0.02 || rSpanZ < input.depth - 0.02) {
      fail('roof', `Roof XZ coverage (${rSpanX.toFixed(2)}x${rSpanZ.toFixed(2)}) smaller than footprint (${input.width.toFixed(2)}x${input.depth.toFixed(2)}).`);
    }
    if (!input.hasCeilingDeck) {
      fail('roof', 'Roof lacks sealed ceiling/soffit deck.');
    }
    if (
      (input.roofStyleResolved === 'sloped' || input.roofStyleResolved === 'fantasy') &&
      !input.hasGableClosure
    ) {
      fail('roof', 'Pitched/fantasy roof lacks solid gable closure walls.');
    }
    if (input.roofMinLocalY < input.floorTopLocalY + input.doorHeight - 0.05) {
      fail('roof', 'Roof soffit dips below doorway clearance.');
    }
  }

  // 4. Doors check: valid dimensions, aligned at front wall, door mesh valid
  const doorMeasure = measureLocalMeshesBounds([input.doorMesh]);
  if (
    !doorMeasure.valid ||
    input.doorWidth < 1.15 ||
    input.doorHeight < 1.95 ||
    !Number.isFinite(input.doorLocalPos.x) ||
    !Number.isFinite(input.doorLocalPos.z)
  ) {
    fail('doors', 'Door leaf geometry invalid or opening too narrow/short.');
  }

  // 5. Windows check: present and not overlapping doorway opening
  const winMeasure = measureLocalMeshesBounds(input.windowMeshes);
  if (!winMeasure.valid || input.windowPositionsLocal.length === 0) {
    fail('windows', 'Windows missing or invalid bounds.');
  } else {
    for (let i = 0; i < input.windowPositionsLocal.length; i++) {
      const wp = input.windowPositionsLocal[i];
      if (!Number.isFinite(wp.x) || !Number.isFinite(wp.y) || !Number.isFinite(wp.z)) {
        fail('windows', 'Non-finite window coordinates.');
        break;
      }
      if (
        Math.abs(wp.z - input.doorLocalPos.z) < 0.4 &&
        Math.abs(wp.x - input.doorLocalPos.x) < input.doorWidth * 0.65
      ) {
        fail('windows', 'Window intersects front doorway opening.');
        break;
      }
    }
  }

  // 6. Interior check: enough interior space & bed safely inside walls
  const innerHalfW = input.width * 0.5 - input.wallThickness;
  const innerHalfD = input.depth * 0.5 - input.wallThickness;
  if (innerHalfW < 1.4 || innerHalfD < 1.3) {
    fail('interior', 'Interior floor space too tight for navigation.');
  }
  if (
    Math.abs(input.bedLocalPos.x) >= innerHalfW - 0.1 ||
    Math.abs(input.bedLocalPos.z) >= innerHalfD - 0.1 ||
    input.bedLocalPos.y < input.floorTopLocalY - 0.05
  ) {
    fail('interior', 'Bed target placed outside interior wall perimeter or below floor.');
  }

  // 7. Collision check: wall colliders must not cover doorway threshold; roof collider must stay above headroom; walkable floor must exist
  const wallColliders = input.boxCollidersLocal.filter((c) => c.tag === 'wall');
  const floorColliders = input.boxCollidersLocal.filter((c) => c.tag === 'floor');
  const roofColliders = input.boxCollidersLocal.filter((c) => c.tag === 'roof');
  if (wallColliders.length < 4) {
    fail('collision', 'Insufficient wall colliders.');
  }
  if (floorColliders.length === 0 || !floorColliders.some((f) => f.walkableTop)) {
    fail('collision', 'Walkable interior floor collider missing.');
  }
  if (roofColliders.length === 0) {
    fail('collision', 'Roof collider missing.');
  } else {
    for (let i = 0; i < roofColliders.length; i++) {
      const rc = roofColliders[i];
      if (rc.minY < input.floorTopLocalY + input.doorHeight - 0.02) {
        fail('collision', 'Roof collider extends into indoor standing/doorway headroom (trap hazard).');
        break;
      }
    }
  }
  for (let i = 0; i < wallColliders.length; i++) {
    const wc = wallColliders[i];
    if (
      pointInsideLocalBox2D(input.doorLocalPos.x, input.doorLocalPos.z, wc, 0.35) ||
      pointInsideLocalBox2D(input.doorThresholdLocal.x, input.doorThresholdLocal.z, wc, 0.38)
    ) {
      fail('collision', 'Wall collider intrudes into doorway or threshold clearance.');
      break;
    }
  }

  // 8. Entrance check: exterior door entry is on dry walkable land & unobstructed
  if (!input.skipTerrainChecks) {
    const ex = input.doorEntryWorldPos.x;
    const ez = input.doorEntryWorldPos.z;
    const eh = groundHeightAt(ex, ez);
    if (!Number.isFinite(eh) || isWater(ex, ez, eh) || !isLand(ex, ez, 0.35, eh) || isNearWater(ex, ez, 2.0)) {
      fail('entrance', 'House entrance lands in water or below safe shoreline elevation.');
    } else if (groundSlopeAt(ex, ez, eh) > 0.44) {
      fail('entrance', 'House entrance terrain slope is too steep.');
    }
  }
  for (let i = 0; i < wallColliders.length; i++) {
    const wc = wallColliders[i];
    if (pointInsideLocalBox2D(input.doorEntryLocal.x, input.doorEntryLocal.z, wc, 0.35)) {
      fail('entrance', 'Exterior door entry overlaps a wall collider.');
      break;
    }
  }

  // 9. Navigation check: unobstructed path from doorEntry -> doorThreshold -> bed inside house
  for (let i = 0; i < wallColliders.length; i++) {
    const wc = wallColliders[i];
    if (
      segmentIntersectsBox2D(
        input.doorEntryLocal.x,
        input.doorEntryLocal.z,
        input.doorThresholdLocal.x,
        input.doorThresholdLocal.z,
        wc,
        0.25,
      )
    ) {
      fail('navigation', 'Doorway path from exterior entry to threshold is blocked by a wall collider.');
      break;
    }
    if (
      segmentIntersectsBox2D(
        input.doorThresholdLocal.x,
        input.doorThresholdLocal.z,
        input.bedLocalPos.x,
        input.bedLocalPos.z,
        wc,
        0.22,
      )
    ) {
      fail('navigation', 'Interior navigation from threshold to bed intersects a wall collider.');
      break;
    }
  }

  const hasError = issues.some((it) => it.severity === 'error');
  const hasWarning = issues.some((it) => it.severity === 'warning');
  const status: BuildingValidationStatus = hasError
    ? 'invalid'
    : hasWarning
      ? 'warning'
      : 'valid';

  return {
    villageId: input.villageId,
    buildingId: input.buildingId,
    status,
    valid: !hasError,
    attempt: input.attempt,
    roofStyleResolved: input.roofStyleResolved,
    checks,
    issues,
    debug: {
      cx: input.cx,
      cz: input.cz,
      anchorY: input.anchorY,
      yaw: input.yaw,
      width: input.width,
      depth: input.depth,
      wallHeight: input.wallHeight,
      roofHeight: input.roofHeight,
      roofMinLocalY: input.roofMinLocalY,
      roofMaxLocalY: input.roofMaxLocalY,
      roofWidth: input.roofWidth,
      roofDepth: input.roofDepth,
      doorWorldPos: {
        x: input.doorWorldPos.x,
        y: input.doorWorldPos.y,
        z: input.doorWorldPos.z,
      },
      doorEntryWorldPos: {
        x: input.doorEntryWorldPos.x,
        y: input.doorEntryWorldPos.y,
        z: input.doorEntryWorldPos.z,
      },
      doorThresholdWorldPos: {
        x: input.doorThresholdWorldPos.x,
        y: input.doorThresholdWorldPos.y,
        z: input.doorThresholdWorldPos.z,
      },
      colliders: input.worldColliders.map((c) => ({ ...c })),
    },
  };
}
