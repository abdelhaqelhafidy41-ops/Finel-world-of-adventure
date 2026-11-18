import * as THREE from 'three';
import {
  getCoastlineZAt,
  groundHeightAt,
  seededRandom,
} from '../math/noise';
import {
  BUILDING_WATER_BUFFER,
  findNearestValidLand,
  findNearestValidResourceLocation,
  isValidBuildingLocation,
  isValidResourceLocation,
} from './WorldPlacementValidator';
import type { ProceduralTextureSet } from './textures';
import type { WorldCollider, WorldLandmark } from '../types';
import type { WorldInteractable } from './WorldManager';
import type { ResolvedGraphicsProfile } from '../engine/GraphicsQualityManager';

export type ExplorationLocationKind =
  | 'camp'
  | 'ruins'
  | 'mine'
  | 'cave'
  | 'location';

export interface ExplorationBedPlacement {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ExplorationChestPlacement {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  loot: Array<{ itemId: string; count: number }>;
  coins: number;
  xp: number;
}

export interface ExplorationResourcePlacement {
  id: string;
  kind:
    | 'wood'
    | 'stone'
    | 'iron-ore'
    | 'copper-ore'
    | 'silver-ore'
    | 'gold-ore'
    | 'coal'
    | 'gravel'
    | 'fiber'
    | 'medicinal-herb'
    | 'rare-mineral';
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface ExplorationStationPlacement {
  id: string;
  stationType: 'crafting_table' | 'furnace' | 'forge' | 'workbench';
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface ExplorationLocationRecord {
  id: string;
  name: string;
  kind: ExplorationLocationKind;
  x: number;
  y: number;
  z: number;
  discoveryRadius: number;
  clearanceRadius: number;
  discoveryMessage: string;
  isLoaded: boolean;
  rootGroup: THREE.Group;
  detailGroup: THREE.Group;
  fireLights: THREE.PointLight[];
  emissiveMeshes: THREE.Mesh[];
  disposables: Array<{ dispose: () => void }>;
  registeredInteractableIds: string[];
  registeredChestIds: string[];
  blueprint: LocationBlueprint;
}

interface LocationBlueprint {
  id: string;
  name: string;
  kind: ExplorationLocationKind;
  x: number;
  z: number;
  discoveryRadius: number;
  clearanceRadius: number;
  discoveryMessage: string;
}

export class ExplorationLocationManager {
  public readonly locations: ExplorationLocationRecord[] = [];
  private readonly parentGroup = new THREE.Group();
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly chestMeshes = new Map<string, { lid: THREE.Object3D; lockMesh: THREE.Mesh }>();
  private readonly boxUnitGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylGeoCache = new Map<string, THREE.CylinderGeometry>();
  private readonly chestLockClosedMat = new THREE.MeshStandardMaterial({
    color: 0xe6b84d,
    emissive: 0x6a4910,
    emissiveIntensity: 0.4,
    metalness: 0.7,
    roughness: 0.35,
  });
  private readonly chestLockOpenedMat = new THREE.MeshStandardMaterial({
    color: 0xe6b84d,
    emissive: 0x6a4910,
    emissiveIntensity: 0,
    metalness: 0.7,
    roughness: 0.35,
  });

  private readonly timberMat: THREE.MeshStandardMaterial;
  private readonly plankMat: THREE.MeshStandardMaterial;
  private readonly stoneMat: THREE.MeshStandardMaterial;
  private readonly sandstoneMat: THREE.MeshStandardMaterial;
  private readonly mossStoneMat: THREE.MeshStandardMaterial;
  private readonly canvasMat: THREE.MeshStandardMaterial;
  private readonly darkCanvasMat: THREE.MeshStandardMaterial;
  private readonly ironMat: THREE.MeshStandardMaterial;
  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly emberMat: THREE.MeshStandardMaterial;
  private readonly clothBedMat: THREE.MeshStandardMaterial;
  private readonly pillowMat: THREE.MeshStandardMaterial;

  private readonly registerColliderFn: (c: WorldCollider, ownerKey?: string) => void;
  private readonly unregisterCollidersFn?: (ownerKey: string) => void;
  private readonly interactables: WorldInteractable[];
  private readonly onRegisterBedFn: (bed: ExplorationBedPlacement) => void;
  private readonly onRegisterChestFn: (chest: ExplorationChestPlacement) => void;
  private readonly onRegisterResourceFn: (res: ExplorationResourcePlacement) => void;
  private readonly onRegisterStationFn?: (station: ExplorationStationPlacement) => void;
  private readonly isChestOpenedFn?: (id: string) => boolean;
  private readonly isDestroyedFn?: (id: string) => boolean;
  private readonly onUnloadLocationFn?: (
    locId: string,
    interactableIds: string[],
    chestIds: string[],
  ) => void;

  private activeDisposablesTarget: Array<{ dispose: () => void }> | null = null;
  private loadDist = 260;
  private unloadDist = 355;
  private detailDist = 190;
  private maxActiveLights = 8;
  private propShadowsEnabled = true;
  private shadowsEnabled = true;

  constructor(
    scene: THREE.Scene,
    textures: ProceduralTextureSet,
    registerCollider: (c: WorldCollider, ownerKey?: string) => void,
    interactables: WorldInteractable[],
    landmarks: WorldLandmark[],
    onRegisterBed: (bed: ExplorationBedPlacement) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
    isBlockedSite?: (x: number, z: number, radius: number) => boolean,
    streamingHooks?: {
      unregisterColliders?: (ownerKey: string) => void;
      isChestOpened?: (id: string) => boolean;
      isDestroyed?: (id: string) => boolean;
      onRegisterStation?: (station: ExplorationStationPlacement) => void;
      onUnloadLocation?: (
        locId: string,
        interactableIds: string[],
        chestIds: string[],
      ) => void;
    },
  ) {
    scene.add(this.parentGroup);
    this.registerColliderFn = registerCollider;
    this.unregisterCollidersFn = streamingHooks?.unregisterColliders;
    this.interactables = interactables;
    this.onRegisterBedFn = onRegisterBed;
    this.onRegisterChestFn = onRegisterChest;
    this.onRegisterResourceFn = onRegisterResource;
    this.onRegisterStationFn = streamingHooks?.onRegisterStation;
    this.isChestOpenedFn = streamingHooks?.isChestOpened;
    this.isDestroyedFn = streamingHooks?.isDestroyed;
    this.onUnloadLocationFn = streamingHooks?.onUnloadLocation;

    this.disposables.push(
      this.boxUnitGeo,
      this.chestLockClosedMat,
      this.chestLockOpenedMat,
    );

    this.timberMat = new THREE.MeshStandardMaterial({
      map: textures.barkMap,
      normalMap: textures.barkNormalMap,
      color: 0x6f5038,
      roughness: 0.9,
    });
    this.plankMat = new THREE.MeshStandardMaterial({
      color: 0x8e6948,
      roughness: 0.85,
    });
    this.stoneMat = new THREE.MeshStandardMaterial({
      map: textures.rockMap,
      normalMap: textures.rockNormalMap,
      roughnessMap: textures.rockRoughnessMap,
      color: 0x7e827d,
      roughness: 0.9,
      flatShading: true,
    });
    this.sandstoneMat = new THREE.MeshStandardMaterial({
      color: 0xc59a62,
      roughness: 0.88,
      flatShading: true,
    });
    this.mossStoneMat = new THREE.MeshStandardMaterial({
      color: 0x5c7252,
      roughness: 0.92,
      flatShading: true,
    });
    this.canvasMat = new THREE.MeshStandardMaterial({
      color: 0xcab68c,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    this.darkCanvasMat = new THREE.MeshStandardMaterial({
      color: 0x5f6b4b,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    this.ironMat = new THREE.MeshStandardMaterial({
      color: 0x454b52,
      roughness: 0.52,
      metalness: 0.65,
    });
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: 0x6ad1e6,
      emissive: 0x2299bb,
      emissiveIntensity: 0.85,
      roughness: 0.25,
    });
    this.emberMat = new THREE.MeshStandardMaterial({
      color: 0xff8a2b,
      emissive: 0xff5a18,
      emissiveIntensity: 1.4,
      roughness: 0.5,
    });
    this.clothBedMat = new THREE.MeshStandardMaterial({
      color: 0x9b4638,
      roughness: 0.88,
    });
    this.pillowMat = new THREE.MeshStandardMaterial({
      color: 0xe6dcc8,
      roughness: 0.85,
    });

    this.disposables.push(
      this.timberMat,
      this.plankMat,
      this.stoneMat,
      this.sandstoneMat,
      this.mossStoneMat,
      this.canvasMat,
      this.darkCanvasMat,
      this.ironMat,
      this.crystalMat,
      this.emberMat,
      this.clothBedMat,
      this.pillowMat,
    );

    const coastTreasureX = 880;
    const coastTreasureZ = getCoastlineZAt(coastTreasureX) - 24;

    const blueprints: LocationBlueprint[] = [
      {
        id: 'loc-abandoned-cabin',
        name: 'Abandoned Cabin',
        kind: 'location',
        x: -460,
        z: 245,
        discoveryRadius: 28,
        clearanceRadius: 24,
        discoveryMessage:
          'Discovered the Abandoned Cabin — an old woodsman shelter with a usable bed and supply chest.',
      },
      {
        id: 'loc-forest-camp',
        name: 'Whispering Forest Camp',
        kind: 'camp',
        x: -690,
        z: -210,
        discoveryRadius: 28,
        clearanceRadius: 24,
        discoveryMessage:
          'Discovered Whispering Forest Camp — an abandoned ranger campsite beneath towering pines.',
      },
      {
        id: 'loc-hunter-camp',
        name: 'Ridge Hunter Camp',
        kind: 'camp',
        x: 380,
        z: -480,
        discoveryRadius: 28,
        clearanceRadius: 24,
        discoveryMessage:
          'Discovered Ridge Hunter Camp — lookouts and pelts left by frontier trackers.',
      },
      {
        id: 'loc-ruined-village',
        name: 'Mossy Ruined Village',
        kind: 'ruins',
        x: -1040,
        z: 280,
        discoveryRadius: 42,
        clearanceRadius: 44,
        discoveryMessage:
          'Discovered the Ruined Village — crumbling stone cottages overtaken by vines and wildflowers.',
      },
      {
        id: 'loc-ancient-tower',
        name: 'Ancient Stone Tower',
        kind: 'ruins',
        x: -230,
        z: -820,
        discoveryRadius: 32,
        clearanceRadius: 26,
        discoveryMessage:
          'Discovered the Ancient Tower — a weathered highland spire guarding forgotten relics.',
      },
      {
        id: 'loc-sunstone-mine',
        name: 'Sunstone Mine',
        kind: 'mine',
        x: 840,
        z: -330,
        discoveryRadius: 36,
        clearanceRadius: 32,
        discoveryMessage:
          'Discovered Sunstone Mine — rich seams of iron ore and coal glinting inside the timbered shaft.',
      },
      {
        id: 'loc-echoing-cave',
        name: 'Echoing Crystal Cave',
        kind: 'cave',
        x: -780,
        z: -950,
        discoveryRadius: 34,
        clearanceRadius: 30,
        discoveryMessage:
          'Discovered Echoing Crystal Cave — luminescent azure crystals illuminate rich underground veins.',
      },
      {
        id: 'loc-ridge-watchtower',
        name: 'Borderland Watchtower',
        kind: 'location',
        x: 690,
        z: -860,
        discoveryRadius: 32,
        clearanceRadius: 26,
        discoveryMessage:
          'Discovered Borderland Watchtower — a stone frontier outpost overlooking the eastern pass.',
      },
      {
        id: 'loc-ancient-ruins',
        name: 'Sunstone Temple Ruins',
        kind: 'ruins',
        x: 1560,
        z: 380,
        discoveryRadius: 42,
        clearanceRadius: 40,
        discoveryMessage:
          'Discovered Sunstone Temple Ruins — sunken desert monoliths guarding ancient treasure.',
      },
      {
        id: 'loc-hidden-treasure',
        name: 'Smuggler’s Treasure Cove',
        kind: 'location',
        x: coastTreasureX,
        z: coastTreasureZ,
        discoveryRadius: 32,
        clearanceRadius: 26,
        discoveryMessage:
          'Discovered Smuggler’s Treasure Cove — weathered ship ribs and hidden coastal bounty!',
      },
    ];

    // Resolve lightweight site metadata & world-map landmarks upfront without loading 3D geometry.
    for (const bp of blueprints) {
      const site = this.findDryLocationSite(
        bp.x,
        bp.z,
        isBlockedSite,
        bp.clearanceRadius,
        bp.id === 'loc-hidden-treasure',
      );
      const wx = site.x;
      const wz = site.z;
      const wy = groundHeightAt(wx, wz);

      const rootGroup = new THREE.Group();
      rootGroup.position.set(wx, wy, wz);
      rootGroup.visible = false;
      const detailGroup = new THREE.Group();
      rootGroup.add(detailGroup);

      const record: ExplorationLocationRecord = {
        id: bp.id,
        name: bp.name,
        kind: bp.kind,
        x: wx,
        y: wy,
        z: wz,
        discoveryRadius: bp.discoveryRadius,
        clearanceRadius: bp.clearanceRadius,
        discoveryMessage: bp.discoveryMessage,
        isLoaded: false,
        rootGroup,
        detailGroup,
        fireLights: [],
        emissiveMeshes: [],
        disposables: [],
        registeredInteractableIds: [],
        registeredChestIds: [],
        blueprint: bp,
      };
      this.locations.push(record);

      landmarks.push({
        id: bp.id,
        name: bp.name,
        kind: bp.kind,
        x: wx,
        z: wz,
        discovered: false,
      });
    }
  }

  private materializeLocation(loc: ExplorationLocationRecord): void {
    if (loc.isLoaded) return;
    const bp = loc.blueprint;
    const wx = loc.x;
    const wy = loc.y;
    const wz = loc.z;
    const colliderKey = `exp:${loc.id}`;

    loc.rootGroup.position.set(wx, wy, wz);
    if (loc.detailGroup.parent !== loc.rootGroup) {
      loc.rootGroup.add(loc.detailGroup);
    }
    this.parentGroup.add(loc.rootGroup);
    loc.rootGroup.visible = true;

    loc.disposables = [];
    loc.registeredInteractableIds = [];
    loc.registeredChestIds = [];
    loc.fireLights.length = 0;
    loc.emissiveMeshes.length = 0;

    const prevTarget = this.activeDisposablesTarget;
    this.activeDisposablesTarget = loc.disposables;

    const registerSiteCollider = (c: WorldCollider) => {
      this.registerColliderFn(c, colliderKey);
    };

    const registerSiteBed = (bed: ExplorationBedPlacement) => {
      if (this.isDestroyedFn?.(bed.id)) return;
      loc.registeredInteractableIds.push(bed.id);
      this.onRegisterBedFn(bed);
    };

    const registerSiteChest = (chest: ExplorationChestPlacement) => {
      loc.registeredChestIds.push(chest.id);
      loc.registeredInteractableIds.push(chest.id);
      this.onRegisterChestFn(chest);
      if (this.isChestOpenedFn?.(chest.id)) {
        this.markChestOpened(chest.id);
      }
    };

    const registerValidatedResource = (res: ExplorationResourcePlacement) => {
      if (this.isDestroyedFn?.(res.id)) return;
      const safePos = isValidResourceLocation(res.x, res.z, res.kind)
        ? { x: res.x, y: groundHeightAt(res.x, res.z), z: res.z }
        : findNearestValidResourceLocation(res.x, res.z, res.kind, 28);
      if (!safePos) return;
      loc.registeredInteractableIds.push(res.id);
      this.onRegisterResourceFn({
        ...res,
        x: safePos.x,
        y: safePos.y,
        z: safePos.z,
      });
    };

    const registerSiteStation = (station: ExplorationStationPlacement) => {
      loc.registeredInteractableIds.push(station.id);
      this.onRegisterStationFn?.(station);
    };

    try {
      if (bp.id === 'loc-abandoned-cabin') {
        this.buildAbandonedCabin(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.timberMat,
          this.plankMat,
          this.stoneMat,
          this.clothBedMat,
          this.pillowMat,
          this.ironMat,
          registerSiteCollider,
          registerSiteBed,
          registerSiteChest,
          registerValidatedResource,
          registerSiteStation,
        );
      } else if (bp.id === 'loc-forest-camp' || bp.id === 'loc-hunter-camp') {
        this.buildCampSite(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.timberMat,
          this.plankMat,
          this.stoneMat,
          bp.id === 'loc-hunter-camp' ? this.darkCanvasMat : this.canvasMat,
          this.clothBedMat,
          this.pillowMat,
          this.emberMat,
          this.ironMat,
          loc.fireLights,
          loc.emissiveMeshes,
          registerSiteCollider,
          registerSiteBed,
          registerSiteChest,
          registerValidatedResource,
        );
      } else if (bp.id === 'loc-ruined-village') {
        this.buildRuinedVillage(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.stoneMat,
          this.mossStoneMat,
          this.timberMat,
          this.ironMat,
          registerSiteCollider,
          registerSiteChest,
          registerValidatedResource,
        );
      } else if (bp.id === 'loc-ancient-tower' || bp.id === 'loc-ridge-watchtower') {
        this.buildTowerLocation(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.stoneMat,
          this.timberMat,
          this.plankMat,
          this.emberMat,
          this.ironMat,
          loc.fireLights,
          loc.emissiveMeshes,
          registerSiteCollider,
          registerSiteChest,
          registerValidatedResource,
        );
      } else if (bp.id === 'loc-sunstone-mine') {
        this.buildMineLocation(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.timberMat,
          this.plankMat,
          this.stoneMat,
          this.ironMat,
          this.crystalMat,
          loc.fireLights,
          loc.emissiveMeshes,
          registerSiteCollider,
          registerSiteChest,
          registerValidatedResource,
          registerSiteStation,
        );
      } else if (bp.id === 'loc-echoing-cave') {
        this.buildCaveLocation(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.stoneMat,
          this.mossStoneMat,
          this.crystalMat,
          this.ironMat,
          loc.fireLights,
          loc.emissiveMeshes,
          registerSiteCollider,
          registerSiteChest,
          registerValidatedResource,
        );
      } else if (bp.id === 'loc-ancient-ruins') {
        this.buildDesertRuins(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.sandstoneMat,
          this.emberMat,
          this.ironMat,
          loc.fireLights,
          loc.emissiveMeshes,
          registerSiteCollider,
          registerSiteChest,
          registerValidatedResource,
        );
      } else {
        this.buildTreasureCove(
          bp,
          wx,
          wy,
          wz,
          loc.rootGroup,
          loc.detailGroup,
          this.timberMat,
          this.plankMat,
          this.darkCanvasMat,
          this.ironMat,
          registerSiteCollider,
          registerSiteChest,
          registerValidatedResource,
        );
      }

      const plaqueId = `${bp.id}-plaque`;
      if (!this.isDestroyedFn?.(plaqueId)) {
        loc.registeredInteractableIds.push(plaqueId);
        this.interactables.push({
          id: plaqueId,
          label: bp.name,
          actionVerb: 'Survey',
          kind: 'cairn',
          x: wx,
          y: wy,
          z: wz,
          radius: 4.5,
          collected: false,
          message: bp.discoveryMessage,
        });
      }
    } finally {
      this.activeDisposablesTarget = prevTarget;
    }

    loc.isLoaded = true;
    this.applyShadowAndLightState(loc);
  }

  private unloadLocation(loc: ExplorationLocationRecord): void {
    if (!loc.isLoaded) return;

    this.onUnloadLocationFn?.(
      loc.id,
      loc.registeredInteractableIds,
      loc.registeredChestIds,
    );
    this.unregisterCollidersFn?.(`exp:${loc.id}`);

    for (let i = 0; i < loc.registeredChestIds.length; i++) {
      this.chestMeshes.delete(loc.registeredChestIds[i]);
    }

    for (let i = 0; i < loc.fireLights.length; i++) {
      loc.fireLights[i].visible = false;
      loc.fireLights[i].dispose();
    }
    loc.fireLights.length = 0;
    loc.emissiveMeshes.length = 0;

    for (let i = 0; i < loc.disposables.length; i++) {
      loc.disposables[i].dispose();
    }
    loc.disposables.length = 0;
    loc.registeredInteractableIds.length = 0;
    loc.registeredChestIds.length = 0;

    loc.rootGroup.removeFromParent();
    loc.rootGroup.clear();
    loc.detailGroup.clear();
    loc.rootGroup.add(loc.detailGroup);
    loc.rootGroup.visible = false;
    loc.isLoaded = false;
  }

  private findDryLocationSite(
    targetX: number,
    targetZ: number,
    isBlocked?: (x: number, z: number, r: number) => boolean,
    clearanceRadius = 24,
    isCoastal = false,
  ): { x: number; z: number } {
    const rand = seededRandom(Math.round(targetX * 13 + targetZ * 37 + 911));
    const waterBuffer = isCoastal ? BUILDING_WATER_BUFFER * 0.42 : BUILDING_WATER_BUFFER;
    const halfSpan = Math.max(7, Math.min(14, clearanceRadius * 0.38));

    const isSiteAcceptable = (cx: number, cz: number, maxSlope: number): boolean => {
      if (Math.hypot(cx, cz) < 220) return false;
      const cy = groundHeightAt(cx, cz);
      if (cy > 46) return false;
      if (!isValidBuildingLocation(cx, cz, halfSpan, halfSpan, 0, waterBuffer, maxSlope)) {
        return false;
      }
      if (isBlocked && isBlocked(cx, cz, clearanceRadius + 16)) return false;
      return true;
    };

    for (let attempt = 0; attempt < 48; attempt++) {
      const spread = attempt === 0 ? 0 : 18 + attempt * 14;
      const a = rand() * Math.PI * 2;
      const cx = targetX + Math.cos(a) * spread;
      const cz = targetZ + Math.sin(a) * spread;
      if (isSiteAcceptable(cx, cz, 0.3)) {
        return { x: cx, z: cz };
      }
    }

    for (let r = 32; r <= 720; r += 28) {
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const ang = (i / steps) * Math.PI * 2;
        const cx = targetX + Math.cos(ang) * r;
        const cz = targetZ + Math.sin(ang) * r;
        if (isSiteAcceptable(cx, cz, 0.38)) {
          return { x: cx, z: cz };
        }
      }
    }

    const nearest = findNearestValidLand(
      targetX,
      targetZ,
      waterBuffer + 4,
      0.34,
      640,
    );
    return { x: nearest.x, z: nearest.z };
  }

  private addBox(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    ry = 0,
    castShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxUnitGeo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.userData.__origCastShadow = castShadow;
    mesh.userData.__origReceiveShadow = true;
    mesh.castShadow = castShadow && this.propShadowsEnabled;
    mesh.receiveShadow = this.shadowsEnabled;
    parent.add(mesh);
    return mesh;
  }

  private addCylinder(
    parent: THREE.Object3D,
    rt: number,
    rb: number,
    h: number,
    seg: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    castShadow = true,
  ): THREE.Mesh {
    const key = `${rt}_${rb}_${h}_${seg}`;
    let geo = this.cylGeoCache.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(rt, rb, h, seg);
      this.cylGeoCache.set(key, geo);
      this.disposables.push(geo);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData.__origCastShadow = castShadow;
    mesh.userData.__origReceiveShadow = true;
    mesh.castShadow = castShadow && this.propShadowsEnabled;
    mesh.receiveShadow = this.shadowsEnabled;
    parent.add(mesh);
    return mesh;
  }

  private createBedVisual(
    parent: THREE.Object3D,
    lx: number,
    ly: number,
    lz: number,
    yaw: number,
    timberMat: THREE.Material,
    clothMat: THREE.Material,
    pillowMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(lx, ly, lz);
    g.rotation.y = yaw;
    this.addBox(g, 1.15, 0.24, 2.05, 0, 0.2, 0, timberMat);
    this.addBox(g, 1.15, 0.65, 0.12, 0, 0.48, -0.96, timberMat);
    this.addBox(g, 1.04, 0.18, 1.88, 0, 0.36, 0.02, clothMat);
    this.addBox(g, 0.78, 0.14, 0.42, 0, 0.47, -0.64, pillowMat);
    parent.add(g);
  }

  private createChestVisual(
    chestId: string,
    parent: THREE.Object3D,
    lx: number,
    ly: number,
    lz: number,
    yaw: number,
    plankMat: THREE.Material,
    ironMat: THREE.Material,
  ): void {
    const g = new THREE.Group();
    g.position.set(lx, ly, lz);
    g.rotation.y = yaw;

    this.addBox(g, 0.94, 0.5, 0.62, 0, 0.25, 0, plankMat);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.5, -0.31);
    const lid = this.addBox(lidPivot, 0.96, 0.18, 0.64, 0, 0.08, 0.31, plankMat);
    lid.userData.__origCastShadow = true;
    lid.castShadow = this.propShadowsEnabled;
    this.addBox(lidPivot, 0.98, 0.19, 0.12, 0, 0.08, 0.31, ironMat);
    g.add(lidPivot);

    const lockMesh = this.addBox(
      g,
      0.16,
      0.18,
      0.08,
      0,
      0.45,
      0.33,
      this.chestLockClosedMat,
    );

    this.chestMeshes.set(chestId, { lid: lidPivot, lockMesh });
    parent.add(g);
  }

  public markChestOpened(chestId: string): void {
    const entry = this.chestMeshes.get(chestId);
    if (!entry) return;
    entry.lid.rotation.x = -1.15;
    entry.lockMesh.material = this.chestLockOpenedMat;
  }

  private buildAbandonedCabin(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    timberMat: THREE.Material,
    plankMat: THREE.Material,
    stoneMat: THREE.Material,
    clothMat: THREE.Material,
    pillowMat: THREE.Material,
    ironMat: THREE.Material,
    registerCollider: (c: WorldCollider) => void,
    onRegisterBed: (bed: ExplorationBedPlacement) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
    onRegisterStation?: (station: ExplorationStationPlacement) => void,
  ): void {
    // Timber floor platform
    this.addBox(root, 6.2, 0.35, 5.4, 0, 0.1, 0, plankMat);
    // Walkable cabin perimeter walls leaving front door opening at z=+2.5
    this.addBox(root, 6.2, 2.8, 0.28, 0, 1.55, -2.5, timberMat); // back
    this.addBox(root, 0.28, 2.8, 5.2, -2.95, 1.55, 0, timberMat); // left
    this.addBox(root, 0.28, 2.8, 5.2, 2.95, 1.55, 0, timberMat); // right
    this.addBox(root, 2.25, 2.8, 0.28, -1.85, 1.55, 2.5, timberMat); // front-left
    this.addBox(root, 2.25, 2.8, 0.28, 1.85, 1.55, 2.5, timberMat); // front-right
    this.addBox(root, 1.7, 0.65, 0.28, 0, 2.62, 2.5, timberMat); // lintel

    // Pitched weathered roof
    const roofL = this.addBox(root, 3.8, 0.2, 6.0, -1.55, 3.55, 0, plankMat);
    roofL.rotation.z = 0.45;
    const roofR = this.addBox(root, 3.8, 0.2, 6.0, 1.55, 3.55, 0, plankMat);
    roofR.rotation.z = -0.45;

    // Stone chimney
    this.addBox(detail, 1.0, 4.4, 1.0, 2.6, 2.2, -1.6, stoneMat);

    // Colliders for outer walls leaving doorway open
    registerCollider({ kind: 'cylinder', x: wx - 2.9, z: wz, radius: 0.7, minY: wy, maxY: wy + 3 });
    registerCollider({ kind: 'cylinder', x: wx + 2.9, z: wz, radius: 0.7, minY: wy, maxY: wy + 3 });
    registerCollider({ kind: 'cylinder', x: wx, z: wz - 2.5, radius: 0.9, minY: wy, maxY: wy + 3 });

    // Interior bed & chest
    this.createBedVisual(detail, -1.75, 0.26, -1.05, 0, timberMat, clothMat, pillowMat);
    onRegisterBed({
      id: `${bp.id}-bed`,
      label: 'Cabin Bed',
      x: wx - 1.75,
      y: wy + 0.3,
      z: wz - 1.05,
      yaw: 0,
    });

    // Woodsman crafting table inside cabin
    this.addBox(detail, 1.35, 0.12, 0.75, 1.6, 0.92, 0.65, plankMat);
    this.addBox(detail, 0.14, 0.65, 0.62, 1.05, 0.56, 0.65, timberMat);
    this.addBox(detail, 0.14, 0.65, 0.62, 2.15, 0.56, 0.65, timberMat);
    onRegisterStation?.({
      id: `${bp.id}-station-table`,
      stationType: 'crafting_table',
      label: 'Crafting Table',
      x: wx + 1.6,
      y: wy + 0.3,
      z: wz + 0.65,
    });

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, 1.65, 0.26, -1.55, 0, plankMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: 'Woodsman Chest',
      x: wx + 1.65,
      y: wy + 0.3,
      z: wz - 1.55,
      loot: [
        { itemId: 'wood', count: 8 },
        { itemId: 'fiber', count: 5 },
        { itemId: 'hunter-knife', count: 1 },
      ],
      coins: 28,
      xp: 35,
    });

    onRegisterResource({
      id: `${bp.id}-wood-1`,
      kind: 'wood',
      label: 'Chopped Firewood Pile',
      x: wx + 4.4,
      y: groundHeightAt(wx + 4.4, wz + 1.2),
      z: wz + 1.2,
    });
  }

