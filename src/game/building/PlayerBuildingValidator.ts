import type { WorldCollider, WorldLandmark } from '../types';
import {
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  groundHeightAt,
  groundSlopeAt,
} from '../math/noise';
import {
  getHydrologyClearance,
  isWater,
} from '../world/WorldPlacementValidator';
import { getBlueprintById } from './buildingCatalog';
import type {
  BuildingBlueprint,
  PlacementValidationResult,
  PlayerBuiltStructure,
  SnapAnchorType,
} from './buildingTypes';

export interface PlacementEnvironmentContext {
  villages: ReadonlyArray<{ centerX: number; centerZ: number; clearanceRadius: number }>;
  oakhollowCenter: { x: number; z: number };
  landmarks: ReadonlyArray<WorldLandmark>;
  npcSpawns: ReadonlyArray<{ x: number; z: number }>;
  queryCollidersNear: (x: number, z: number) => readonly WorldCollider[];
  existingStructures: ReadonlyArray<PlayerBuiltStructure>;
  playerPos?: { x: number; y: number; z: number };
}

function pointToSegmentDistSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-6) {
    return (px - ax) * (px - ax) + (pz - az) * (pz - az);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq));
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}

function isBlockingOakhollowRoads(
  x: number,
  z: number,
  footprintRadius: number,
  cx: number,
  cz: number,
): boolean {
  const segments: ReadonlyArray<readonly [number, number, number, number, number]> = [
    // N-S Village Road
    [cx, cz - 30, cx, cz + 30, 2.5],
    // E-W Village Road
    [cx - 30, cz, cx + 31, cz, 2.4],
    // Approach trail toward spawn glade
    [cx - 4, cz + 10, 2, -6, 2.4],
    // Farm lane
    [cx + 12, cz + 2, cx + 21, cz + 18, 2.0],
  ];

  for (let i = 0; i < segments.length; i++) {
    const [ax, az, bx, bz, halfRoad] = segments[i];
    const limit = halfRoad + footprintRadius;
    if (pointToSegmentDistSq(x, z, ax, az, bx, bz) < limit * limit) {
      return true;
    }
  }
  return false;
}

function findBestSnapTarget(
  bp: BuildingBlueprint,
  targetX: number,
  targetZ: number,
  targetYaw: number,
  existingStructures: ReadonlyArray<PlayerBuiltStructure>,
): {
  x: number;
  y: number;
  z: number;
  yaw: number;
  snappedToId: string;
  snappedType: SnapAnchorType;
} | null {
  if (!bp.snapType) return null;

  const maxSnapDist = bp.isRoofPiece ? 2.85 : 2.35;
  const maxSnapDistSq = maxSnapDist * maxSnapDist;
  let bestDistSq = maxSnapDistSq;
  let best: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    snappedToId: string;
    snappedType: SnapAnchorType;
  } | null = null;

  for (let i = 0; i < existingStructures.length; i++) {
    const st = existingStructures[i];
    const dxCenter = targetX - st.x;
    const dzCenter = targetZ - st.z;
    if (dxCenter * dxCenter + dzCenter * dzCenter > 130) continue;

    const stBp = getBlueprintById(st.blueprintId);
    if (!stBp?.snapAnchors || stBp.snapAnchors.length === 0) continue;

    const cos = Math.cos(st.yaw);
    const sin = Math.sin(st.yaw);

    for (let a = 0; a < stBp.snapAnchors.length; a++) {
      const anchor = stBp.snapAnchors[a];
      if (!anchor.accepts.includes(bp.snapType)) continue;

      const wx = st.x + anchor.localX * cos - anchor.localZ * sin;
      const wz = st.z + anchor.localX * sin + anchor.localZ * cos;
      const wy = st.y + anchor.localY;

      const dSq = (targetX - wx) * (targetX - wx) + (targetZ - wz) * (targetZ - wz);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        const baseYaw = anchor.yawOffset !== undefined ? st.yaw + anchor.yawOffset : targetYaw;
        // Align walls/doors/windows/roofs/fences cleanly onto modular grid orientation if near-parallel
        const snapYaw =
          anchor.yawOffset !== undefined
            ? baseYaw
            : Math.round((targetYaw - st.yaw) / (Math.PI * 0.5)) * (Math.PI * 0.5) + st.yaw;
        best = {
          x: wx,
          y: wy,
          z: wz,
          yaw: snapYaw,
          snappedToId: st.id,
          snappedType: anchor.anchorType,
        };
      }
    }
  }

  return best;
}

