import * as THREE from 'three';
import type { DoorState, WorldCollider } from '../types';
import type { ProceduralTextureSet } from '../world/textures';
import type { WorldInteractable } from '../world/WorldManager';
import { toChunkKey, worldToChunkCoords } from '../world/ChunkManager';
import { getBlueprintById } from './buildingCatalog';
import { BuildingMeshFactory, type BuiltStructureMeshRefs } from './BuildingMeshFactory';
import { getCropById, getCropDisplayName } from '../farming/cropCatalog';
import type { CropId } from '../farming/farmingTypes';
import type {
  BuildingPermissionScope,
  PlayerBuiltStructure,
  PlayerStructureFarmState,
  PlayerStructureStorageItem,
  SavedPlayerBuilding,
} from './buildingTypes';

interface MountedDoorRuntime {
  doorId: string;
  pivot: THREE.Group;
  targetOpen: boolean;
  progress: number;
  state: DoorState;
  isBlocking: boolean;
  x: number;
  z: number;
  minY: number;
  maxY: number;
  halfW: number;
  halfD: number;
  yaw: number;
  activeNpcUsers: Set<string>;
}

interface MountedStructureRuntime {
  structureId: string;
  chunkKey: string;
  refs: BuiltStructureMeshRefs;
  doorRuntime?: MountedDoorRuntime;
  interactableIds: string[];
  colliderOwnerKey: string;
}

export interface BuildingManagerCallbacks {
  scene: THREE.Scene;
  textures: ProceduralTextureSet;
  registerCollider: (collider: WorldCollider, ownerKey: string) => void;
  unregisterColliders: (ownerKey: string) => void;
  interactables: WorldInteractable[];
  onDoorAudioEvent?: (doorId: string, isOpen: boolean, x: number, y: number, z: number) => void;
}

export class BuildingManager {
  private readonly factory: BuildingMeshFactory;
  private readonly rootGroup = new THREE.Group();
  private readonly callbacks: BuildingManagerCallbacks;
  private readonly structures = new Map<string, PlayerBuiltStructure>();
  private readonly chunkIndex = new Map<string, Set<string>>();
  private readonly mounted = new Map<string, MountedStructureRuntime>();
  private readonly doorToStructure = new Map<string, string>();
  private readonly activeChunks = new Set<string>();
  private shadowsEnabled = true;

  private previewGroup: THREE.Group | null = null;
  private previewBlueprintId: string | null = null;

  constructor(callbacks: BuildingManagerCallbacks) {
    this.callbacks = callbacks;
    this.factory = new BuildingMeshFactory(callbacks.textures);
    this.rootGroup.name = 'PlayerBuiltStructures';
    callbacks.scene.add(this.rootGroup);
  }

  public applyTextures(textures: ProceduralTextureSet): void {
    this.factory.applyTextures(textures);
  }