  private buildCampSite(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    timberMat: THREE.Material,
    plankMat: THREE.Material,
    stoneMat: THREE.Material,
    canvasMat: THREE.Material,
    clothMat: THREE.Material,
    pillowMat: THREE.Material,
    emberMat: THREE.Material,
    ironMat: THREE.Material,
    fireLights: THREE.PointLight[],
    emissiveMeshes: THREE.Mesh[],
    registerCollider: (c: WorldCollider) => void,
    onRegisterBed: (bed: ExplorationBedPlacement) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
  ): void {
    // Two pitched canvas tents
    const tentGeo = new THREE.ConeGeometry(2.3, 2.5, 4);
    (this.activeDisposablesTarget ?? this.disposables).push(tentGeo);
    const tent1 = new THREE.Mesh(tentGeo, canvasMat);
    tent1.position.set(-4.2, 1.25, -2.2);
    tent1.rotation.y = Math.PI * 0.25;
    tent1.userData.__origCastShadow = true;
    tent1.userData.__origReceiveShadow = true;
    tent1.castShadow = this.propShadowsEnabled;
    tent1.receiveShadow = this.shadowsEnabled;
    root.add(tent1);

    const tent2 = new THREE.Mesh(tentGeo, canvasMat);
    tent2.position.set(4.0, 1.1, -2.8);
    tent2.scale.setScalar(0.85);
    tent2.rotation.y = 0.4;
    tent2.userData.__origCastShadow = true;
    tent2.userData.__origReceiveShadow = true;
    tent2.castShadow = this.propShadowsEnabled;
    tent2.receiveShadow = this.shadowsEnabled;
    root.add(tent2);

    registerCollider({ kind: 'cylinder', x: wx - 4.2, z: wz - 2.2, radius: 1.8, minY: wy, maxY: wy + 2.5 });
    registerCollider({ kind: 'cylinder', x: wx + 4.0, z: wz - 2.8, radius: 1.5, minY: wy, maxY: wy + 2.4 });

    // Central stone fire ring + embers + light
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8;
      this.addCylinder(detail, 0.22, 0.26, 0.24, 6, Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9, stoneMat);
    }
    const embers = this.addCylinder(detail, 0.55, 0.65, 0.14, 7, 0, 0.08, 0, emberMat, false);
    emissiveMeshes.push(embers);
    const fireLight = new THREE.PointLight(0xff8e38, 1.8, 16, 1.8);
    fireLight.position.set(0, 0.9, 0);
    detail.add(fireLight);
    fireLights.push(fireLight);