function findSupportingFloorY(
  x: number,
  z: number,
  existingStructures: ReadonlyArray<PlayerBuiltStructure>,
): number | null {
  let highestTop: number | null = null;
  for (let i = 0; i < existingStructures.length; i++) {
    const st = existingStructures[i];
    const bp = getBlueprintById(st.blueprintId);
    if (!bp || (!bp.isFloorPiece && !bp.isHouse)) continue;

    const dx = x - st.x;
    const dz = z - st.z;
    const cos = Math.cos(-st.yaw);
    const sin = Math.sin(-st.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const halfW = bp.width * 0.5 - 0.15;
    const halfD = bp.depth * 0.5 - 0.15;
    if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfD) {
      const topY = st.y + (bp.isHouse ? 0.42 : bp.height);
      if (highestTop === null || topY > highestTop) {
        highestTop = topY;
      }
    }
  }
  return highestTop;
}

export function validatePlayerPlacement(
  bp: BuildingBlueprint,
  rawX: number,
  rawZ: number,
  rawYaw: number,
  snapEnabled: boolean,
  ctx: PlacementEnvironmentContext,
  ignoreStructureId?: string,
): PlacementValidationResult {
  const structures = ignoreStructureId
    ? ctx.existingStructures.filter((s) => s.id !== ignoreStructureId)
    : ctx.existingStructures;

  let x = rawX;
  let z = rawZ;
  let yaw = rawYaw;
  let y = groundHeightAt(x, z);
  let snappedToId: string | undefined;
  let snappedType: SnapAnchorType | undefined;

  if (snapEnabled) {
    const snap = findBestSnapTarget(bp, x, z, yaw, structures);
    if (snap) {
      x = snap.x;
      z = snap.z;
      yaw = snap.yaw;
      y = snap.y;
      snappedToId = snap.snappedToId;
      snappedType = snap.snappedType;
    }
  }

  // If allowOnFloor & not snapped above ground, rest smoothly onto existing floor/foundation/house floor
  if (!snappedToId && bp.allowOnFloor) {
    const floorTop = findSupportingFloorY(x, z, structures);
    if (floorTop !== null) {
      y = Math.max(groundHeightAt(x, z), floorTop);
    } else {
      y = groundHeightAt(x, z);
    }
  } else if (!snappedToId) {
    y = groundHeightAt(x, z);
  }

  const fail = (
    reason: PlacementValidationResult['reason'],
  ): PlacementValidationResult => ({
    valid: false,
    reason,
    alignedX: x,
    alignedY: y,
    alignedZ: z,
    alignedYaw: yaw,
    snappedToId,
    snappedType,
  });

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fail('out_of_bounds');
  }

  const footprintRadius = Math.max(0.45, Math.hypot(bp.width * 0.5, bp.depth * 0.5));
  if (Math.hypot(x, z) > PLAYABLE_RADIUS - Math.max(36, footprintRadius + 18)) {
    return fail('out_of_bounds');
  }

  // Water & ocean validation (allow slightly closer docks/walls than full villages, never inside water)
  const centerGroundY = groundHeightAt(x, z);
  if (centerGroundY <= WATER_LEVEL + 0.35 || isWater(x, z, centerGroundY)) {
    return fail('in_water');
  }
  const hydro = getHydrologyClearance(x, z);
  if (hydro < bp.waterBuffer * 0.65) {
    return fail('near_water');
  }

  // Sample 4 footprint corners for water, slope, and relief
  const hw = bp.width * 0.5;
  const hd = bp.depth * 0.5;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let minCornerY = centerGroundY;
  let maxCornerY = centerGroundY;

  const corners: ReadonlyArray<readonly [number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];

  for (let i = 0; i < corners.length; i++) {
    const wx = x + corners[i][0] * cos - corners[i][1] * sin;
    const wz = z + corners[i][0] * sin + corners[i][1] * cos;
    const wy = groundHeightAt(wx, wz);
    if (wy <= WATER_LEVEL + 0.25 || isWater(wx, wz, wy)) {
      return fail('in_water');
    }
    if (wy < minCornerY) minCornerY = wy;
    if (wy > maxCornerY) maxCornerY = wy;
  }

  // Slope & relief checks (relaxed for elevated pieces snapped onto floors/walls)
  const isElevatedModular =
    Boolean(snappedToId) &&
    (bp.isRoofPiece || bp.isWallPiece || bp.isDoorPiece || bp.isWindowPiece || bp.isFloorPiece);

  if (!isElevatedModular) {
    const slope = groundSlopeAt(x, z, centerGroundY);
    if (slope > bp.maxSlope) {
      return fail('slope_too_steep');
    }
    if (maxCornerY - minCornerY > bp.maxRelief) {
      return fail('uneven_terrain');
    }
  }

  // Protect villages & village buildings while leaving outskirts open beyond clearance
  for (let i = 0; i < ctx.villages.length; i++) {
    const v = ctx.villages[i];
    const limit = v.clearanceRadius + Math.min(footprintRadius, 3.2);
    const dx = x - v.centerX;
    const dz = z - v.centerZ;
    if (dx * dx + dz * dz < limit * limit) {
      return fail('inside_village_protected');
    }
  }

  // Protect main Oakhollow & approach roads
  if (
    isBlockingOakhollowRoads(
      x,
      z,
      Math.min(footprintRadius, 3.2),
      ctx.oakhollowCenter.x,
      ctx.oakhollowCenter.z,
    )
  ) {
    return fail('blocking_road');
  }

  // Protect important NPC spawn/home anchors
  const npcClearR = Math.min(3.5, footprintRadius + 1.1);
  for (let i = 0; i < ctx.npcSpawns.length; i++) {
    const npc = ctx.npcSpawns[i];
    const dx = x - npc.x;
    const dz = z - npc.z;
    if (dx * dx + dz * dz < npcClearR * npcClearR) {
      return fail('near_npc_spawn');
    }
  }

  // Protect important quest landmarks & exploration cairns/signposts/camps/ruins
  const lmClearR = Math.min(4.2, footprintRadius + 1.8);
  for (let i = 0; i < ctx.landmarks.length; i++) {
    const lm = ctx.landmarks[i];
    if (lm.kind === 'herb' || lm.kind === 'location') continue;
    const radiusPad = lm.kind === 'ruins' || lm.kind === 'mine' || lm.kind === 'cave' ? 9.0 : lmClearR;
    const dx = x - lm.x;
    const dz = z - lm.z;
    if (dx * dx + dz * dz < radiusPad * radiusPad) {
      return fail('near_quest_object');
    }
  }

  // Check world colliders (trees, rocks, existing world buildings, other placed buildings)
  const colliders = ctx.queryCollidersNear(x, z);
  const myMinY = y + (bp.isRoofPiece || bp.isWallPiece ? 0.15 : 0.2);
  const myMaxY = y + bp.height - 0.12;
  // Slightly inset horizontal footprint so snapped adjacent walls/floors/props fit cleanly side by side
  const checkR = Math.max(0.28, Math.min(hw, hd) - 0.18);

  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.kind === 'box') {
      if (bp.allowOnFloor && (c.walkableTop || c.tag === 'floor' || c.tag === 'roof')) {
        continue;
      }
      if (bp.isRoofPiece && (c.tag === 'wall' || c.tag === 'door')) {
        continue;
      }
      if (myMaxY <= c.minY + 0.1 || myMinY >= c.maxY - 0.1) continue;

      const dx = x - c.x;
      const dz = z - c.z;
      const cc = Math.cos(-c.yaw);
      const ss = Math.sin(-c.yaw);
      const lx = dx * cc - dz * ss;
      const lz = dx * ss + dz * cc;
      // Tight tolerance so snapped walls & doors touch edge-to-edge without false collision
      const tol = isElevatedModular ? -0.16 : 0.02;
      if (Math.abs(lx) < c.halfW + checkR + tol && Math.abs(lz) < c.halfD + checkR + tol) {
        return fail('colliding_structure');
      }
    } else if (c.kind === 'cylinder') {
      if (myMaxY <= c.minY + 0.1 || myMinY >= c.maxY - 0.1) continue;
      const distSq = (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z);
      const minD = c.radius + Math.max(0.25, Math.min(hw, hd) - 0.1);
      if (distSq < minD * minD) {
        return fail('colliding_structure');
      }
    }
  }

  // Prevent placing duplicate structure directly on top of identical coordinate
  for (let i = 0; i < structures.length; i++) {
    const st = structures[i];
    const dx = x - st.x;
    const dy = y - st.y;
    const dz = z - st.z;
    if (dx * dx + dy * dy + dz * dz < 0.25 * 0.25) {
      return fail('colliding_structure');
    }
  }

  // Prevent burying the player directly inside solid box during placement of solid props/blocks
  if (ctx.playerPos && !bp.isFloorPiece && !bp.isRoofPiece && !bp.isFarmPlot) {
    const pdx = ctx.playerPos.x - x;
    const pdz = ctx.playerPos.z - z;
    const cc = Math.cos(-yaw);
    const ss = Math.sin(-yaw);
    const lx = pdx * cc - pdz * ss;
    const lz = pdx * ss + pdz * cc;
    const pFootR = 0.25;
    if (!bp.isHouse && Math.abs(lx) < Math.max(0.3, hw - 0.15) + pFootR && Math.abs(lz) < Math.max(0.3, hd - 0.15) + pFootR) {
      if (ctx.playerPos.y < y + bp.height && ctx.playerPos.y + 1.7 > y) {
        return fail('colliding_structure');
      }
    }
  }

  return {
    valid: true,
    reason: 'valid',
    alignedX: x,
    alignedY: y,
    alignedZ: z,
    alignedYaw: yaw,
    snappedToId,
    snappedType,
  };
}
