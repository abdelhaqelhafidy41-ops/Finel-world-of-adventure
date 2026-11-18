import * as THREE from 'three';
import type { BiomeType, WorldCollider } from '../types';
import {
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  getBiomeAt,
  getCoastlineZAt,
  getEastRiverCenterXAt,
  getLakeDistanceFactor,
  getRiverCenterXAt,
  getWestRiverCenterXAt,
  groundHeightAt,
  groundSlopeAt,
} from '../math/noise';
import type { ProceduralTextureSet } from './textures';

export type BridgeStyle = 'timber' | 'stone' | 'sandstone';

export interface BridgeSpec {
  readonly id: string;
  readonly kind: 'river' | 'gorge';
  readonly style: BridgeStyle;
  readonly chunkCx: number;
  readonly chunkCz: number;
  readonly startX: number;
  readonly startZ: number;
  readonly startY: number;
  readonly endX: number;
  readonly endZ: number;
  readonly endY: number;
  readonly midX: number;
  readonly midZ: number;
  readonly crownY: number;
  readonly length: number;
  readonly width: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly yaw: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const CHUNK_SIZE = 120;
const BRIDGE_WIDTH = 4.2;

function hashInt(seed: number, a: number, b: number, c: number): number {
  let n =
    Math.imul(a, 374761393) +
    Math.imul(b, 668265263) +
    Math.imul(c, 2246822519) +
    Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/**
 * Evaluates the smooth arched bridge deck top surface Y at normalized parameter u in [0, 1].
 * Embeds flush at u = 0 (startY) and u = 1 (endY) with a gentle arch peaking at crownY.
 */
export function evaluateBridgeDeckY(spec: BridgeSpec, u: number): number {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const linearY = spec.startY + (spec.endY - spec.startY) * t;
  const archLift = Math.max(0, spec.crownY - (spec.startY + spec.endY) * 0.5);
  // Smooth sin^2-like arch (4*t*(1-t)) that is zero at both ends and smooth at the crown
  const arch = 4 * t * (1 - t);
  return linearY + archLift * arch;
}

/**
 * Zero-GC navigation helper for NPCs, enemies, animals, and player checks:
 * returns the highest walkable bridge/floor deck Y at `(x, z)` if a walkableTop
 * box collider supports an actor near `currentY`, otherwise `null`.
 */
export function sampleWalkableBridgeHeight(
  x: number,
  z: number,
  currentY: number,
  colliders: readonly WorldCollider[],
  stepTolerance = 1.05,
): number | null {
  let bestY = -Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.kind !== 'box' || !c.walkableTop) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (
      Math.abs(lx) <= c.halfW + 0.12 &&
      Math.abs(lz) <= c.halfD + 0.12 &&
      currentY >= c.maxY - stepTolerance &&
      currentY <= c.maxY + 2.4 &&
      c.maxY > bestY
    ) {
      bestY = c.maxY;
    }
  }
  return bestY > -Infinity ? bestY : null;
}

function chooseBridgeStyle(biome: BiomeType, kind: 'river' | 'gorge'): BridgeStyle {
  if (biome === 'Desert') return 'sandstone';
  if (biome === 'Mountains' || kind === 'gorge') return 'stone';
  return 'timber';
}

export class BridgeSystem {
  private readonly seed: number;
  private readonly chunkSpecsCache = new Map<string, BridgeSpec[]>();
  private readonly isVillageClearance: (x: number, z: number) => boolean;

  private readonly timberPlankMat: THREE.MeshStandardMaterial;
  private readonly timberBeamMat: THREE.MeshStandardMaterial;
  private readonly stonePierMat: THREE.MeshStandardMaterial;
  private readonly sandstoneMat: THREE.MeshStandardMaterial;
  private readonly sandstoneTrimMat: THREE.MeshStandardMaterial;