  public applyGraphicsProfile(shadowsEnabled: boolean): void {
    this.shadowsEnabled = shadowsEnabled;
    this.mounted.forEach((rt) => {
      rt.refs.group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.castShadow = Boolean(mesh.userData.__origCastShadow) && shadowsEnabled;
          mesh.receiveShadow = Boolean(mesh.userData.__origReceiveShadow) && shadowsEnabled;
        }
      });
    });
  }

  public getAllStructures(): PlayerBuiltStructure[] {
    return Array.from(this.structures.values());
  }

  public getStructureCount(): number {
    return this.structures.size;
  }

  public getStructureById(id: string): PlayerBuiltStructure | undefined {
    return this.structures.get(id);
  }

  public getStructureByDoorId(doorId: string): PlayerBuiltStructure | undefined {
    const sid = this.doorToStructure.get(doorId);
    return sid ? this.structures.get(sid) : undefined;
  }

  public hasDoor(doorId: string): boolean {
    return this.doorToStructure.has(doorId);
  }

  public getNearestManageableStructure(
    x: number,
    y: number,
    z: number,
    maxDist = 5.4,
  ): PlayerBuiltStructure | null {
    let best: PlayerBuiltStructure | null = null;
    let bestDistSq = maxDist * maxDist;
    this.structures.forEach((st) => {
      const bp = getBlueprintById(st.blueprintId);
      const radiusBoost = bp ? Math.min(2.6, Math.max(bp.width, bp.depth) * 0.35) : 0;
      const dx = st.x - x;
      const dy = (st.y + 1.0) - y;
      const dz = st.z - z;
      if (Math.abs(dy) > 4.5) return;
      const effectiveDist = Math.max(0, Math.hypot(dx, dz) - radiusBoost);
      const dSq = effectiveDist * effectiveDist;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = st;
      }
    });
    return best;
  }

  // -------------------------------------------------------------------------
  // Preview Group Management
  // -------------------------------------------------------------------------
  public updatePreview(
    visible: boolean,
    blueprintId: string,
    x: number,
    y: number,
    z: number,
    yaw: number,
    valid: boolean,
  ): void {
    if (!visible) {
      if (this.previewGroup) {
        this.previewGroup.visible = false;
      }
      return;
    }

    const bp = getBlueprintById(blueprintId);
    if (!bp) return;

    if (!this.previewGroup || this.previewBlueprintId !== blueprintId) {
      if (this.previewGroup) {
        this.previewGroup.removeFromParent();
      }
      this.previewGroup = this.factory.createPreviewGroup(bp);
      this.previewBlueprintId = blueprintId;
      this.callbacks.scene.add(this.previewGroup);
    }

    this.previewGroup.visible = true;
    this.previewGroup.position.set(x, y, z);
    this.previewGroup.rotation.set(0, yaw, 0);
    this.factory.applyPreviewTint(this.previewGroup, valid);
  }

  public clearPreview(): void {
    if (this.previewGroup) {
      this.previewGroup.removeFromParent();
      this.previewGroup = null;
      this.previewBlueprintId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Placement / Mutation / Upgrade / Demolition
  // -------------------------------------------------------------------------
  public addOrUpdateStructure(structure: PlayerBuiltStructure): PlayerBuiltStructure {
    const existing = this.structures.get(structure.id);
    if (existing) {
      this.unmountStructure(structure.id);
      this.removeFromChunkIndex(existing);
    }

    const stored: PlayerBuiltStructure = {
      ...structure,
      storageItems: structure.storageItems
        ? structure.storageItems.map((it) => ({ ...it }))
        : undefined,
      farmState: structure.farmState ? { ...structure.farmState } : undefined,
    };

    this.structures.set(stored.id, stored);
    const chunkKey = this.addToChunkIndex(stored);
    if (this.activeChunks.has(chunkKey)) {
      this.mountStructure(stored, chunkKey);
    }
    return stored;
  }

  public removeStructure(structureId: string): PlayerBuiltStructure | null {
    const existing = this.structures.get(structureId);
    if (!existing) return null;
    this.unmountStructure(structureId);
    this.removeFromChunkIndex(existing);
    this.structures.delete(structureId);
    return existing;
  }

  public setPermissions(structureId: string, scope: BuildingPermissionScope): boolean {
    const st = this.structures.get(structureId);
    if (!st) return false;
    st.permission = scope;
    return true;
  }

  public applyDamage(structureId: string, amount: number): { health: number; destroyed: boolean } | null {
    const st = this.structures.get(structureId);
    if (!st) return null;
    st.health = Math.max(0, Math.round(st.health - Math.max(0, amount)));
    if (st.health <= 0) {
      this.removeStructure(structureId);
      return { health: 0, destroyed: true };
    }
    return { health: st.health, destroyed: false };
  }

  public applyRepair(structureId: string, targetHealth?: number): number | null {
    const st = this.structures.get(structureId);
    if (!st) return null;
    st.health = Math.min(st.maxHealth, targetHealth ?? st.maxHealth);
    return st.health;
  }

  public applyUpgrade(structureId: string, newBlueprintId: string): PlayerBuiltStructure | null {
    const st = this.structures.get(structureId);
    const nextBp = getBlueprintById(newBlueprintId);
    if (!st || !nextBp) return null;

    const upgraded: PlayerBuiltStructure = {
      ...st,
      blueprintId: nextBp.id,
      category: nextBp.category,
      tier: nextBp.tier,
      maxHealth: nextBp.maxHealth,
      health: nextBp.maxHealth,
      storageItems:
        nextBp.storageCapacity && st.storageItems
          ? st.storageItems
          : nextBp.storageCapacity
            ? []
            : st.storageItems,
    };
    return this.addOrUpdateStructure(upgraded);
  }

  public setStorageItems(structureId: string, items: PlayerStructureStorageItem[]): boolean {
    const st = this.structures.get(structureId);
    if (!st) return false;
    st.storageItems = items.map((i) => ({ ...i }));
    return true;
  }

  public toggleDoor(
    doorId: string,
    forceOpen?: boolean,
    isNpc = false,
  ): { isOpen: boolean; x: number; y: number; z: number } | null {
    const sid = this.doorToStructure.get(doorId);
    if (!sid) return null;
    const st = this.structures.get(sid);
    if (!st) return null;

    const nextOpen = forceOpen !== undefined ? forceOpen : !Boolean(st.doorOpen);
    st.doorOpen = nextOpen;

    const rt = this.mounted.get(sid);
    if (rt?.doorRuntime) {
      const dr = rt.doorRuntime;
      dr.targetOpen = nextOpen;
      dr.state = nextOpen ? 'OPENING' : 'CLOSING';
      this.syncDoorInteractable(dr, nextOpen);
      if (nextOpen && dr.isBlocking) {
        dr.isBlocking = false;
        this.callbacks.unregisterColliders(`door:${dr.doorId}`);
      }
      this.callbacks.onDoorAudioEvent?.(dr.doorId, nextOpen, dr.x, (dr.minY + dr.maxY) * 0.5, dr.z);
    } else if (!isNpc) {
      this.callbacks.onDoorAudioEvent?.(doorId, nextOpen, st.x, st.y + 1, st.z);
    }

    return { isOpen: nextOpen, x: st.x, y: st.y + 1, z: st.z };
  }

  public getDoorState(doorId: string): DoorState {
    const sid = this.doorToStructure.get(doorId);
    if (!sid) return 'OPEN';
    const rt = this.mounted.get(sid);
    if (rt?.doorRuntime) return rt.doorRuntime.state;
    const st = this.structures.get(sid);
    return st?.doorOpen ? 'OPEN' : 'CLOSED';
  }

  public requestNpcDoorOpen(doorId: string, npcId: string): DoorState {
    const sid = this.doorToStructure.get(doorId);
    if (!sid) return 'OPEN';
    const st = this.structures.get(sid);
    const rt = this.mounted.get(sid);
    if (!st || !rt?.doorRuntime) return 'OPEN';
    // Only authorized structures (not owner-only locked) allow wandering village NPCs
    if (st.permission === 'owner') return rt.doorRuntime.state;
    rt.doorRuntime.activeNpcUsers.add(npcId);
    if (!rt.doorRuntime.targetOpen) {
      this.toggleDoor(doorId, true, true);
    }
    return rt.doorRuntime.state;
  }

  public requestNpcDoorClose(doorId: string, npcId: string): void {
    const sid = this.doorToStructure.get(doorId);
    if (!sid) return;
    const rt = this.mounted.get(sid);
    if (!rt?.doorRuntime) return;
    rt.doorRuntime.activeNpcUsers.delete(npcId);
    if (rt.doorRuntime.activeNpcUsers.size === 0 && rt.doorRuntime.targetOpen) {
      this.toggleDoor(doorId, false, true);
    }
  }

  public isWaterTroughNearby(x: number, z: number, radius = 9.5): boolean {
    const rSq = radius * radius;
    let found = false;
    this.structures.forEach((st) => {
      if (found) return;
      const bp = getBlueprintById(st.blueprintId);
      if (bp?.isWaterTrough) {
        const dx = st.x - x;
        const dz = st.z - z;
        if (dx * dx + dz * dz <= rSq) {
          found = true;
        }
      }
    });
    return found;
  }

  private normalizeFarmState(
    st: PlayerBuiltStructure,
    totalWorldHours: number,
  ): PlayerStructureFarmState {
    const raw = st.farmState ?? {
      stage: 0,
      growthProgress: 0,
      plantedAtElapsed: 0,
    };
    const isLegacyPlanted =
      raw.soilPrepared === undefined &&
      raw.cropId === undefined &&
      ((raw.growthProgress ?? 0) > 0 || (raw.plantedAtElapsed ?? 0) > 0 || raw.stage > 0);

    const soilPrepared =
      raw.soilPrepared !== undefined ? raw.soilPrepared : isLegacyPlanted;
    const cropId =
      raw.cropId !== undefined ? raw.cropId : isLegacyPlanted ? 'wheat' : null;
    const waterLevel =
      raw.waterLevel !== undefined ? raw.waterLevel : isLegacyPlanted ? 0.7 : 0;
    const lastUpdatedWorldHours =
      raw.lastUpdatedWorldHours !== undefined
        ? raw.lastUpdatedWorldHours
        : totalWorldHours;

    const normalized: PlayerStructureFarmState = {
      stage: raw.stage ?? 0,
      growthProgress: raw.growthProgress ?? 0,
      plantedAtElapsed: raw.plantedAtElapsed ?? 0,
      soilPrepared,
      cropId,
      waterLevel,
      plantedAtWorldHours:
        raw.plantedAtWorldHours !== undefined
          ? raw.plantedAtWorldHours
          : isLegacyPlanted
            ? totalWorldHours
            : null,
      lastUpdatedWorldHours,
    };
    st.farmState = normalized;
    return normalized;
  }

  private advanceFarmStateByWorldHours(
    st: PlayerBuiltStructure,
    totalWorldHours: number,
    isRaining: boolean,
  ): boolean {
    const bp = getBlueprintById(st.blueprintId);
    if (!bp?.isFarmPlot) return false;
    const fs = this.normalizeFarmState(st, totalWorldHours);
    const prevStage = fs.stage;
    const prevWaterBucket = Math.round((fs.waterLevel ?? 0) * 10);
    const prevCropId = fs.cropId;

    const deltaH = Math.max(0, totalWorldHours - (fs.lastUpdatedWorldHours ?? totalWorldHours));
    const nearTrough = this.isWaterTroughNearby(st.x, st.z);

    if (isRaining) {
      fs.waterLevel = 1;
    } else if (nearTrough) {
      fs.waterLevel = Math.max(fs.waterLevel ?? 0, 0.58);
    } else if (deltaH > 0) {
      fs.waterLevel = Math.max(0, (fs.waterLevel ?? 0) - deltaH / 14);
    }

    if (fs.soilPrepared && fs.cropId && fs.stage < 3 && deltaH > 0) {
      const crop = getCropById(fs.cropId);
      const baseHours = crop?.growthWorldHours ?? 6;
      const fieldFactor = bp.id === 'large-farm-field' ? 0.92 : 1.0;
      const effectiveHours = Math.max(1.5, baseHours * fieldFactor);
      const hydrated = (fs.waterLevel ?? 0) > 0.05 || isRaining || nearTrough;
      const speedMult = isRaining ? 1.15 : hydrated ? 1.0 : 0.24;
      fs.growthProgress = Math.min(1, fs.growthProgress + (deltaH / effectiveHours) * speedMult);
    }

    if (!fs.soilPrepared || !fs.cropId) {
      fs.stage = 0;
      fs.growthProgress = 0;
    } else if (fs.growthProgress >= 1) {
      fs.stage = 3;
    } else if (fs.growthProgress >= 0.58) {
      fs.stage = 2;
    } else {
      fs.stage = 1;
    }

    fs.lastUpdatedWorldHours = totalWorldHours;
    const nextWaterBucket = Math.round((fs.waterLevel ?? 0) * 10);
    return prevStage !== fs.stage || prevWaterBucket !== nextWaterBucket || prevCropId !== fs.cropId;
  }

  public syncAllFarmPlotsByWorldHours(totalWorldHours: number, isRaining: boolean): void {
    this.structures.forEach((st) => {
      const bp = getBlueprintById(st.blueprintId);
      if (!bp?.isFarmPlot) return;
      this.advanceFarmStateByWorldHours(st, totalWorldHours, isRaining);
      const rt = this.mounted.get(st.id);
      if (rt && st.farmState) {
        this.factory.syncFarmPlotVisuals(
          rt.refs,
          st.farmState.stage,
          st.farmState.cropId,
          st.farmState.waterLevel ?? 0,
        );
        this.syncFarmInteractable(st);
      }
    });
  }

  public prepareFarmSoil(structureId: string, totalWorldHours: number): boolean {
    const st = this.structures.get(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.isFarmPlot) return false;
    const fs = this.normalizeFarmState(st, totalWorldHours);
    fs.soilPrepared = true;
    fs.lastUpdatedWorldHours = totalWorldHours;
    const rt = this.mounted.get(st.id);
    if (rt) {
      this.factory.syncFarmPlotVisuals(rt.refs, fs.stage, fs.cropId, fs.waterLevel ?? 0);
      this.syncFarmInteractable(st);
    }
    return true;
  }

  public plantFarmSeed(
    structureId: string,
    cropId: CropId,
    totalWorldHours: number,
    isRaining = false,
  ): boolean {
    const st = this.structures.get(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    const crop = getCropById(cropId);
    if (!st || !bp?.isFarmPlot || !crop) return false;
    const fs = this.normalizeFarmState(st, totalWorldHours);
    if (fs.cropId && fs.stage >= 1) return false;
    fs.soilPrepared = true;
    fs.cropId = cropId;
    fs.stage = 1;
    fs.growthProgress = 0.05;
    fs.plantedAtWorldHours = totalWorldHours;
    fs.lastUpdatedWorldHours = totalWorldHours;
    if (isRaining) {
      fs.waterLevel = 1;
    } else if (this.isWaterTroughNearby(st.x, st.z)) {
      fs.waterLevel = Math.max(fs.waterLevel ?? 0, 0.58);
    }
    const rt = this.mounted.get(st.id);
    if (rt) {
      this.factory.syncFarmPlotVisuals(rt.refs, fs.stage, fs.cropId, fs.waterLevel ?? 0);
      this.syncFarmInteractable(st);
    }
    return true;
  }

  public waterFarmPlot(structureId: string, totalWorldHours: number): boolean {
    const st = this.structures.get(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.isFarmPlot) return false;
    const fs = this.normalizeFarmState(st, totalWorldHours);
    fs.soilPrepared = true;
    fs.waterLevel = 1;
    fs.lastUpdatedWorldHours = totalWorldHours;
    const rt = this.mounted.get(st.id);
    if (rt) {
      this.factory.syncFarmPlotVisuals(rt.refs, fs.stage, fs.cropId, fs.waterLevel ?? 0);
      this.syncFarmInteractable(st);
    }
    return true;
  }

  public harvestFarmPlot(
    structureId: string,
    currentElapsed: number,
    totalWorldHours = 0,
  ): {
    itemId: string;
    count: number;
    seedItemId: string;
    seedCount: number;
    cropId: CropId;
  } | null {
    const st = this.structures.get(structureId);
    const bp = st ? getBlueprintById(st.blueprintId) : undefined;
    if (!st || !bp?.isFarmPlot || !st.farmState) return null;
    if (st.farmState.stage < 3) return null;

    const cropId = (st.farmState.cropId as CropId | undefined) ?? 'wheat';
    const crop = getCropById(cropId) ?? getCropById('wheat')!;
    const fieldScale = bp.id === 'large-farm-field' ? 2 : 1;
    const yieldCount = Math.max(
      crop.baseYield * fieldScale,
      bp.id === 'large-farm-field'
        ? Math.max(bp.farmYieldCount ?? 6, crop.baseYield * 2)
        : crop.baseYield,
    );
    const seedSpan = crop.seedReturnMax - crop.seedReturnMin + 1;
    const seedCount =
      (crop.seedReturnMin + Math.floor(Math.random() * seedSpan)) * fieldScale;

    st.farmState.stage = 0;
    st.farmState.growthProgress = 0;
    st.farmState.plantedAtElapsed = currentElapsed;
    st.farmState.soilPrepared = true;
    st.farmState.cropId = null;
    st.farmState.waterLevel = Math.max(0, (st.farmState.waterLevel ?? 0.4) - 0.25);
    st.farmState.plantedAtWorldHours = null;
    st.farmState.lastUpdatedWorldHours = totalWorldHours;

    const rt = this.mounted.get(st.id);
    if (rt) {
      this.factory.syncFarmPlotVisuals(
        rt.refs,
        0,
        null,
        st.farmState.waterLevel ?? 0,
      );
      this.syncFarmInteractable(st);
    }

    return {
      itemId: crop.harvestItemId,
      count: yieldCount,
      seedItemId: crop.seedItemId,
      seedCount,
      cropId: crop.id,
    };
  }

  private syncFarmInteractable(st: PlayerBuiltStructure): void {
    const interactable = this.callbacks.interactables.find((i) => i.id === `pfarm_${st.id}`);
    if (!interactable) return;
    const fs = st.farmState;
    if (!fs || !fs.soilPrepared) {
      interactable.actionVerb = 'Till Soil';
      interactable.message = 'Prepare the soil to begin planting crops.';
      return;
    }
    if (!fs.cropId) {
      interactable.actionVerb = 'Plant Seeds';
      interactable.message = 'Prepared fertile soil ready for seeds.';
      return;
    }
    const cropName = getCropDisplayName(fs.cropId, 'en');
    if (fs.stage >= 3) {
      interactable.actionVerb = 'Harvest';
      interactable.message = `${cropName} is ripe and ready to harvest!`;
    } else {
      const pct = Math.round((fs.growthProgress ?? 0) * 100);
      interactable.actionVerb = 'Tend Crop';
      interactable.message = `${cropName} is growing (${pct}%).`;
    }
  }

  // -------------------------------------------------------------------------
  // Chunk Streaming Hooks
  // -------------------------------------------------------------------------
  public onChunkActivated(chunkKey: string): void {
    this.activeChunks.add(chunkKey);
    const ids = this.chunkIndex.get(chunkKey);
    if (!ids) return;
    ids.forEach((id) => {
      if (!this.mounted.has(id)) {
        const st = this.structures.get(id);
        if (st) {
          this.mountStructure(st, chunkKey);
        }
      }
    });
  }

  public onChunkDeactivated(chunkKey: string): void {
    this.activeChunks.delete(chunkKey);
    const ids = this.chunkIndex.get(chunkKey);
    if (!ids) return;
    ids.forEach((id) => {
      this.unmountStructure(id);
    });
  }

  public syncActiveChunks(activeChunkKeys: ReadonlySet<string>): void {
    activeChunkKeys.forEach((key) => {
      if (!this.activeChunks.has(key)) {
        this.onChunkActivated(key);
      }
    });
    const toRemove: string[] = [];
    this.activeChunks.forEach((key) => {
      if (!activeChunkKeys.has(key)) toRemove.push(key);
    });
    for (let i = 0; i < toRemove.length; i++) {
      this.onChunkDeactivated(toRemove[i]);
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame animation (doors, farms, night lanterns)
  // -------------------------------------------------------------------------
  public update(
    dt: number,
    elapsed: number,
    worldHours: number,
    playerPos: THREE.Vector3,
    isDoorwayOccupied?: (x: number, z: number, radius: number) => boolean,
    totalWorldHours?: number,
    isRaining = false,
  ): void {
    const safeDt = Math.max(0.001, Math.min(0.1, dt));
    const h = ((worldHours % 24) + 24) % 24;
    let nightFactor = 0;
    if (h >= 19.5 || h < 5.5) {
      nightFactor = 1;
    } else if (h >= 17.0 && h < 19.5) {
      nightFactor = THREE.MathUtils.smoothstep(h, 17.0, 19.5);
    } else if (h >= 5.5 && h < 8.0) {
      nightFactor = 1 - THREE.MathUtils.smoothstep(h, 5.5, 8.0);
    }

    this.factory.updateNightLighting(elapsed, nightFactor);

    const doorSpeed = 2.8;
    const lampIntensity = THREE.MathUtils.lerp(1.2, 6.4, nightFactor);
    const effectiveTotalHours =
      totalWorldHours !== undefined ? totalWorldHours : elapsed / 15;

    this.mounted.forEach((rt) => {
      const st = this.structures.get(rt.structureId);
      if (!st) return;

      // 1. Lantern lighting distance & night modulation
      if (rt.refs.lampLights && rt.refs.lampLights.length > 0) {
        const dSq = (playerPos.x - st.x) * (playerPos.x - st.x) + (playerPos.z - st.z) * (playerPos.z - st.z);
        const allowLight = dSq < 42 * 42 && nightFactor > 0.08;
        for (let i = 0; i < rt.refs.lampLights.length; i++) {
          rt.refs.lampLights[i].visible = allowLight;
          if (allowLight) rt.refs.lampLights[i].intensity = lampIntensity;
        }
      }

      // 2. Hinged door animation & dynamic collider sync
      const dr = rt.doorRuntime;
      if (dr) {
        const targetProgress = dr.targetOpen ? 1 : 0;
        if (Math.abs(dr.progress - targetProgress) > 0.0005 || dr.state === 'OPENING' || dr.state === 'CLOSING') {
          if (!dr.targetOpen && dr.progress > 0.65 && isDoorwayOccupied?.(dr.x, dr.z, 0.78)) {
            dr.state = 'OPEN';
          } else {
            if (dr.progress < targetProgress) {
              dr.progress = Math.min(1, dr.progress + doorSpeed * safeDt);
            } else if (dr.progress > targetProgress) {
              dr.progress = Math.max(0, dr.progress - doorSpeed * safeDt);
            }
            dr.pivot.rotation.y = -1.35 * dr.progress;

            const nextState: DoorState =
              dr.progress <= 0.001
                ? 'CLOSED'
                : dr.progress >= 0.999
                  ? 'OPEN'
                  : dr.targetOpen
                    ? 'OPENING'
                    : 'CLOSING';
            if (nextState !== dr.state) {
              dr.state = nextState;
              this.syncDoorInteractable(dr, dr.targetOpen);
            }

            const shouldBlock = !dr.targetOpen && dr.progress < 0.72;
            if (shouldBlock !== dr.isBlocking) {
              dr.isBlocking = shouldBlock;
              this.syncDoorCollider(dr);
            }
          }
        }
      }

      // 3. Lightweight timestamp-based farm crop progression
      if (st.farmState) {
        const visualDirty = this.advanceFarmStateByWorldHours(
          st,
          effectiveTotalHours,
          isRaining,
        );
        if (visualDirty) {
          this.factory.syncFarmPlotVisuals(
            rt.refs,
            st.farmState.stage,
            st.farmState.cropId,
            st.farmState.waterLevel ?? 0,
          );
          this.syncFarmInteractable(st);
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Save / Restore Serialization
  // -------------------------------------------------------------------------
  public exportSavedBuildings(): SavedPlayerBuilding[] {
    const out: SavedPlayerBuilding[] = [];
    this.structures.forEach((st) => {
      out.push({
        id: st.id,
        blueprintId: st.blueprintId,
        x: st.x,
        y: st.y,
        z: st.z,
        yaw: st.yaw,
        health: st.health,
        maxHealth: st.maxHealth,
        ownerId: st.ownerId,
        ownerName: st.ownerName,
        permission: st.permission,
        createdAtMs: st.createdAtMs,
        ...(st.doorOpen !== undefined ? { doorOpen: st.doorOpen } : {}),
        ...(st.storageItems ? { storageItems: st.storageItems.map((i) => ({ ...i })) } : {}),
        ...(st.farmState ? { farmState: { ...st.farmState } } : {}),
      });
    });
    return out;
  }

  public restoreSavedBuildings(
    savedList: ReadonlyArray<SavedPlayerBuilding>,
    activeChunkKeys: ReadonlySet<string>,
  ): void {
    // Clear existing structures
    const existingIds = Array.from(this.structures.keys());
    for (let i = 0; i < existingIds.length; i++) {
      this.removeStructure(existingIds[i]);
    }
    this.activeChunks.clear();
    activeChunkKeys.forEach((k) => this.activeChunks.add(k));

    for (let i = 0; i < savedList.length; i++) {
      const s = savedList[i];
      const bp = getBlueprintById(s.blueprintId);
      if (!bp) continue;
      const hydrated: PlayerBuiltStructure = {
        id: s.id,
        blueprintId: bp.id,
        category: bp.category,
        tier: bp.tier,
        x: s.x,
        y: s.y,
        z: s.z,
        yaw: s.yaw,
        health: Math.max(1, Math.min(bp.maxHealth, s.health || bp.maxHealth)),
        maxHealth: bp.maxHealth,
        ownerId: s.ownerId || 'local',
        ownerName: s.ownerName || 'Explorer',
        permission: s.permission || 'owner',
        createdAtMs: s.createdAtMs || Date.now(),
        ...(bp.hasDoor ? { doorOpen: Boolean(s.doorOpen) } : {}),
        ...(bp.storageCapacity
          ? { storageItems: (s.storageItems ?? []).map((it) => ({ ...it })) }
          : {}),
        ...(bp.isFarmPlot
          ? {
              farmState: s.farmState
                ? { ...s.farmState }
                : { stage: 0, growthProgress: 0, plantedAtElapsed: 0 },
            }
          : {}),
      };
      this.addOrUpdateStructure(hydrated);
    }
  }

  public dispose(): void {
    const ids = Array.from(this.structures.keys());
    for (let i = 0; i < ids.length; i++) {
      this.unmountStructure(ids[i]);
    }
    this.structures.clear();
    this.chunkIndex.clear();
    this.doorToStructure.clear();
    this.clearPreview();
    this.rootGroup.removeFromParent();
    this.factory.dispose();
  }

  // -------------------------------------------------------------------------
  // Internal Mounting, Colliders & Interactables
  // -------------------------------------------------------------------------
  private getChunkKey(x: number, z: number): string {
    const c = worldToChunkCoords(x, z, 120);
    return toChunkKey(c.cx, c.cz);
  }

  private addToChunkIndex(st: PlayerBuiltStructure): string {
    const key = this.getChunkKey(st.x, st.z);
    let set = this.chunkIndex.get(key);
    if (!set) {
      set = new Set();
      this.chunkIndex.set(key, set);
    }
    set.add(st.id);
    return key;
  }

  private removeFromChunkIndex(st: PlayerBuiltStructure): void {
    const key = this.getChunkKey(st.x, st.z);
    const set = this.chunkIndex.get(key);
    if (set) {
      set.delete(st.id);
      if (set.size === 0) this.chunkIndex.delete(key);
    }
  }

  private toWorldPos(
    baseX: number,
    baseY: number,
    baseZ: number,
    yaw: number,
    lx: number,
    ly: number,
    lz: number,
  ): { x: number; y: number; z: number } {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return {
      x: baseX + lx * cos - lz * sin,
      y: baseY + ly,
      z: baseZ + lx * sin + lz * cos,
    };
  }

  private mountStructure(st: PlayerBuiltStructure, chunkKey: string): void {
    const bp = getBlueprintById(st.blueprintId);
    if (!bp) return;

    const refs = this.factory.buildStructure(bp, this.shadowsEnabled, false);
    refs.group.position.set(st.x, st.y, st.z);
    refs.group.rotation.set(0, st.yaw, 0);
    this.rootGroup.add(refs.group);

    if (st.farmState) {
      this.factory.syncFarmPlotVisuals(
        refs,
        st.farmState.stage,
        st.farmState.cropId,
        st.farmState.waterLevel ?? 0,
      );
    }

    const colliderOwnerKey = `pbuild:${st.id}`;
    const interactableIds: string[] = [];

    // 1. Register Colliders
    if (bp.isHouse) {
      const w = bp.width;
      const d = bp.depth;
      const wh = bp.wallHeight ?? 2.8;
      const wallThick = 0.28;
      // Floor
      this.callbacks.registerCollider(
        {
          kind: 'box',
          x: st.x,
          z: st.z,
          halfW: w * 0.5,
          halfD: d * 0.5,
          minY: st.y - 0.5,
          maxY: st.y + 0.42,
          yaw: st.yaw,
          walkableTop: true,
          tag: 'floor',
        },
        colliderOwnerKey,
      );
      // Roof (sets indoorFactor in WorldManager.sampleEnvironmentAudioContext!)
      this.callbacks.registerCollider(
        {
          kind: 'box',
          x: st.x,
          z: st.z,
          halfW: w * 0.52,
          halfD: d * 0.52,
          minY: st.y + 0.35 + wh,
          maxY: st.y + 0.35 + wh + (bp.roofHeight ?? 2.2),
          yaw: st.yaw,
          tag: 'roof',
        },
        colliderOwnerKey,
      );
      // Back & side walls
      const addWallCol = (lx: number, lz: number, hw: number, hd: number) => {
        const p = this.toWorldPos(st.x, st.y, st.z, st.yaw, lx, 0, lz);
        this.callbacks.registerCollider(
          {
            kind: 'box',
            x: p.x,
            z: p.z,
            halfW: hw,
            halfD: hd,
            minY: st.y + 0.35,
            maxY: st.y + 0.35 + wh,
            yaw: st.yaw,
            tag: 'wall',
          },
          colliderOwnerKey,
        );
      };
      addWallCol(0, -d * 0.5 + wallThick * 0.5, w * 0.5, wallThick * 0.5);
      addWallCol(-w * 0.5 + wallThick * 0.5, 0, wallThick * 0.5, d * 0.5);
      addWallCol(w * 0.5 - wallThick * 0.5, 0, wallThick * 0.5, d * 0.5);
      // Front wall flanking segments leaving central door clear
      const doorHalfW = bp.doorOffset?.halfW ?? 0.66;
      const frontLeftHalfW = Math.max(0.25, (w * 0.5 - doorHalfW) * 0.5);
      const frontLeftCenter = doorHalfW + frontLeftHalfW;
      addWallCol(-frontLeftCenter, d * 0.5 - wallThick * 0.5, frontLeftHalfW, wallThick * 0.5);
      addWallCol(frontLeftCenter, d * 0.5 - wallThick * 0.5, frontLeftHalfW, wallThick * 0.5);
    } else if (bp.isFloorPiece) {
      this.callbacks.registerCollider(
        {
          kind: 'box',
          x: st.x,
          z: st.z,
          halfW: bp.width * 0.5,
          halfD: bp.depth * 0.5,
          minY: st.y - 0.6,
          maxY: st.y + bp.height,
          yaw: st.yaw,
          walkableTop: true,
          tag: 'floor',
        },
        colliderOwnerKey,
      );
    } else if (bp.isRoofPiece) {
      this.callbacks.registerCollider(
        {
          kind: 'box',
          x: st.x,
          z: st.z,
          halfW: bp.width * 0.52,
          halfD: bp.depth * 0.52,
          minY: st.y,
          maxY: st.y + bp.height,
          yaw: st.yaw,
          tag: 'roof',
        },
        colliderOwnerKey,
      );
    } else if (bp.isDoorPiece && bp.doorOffset) {
      const openingHalfW = bp.doorOffset.halfW;
      const sideHalfW = Math.max(0.25, (bp.width * 0.5 - openingHalfW) * 0.5);
      const sideCenter = openingHalfW + sideHalfW;
      for (const sign of [-1, 1]) {
        const p = this.toWorldPos(st.x, st.y, st.z, st.yaw, sign * sideCenter, 0, 0);
        this.callbacks.registerCollider(
          {
            kind: 'box',
            x: p.x,
            z: p.z,
            halfW: sideHalfW,
            halfD: bp.depth * 0.5,
            minY: st.y,
            maxY: st.y + bp.height,
            yaw: st.yaw,
            tag: 'wall',
          },
          colliderOwnerKey,
        );
      }
    } else if (!bp.isFarmPlot) {
      this.callbacks.registerCollider(
        {
          kind: 'box',
          x: st.x,
          z: st.z,
          halfW: bp.width * 0.5,
          halfD: bp.depth * 0.5,
          minY: st.y - 0.3,
          maxY: st.y + bp.height,
          yaw: st.yaw,
          walkableTop: Boolean(bp.isStairsPiece),
          tag: bp.isWallPiece ? 'wall' : 'prop',
        },
        colliderOwnerKey,
      );
    }

    // 2. Register Door Interactable + Dynamic Door Blocking Collider
    let doorRuntime: MountedDoorRuntime | undefined;
    if (bp.hasDoor && bp.doorOffset && refs.doorPivot) {
      const doorId = `pdoor_${st.id}`;
      const dp = this.toWorldPos(
        st.x,
        st.y,
        st.z,
        st.yaw,
        bp.doorOffset.x,
        bp.doorOffset.y,
        bp.doorOffset.z,
      );
      const isOpen = Boolean(st.doorOpen);
      refs.doorPivot.rotation.y = isOpen ? -1.35 : 0;

      doorRuntime = {
        doorId,
        pivot: refs.doorPivot,
        targetOpen: isOpen,
        progress: isOpen ? 1 : 0,
        state: isOpen ? 'OPEN' : 'CLOSED',
        isBlocking: !isOpen,
        x: dp.x,
        z: dp.z,
        minY: dp.y,
        maxY: dp.y + bp.doorOffset.height,
        halfW: bp.doorOffset.halfW,
        halfD: bp.doorOffset.halfD,
        yaw: st.yaw,
        activeNpcUsers: new Set(),
      };
      this.doorToStructure.set(doorId, st.id);
      this.syncDoorCollider(doorRuntime);

      this.callbacks.interactables.push({
        id: doorId,
        label: bp.isGatePiece ? 'Yard Gate' : `${bp.nameEn} Door`,
        actionVerb: isOpen ? 'Close' : 'Open',
        kind: 'door',
        x: dp.x,
        y: dp.y,
        z: dp.z,
        radius: 2.8,
        collected: false,
        isOpen,
        message: isOpen ? 'Opened the door.' : 'Closed the door.',
      });
      interactableIds.push(doorId);
    }

    // 3. Register Crafting Station Interactable
    if (bp.stationType) {
      const stId = `pstation_${st.id}`;
      const sp = bp.stationOffset
        ? this.toWorldPos(st.x, st.y, st.z, st.yaw, bp.stationOffset.x, bp.stationOffset.y, bp.stationOffset.z)
        : { x: st.x, y: st.y, z: st.z };
      this.callbacks.interactables.push({
        id: stId,
        label: bp.nameEn,
        actionVerb: 'Craft',
        kind: 'crafting_station',
        stationType: bp.stationType,
        x: sp.x,
        y: sp.y,
        z: sp.z,
        radius: 3.1,
        collected: false,
        message: `Opened ${bp.nameEn}.`,
      });
      interactableIds.push(stId);
    }

    // 4. Register Storage Vault / Chest Interactable
    if (bp.storageCapacity && bp.storageCapacity > 0) {
      const storeId = `pstore_${st.id}`;
      const sp = bp.storageOffset
        ? this.toWorldPos(st.x, st.y, st.z, st.yaw, bp.storageOffset.x, bp.storageOffset.y, bp.storageOffset.z)
        : { x: st.x, y: st.y, z: st.z };
      this.callbacks.interactables.push({
        id: storeId,
        label: bp.nameEn,
        actionVerb: 'Open Storage',
        kind: 'player_storage',
        x: sp.x,
        y: sp.y,
        z: sp.z,
        radius: 2.9,
        collected: false,
        message: `Opened ${bp.nameEn}.`,
      });
      interactableIds.push(storeId);
    }

    // 5. Register Bed Interactable
    if (bp.hasBed) {
      const bedId = `pbed_${st.id}`;
      this.callbacks.interactables.push({
        id: bedId,
        label: bp.nameEn,
        actionVerb: 'Sleep',
        kind: 'bed',
        x: st.x,
        y: st.y,
        z: st.z,
        radius: 2.8,
        collected: false,
        bedYaw: st.yaw,
        isPlacedBed: true,
        message: 'Rest until morning.',
      });
      interactableIds.push(bedId);
    }

    // 6. Register Farm Plot Interactable
    if (bp.isFarmPlot) {
      const farmId = `pfarm_${st.id}`;
      const fs = st.farmState;
      const prepared = Boolean(fs?.soilPrepared);
      const cropId = fs?.cropId ?? null;
      const ready = (fs?.stage ?? 0) >= 3;
      const cropName = getCropDisplayName(cropId, 'en');
      const actionVerb = !prepared
        ? 'Till Soil'
        : !cropId
          ? 'Plant Seeds'
          : ready
            ? 'Harvest'
            : 'Tend Crop';
      const message = !prepared
        ? 'Prepare the soil to begin planting crops.'
        : !cropId
          ? 'Prepared fertile soil ready for seeds.'
          : ready
            ? `${cropName} is ripe and ready to harvest!`
            : `${cropName} is growing.`;
      this.callbacks.interactables.push({
        id: farmId,
        label: bp.nameEn,
        actionVerb,
        kind: 'farm_plot',
        x: st.x,
        y: st.y,
        z: st.z,
        radius: Math.max(2.8, bp.width * 0.6),
        collected: false,
        message,
      });
      interactableIds.push(farmId);
    }

    // 7. Register Structure Manage fallback on non-functional modular/decor structures
    if (!bp.hasDoor && !bp.stationType && !bp.storageCapacity && !bp.hasBed && !bp.isFarmPlot) {
      const manageId = `pmanage_${st.id}`;
      this.callbacks.interactables.push({
        id: manageId,
        label: bp.nameEn,
        actionVerb: 'Manage',
        kind: 'structure_manage',
        x: st.x,
        y: st.y,
        z: st.z,
        radius: 3.1,
        collected: false,
        message: `Managing ${bp.nameEn}.`,
      });
      interactableIds.push(manageId);
    }

    this.mounted.set(st.id, {
      structureId: st.id,
      chunkKey,
      refs,
      doorRuntime,
      interactableIds,
      colliderOwnerKey,
    });
  }

  private unmountStructure(structureId: string): void {
    const rt = this.mounted.get(structureId);
    if (!rt) return;

    rt.refs.group.removeFromParent();
    this.callbacks.unregisterColliders(rt.colliderOwnerKey);

    if (rt.doorRuntime) {
      this.callbacks.unregisterColliders(`door:${rt.doorRuntime.doorId}`);
      this.doorToStructure.delete(rt.doorRuntime.doorId);
    }

    if (rt.interactableIds.length > 0) {
      const idSet = new Set(rt.interactableIds);
      for (let i = this.callbacks.interactables.length - 1; i >= 0; i--) {
        if (idSet.has(this.callbacks.interactables[i].id)) {
          this.callbacks.interactables.splice(i, 1);
        }
      }
    }

    this.mounted.delete(structureId);
  }

  private syncDoorCollider(dr: MountedDoorRuntime): void {
    const colliderKey = `door:${dr.doorId}`;
    this.callbacks.unregisterColliders(colliderKey);
    if (dr.isBlocking) {
      this.callbacks.registerCollider(
        {
          kind: 'box',
          x: dr.x,
          z: dr.z,
          halfW: dr.halfW,
          halfD: dr.halfD,
          minY: dr.minY,
          maxY: dr.maxY,
          yaw: dr.yaw,
          tag: 'door',
        },
        colliderKey,
      );
    }
  }

  private syncDoorInteractable(dr: MountedDoorRuntime, isOpen: boolean): void {
    const interactable = this.callbacks.interactables.find(
      (i) => i.id === dr.doorId && i.kind === 'door',
    );
    if (interactable) {
      interactable.isOpen = isOpen;
      interactable.actionVerb = isOpen ? 'Close' : 'Open';
      interactable.message = isOpen ? 'Opened the door.' : 'Closed the door.';
    }
  }

}