    // Log benches
    this.addCylinder(detail, 0.22, 0.24, 2.2, 7, 0, 0.2, 2.4, timberMat).rotation.z = Math.PI / 2;

    // Camp bedroll
    this.createBedVisual(detail, -2.5, 0, 2.6, 0.55, timberMat, clothMat, pillowMat);
    onRegisterBed({
      id: `${bp.id}-bed`,
      label: 'Camp Bedroll',
      x: wx - 2.5,
      y: wy,
      z: wz + 2.6,
      yaw: 0.55,
    });

    const isHunter = bp.id === 'loc-hunter-camp';
    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, 2.4, 0, 1.8, -0.5, plankMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: isHunter ? 'Tracker Supply Chest' : 'Ranger Stash',
      x: wx + 2.4,
      y: wy,
      z: wz + 1.8,
      loot: isHunter
        ? [
            { itemId: 'arrow', count: 12 },
            { itemId: 'leather', count: 4 },
            { itemId: 'cooked-meat', count: 3 },
          ]
        : [
            { itemId: 'wood', count: 6 },
            { itemId: 'torch', count: 2 },
            { itemId: 'sun-apple', count: 3 },
          ],
      coins: 35,
      xp: 40,
    });

    onRegisterResource({
      id: `${bp.id}-res-1`,
      kind: 'wood',
      label: 'Camp Timber Stack',
      x: wx + 5.2,
      y: groundHeightAt(wx + 5.2, wz + 2.0),
      z: wz + 2.0,
    });
    if (bp.id === 'loc-forest-camp') {
      onRegisterResource({
        id: `${bp.id}-herb-1`,
        kind: 'medicinal-herb',
        label: 'Silversage Clump',
        x: wx - 4.4,
        y: groundHeightAt(wx - 4.4, wz + 3.8),
        z: wz + 3.8,
      });
    }
  }

  private buildRuinedVillage(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    stoneMat: THREE.Material,
    mossStoneMat: THREE.Material,
    timberMat: THREE.Material,
    ironMat: THREE.Material,
    registerCollider: (c: WorldCollider) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
  ): void {
    const cottages = [
      { ox: -10, oz: -6, yaw: 0.2 },
      { ox: 11, oz: -4, yaw: -0.35 },
      { ox: -3, oz: 12, yaw: 1.2 },
    ];
    for (const c of cottages) {
      const g = new THREE.Group();
      const baseH = groundHeightAt(wx + c.ox, wz + c.oz) - wy;
      g.position.set(c.ox, baseH, c.oz);
      g.rotation.y = c.yaw;
      this.addBox(g, 5.2, 2.1, 0.45, 0, 1.05, -2.2, mossStoneMat);
      this.addBox(g, 0.45, 1.65, 4.4, -2.4, 0.82, 0, stoneMat);
      this.addBox(g, 0.45, 2.4, 3.0, 2.4, 1.2, -0.7, mossStoneMat);
      this.addBox(g, 4.2, 0.18, 0.25, 0.2, 0.2, 1.6, timberMat, 0.35);
      root.add(g);
      registerCollider({ kind: 'cylinder', x: wx + c.ox, z: wz + c.oz, radius: 2.6, minY: wy + baseH, maxY: wy + baseH + 3 });
    }

    // Broken well in center
    this.addCylinder(detail, 1.2, 1.3, 1.0, 8, 0, 0.5, 0, mossStoneMat);
    registerCollider({ kind: 'cylinder', x: wx, z: wz, radius: 1.35, minY: wy, maxY: wy + 1.5 });

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, -10.0, groundHeightAt(wx - 10, wz - 6) - wy, -6.2, 0.2, timberMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: 'Relic Chest',
      x: wx - 10.0,
      y: groundHeightAt(wx - 10, wz - 6),
      z: wz - 6.2,
      loot: [
        { itemId: 'iron-ore', count: 5 },
        { itemId: 'stone', count: 6 },
        { itemId: 'apothecary-tonic', count: 2 },
      ],
      coins: 55,
      xp: 60,
    });

    onRegisterResource({
      id: `${bp.id}-stone-1`,
      kind: 'stone',
      label: 'Collapsed Masonry',
      x: wx + 5.5,
      y: groundHeightAt(wx + 5.5, wz + 5.0),
      z: wz + 5.0,
    });
  }

  private buildTowerLocation(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    stoneMat: THREE.Material,
    timberMat: THREE.Material,
    plankMat: THREE.Material,
    emberMat: THREE.Material,
    ironMat: THREE.Material,
    fireLights: THREE.PointLight[],
    emissiveMeshes: THREE.Mesh[],
    registerCollider: (c: WorldCollider) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
  ): void {
    // Tall cylindrical keep + battlements
    this.addCylinder(root, 3.6, 4.1, 2.2, 10, 0, 1.1, 0, stoneMat);
    this.addCylinder(root, 2.75, 3.2, 11.5, 10, 0, 7.2, 0, stoneMat);
    this.addCylinder(root, 3.25, 2.9, 1.2, 10, 0, 13.2, 0, stoneMat);
    // Timber balcony scaffold
    this.addCylinder(detail, 3.55, 3.55, 0.25, 10, 0, 12.6, 0, plankMat);
    registerCollider({ kind: 'cylinder', x: wx, z: wz, radius: 4.1, minY: wy, maxY: wy + 14 });

    // Brazier outside doorway
    this.addCylinder(detail, 0.45, 0.35, 1.1, 7, 4.8, 0.55, 2.2, ironMat);
    const brazierFire = this.addCylinder(detail, 0.32, 0.22, 0.25, 6, 4.8, 1.18, 2.2, emberMat, false);
    emissiveMeshes.push(brazierFire);
    const light = new THREE.PointLight(0xff9244, 1.9, 18, 1.7);
    light.position.set(4.8, 1.9, 2.2);
    detail.add(light);
    fireLights.push(light);

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, -4.5, groundHeightAt(wx - 4.5, wz + 2.5) - wy, 2.5, 0.6, timberMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: bp.id === 'loc-ancient-tower' ? 'Ancient Spire Coffer' : 'Watchtower Armament Chest',
      x: wx - 4.5,
      y: groundHeightAt(wx - 4.5, wz + 2.5),
      z: wz + 2.5,
      loot:
        bp.id === 'loc-ancient-tower'
          ? [
              { itemId: 'steel-sword', count: 1 },
              { itemId: 'iron-ore', count: 4 },
            ]
          : [
              { itemId: 'crossbow', count: 1 },
              { itemId: 'arrow', count: 14 },
            ],
      coins: 75,
      xp: 80,
    });

    onRegisterResource({
      id: `${bp.id}-stone`,
      kind: 'stone',
      label: 'Fallen Tower Stone',
      x: wx + 6.4,
      y: groundHeightAt(wx + 6.4, wz - 3.2),
      z: wz - 3.2,
    });
  }

  private buildMineLocation(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    timberMat: THREE.Material,
    plankMat: THREE.Material,
    stoneMat: THREE.Material,
    ironMat: THREE.Material,
    crystalMat: THREE.Material,
    fireLights: THREE.PointLight[],
    emissiveMeshes: THREE.Mesh[],
    registerCollider: (c: WorldCollider) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
    onRegisterStation?: (station: ExplorationStationPlacement) => void,
  ): void {
    // Rock mound & recessed mine portal
    this.addBox(root, 12, 7.5, 8, 0, 3.6, -5.5, stoneMat);
    // Timbered mine entrance frame
    this.addBox(root, 0.45, 3.6, 0.45, -2.0, 1.8, -0.5, timberMat);
    this.addBox(root, 0.45, 3.6, 0.45, 2.0, 1.8, -0.5, timberMat);
    this.addBox(root, 4.8, 0.45, 0.55, 0, 3.65, -0.5, timberMat);
    // Dark tunnel backing
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x101316, roughness: 0.98 });
    (this.activeDisposablesTarget ?? this.disposables).push(darkMat);
    this.addBox(root, 3.4, 3.2, 0.5, 0, 1.6, -1.6, darkMat, 0, false);

    // Rail tracks & minecart
    this.addBox(detail, 0.1, 0.08, 10, -0.55, 0.05, 3.5, ironMat);
    this.addBox(detail, 0.1, 0.08, 10, 0.55, 0.05, 3.5, ironMat);
    for (let t = -1; t <= 8; t += 1.1) {
      this.addBox(detail, 1.5, 0.06, 0.2, 0, 0.02, t, timberMat);
    }
    this.addBox(detail, 1.3, 0.85, 1.8, 0, 0.65, 2.8, ironMat);

    // Prospector smelting furnace outside portal
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff6e2e,
      emissive: 0xd94814,
      emissiveIntensity: 0.72,
      roughness: 0.55,
    });
    (this.activeDisposablesTarget ?? this.disposables).push(emberMat);
    this.addCylinder(detail, 0.55, 0.68, 1.3, 8, 3.6, 0.65, 4.4, stoneMat);
    this.addCylinder(detail, 0.25, 0.3, 0.8, 7, 3.6, 1.55, 4.4, stoneMat);
    this.addBox(detail, 0.46, 0.4, 0.2, 3.6, 0.52, 4.92, emberMat);
    onRegisterStation?.({
      id: `${bp.id}-station-furnace`,
      stationType: 'furnace',
      label: 'Smelting Furnace',
      x: wx + 3.6,
      y: groundHeightAt(wx + 3.6, wz + 4.4),
      z: wz + 4.4,
    });

    // Glowing lantern crystals at portal
    const crys = this.addCylinder(detail, 0.15, 0.28, 0.9, 5, 2.3, 0.45, 0.2, crystalMat, false);
    emissiveMeshes.push(crys);
    const l = new THREE.PointLight(0x7ad6ee, 1.8, 16, 1.7);
    l.position.set(0, 2.8, 1.2);
    detail.add(l);
    fireLights.push(l);

    registerCollider({ kind: 'cylinder', x: wx - 3.6, z: wz - 4.5, radius: 3.2, minY: wy, maxY: wy + 7 });
    registerCollider({ kind: 'cylinder', x: wx + 3.6, z: wz - 4.5, radius: 3.2, minY: wy, maxY: wy + 7 });

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, -3.5, groundHeightAt(wx - 3.5, wz + 2.4) - wy, 2.4, 0.4, plankMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: 'Prospector Chest',
      x: wx - 3.5,
      y: groundHeightAt(wx - 3.5, wz + 2.4),
      z: wz + 2.4,
      loot: [
        { itemId: 'iron-ore', count: 8 },
        { itemId: 'coal', count: 6 },
        { itemId: 'torch', count: 3 },
      ],
      coins: 65,
      xp: 75,
    });

    onRegisterResource({
      id: `${bp.id}-iron-1`,
      kind: 'iron-ore',
      label: 'Rich Iron Vein',
      x: wx + 4.4,
      y: groundHeightAt(wx + 4.4, wz + 1.8),
      z: wz + 1.8,
    });
    onRegisterResource({
      id: `${bp.id}-copper-1`,
      kind: 'copper-ore',
      label: 'Mine Copper Seam',
      x: wx + 2.6,
      y: groundHeightAt(wx + 2.6, wz + 6.8),
      z: wz + 6.8,
    });
    onRegisterResource({
      id: `${bp.id}-coal-1`,
      kind: 'coal',
      label: 'Coal Seam',
      x: wx - 4.6,
      y: groundHeightAt(wx - 4.6, wz + 4.6),
      z: wz + 4.6,
    });
  }

  private buildCaveLocation(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    stoneMat: THREE.Material,
    mossStoneMat: THREE.Material,
    crystalMat: THREE.Material,
    ironMat: THREE.Material,
    fireLights: THREE.PointLight[],
    emissiveMeshes: THREE.Mesh[],
    registerCollider: (c: WorldCollider) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
  ): void {
    // Vaulted rock archway & cavern hood
    this.addCylinder(root, 4.2, 5.2, 6.2, 7, -3.8, 3.0, -2.5, stoneMat);
    this.addCylinder(root, 4.0, 5.0, 6.4, 7, 3.8, 3.0, -2.5, stoneMat);
    this.addBox(root, 10.5, 2.8, 7.5, 0, 5.8, -3.2, mossStoneMat);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0e141c, roughness: 0.96 });
    (this.activeDisposablesTarget ?? this.disposables).push(darkMat);
    this.addBox(root, 4.8, 4.2, 0.8, 0, 2.1, -5.2, darkMat, 0, false);

    // Crystal clusters
    const crystalOffsets = [
      [-1.8, -1.6],
      [2.1, -2.2],
      [-0.6, -3.4],
    ];
    for (const [cx, cz] of crystalOffsets) {
      const m = this.addCylinder(detail, 0.08, 0.34, 1.45, 5, cx, 0.72, cz, crystalMat, false);
      emissiveMeshes.push(m);
    }
    const light = new THREE.PointLight(0x52d4ff, 2.1, 18, 1.7);
    light.position.set(0, 2.4, -1.8);
    detail.add(light);
    fireLights.push(light);

    registerCollider({ kind: 'cylinder', x: wx - 4.2, z: wz - 2.5, radius: 2.8, minY: wy, maxY: wy + 6 });
    registerCollider({ kind: 'cylinder', x: wx + 4.2, z: wz - 2.5, radius: 2.8, minY: wy, maxY: wy + 6 });

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, 0.4, groundHeightAt(wx + 0.4, wz - 2.4) - wy, -2.4, 0.1, stoneMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: 'Crystal Grotto Chest',
      x: wx + 0.4,
      y: groundHeightAt(wx + 0.4, wz - 2.4),
      z: wz - 2.4,
      loot: [
        { itemId: 'iron-ore', count: 7 },
        { itemId: 'coal', count: 5 },
        { itemId: 'spear', count: 1 },
      ],
      coins: 90,
      xp: 90,
    });

    onRegisterResource({
      id: `${bp.id}-iron`,
      kind: 'iron-ore',
      label: 'Cave Iron Seam',
      x: wx + 3.2,
      y: groundHeightAt(wx + 3.2, wz + 2.4),
      z: wz + 2.4,
    });
    onRegisterResource({
      id: `${bp.id}-silver`,
      kind: 'silver-ore',
      label: 'Cave Silver Vein',
      x: wx - 2.8,
      y: groundHeightAt(wx - 2.8, wz + 3.6),
      z: wz + 3.6,
    });
    onRegisterResource({
      id: `${bp.id}-crystal`,
      kind: 'rare-mineral',
      label: 'Sunstone Crystal Vein',
      x: wx + 0.5,
      y: groundHeightAt(wx + 0.5, wz + 4.8),
      z: wz + 4.8,
    });
  }

  private buildDesertRuins(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    sandstoneMat: THREE.Material,
    emberMat: THREE.Material,
    ironMat: THREE.Material,
    fireLights: THREE.PointLight[],
    emissiveMeshes: THREE.Mesh[],
    registerCollider: (c: WorldCollider) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
  ): void {
    // Stepped sandstone dais
    this.addBox(root, 12, 0.6, 12, 0, 0.3, 0, sandstoneMat);
    this.addBox(root, 8.5, 0.6, 8.5, 0, 0.9, 0, sandstoneMat);
    // Four perimeter obelisks/pillars
    const cols = [
      [-4.6, -4.6, 5.4],
      [4.6, -4.6, 4.2],
      [-4.6, 4.6, 3.6],
      [4.6, 4.6, 5.8],
    ];
    for (const [cx, cz, ch] of cols) {
      this.addBox(root, 1.1, ch, 1.1, cx, ch * 0.5 + 0.5, cz, sandstoneMat);
      registerCollider({ kind: 'cylinder', x: wx + cx, z: wz + cz, radius: 0.85, minY: wy, maxY: wy + ch });
    }
    // Central sun altar & flame
    this.addBox(detail, 1.8, 1.4, 1.8, 0, 1.9, 0, sandstoneMat);
    const altarFlame = this.addCylinder(detail, 0.28, 0.42, 0.45, 6, 0, 2.7, 0, emberMat, false);
    emissiveMeshes.push(altarFlame);
    const l = new THREE.PointLight(0xffb44c, 2.0, 20, 1.6);
    l.position.set(0, 3.4, 0);
    detail.add(l);
    fireLights.push(l);

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, 0, 1.2, 2.4, 0, sandstoneMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: 'Sunstone Relic Vault',
      x: wx,
      y: wy + 1.2,
      z: wz + 2.4,
      loot: [
        { itemId: 'steel-sword', count: 1 },
        { itemId: 'apothecary-tonic', count: 3 },
      ],
      coins: 120,
      xp: 110,
    });

    onRegisterResource({
      id: `${bp.id}-stone`,
      kind: 'stone',
      label: 'Carved Sandstone Block',
      x: wx - 7.5,
      y: groundHeightAt(wx - 7.5, wz + 1.2),
      z: wz + 1.2,
    });
  }

  private buildTreasureCove(
    bp: LocationBlueprint,
    wx: number,
    wy: number,
    wz: number,
    root: THREE.Group,
    detail: THREE.Group,
    timberMat: THREE.Material,
    plankMat: THREE.Material,
    sailMat: THREE.Material,
    ironMat: THREE.Material,
    registerCollider: (c: WorldCollider) => void,
    onRegisterChest: (chest: ExplorationChestPlacement) => void,
    onRegisterResource: (res: ExplorationResourcePlacement) => void,
  ): void {
    // Beached wooden ship hull ribs & broken mast
    this.addBox(root, 3.4, 1.1, 8.2, 0, 0.55, 0, plankMat, 0.35);
    this.addCylinder(root, 0.18, 0.26, 6.2, 7, -0.4, 3.1, -0.6, timberMat);
    const sail = this.addBox(detail, 3.2, 2.4, 0.08, 0.4, 3.9, -0.6, sailMat, 0.25);
    sail.rotation.z = 0.14;
    registerCollider({ kind: 'cylinder', x: wx, z: wz, radius: 2.6, minY: wy, maxY: wy + 3.5 });

    const chestId = `${bp.id}-chest`;
    this.createChestVisual(chestId, detail, 2.4, groundHeightAt(wx + 2.4, wz + 2.2) - wy, 2.2, -0.65, plankMat, ironMat);
    onRegisterChest({
      id: chestId,
      label: 'Smuggler’s Treasure Chest',
      x: wx + 2.4,
      y: groundHeightAt(wx + 2.4, wz + 2.2),
      z: wz + 2.2,
      loot: [
        { itemId: 'steel-sword', count: 1 },
        { itemId: 'crossbow', count: 1 },
        { itemId: 'arrow', count: 16 },
      ],
      coins: 150,
      xp: 120,
    });

    onRegisterResource({
      id: `${bp.id}-wood`,
      kind: 'wood',
      label: 'Driftwood Timbers',
      x: wx - 4.2,
      y: groundHeightAt(wx - 4.2, wz + 2.8),
      z: wz + 2.8,
    });
  }

  private applyShadowAndLightState(loc: ExplorationLocationRecord): void {
    if (!loc.isLoaded) return;
    loc.rootGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.userData.__origCastShadow === undefined) {
          mesh.userData.__origCastShadow = mesh.castShadow;
          mesh.userData.__origReceiveShadow = mesh.receiveShadow;
        }
        mesh.castShadow =
          Boolean(mesh.userData.__origCastShadow) && this.propShadowsEnabled;
        mesh.receiveShadow =
          Boolean(mesh.userData.__origReceiveShadow) && this.shadowsEnabled;
      }
    });
    if (this.maxActiveLights === 0) {
      for (let j = 0; j < loc.fireLights.length; j++) {
        loc.fireLights[j].visible = false;
      }
    }
  }

  public applyGraphicsProfile(profile: ResolvedGraphicsProfile): void {
    this.propShadowsEnabled = profile.propShadows;
    this.shadowsEnabled = profile.shadowEnabled;
    this.loadDist = profile.explorationDrawDist;
    this.unloadDist = this.loadDist + 95;
    this.detailDist = Math.min(this.loadDist * 0.68, profile.villageDetailDist + 65);
    this.maxActiveLights =
      profile.effectiveTier === 'very-low'
        ? 0
        : profile.effectiveTier === 'low'
          ? 1
          : profile.villageMaxLights;

    for (let i = 0; i < this.locations.length; i++) {
      this.applyShadowAndLightState(this.locations[i]);
    }
  }

  public getLoadedLocationCount(): number {
    let count = 0;
    for (let i = 0; i < this.locations.length; i++) {
      if (this.locations[i].isLoaded) count++;
    }
    return count;
  }

  public update(
    elapsed: number,
    playerPos: THREE.Vector3,
    worldHours: number,
    immediate = false,
  ): void {
    const isNight = worldHours < 6.4 || worldHours >= 18.2;
    const loadDistSq = this.loadDist * this.loadDist;
    const unloadDistSq = this.unloadDist * this.unloadDist;
    const detailDistSq = this.detailDist * this.detailDist;
    const lightDistSq = 65 * 65;
    let activeLightBudget = this.maxActiveLights;

    let nearestPending: ExplorationLocationRecord | null = null;
    let nearestPendingDistSq = Infinity;

    for (let i = 0; i < this.locations.length; i++) {
      const loc = this.locations[i];
      const dx = playerPos.x - loc.x;
      const dz = playerPos.z - loc.z;
      const dSq = dx * dx + dz * dz;

      if (loc.isLoaded) {
        if (dSq > unloadDistSq) {
          this.unloadLocation(loc);
          continue;
        }
      } else if (dSq <= loadDistSq) {
        if (immediate) {
          this.materializeLocation(loc);
        } else if (dSq < nearestPendingDistSq) {
          nearestPendingDistSq = dSq;
          nearestPending = loc;
        }
      }
    }

    if (!immediate && nearestPending) {
      // Progressive async streaming: materialize at most 1 exploration site per frame
      this.materializeLocation(nearestPending);
    }

    for (let i = 0; i < this.locations.length; i++) {
      const loc = this.locations[i];
      if (!loc.isLoaded) continue;
      const dx = playerPos.x - loc.x;
      const dz = playerPos.z - loc.z;
      const dSq = dx * dx + dz * dz;

      loc.rootGroup.visible = dSq <= loadDistSq;
      if (!loc.rootGroup.visible) {
        for (let j = 0; j < loc.fireLights.length; j++) {
          loc.fireLights[j].visible = false;
        }
        continue;
      }

      const near = dSq <= detailDistSq;
      loc.detailGroup.visible = near;
      if (loc.fireLights.length > 0) {
        const allowLights = near && dSq <= lightDistSq && activeLightBudget > 0;
        const flicker = allowLights ? 0.88 + Math.sin(elapsed * 7.2 + i) * 0.12 : 0;
        for (let j = 0; j < loc.fireLights.length; j++) {
          const light = loc.fireLights[j];
          if (allowLights && activeLightBudget > 0) {
            light.visible = true;
            light.intensity = (isNight ? 2.4 : 1.0) * flicker;
            activeLightBudget--;
          } else {
            light.visible = false;
          }
        }
      }
    }
  }

  public isInsideClearance(x: number, z: number): boolean {
    for (let i = 0; i < this.locations.length; i++) {
      const loc = this.locations[i];
      const dx = x - loc.x;
      const dz = z - loc.z;
      if (dx * dx + dz * dz <= loc.clearanceRadius * loc.clearanceRadius) {
        return true;
      }
    }
    return false;
  }

  public dispose(): void {
    for (let i = 0; i < this.locations.length; i++) {
      this.unloadLocation(this.locations[i]);
    }
    this.disposables.forEach((d) => d.dispose());
    this.parentGroup.removeFromParent();
  }
}
