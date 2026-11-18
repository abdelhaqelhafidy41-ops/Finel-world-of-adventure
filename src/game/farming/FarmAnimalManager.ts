import * as THREE from 'three';
import type { WorldInteractable } from '../world/WorldManager';
import { groundHeightAt } from '../math/noise';
import { isWater } from '../world/WorldPlacementValidator';
import type { VillageSiteRecord } from '../world/VillageManager';
import type { PlayerBuiltStructure } from '../building/buildingTypes';
import { getBlueprintById } from '../building/buildingCatalog';
import type {
  FarmAnimalRecord,
  FarmAnimalSpecies,
  SavedFarmAnimal,
} from './farmingTypes';
import { FARM_ANIMAL_SPECS } from './cropCatalog';

interface MountedAnimalVisual {
  group: THREE.Group;
  headPivot: THREE.Group;
  phase: number;
  wanderAngle: number;
  wanderTimer: number;
  interactableId: string;
}

interface FarmAnimalEntry {
  record: FarmAnimalRecord;
  visual: MountedAnimalVisual | null;
}

export class FarmAnimalManager {
  private readonly scene: THREE.Scene;
  private readonly rootGroup = new THREE.Group();
  private readonly interactables: WorldInteractable[];
  private readonly animals = new Map<string, FarmAnimalEntry>();
  private shadowsEnabled = true;

  // Shared geometries & materials (disposed cleanly in dispose())
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();