  constructor(
    seed: number,
    textures: ProceduralTextureSet,
    isVillageClearance: (x: number, z: number) => boolean,
  ) {
    this.seed = seed >>> 0;
    this.isVillageClearance = isVillageClearance;

    this.timberPlankMat = new THREE.MeshStandardMaterial({
      color: 0x8e6b47,
      map: textures.barkMap,
      normalMap: textures.barkNormalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.86,
      metalness: 0.02,
    });
    this.timberBeamMat = new THREE.MeshStandardMaterial({
      color: 0x5c4128,
      map: textures.barkMap,
      normalMap: textures.barkNormalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.9,
      metalness: 0.03,
    });
    this.stonePierMat = new THREE.MeshStandardMaterial({
      color: 0x7b7d79,
      map: textures.rockMap,
      normalMap: textures.rockNormalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.92,
      metalness: 0.04,
    });
    this.sandstoneMat = new THREE.MeshStandardMaterial({
      color: 0xc9a978,
      map: textures.sandMap,
      normalMap: textures.sandNormalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.88,
      metalness: 0.02,
    });
    this.sandstoneTrimMat = new THREE.MeshStandardMaterial({
      color: 0x9f7e52,
      map: textures.rockMap,
      normalMap: textures.rockNormalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.9,
      metalness: 0.02,
    });
  }

  /**
   * Deterministically resolves all valid bridges anchored inside chunk `(cx, cz)`.
   * Cached per chunk so chunk re-activation is instant and never scans the full world.
   */
  public getBridgesForChunk(cx: number, cz: number): readonly BridgeSpec[] {
    const key = `${cx},${cz}`;
    const cached = this.chunkSpecsCache.get(key);
    if (cached) return cached;

    const specs: BridgeSpec[] = [];
    const chunkMinX = cx * CHUNK_SIZE - CHUNK_SIZE * 0.5;
    const chunkMaxX = cx * CHUNK_SIZE + CHUNK_SIZE * 0.5;
    const chunkMinZ = cz * CHUNK_SIZE - CHUNK_SIZE * 0.5;
    const chunkMaxZ = cz * CHUNK_SIZE + CHUNK_SIZE * 0.5;

    if (Math.hypot(cx * CHUNK_SIZE, cz * CHUNK_SIZE) > PLAYABLE_RADIUS - 60) {
      this.chunkSpecsCache.set(key, specs);
      return specs;
    }

    // 1. Deterministic River Bridges across all 3 world rivers
    const rivers: Array<{
      id: string;
      fn: (z: number) => number;
      minZ: number;
      spacing: number;
      xMin: number;
      xMax: number;
    }> = [
      { id: 'main', fn: getRiverCenterXAt, minZ: -310, spacing: 118, xMin: -280, xMax: 240 },
      { id: 'west', fn: getWestRiverCenterXAt, minZ: -1160, spacing: 150, xMin: -1480, xMax: -420 },
      { id: 'east', fn: getEastRiverCenterXAt, minZ: -1060, spacing: 150, xMin: 460, xMax: 1500 },
    ];

    for (let r = 0; r < rivers.length; r++) {
      const river = rivers[r];
      if (chunkMaxX < river.xMin || chunkMinX > river.xMax) continue;
      if (chunkMaxZ < river.minZ) continue;

      const startIdx = Math.floor((chunkMinZ - 20) / river.spacing);
      const endIdx = Math.ceil((chunkMaxZ + 20) / river.spacing);

      for (let idx = startIdx; idx <= endIdx; idx++) {
        const jitter = (hashInt(this.seed, r * 97 + 13, idx, 5) - 0.5) * (river.spacing * 0.32);
        const z = idx * river.spacing + jitter;
        if (z < chunkMinZ || z >= chunkMaxZ || z < river.minZ) continue;

        const rx = river.fn(z);
        if (rx < chunkMinX || rx >= chunkMaxX) continue;

        const coastZ = getCoastlineZAt(rx);
        if (z > coastZ - 32) continue;

        // Don't place a river bridge right inside a wide lake basin
        if (getLakeDistanceFactor(rx, z) < 1.15) continue;

        const spec = this.tryBuildRiverBridge(
          `bridge_${river.id}_${idx}`,
          cx,
          cz,
          rx,
          z,
          river.fn,
        );
        if (spec) {
          specs.push(spec);
        }
      }
    }

    // 2. Deterministic Mountain / Canyon Gorge Bridges (at most 1 per highland chunk)
    if (specs.length === 0) {
      const gorge = this.tryBuildGorgeBridge(cx, cz);
      if (gorge) {
        specs.push(gorge);
      }
    }

    this.chunkSpecsCache.set(key, specs);
    return specs;
  }