  private readonly matCowHide: THREE.MeshStandardMaterial;
  private readonly matCowPatch: THREE.MeshStandardMaterial;
  private readonly matSheepWool: THREE.MeshStandardMaterial;
  private readonly matDarkHoof: THREE.MeshStandardMaterial;
  private readonly matGoatCoat: THREE.MeshStandardMaterial;
  private readonly matGoatBeard: THREE.MeshStandardMaterial;
  private readonly matChickenBody: THREE.MeshStandardMaterial;
  private readonly matChickenComb: THREE.MeshStandardMaterial;
  private readonly matBeakHorn: THREE.MeshStandardMaterial;
  private readonly matUdder: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, interactables: WorldInteractable[]) {
    this.scene = scene;
    this.interactables = interactables;
    this.rootGroup.name = 'DomesticFarmAnimals';
    this.scene.add(this.rootGroup);

    this.matCowHide = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.86 });
    this.matCowPatch = new THREE.MeshStandardMaterial({ color: 0x3a2d24, roughness: 0.85 });
    this.matSheepWool = new THREE.MeshStandardMaterial({ color: 0xf7f3e9, roughness: 0.96 });
    this.matDarkHoof = new THREE.MeshStandardMaterial({ color: 0x35312c, roughness: 0.72 });
    this.matGoatCoat = new THREE.MeshStandardMaterial({ color: 0xb99d7a, roughness: 0.88 });
    this.matGoatBeard = new THREE.MeshStandardMaterial({ color: 0x5d4b3b, roughness: 0.9 });
    this.matChickenBody = new THREE.MeshStandardMaterial({ color: 0xeadfce, roughness: 0.86 });
    this.matChickenComb = new THREE.MeshStandardMaterial({ color: 0xc93832, roughness: 0.56 });
    this.matBeakHorn = new THREE.MeshStandardMaterial({ color: 0xdfb15b, roughness: 0.5 });
    this.matUdder = new THREE.MeshStandardMaterial({ color: 0xe3b1b1, roughness: 0.78 });

    this.disposables.push(
      this.matCowHide,
      this.matCowPatch,
      this.matSheepWool,
      this.matDarkHoof,
      this.matGoatCoat,
      this.matGoatBeard,
      this.matChickenBody,
      this.matChickenComb,
      this.matBeakHorn,
      this.matUdder,
    );
  }

  public applyGraphicsProfile(shadowsEnabled: boolean): void {
    this.shadowsEnabled = shadowsEnabled;
    this.animals.forEach((entry) => {
      if (!entry.visual) return;
      entry.visual.group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.castShadow = Boolean(m.userData.__origCastShadow) && shadowsEnabled;
          m.receiveShadow = Boolean(m.userData.__origReceiveShadow) && shadowsEnabled;
        }
      });
    });
  }

  public getAllAnimals(): FarmAnimalRecord[] {
    const out: FarmAnimalRecord[] = [];
    this.animals.forEach((e) => out.push({ ...e.record }));
    return out;
  }

  public getAnimalById(id: string): FarmAnimalRecord | undefined {
    const e = this.animals.get(id);
    return e ? { ...e.record } : undefined;
  }

  public seedDefaultVillageAnimals(
    villages: ReadonlyArray<VillageSiteRecord>,
    totalWorldHours: number,
  ): void {
    if (this.animals.size > 0) return;

    const addSafe = (
      id: string,
      species: FarmAnimalSpecies,
      villageId: string,
      targetX: number,
      targetZ: number,
      penRadius: number,
      readyNow: boolean,
    ) => {
      if (this.animals.has(id)) return;
      let sx = targetX;
      let sz = targetZ;
      if (isWater(sx, sz)) {
        let found = false;
        for (let r = 2; r <= 12 && !found; r += 2) {
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const tx = targetX + Math.cos(ang) * r;
            const tz = targetZ + Math.sin(ang) * r;
            if (!isWater(tx, tz)) {
              sx = tx;
              sz = tz;
              found = true;
              break;
            }
          }
        }
      }
      const spec = FARM_ANIMAL_SPECS[species];
      const rec: FarmAnimalRecord = {
        id,
        species,
        homeVillageId: villageId,
        homeX: sx,
        homeZ: sz,
        penRadius,
        x: sx,
        y: groundHeightAt(sx, sz),
        z: sz,
        yaw: ((sx * 0.4 + sz * 0.7) % (Math.PI * 2)),
        lastProducedWorldHours: readyNow
          ? totalWorldHours - spec.intervalWorldHours - 0.5
          : totalWorldHours,
        fedUntilWorldHours: totalWorldHours + 2,
        ownerId: 'village',
      };
      this.animals.set(id, { record: rec, visual: null });
    };

    for (const v of villages) {
      if (v.id === 'oakhollow') {
        const fx = v.farmCenter.x;
        const fz = v.farmCenter.z;
        addSafe('oak_hen_1', 'chicken', v.id, fx - 5.2, fz + 5.2, 2.8, true);
        addSafe('oak_hen_2', 'chicken', v.id, fx - 3.6, fz + 5.6, 2.8, false);
        addSafe('oak_sheep_1', 'sheep', v.id, fx + 9.2, fz - 1.5, 3.2, true);
        addSafe('oak_cow_1', 'cow', v.id, fx + 9.8, fz + 2.8, 3.2, false);
      } else if (
        v.kind === 'farming' ||
        v.kind === 'plains' ||
        v.kind === 'river' ||
        v.kind === 'valley'
      ) {
        const fx = v.farmCenter.x;
        const fz = v.farmCenter.z;
        addSafe(`${v.id}_hen_1`, 'chicken', v.id, fx - 3.5, fz + 4.5, 2.8, true);
        addSafe(
          `${v.id}_herd_1`,
          v.kind === 'valley' ? 'goat' : 'sheep',
          v.id,
          fx + 5.5,
          fz + 2.0,
          3.2,
          false,
        );
      }
    }
  }

  public spawnStarterAnimalForStructure(
    st: PlayerBuiltStructure,
    totalWorldHours: number,
  ): FarmAnimalRecord | null {
    const bp = getBlueprintById(st.blueprintId);
    if (!bp?.isCoop) return null;
    const id = `fanimal_coop_${st.id}_0`;
    if (this.animals.has(id)) return null;
    return this.addAnimalToStructure(st, 'chicken', st.ownerId, totalWorldHours, id);
  }

  public findNearestPlayerStructureForSpecies(
    structures: ReadonlyArray<PlayerBuiltStructure>,
    x: number,
    z: number,
    species: FarmAnimalSpecies,
    maxDist = 64,
  ): PlayerBuiltStructure | null {
    const maxSq = maxDist * maxDist;
    let best: PlayerBuiltStructure | null = null;
    let bestSq = maxSq;
    for (const st of structures) {
      const bp = getBlueprintById(st.blueprintId);
      if (!bp) continue;
      const accepts =
        species === 'chicken' ? Boolean(bp.isCoop) : Boolean(bp.isAnimalPen);
      if (!accepts) continue;
      const dSq = (st.x - x) * (st.x - x) + (st.z - z) * (st.z - z);
      if (dSq <= bestSq) {
        bestSq = dSq;
        best = st;
      }
    }
    return best;
  }

  public addAnimalToStructure(
    st: PlayerBuiltStructure,
    species: FarmAnimalSpecies,
    ownerId: string,
    totalWorldHours: number,
    forcedId?: string,
  ): FarmAnimalRecord {
    const countExisting = Array.from(this.animals.values()).filter(
      (e) => e.record.homeStructureId === st.id,
    ).length;
    const id = forcedId ?? `fanimal_${st.id}_${countExisting}_${Math.floor(Math.random() * 9999)}`;
    const angle = countExisting * 1.9;
    const dist = 0.8 + (countExisting % 3) * 0.55;
    const sx = st.x + Math.cos(angle) * dist;
    const sz = st.z + Math.sin(angle) * dist;
    const spec = FARM_ANIMAL_SPECS[species];
    const rec: FarmAnimalRecord = {
      id,
      species,
      homeStructureId: st.id,
      homeX: st.x,
      homeZ: st.z,
      penRadius: species === 'chicken' ? 2.6 : 3.2,
      x: sx,
      y: groundHeightAt(sx, sz),
      z: sz,
      yaw: angle,
      lastProducedWorldHours: totalWorldHours - spec.intervalWorldHours * 0.4,
      fedUntilWorldHours: totalWorldHours + 6,
      ownerId,
    };
    this.animals.set(id, { record: rec, visual: null });
    return { ...rec };
  }

  public removeAnimalsForStructure(structureId: string): void {
    const toRemove: string[] = [];
    this.animals.forEach((entry, id) => {
      if (entry.record.homeStructureId === structureId) {
        toRemove.push(id);
      }
    });
    for (const id of toRemove) {
      this.unmountAnimalVisual(id);
      this.animals.delete(id);
    }
  }

  public isReadyToProduce(rec: FarmAnimalRecord, totalWorldHours: number): boolean {
    return this.getHoursUntilProduce(rec, totalWorldHours) <= 0;
  }

  public getHoursUntilProduce(rec: FarmAnimalRecord, totalWorldHours: number): number {
    const spec = FARM_ANIMAL_SPECS[rec.species];
    const elapsed = Math.max(0, totalWorldHours - rec.lastProducedWorldHours);
    const fed = rec.fedUntilWorldHours > totalWorldHours;
    const effectiveInterval = fed ? spec.intervalWorldHours * 0.65 : spec.intervalWorldHours;
    return Math.max(0, effectiveInterval - elapsed);
  }

  public collectProduct(
    animalId: string,
    totalWorldHours: number,
  ): { itemId: string; count: number; species: FarmAnimalSpecies } | null {
    const entry = this.animals.get(animalId);
    if (!entry) return null;
    if (!this.isReadyToProduce(entry.record, totalWorldHours)) return null;
    const spec = FARM_ANIMAL_SPECS[entry.record.species];
    entry.record.lastProducedWorldHours = totalWorldHours;
    this.syncInteractable(entry, totalWorldHours);
    return {
      itemId: spec.produceItemId,
      count: spec.produceCount,
      species: entry.record.species,
    };
  }

  public feedAnimal(animalId: string, totalWorldHours: number): boolean {
    const entry = this.animals.get(animalId);
    if (!entry) return false;
    entry.record.fedUntilWorldHours = Math.max(
      entry.record.fedUntilWorldHours,
      totalWorldHours,
    ) + 8;
    // Also nudge production slightly forward when fed
    entry.record.lastProducedWorldHours -= 1.25;
    this.syncInteractable(entry, totalWorldHours);
    return true;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    totalWorldHours: number,
    worldHours: number,
  ): void {
    const safeDt = Math.max(0.001, Math.min(0.1, dt));
    const mountDistSq = 95 * 95;
    const unmountDistSq = 120 * 120;
    const isNight = worldHours >= 20.5 || worldHours < 5.0;

    this.animals.forEach((entry) => {
      const rec = entry.record;
      const dx = playerPos.x - rec.homeX;
      const dz = playerPos.z - rec.homeZ;
      const distSq = dx * dx + dz * dz;

      if (!entry.visual) {
        if (distSq <= mountDistSq) {
          this.mountAnimalVisual(entry, totalWorldHours);
        }
        return;
      }

      if (distSq > unmountDistSq) {
        this.unmountAnimalVisual(rec.id);
        return;
      }

      const vis = entry.visual;
      vis.phase += safeDt * (isNight ? 1.4 : 3.2);
      vis.wanderTimer -= safeDt;
      if (vis.wanderTimer <= 0) {
        vis.wanderTimer = 2.4 + Math.random() * 3.8;
        vis.wanderAngle = Math.random() * Math.PI * 2;
      }

      if (!isNight) {
        const speed = rec.species === 'chicken' ? 0.52 : 0.42;
        const stepX = Math.cos(vis.wanderAngle) * speed * safeDt;
        const stepZ = Math.sin(vis.wanderAngle) * speed * safeDt;
        let nx = rec.x + stepX;
        let nz = rec.z + stepZ;

        const offX = nx - rec.homeX;
        const offZ = nz - rec.homeZ;
        const offDist = Math.hypot(offX, offZ);
        if (offDist > rec.penRadius) {
          // Gently steer back toward pen center
          vis.wanderAngle = Math.atan2(rec.homeZ - rec.z, rec.homeX - rec.x);
          nx = rec.x + Math.cos(vis.wanderAngle) * speed * safeDt;
          nz = rec.z + Math.sin(vis.wanderAngle) * speed * safeDt;
        }
        if (!isWater(nx, nz)) {
          rec.x = nx;
          rec.z = nz;
          rec.y = groundHeightAt(nx, nz);
          rec.yaw = Math.atan2(Math.cos(vis.wanderAngle), Math.sin(vis.wanderAngle));
        }
        vis.headPivot.rotation.x = Math.sin(vis.phase * 1.4) * 0.18 + 0.1;
      } else {
        // Gentle resting head pose at night
        vis.headPivot.rotation.x = 0.25;
      }

      vis.group.position.set(rec.x, rec.y, rec.z);
      vis.group.rotation.y = rec.yaw;

      const inter = this.interactables.find((i) => i.id === vis.interactableId);
      if (inter) {
        inter.x = rec.x;
        inter.y = rec.y;
        inter.z = rec.z;
      }
      // Refresh ready state text periodically (~every 2 seconds based on phase check)
      if (Math.floor(vis.phase) !== Math.floor(vis.phase - safeDt * 3.2)) {
        this.syncInteractable(entry, totalWorldHours);
      }
    });
  }

  public exportState(): SavedFarmAnimal[] {
    const out: SavedFarmAnimal[] = [];
    this.animals.forEach((e) => {
      const r = e.record;
      out.push({
        id: r.id,
        species: r.species,
        ...(r.homeVillageId ? { homeVillageId: r.homeVillageId } : {}),
        ...(r.homeStructureId ? { homeStructureId: r.homeStructureId } : {}),
        homeX: r.homeX,
        homeZ: r.homeZ,
        penRadius: r.penRadius,
        lastProducedWorldHours: r.lastProducedWorldHours,
        fedUntilWorldHours: r.fedUntilWorldHours,
        ownerId: r.ownerId,
      });
    });
    return out;
  }

  public restoreState(
    saved: SavedFarmAnimal[] | undefined,
    villages: ReadonlyArray<VillageSiteRecord>,
    totalWorldHours: number,
  ): void {
    const ids = Array.from(this.animals.keys());
    for (const id of ids) {
      this.unmountAnimalVisual(id);
    }
    this.animals.clear();

    if (saved && saved.length > 0) {
      for (const s of saved) {
        if (!FARM_ANIMAL_SPECS[s.species]) continue;
        const rec: FarmAnimalRecord = {
          id: s.id,
          species: s.species,
          homeVillageId: s.homeVillageId,
          homeStructureId: s.homeStructureId,
          homeX: s.homeX,
          homeZ: s.homeZ,
          penRadius: s.penRadius || 2.8,
          x: s.homeX,
          y: groundHeightAt(s.homeX, s.homeZ),
          z: s.homeZ,
          yaw: (s.homeX * 0.3) % (Math.PI * 2),
          lastProducedWorldHours: s.lastProducedWorldHours ?? totalWorldHours,
          fedUntilWorldHours: s.fedUntilWorldHours ?? totalWorldHours,
          ownerId: s.ownerId || 'village',
        };
        this.animals.set(rec.id, { record: rec, visual: null });
      }
    } else {
      this.seedDefaultVillageAnimals(villages, totalWorldHours);
    }
  }

  public dispose(): void {
    const ids = Array.from(this.animals.keys());
    for (const id of ids) {
      this.unmountAnimalVisual(id);
    }
    this.animals.clear();
    this.rootGroup.removeFromParent();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.geoCache.clear();
  }

  // -------------------------------------------------------------------------
  // Internal Visual Builders & Interactable Sync
  // -------------------------------------------------------------------------
  private boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = `b:${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.geoCache.set(key, g);
      this.disposables.push(g);
    }
    return g;
  }

  private cylGeo(rt: number, rb: number, h: number): THREE.BufferGeometry {
    const key = `c:${rt.toFixed(2)}:${rb.toFixed(2)}:${h.toFixed(2)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.CylinderGeometry(rt, rb, h, 7);
      this.geoCache.set(key, g);
      this.disposables.push(g);
    }
    return g;
  }

  private sphereGeo(r: number): THREE.BufferGeometry {
    const key = `s:${r.toFixed(2)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = new THREE.SphereGeometry(r, 8, 7);
      this.geoCache.set(key, g);
      this.disposables.push(g);
    }
    return g;
  }

  private addPart(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.__origCastShadow = castShadow;
    m.userData.__origReceiveShadow = true;
    m.castShadow = castShadow && this.shadowsEnabled;
    m.receiveShadow = this.shadowsEnabled;
    parent.add(m);
    return m;
  }

  private mountAnimalVisual(entry: FarmAnimalEntry, totalWorldHours: number): void {
    const rec = entry.record;
    const group = new THREE.Group();
    const headPivot = new THREE.Group();

    if (rec.species === 'chicken') {
      const body = this.addPart(group, this.sphereGeo(0.18), this.matChickenBody, 0, 0.28, 0);
      body.scale.set(0.85, 0.88, 1.25);
      this.addPart(group, this.cylGeo(0.018, 0.018, 0.16), this.matBeakHorn, -0.06, 0.08, 0, false);
      this.addPart(group, this.cylGeo(0.018, 0.018, 0.16), this.matBeakHorn, 0.06, 0.08, 0, false);
      this.addPart(group, this.boxGeo(0.04, 0.12, 0.18), this.matChickenBody, -0.15, 0.3, 0);
      this.addPart(group, this.boxGeo(0.04, 0.12, 0.18), this.matChickenBody, 0.15, 0.3, 0);
      headPivot.position.set(0, 0.38, 0.18);
      this.addPart(headPivot, this.sphereGeo(0.1), this.matChickenBody, 0, 0.06, 0);
      this.addPart(headPivot, this.boxGeo(0.035, 0.07, 0.11), this.matChickenComb, 0, 0.16, 0, false);
      this.addPart(headPivot, this.boxGeo(0.04, 0.04, 0.09), this.matBeakHorn, 0, 0.05, 0.1, false);
      group.add(headPivot);
    } else if (rec.species === 'sheep') {
      const wool = this.addPart(group, this.sphereGeo(0.38), this.matSheepWool, 0, 0.55, 0);
      wool.scale.set(0.92, 0.85, 1.32);
      for (const [lx, lz] of [
        [-0.17, 0.24],
        [0.17, 0.24],
        [-0.17, -0.24],
        [0.17, -0.24],
      ]) {
        this.addPart(group, this.cylGeo(0.045, 0.038, 0.36), this.matDarkHoof, lx, 0.18, lz);
      }
      headPivot.position.set(0, 0.62, 0.44);
      this.addPart(headPivot, this.sphereGeo(0.15), this.matDarkHoof, 0, 0, 0.06);
      this.addPart(headPivot, this.boxGeo(0.24, 0.06, 0.08), this.matDarkHoof, 0, 0.06, 0, false);
      group.add(headPivot);
    } else if (rec.species === 'goat') {
      this.addPart(group, this.boxGeo(0.42, 0.42, 0.92), this.matGoatCoat, 0, 0.56, 0);
      for (const [lx, lz] of [
        [-0.15, 0.3],
        [0.15, 0.3],
        [-0.15, -0.3],
        [0.15, -0.3],
      ]) {
        this.addPart(group, this.cylGeo(0.048, 0.04, 0.4), this.matDarkHoof, lx, 0.2, lz);
      }
      headPivot.position.set(0, 0.72, 0.45);
      this.addPart(headPivot, this.boxGeo(0.2, 0.22, 0.28), this.matGoatCoat, 0, 0.05, 0.08);
      this.addPart(headPivot, this.boxGeo(0.06, 0.1, 0.08), this.matGoatBeard, 0, -0.09, 0.16, false);
      this.addPart(headPivot, this.cylGeo(0.02, 0.035, 0.2), this.matBeakHorn, -0.07, 0.2, 0, false);
      this.addPart(headPivot, this.cylGeo(0.02, 0.035, 0.2), this.matBeakHorn, 0.07, 0.2, 0, false);
      group.add(headPivot);
    } else {
      // Cow
      this.addPart(group, this.boxGeo(0.68, 0.64, 1.34), this.matCowHide, 0, 0.82, 0);
      this.addPart(group, this.boxGeo(0.32, 0.36, 0.5), this.matCowPatch, -0.2, 0.88, -0.1, false);
      this.addPart(group, this.boxGeo(0.28, 0.32, 0.4), this.matCowPatch, 0.22, 0.78, 0.24, false);
      this.addPart(group, this.sphereGeo(0.14), this.matUdder, 0, 0.48, -0.24, false);
      for (const [lx, lz] of [
        [-0.22, 0.46],
        [0.22, 0.46],
        [-0.22, -0.46],
        [0.22, -0.46],
      ]) {
        this.addPart(group, this.cylGeo(0.075, 0.06, 0.58), this.matDarkHoof, lx, 0.29, lz);
      }
      headPivot.position.set(0, 0.94, 0.7);
      this.addPart(headPivot, this.boxGeo(0.34, 0.34, 0.42), this.matCowHide, 0, 0, 0.1);
      this.addPart(headPivot, this.cylGeo(0.02, 0.04, 0.2), this.matBeakHorn, -0.16, 0.22, 0.05, false);
      this.addPart(headPivot, this.cylGeo(0.02, 0.04, 0.2), this.matBeakHorn, 0.16, 0.22, 0.05, false);
      group.add(headPivot);
    }

    group.position.set(rec.x, rec.y, rec.z);
    group.rotation.y = rec.yaw;
    this.rootGroup.add(group);

    const interactableId = `fanimal_${rec.id}`;
    entry.visual = {
      group,
      headPivot,
      phase: Math.random() * Math.PI * 2,
      wanderAngle: Math.random() * Math.PI * 2,
      wanderTimer: 1 + Math.random() * 2,
      interactableId,
    };

    const spec = FARM_ANIMAL_SPECS[rec.species];
    this.interactables.push({
      id: interactableId,
      label: spec.nameEn,
      actionVerb: spec.actionVerbEn,
      kind: 'farm_animal',
      x: rec.x,
      y: rec.y,
      z: rec.z,
      radius: 2.8,
      collected: false,
      message: `${spec.nameEn}`,
    });
    this.syncInteractable(entry, totalWorldHours);
  }

  private unmountAnimalVisual(animalId: string): void {
    const entry = this.animals.get(animalId);
    if (!entry?.visual) return;
    entry.visual.group.removeFromParent();
    const idx = this.interactables.findIndex((i) => i.id === entry.visual!.interactableId);
    if (idx !== -1) {
      this.interactables.splice(idx, 1);
    }
    entry.visual = null;
  }

  private syncInteractable(entry: FarmAnimalEntry, totalWorldHours: number): void {
    if (!entry.visual) return;
    const inter = this.interactables.find((i) => i.id === entry.visual!.interactableId);
    if (!inter) return;
    const spec = FARM_ANIMAL_SPECS[entry.record.species];
    const ready = this.isReadyToProduce(entry.record, totalWorldHours);
    if (ready) {
      inter.actionVerb = spec.actionVerbEn;
      inter.message = `${spec.nameEn} is ready!`;
    } else {
      inter.actionVerb = 'Feed / Tend';
      inter.message = `${spec.nameEn} is grazing peacefully.`;
    }
  }
}