  /**
   * Fast footprint check used during tree/rock scattering so props never spawn
   * on top of bridge decks or block bridge entrances.
   */
  public isNearBridgeFootprint(wx: number, wz: number, padding = 3.2): boolean {
    const cx = Math.floor((wx + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
    const cz = Math.floor((wz + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.chunkSpecsCache.get(`${cx + dx},${cz + dz}`);
        if (!list || list.length === 0) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (
            wx >= b.minX - padding &&
            wx <= b.maxX + padding &&
            wz >= b.minZ - padding &&
            wz <= b.maxZ + padding
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private tryBuildRiverBridge(
    id: string,
    cx: number,
    cz: number,
    rx: number,
    rz: number,
    riverFn: (z: number) => number,
  ): BridgeSpec | null {
    const midH = groundHeightAt(rx, rz);
    // Must actually cross water
    if (midH > WATER_LEVEL - 0.15) return null;

    // Tangent along river flow (dX/dZ, 1) -> perpendicular crossing vector
    const dxdz = (riverFn(rz + 4) - riverFn(rz - 4)) / 8;
    const tangLen = Math.hypot(dxdz, 1) || 1;
    // Perpendicular to (dxdz, 1) is (1, -dxdz) normalized
    const dirX = 1 / tangLen;
    const dirZ = -dxdz / tangLen;

    // Scan outward from river center to find stable dry ground on both banks
    let leftDist = -1;
    let rightDist = -1;

    for (let d = 5; d <= 22; d += 1.25) {
      if (leftDist < 0) {
        const lx = rx - dirX * d;
        const lz = rz - dirZ * d;
        const lh = groundHeightAt(lx, lz);
        if (lh >= WATER_LEVEL + 0.85 && groundSlopeAt(lx, lz, lh) <= 0.48) {
          leftDist = d + 1.8; // embed ramp smoothly onto bank
        }
      }
      if (rightDist < 0) {
        const gx = rx + dirX * d;
        const gz = rz + dirZ * d;
        const gh = groundHeightAt(gx, gz);
        if (gh >= WATER_LEVEL + 0.85 && groundSlopeAt(gx, gz, gh) <= 0.48) {
          rightDist = d + 1.8;
        }
      }
      if (leftDist > 0 && rightDist > 0) break;
    }

    if (leftDist < 0 || rightDist < 0) return null;

    const totalLen = leftDist + rightDist;
    if (totalLen < 12 || totalLen > 40) return null;

    const startX = rx - dirX * leftDist;
    const startZ = rz - dirZ * leftDist;
    const endX = rx + dirX * rightDist;
    const endZ = rz + dirZ * rightDist;

    if (
      this.isVillageClearance(startX, startZ) ||
      this.isVillageClearance(endX, endZ) ||
      this.isVillageClearance(rx, rz)
    ) {
      return null;
    }

    const startY = groundHeightAt(startX, startZ) - 0.04;
    const endY = groundHeightAt(endX, endZ) - 0.04;
    if (startY < WATER_LEVEL + 0.65 || endY < WATER_LEVEL + 0.65) return null;
    if (Math.abs(endY - startY) > totalLen * 0.24) return null;

    const crownY = Math.max(
      WATER_LEVEL + 1.85,
      Math.max(startY, endY) + Math.min(0.95, totalLen * 0.035),
    );

    // Ensure approach grades at both ends are comfortably climbable (<= 0.34)
    const archLift = crownY - (startY + endY) * 0.5;
    const startSlope = Math.abs((endY - startY + 4 * archLift) / totalLen);
    const endSlope = Math.abs((endY - startY - 4 * archLift) / totalLen);
    if (startSlope > 0.36 || endSlope > 0.36) return null;

    const midX = (startX + endX) * 0.5;
    const midZ = (startZ + endZ) * 0.5;
    const yaw = Math.atan2(dirX, dirZ);
    const style = chooseBridgeStyle(getBiomeAt(midX, midZ), 'river');
    const pad = BRIDGE_WIDTH * 0.6;

    return {
      id,
      kind: 'river',
      style,
      chunkCx: cx,
      chunkCz: cz,
      startX,
      startZ,
      startY,
      endX,
      endZ,
      endY,
      midX,
      midZ,
      crownY,
      length: totalLen,
      width: BRIDGE_WIDTH,
      dirX,
      dirZ,
      yaw,
      minX: Math.min(startX, endX) - pad,
      maxX: Math.max(startX, endX) + pad,
      minZ: Math.min(startZ, endZ) - pad,
      maxZ: Math.max(startZ, endZ) + pad,
    };
  }

  private tryBuildGorgeBridge(cx: number, cz: number): BridgeSpec | null {
    const centerX = cx * CHUNK_SIZE;
    const centerZ = cz * CHUNK_SIZE;
    const biome = getBiomeAt(centerX, centerZ);
    if (biome !== 'Mountains' && biome !== 'Forest') return null;

    // Only attempt in highland chunks with substantial elevation relief
    const hC = groundHeightAt(centerX, centerZ);
    if (hC < WATER_LEVEL + 4.5) return null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const rx = centerX + (hashInt(this.seed, cx, cz, attempt * 11 + 3) - 0.5) * (CHUNK_SIZE - 34);
      const rz = centerZ + (hashInt(this.seed, cx, cz, attempt * 11 + 7) - 0.5) * (CHUNK_SIZE - 34);
      const midH = groundHeightAt(rx, rz);
      if (midH < WATER_LEVEL + 1.2) continue;

      const angle = hashInt(this.seed, cx, cz, attempt * 11 + 19) * Math.PI;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const halfSpan = 9 + hashInt(this.seed, cx, cz, attempt * 11 + 23) * 6; // 18..30m span

      const startX = rx - dirX * halfSpan;
      const startZ = rz - dirZ * halfSpan;
      const endX = rx + dirX * halfSpan;
      const endZ = rz + dirZ * halfSpan;

      if (
        this.isVillageClearance(startX, startZ) ||
        this.isVillageClearance(endX, endZ) ||
        this.isVillageClearance(rx, rz)
      ) {
        continue;
      }

      const startH = groundHeightAt(startX, startZ);
      const endH = groundHeightAt(endX, endZ);
      const minShoulder = Math.min(startH, endH);

      // Must span a genuine deep gap (>= 5.2m drop below both shoulders)
      if (minShoulder - midH < 5.2) continue;
      if (Math.abs(endH - startH) > 3.6) continue;
      if (
        groundSlopeAt(startX, startZ, startH) > 0.44 ||
        groundSlopeAt(endX, endZ, endH) > 0.44
      ) {
        continue;
      }

      // Check quarter points also drop below deck so bridge doesn't clip through a hill
      const q1H = groundHeightAt(rx - dirX * halfSpan * 0.45, rz - dirZ * halfSpan * 0.45);
      const q2H = groundHeightAt(rx + dirX * halfSpan * 0.45, rz + dirZ * halfSpan * 0.45);
      const deckMidBase = (startH + endH) * 0.5;
      if (q1H > deckMidBase + 0.25 || q2H > deckMidBase + 0.25) continue;

      const totalLen = halfSpan * 2;
      const startY = startH - 0.04;
      const endY = endH - 0.04;
      const crownY = Math.max(startY, endY) + 0.55;
      const yaw = Math.atan2(dirX, dirZ);
      const pad = BRIDGE_WIDTH * 0.6;

      return {
        id: `bridge_gorge_${cx}_${cz}`,
        kind: 'gorge',
        style: chooseBridgeStyle(biome, 'gorge'),
        chunkCx: cx,
        chunkCz: cz,
        startX,
        startZ,
        startY,
        endX,
        endZ,
        endY,
        midX: rx,
        midZ: rz,
        crownY,
        length: totalLen,
        width: BRIDGE_WIDTH,
        dirX,
        dirZ,
        yaw,
        minX: Math.min(startX, endX) - pad,
        maxX: Math.max(startX, endX) + pad,
        minZ: Math.min(startZ, endZ) - pad,
        maxZ: Math.max(startZ, endZ) + pad,
      };
    }

    return null;
  }

  /**
   * Builds a lightweight far-LOD silhouette for simplified chunks.
   */
  public buildFarLodBridges(
    cx: number,
    cz: number,
    farGroup: THREE.Group,
    disposables: Array<{ dispose: () => void }>,
  ): void {
    const specs = this.getBridgesForChunk(cx, cz);
    if (specs.length === 0) return;

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const deckMat =
        spec.style === 'sandstone'
          ? this.sandstoneMat
          : spec.style === 'stone'
            ? this.stonePierMat
            : this.timberPlankMat;
      const geo = new THREE.BoxGeometry(spec.width, 0.45, spec.length);
      disposables.push(geo);
      const mesh = new THREE.Mesh(geo, deckMat);
      mesh.position.set(spec.midX, spec.crownY - 0.22, spec.midZ);
      mesh.rotation.y = spec.yaw;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      farGroup.add(mesh);
    }
  }

  /**
   * Builds full-detail composite procedural bridges and registers their
   * overlapping walkableTop deck colliders + side guard rails for chunk `(cx, cz)`.
   */
  public buildActiveChunkBridges(
    cx: number,
    cz: number,
    nearGroup: THREE.Group,
    disposables: Array<{ dispose: () => void }>,
    registerCollider: (collider: WorldCollider) => void,
    castShadows: boolean,
  ): void {
    const specs = this.getBridgesForChunk(cx, cz);
    if (specs.length === 0) return;

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      this.buildSingleBridgeMeshAndColliders(
        spec,
        nearGroup,
        disposables,
        registerCollider,
        castShadows,
      );
    }
  }

  private buildSingleBridgeMeshAndColliders(
    spec: BridgeSpec,
    parent: THREE.Group,
    disposables: Array<{ dispose: () => void }>,
    registerCollider: (collider: WorldCollider) => void,
    castShadows: boolean,
  ): void {
    const group = new THREE.Group();
    group.name = spec.id;
    group.position.set(spec.midX, 0, spec.midZ);
    group.rotation.y = spec.yaw;
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    parent.add(group);

    const deckMat =
      spec.style === 'sandstone'
        ? this.sandstoneMat
        : this.timberPlankMat;
    const beamMat =
      spec.style === 'sandstone'
        ? this.sandstoneTrimMat
        : this.timberBeamMat;
    const pierMat =
      spec.style === 'sandstone'
        ? this.sandstoneMat
        : this.stonePierMat;

    const halfLen = spec.length * 0.5;
    const halfW = spec.width * 0.5;

    // 1. Segmented Arched Deck & Side Stringers (smooth continuous walking surface)
    const deckSegs = Math.max(8, Math.min(16, Math.round(spec.length / 2.2)));
    const segLen = spec.length / deckSegs;
    const deckGeo = new THREE.BoxGeometry(spec.width, 0.24, segLen + 0.14);
    const stringerGeo = new THREE.BoxGeometry(0.28, 0.34, segLen + 0.18);
    disposables.push(deckGeo, stringerGeo);

    const deckInst = new THREE.InstancedMesh(deckGeo, deckMat, deckSegs);
    const stringerInst = new THREE.InstancedMesh(stringerGeo, beamMat, deckSegs * 2);
    deckInst.receiveShadow = true;
    deckInst.castShadow = castShadows;
    stringerInst.receiveShadow = true;
    stringerInst.castShadow = castShadows;

    const dummy = new THREE.Object3D();
    for (let s = 0; s < deckSegs; s++) {
      const u0 = s / deckSegs;
      const u1 = (s + 1) / deckSegs;
      const uMid = (u0 + u1) * 0.5;
      const y0 = evaluateBridgeDeckY(spec, u0);
      const y1 = evaluateBridgeDeckY(spec, u1);
      const yMid = (y0 + y1) * 0.5;
      const pitch = -Math.atan2(y1 - y0, segLen);
      const localZ = (uMid - 0.5) * spec.length;

      dummy.position.set(0, yMid - 0.12, localZ);
      dummy.rotation.set(pitch, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      deckInst.setMatrixAt(s, dummy.matrix);

      // Left & right structural beams under the deck
      dummy.position.set(-halfW + 0.26, yMid - 0.34, localZ);
      dummy.updateMatrix();
      stringerInst.setMatrixAt(s * 2, dummy.matrix);

      dummy.position.set(halfW - 0.26, yMid - 0.34, localZ);
      dummy.updateMatrix();
      stringerInst.setMatrixAt(s * 2 + 1, dummy.matrix);

      // Register overlapping walkableTop deck collider in world space
      const worldX = spec.midX + spec.dirX * localZ;
      const worldZ = spec.midZ + spec.dirZ * localZ;
      registerCollider({
        kind: 'box',
        x: worldX,
        z: worldZ,
        halfW: halfW + 0.08,
        halfD: segLen * 0.5 + 0.36,
        minY: Math.min(y0, y1) - 0.55,
        maxY: yMid,
        yaw: spec.yaw,
        tag: 'floor',
        walkableTop: true,
      });
    }

    deckInst.instanceMatrix.needsUpdate = true;
    deckInst.computeBoundingSphere();
    stringerInst.instanceMatrix.needsUpdate = true;
    stringerInst.computeBoundingSphere();
    group.add(deckInst, stringerInst);

    // 2. Grounded Stone/Timber Bank Abutments & Support Piers (never float!)
    const pierUs = spec.length > 24 ? [0.03, 0.32, 0.68, 0.97] : [0.04, 0.35, 0.65, 0.96];
    for (let pi = 0; pi < pierUs.length; pi++) {
      const u = pierUs[pi];
      const localZ = (u - 0.5) * spec.length;
      const topY = evaluateBridgeDeckY(spec, u) - 0.22;
      const wx = spec.midX + spec.dirX * localZ;
      const wz = spec.midZ + spec.dirZ * localZ;
      const groundY = groundHeightAt(wx, wz);
      const bottomY = Math.min(groundY - 2.2, WATER_LEVEL - 3.0);
      const pierH = Math.max(1.8, topY - bottomY);

      const isEndAbutment = pi === 0 || pi === pierUs.length - 1;
      if (isEndAbutment) {
        const abutGeo = new THREE.BoxGeometry(spec.width + 0.45, pierH, 2.2);
        disposables.push(abutGeo);
        const abut = new THREE.Mesh(abutGeo, pierMat);
        abut.position.set(0, bottomY + pierH * 0.5, localZ);
        abut.receiveShadow = true;
        abut.castShadow = castShadows;
        abut.matrixAutoUpdate = false;
        abut.updateMatrix();
        group.add(abut);
      } else {
        const colGeo = new THREE.BoxGeometry(0.75, pierH, 0.95);
        disposables.push(colGeo);
        for (const side of [-1, 1]) {
          const col = new THREE.Mesh(colGeo, pierMat);
          col.position.set(side * (halfW - 0.42), bottomY + pierH * 0.5, localZ);
          col.receiveShadow = true;
          col.castShadow = castShadows;
          col.matrixAutoUpdate = false;
          col.updateMatrix();
          group.add(col);
        }
        // Horizontal cross-brace between pier columns
        const braceGeo = new THREE.BoxGeometry(spec.width - 0.4, 0.35, 0.48);
        disposables.push(braceGeo);
        const brace = new THREE.Mesh(braceGeo, beamMat);
        brace.position.set(0, topY - 0.45, localZ);
        brace.receiveShadow = true;
        brace.matrixAutoUpdate = false;
        brace.updateMatrix();
        group.add(brace);
      }
    }

    // 3. Side Railing Posts & Handrails (leave both ends open for smooth entry/exit)
    const postCountPerSide = Math.max(4, Math.min(10, Math.floor(spec.length / 3.0) + 1));
    const postGeo = new THREE.BoxGeometry(0.16, 1.05, 0.16);
    disposables.push(postGeo);
    const postInst = new THREE.InstancedMesh(postGeo, beamMat, postCountPerSide * 2);
    postInst.castShadow = castShadows;
    postInst.receiveShadow = true;

    let pIdx = 0;
    for (let i = 0; i < postCountPerSide; i++) {
      const u = 0.05 + (i / Math.max(1, postCountPerSide - 1)) * 0.9;
      const localZ = (u - 0.5) * spec.length;
      const deckY = evaluateBridgeDeckY(spec, u);
      for (const side of [-1, 1]) {
        dummy.position.set(side * (halfW - 0.12), deckY + 0.48, localZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        postInst.setMatrixAt(pIdx++, dummy.matrix);
      }
    }
    postInst.instanceMatrix.needsUpdate = true;
    postInst.computeBoundingSphere();
    group.add(postInst);

    // Continuous segmented handrails following the arch
    const railSegs = postCountPerSide - 1;
    if (railSegs > 0) {
      const spanFrac = 0.9 / railSegs;
      const railSegLen = spec.length * spanFrac + 0.08;
      const railGeo = new THREE.BoxGeometry(0.12, 0.1, railSegLen);
      disposables.push(railGeo);
      const railInst = new THREE.InstancedMesh(railGeo, beamMat, railSegs * 4);
      railInst.castShadow = castShadows;

      let rIdx = 0;
      for (let i = 0; i < railSegs; i++) {
        const u0 = 0.05 + i * spanFrac;
        const u1 = 0.05 + (i + 1) * spanFrac;
        const uMid = (u0 + u1) * 0.5;
        const y0 = evaluateBridgeDeckY(spec, u0);
        const y1 = evaluateBridgeDeckY(spec, u1);
        const yMid = (y0 + y1) * 0.5;
        const pitch = -Math.atan2(y1 - y0, spec.length * spanFrac);
        const localZ = (uMid - 0.5) * spec.length;

        for (const side of [-1, 1]) {
          // Top rail
          dummy.position.set(side * (halfW - 0.12), yMid + 0.94, localZ);
          dummy.rotation.set(pitch, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          railInst.setMatrixAt(rIdx++, dummy.matrix);

          // Mid rail
          dummy.position.set(side * (halfW - 0.12), yMid + 0.52, localZ);
          dummy.updateMatrix();
          railInst.setMatrixAt(rIdx++, dummy.matrix);
        }
      }
      railInst.instanceMatrix.needsUpdate = true;
      railInst.computeBoundingSphere();
      group.add(railInst);
    }

    // 4. Side railing guard colliders (prevent accidental sideways fall-off over deep water/gorges)
    const guardHalfD = Math.max(1.0, halfLen * 0.86);
    const guardMinY = Math.min(spec.startY, spec.endY) + 0.05;
    const guardMaxY = spec.crownY + 1.05;
    // Perpendicular unit vector for local +X: (cos(yaw), -sin(yaw)) = (dirZ, -dirX)
    const perpX = spec.dirZ;
    const perpZ = -spec.dirX;
    for (const side of [-1, 1]) {
      const offset = side * (halfW + 0.06);
      registerCollider({
        kind: 'box',
        x: spec.midX + perpX * offset,
        z: spec.midZ + perpZ * offset,
        halfW: 0.14,
        halfD: guardHalfD,
        minY: guardMinY,
        maxY: guardMaxY,
        yaw: spec.yaw,
        tag: 'prop',
        walkableTop: false,
      });
    }
  }

  public dispose(): void {
    this.chunkSpecsCache.clear();
    this.timberPlankMat.dispose();
    this.timberBeamMat.dispose();
    this.stonePierMat.dispose();
    this.sandstoneMat.dispose();
    this.sandstoneTrimMat.dispose();
  }
}
