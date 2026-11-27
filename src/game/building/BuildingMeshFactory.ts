import * as THREE from 'three';
import type { BuildingBlueprint } from './buildingTypes';
import type { ProceduralTextureSet } from '../world/textures';
import {
  buildGroupFromWoa3dModel,
  resolveExternalWoa3dModel,
} from '../mods/Woa3dModelBuilder';

export interface BuiltStructureMeshRefs {
  group: THREE.Group;
  doorPivot?: THREE.Group;
  chestLidPivot?: THREE.Group;
  cropStages?: THREE.Group[];
  cropAccentMeshes?: THREE.Mesh[];
  soilMesh?: THREE.Mesh;
  lampLights?: THREE.PointLight[];
}

export interface BuildingPalette {
  woodWarm: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  plankOak: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  stoneBrick: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  roofCedar: THREE.MeshStandardMaterial;
  roofSlate: THREE.MeshStandardMaterial;
  roofTerracotta: THREE.MeshStandardMaterial;
  plasterCream: THREE.MeshStandardMaterial;
  windowGlow: THREE.MeshStandardMaterial;
  lanternGlow: THREE.MeshStandardMaterial;
  emberGlow: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  soilWet: THREE.MeshStandardMaterial;
  waterPool: THREE.MeshStandardMaterial;
  cropSprout: THREE.MeshStandardMaterial;
  wheatGold: THREE.MeshStandardMaterial;
  cornGold: THREE.MeshStandardMaterial;
  carrotOrange: THREE.MeshStandardMaterial;
  tomatoRed: THREE.MeshStandardMaterial;
  potatoEarthy: THREE.MeshStandardMaterial;
  herbSage: THREE.MeshStandardMaterial;
  berryCrimson: THREE.MeshStandardMaterial;
  clothGreen: THREE.MeshStandardMaterial;
  linen: THREE.MeshStandardMaterial;
  previewValidMat: THREE.MeshBasicMaterial;
  previewInvalidMat: THREE.MeshBasicMaterial;
}

export class BuildingMeshFactory {
  private readonly palette: BuildingPalette;
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(textures: ProceduralTextureSet) {
    this.palette = {
      woodWarm: new THREE.MeshStandardMaterial({
        map: textures.barkMap,
        normalMap: textures.barkNormalMap,
        normalScale: new THREE.Vector2(0.55, 0.55),
        color: 0x8b603b,
        roughness: 0.84,
        metalness: 0.04,
      }),
      woodDark: new THREE.MeshStandardMaterial({
        map: textures.barkMap,
        normalMap: textures.barkNormalMap,
        normalScale: new THREE.Vector2(0.65, 0.65),
        color: 0x573b26,
        roughness: 0.88,
        metalness: 0.04,
      }),
      plankOak: new THREE.MeshStandardMaterial({
        map: textures.barkMap,
        normalMap: textures.barkNormalMap,
        normalScale: new THREE.Vector2(0.35, 0.35),
        color: 0xb08152,
        roughness: 0.8,
        metalness: 0.03,
      }),
      stone: new THREE.MeshStandardMaterial({
        map: textures.rockMap,
        normalMap: textures.rockNormalMap,
        normalScale: new THREE.Vector2(0.75, 0.75),
        roughnessMap: textures.rockRoughnessMap,
        color: 0x868a84,
        roughness: 0.9,
        metalness: 0.04,
      }),
      stoneBrick: new THREE.MeshStandardMaterial({
        map: textures.rockMap,
        normalMap: textures.rockNormalMap,
        normalScale: new THREE.Vector2(0.65, 0.65),
        roughnessMap: textures.rockRoughnessMap,
        color: 0xa2a096,
        roughness: 0.86,
        metalness: 0.06,
      }),
      iron: new THREE.MeshStandardMaterial({
        color: 0x383e45,
        roughness: 0.42,
        metalness: 0.76,
      }),
      roofCedar: new THREE.MeshStandardMaterial({
        color: 0x7c4b2d,
        normalMap: textures.barkNormalMap,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.8,
        metalness: 0.04,
      }),
      roofSlate: new THREE.MeshStandardMaterial({
        color: 0x47535e,
        normalMap: textures.rockNormalMap,
        normalScale: new THREE.Vector2(0.42, 0.42),
        roughness: 0.74,
        metalness: 0.12,
      }),
      roofTerracotta: new THREE.MeshStandardMaterial({
        color: 0xa65037,
        normalMap: textures.plasterNormalMap,
        normalScale: new THREE.Vector2(0.4, 0.4),
        roughness: 0.74,
        metalness: 0.06,
      }),
      plasterCream: new THREE.MeshStandardMaterial({
        color: 0xe8ddc6,
        normalMap: textures.plasterNormalMap,
        normalScale: new THREE.Vector2(0.3, 0.3),
        roughness: 0.88,
        metalness: 0.02,
      }),
      windowGlow: new THREE.MeshStandardMaterial({
        color: 0xffe4a8,
        emissive: 0xffb347,
        emissiveIntensity: 0.52,
        roughness: 0.25,
        metalness: 0.15,
      }),
      lanternGlow: new THREE.MeshStandardMaterial({
        color: 0xfff0c2,
        emissive: 0xffb744,
        emissiveIntensity: 1.5,
        roughness: 0.18,
        metalness: 0.05,
      }),
      emberGlow: new THREE.MeshStandardMaterial({
        color: 0xff7b2e,
        emissive: 0xe64a19,
        emissiveIntensity: 0.95,
        roughness: 0.38,
      }),
      soil: new THREE.MeshStandardMaterial({
        color: 0x694b32,
        normalMap: textures.grassNormalMap,
        roughness: 0.95,
        metalness: 0.01,
      }),
      soilWet: new THREE.MeshStandardMaterial({
        color: 0x3b2819,
        normalMap: textures.grassNormalMap,
        roughness: 0.72,
        metalness: 0.03,
      }),
      waterPool: new THREE.MeshStandardMaterial({
        color: 0x3582a8,
        roughness: 0.14,
        metalness: 0.15,
      }),
      cropSprout: new THREE.MeshStandardMaterial({
        color: 0x4f9442,
        roughness: 0.84,
      }),
      wheatGold: new THREE.MeshStandardMaterial({
        color: 0xe5b842,
        roughness: 0.82,
      }),
      cornGold: new THREE.MeshStandardMaterial({
        color: 0xf4cc44,
        roughness: 0.78,
      }),
      carrotOrange: new THREE.MeshStandardMaterial({
        color: 0xea7a26,
        roughness: 0.78,
      }),
      tomatoRed: new THREE.MeshStandardMaterial({
        color: 0xd93c34,
        roughness: 0.62,
      }),
      potatoEarthy: new THREE.MeshStandardMaterial({
        color: 0x5c8b42,
        roughness: 0.84,
      }),
      herbSage: new THREE.MeshStandardMaterial({
        color: 0x76bf92,
        roughness: 0.82,
      }),
      berryCrimson: new THREE.MeshStandardMaterial({
        color: 0xb92b49,
        roughness: 0.68,
      }),
      clothGreen: new THREE.MeshStandardMaterial({
        color: 0x3b6e52,
        roughness: 0.88,
      }),
      linen: new THREE.MeshStandardMaterial({
        color: 0xe8dfd0,
        roughness: 0.86,
      }),
      previewValidMat: new THREE.MeshBasicMaterial({
        color: 0x38d97c,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
      previewInvalidMat: new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    };

    Object.values(this.palette).forEach((m) => this.disposables.push(m));
  }

  public applyTextures(textures: ProceduralTextureSet): void {
    this.palette.woodWarm.map = textures.barkMap;
    this.palette.woodWarm.normalMap = textures.barkNormalMap;
    this.palette.woodDark.map = textures.barkMap;
    this.palette.woodDark.normalMap = textures.barkNormalMap;
    this.palette.plankOak.map = textures.barkMap;
    this.palette.plankOak.normalMap = textures.barkNormalMap;
    this.palette.stone.map = textures.rockMap;
    this.palette.stone.normalMap = textures.rockNormalMap;
    this.palette.stone.roughnessMap = textures.rockRoughnessMap;
    this.palette.stoneBrick.map = textures.rockMap;
    this.palette.stoneBrick.normalMap = textures.rockNormalMap;
    this.palette.stoneBrick.roughnessMap = textures.rockRoughnessMap;
    this.palette.roofCedar.normalMap = textures.barkNormalMap;
    this.palette.roofSlate.normalMap = textures.rockNormalMap;
    this.palette.roofTerracotta.normalMap = textures.plasterNormalMap;
    this.palette.plasterCream.normalMap = textures.plasterNormalMap;
    this.palette.soil.normalMap = textures.grassNormalMap;
    this.palette.soilWet.normalMap = textures.grassNormalMap;
  }

  public syncFarmPlotVisuals(
    refs: BuiltStructureMeshRefs,
    stage: number,
    cropId: string | null | undefined,
    waterLevel: number,
  ): void {
    if (refs.soilMesh) {
      refs.soilMesh.material = waterLevel > 0.15 ? this.palette.soilWet : this.palette.soil;
    }
    if (refs.cropStages) {
      for (let i = 0; i < refs.cropStages.length; i++) {
        refs.cropStages[i].visible =
          Boolean(cropId) && stage > 0 && i === Math.min(refs.cropStages.length - 1, stage - 1);
      }
    }
    if (refs.cropAccentMeshes && refs.cropAccentMeshes.length > 0) {
      let mat = this.palette.wheatGold;
      switch (cropId) {
        case 'corn':
          mat = this.palette.cornGold;
          break;
        case 'carrot':
          mat = this.palette.carrotOrange;
          break;
        case 'tomato':
          mat = this.palette.tomatoRed;
          break;
        case 'potato':
          mat = this.palette.potatoEarthy;
          break;
        case 'herb':
          mat = this.palette.herbSage;
          break;
        case 'berry':
          mat = this.palette.berryCrimson;
          break;
        default:
          mat = this.palette.wheatGold;
          break;
      }
      for (let i = 0; i < refs.cropAccentMeshes.length; i++) {
        refs.cropAccentMeshes[i].material = mat;
      }
    }
  }

  public updateNightLighting(elapsed: number, nightFactor: number): void {
    this.palette.windowGlow.emissiveIntensity = THREE.MathUtils.lerp(0.28, 1.38, nightFactor);
    this.palette.lanternGlow.emissiveIntensity =
      THREE.MathUtils.lerp(0.6, 2.2, nightFactor) +
      Math.sin(elapsed * 3.2) * (0.06 + nightFactor * 0.14);
  }

  private boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = `box:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
    let geo = this.geoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      this.geoCache.set(key, geo);
      this.disposables.push(geo);
    }
    return geo;
  }

  private cylGeo(rt: number, rb: number, h: number, seg = 8): THREE.BufferGeometry {
    const key = `cyl:${rt.toFixed(3)}:${rb.toFixed(3)}:${h.toFixed(3)}:${seg}`;
    let geo = this.geoCache.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(rt, rb, h, seg);
      this.geoCache.set(key, geo);
      this.disposables.push(geo);
    }
    return geo;
  }

  private gableGeo(width: number, height: number, depth: number): THREE.BufferGeometry {
    const key = `gable:${width.toFixed(3)}:${height.toFixed(3)}:${depth.toFixed(3)}`;
    let geo = this.geoCache.get(key);
    if (!geo) {
      const hw = width * 0.5;
      const shape = new THREE.Shape();
      shape.moveTo(-hw, 0);
      shape.lineTo(hw, 0);
      shape.lineTo(0, height);
      shape.closePath();
      geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.translate(0, 0, -depth * 0.5);
      geo.computeVertexNormals();
      this.geoCache.set(key, geo);
      this.disposables.push(geo);
    }
    return geo;
  }

  private makeBox(
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    return m;
  }

  public buildStructure(
    bp: BuildingBlueprint,
    shadowsEnabled = true,
    isPreview = false,
  ): BuiltStructureMeshRefs {
    const group = new THREE.Group();
    const refs: BuiltStructureMeshRefs = { group };

    switch (bp.id) {
      case 'wood-foundation':
      case 'stone-foundation': {
        const isStone = bp.id === 'stone-foundation';
        // Deep skirt (-1.6m below grade) eliminates floating edges on hills
        const base = this.makeBox(
          bp.width,
          2.02,
          bp.depth,
          isStone ? this.palette.stoneBrick : this.palette.stone,
          0,
          -0.61,
          0,
        );
        const topDeck = this.makeBox(
          bp.width,
          0.16,
          bp.depth,
          isStone ? this.palette.stoneBrick : this.palette.plankOak,
          0,
          0.37,
          0,
        );
        group.add(base, topDeck);
        if (!isStone) {
          for (const sx of [-bp.width * 0.45, bp.width * 0.45]) {
            group.add(this.makeBox(0.2, 0.24, bp.depth + 0.04, this.palette.woodDark, sx, 0.34, 0));
          }
        }
        break;
      }

      case 'wood-floor': {
        group.add(this.makeBox(bp.width, 0.22, bp.depth, this.palette.plankOak, 0, 0.11, 0));
        for (const sz of [-1.2, 0, 1.2]) {
          group.add(this.makeBox(bp.width, 0.06, 0.16, this.palette.woodDark, 0, 0.04, sz, false));
        }
        break;
      }

      case 'wood-wall':
      case 'stone-wall':
      case 'reinforced-wall': {
        const mat =
          bp.id === 'wood-wall'
            ? this.palette.plankOak
            : bp.id === 'stone-wall'
              ? this.palette.stone
              : this.palette.stoneBrick;
        group.add(this.makeBox(bp.width, bp.height, bp.depth, mat, 0, bp.height * 0.5, 0));
        group.add(this.makeBox(bp.width + 0.06, 0.4, bp.depth + 0.08, this.palette.stone, 0, 0.16, 0));
        group.add(this.makeBox(bp.width + 0.06, 0.2, bp.depth + 0.06, this.palette.woodDark, 0, bp.height - 0.1, 0));
        if (bp.id === 'reinforced-wall') {
          for (const bx of [-1.1, 0, 1.1]) {
            group.add(this.makeBox(0.18, bp.height - 0.3, bp.depth + 0.1, this.palette.iron, bx, bp.height * 0.5, 0));
          }
        }
        break;
      }

      case 'wood-half-wall': {
        group.add(this.makeBox(bp.width, bp.height, bp.depth, this.palette.plankOak, 0, bp.height * 0.5, 0));
        group.add(this.makeBox(bp.width + 0.06, 0.16, bp.depth + 0.1, this.palette.woodDark, 0, bp.height, 0));
        break;
      }

      case 'timber-pillar': {
        group.add(this.makeBox(0.34, bp.height, 0.34, this.palette.woodDark, 0, bp.height * 0.5, 0));
        group.add(this.makeBox(0.54, 0.28, 0.54, this.palette.stone, 0, 0.14, 0));
        group.add(this.makeBox(0.54, 0.2, 0.54, this.palette.woodWarm, 0, bp.height - 0.1, 0));
        break;
      }

      case 'pitched-roof': {
        const overhang = 0.28;
        const spanW = bp.width + overhang * 2;
        const spanD = bp.depth + overhang * 2;
        const slopeLen = Math.hypot(spanW * 0.5 + 0.15, bp.height);
        const angle = Math.atan2(bp.height, spanW * 0.5);
        const leftSlope = this.makeBox(slopeLen, 0.18, spanD, this.palette.roofCedar, -spanW * 0.25, bp.height * 0.5, 0);
        leftSlope.rotation.z = angle;
        const rightSlope = this.makeBox(slopeLen, 0.18, spanD, this.palette.roofCedar, spanW * 0.25, bp.height * 0.5, 0);
        rightSlope.rotation.z = -angle;
        const gable = new THREE.Mesh(this.gableGeo(bp.width, bp.height, bp.depth), this.palette.woodWarm);
        gable.castShadow = true;
        gable.receiveShadow = true;
        const ridge = this.makeBox(0.24, 0.22, spanD + 0.08, this.palette.woodDark, 0, bp.height + 0.02, 0);
        group.add(leftSlope, rightSlope, gable, ridge);
        break;
      }

      case 'wood-stairs': {
        const steps = 8;
        const stepH = bp.height / steps;
        const stepD = bp.depth / steps;
        for (let i = 0; i < steps; i++) {
          const y = stepH * (i + 0.5);
          const z = bp.depth * 0.5 - stepD * (i + 0.5);
          group.add(this.makeBox(bp.width, stepH, stepD + 0.08, this.palette.plankOak, 0, y, z));
        }
        // Stringers
        for (const sx of [-bp.width * 0.46, bp.width * 0.46]) {
          const beam = this.makeBox(0.14, 0.24, Math.hypot(bp.depth, bp.height), this.palette.woodDark, sx, bp.height * 0.45, 0);
          beam.rotation.x = Math.atan2(bp.height, bp.depth);
          group.add(beam);
        }
        break;
      }

      case 'wooden-door':
      case 'reinforced-door': {
        const isIron = bp.id === 'reinforced-door';
        const jambMat = isIron ? this.palette.stoneBrick : this.palette.woodDark;
        const doorMat = isIron ? this.palette.iron : this.palette.woodWarm;
        const openingW = 1.28;
        const sideW = (bp.width - openingW) * 0.5;
        group.add(
          this.makeBox(sideW, bp.height, bp.depth, isIron ? this.palette.stone : this.palette.plankOak, -openingW * 0.5 - sideW * 0.5, bp.height * 0.5, 0),
          this.makeBox(sideW, bp.height, bp.depth, isIron ? this.palette.stone : this.palette.plankOak, openingW * 0.5 + sideW * 0.5, bp.height * 0.5, 0),
          this.makeBox(openingW + 0.2, 0.72, bp.depth + 0.04, jambMat, 0, bp.height - 0.36, 0),
          this.makeBox(0.12, 2.3, bp.depth + 0.08, jambMat, -openingW * 0.5, 1.15, 0),
          this.makeBox(0.12, 2.3, bp.depth + 0.08, jambMat, openingW * 0.5, 1.15, 0),
        );
        const pivot = new THREE.Group();
        pivot.position.set(-openingW * 0.5 + 0.06, 0, 0);
        const leaf = this.makeBox(openingW - 0.12, 2.24, 0.1, doorMat, (openingW - 0.12) * 0.5, 1.12, 0);
        const handle = this.makeBox(0.12, 0.18, 0.18, this.palette.iron, openingW - 0.26, 1.05, 0.06);
        pivot.add(leaf, handle);
        group.add(pivot);
        refs.doorPivot = pivot;
        break;
      }

      case 'timber-gate': {
        const postW = 0.28;
        const openingW = bp.width - postW * 2 - 1.0;
        const sideFenceW = 0.5;
        group.add(
          this.makeBox(sideFenceW, 1.2, 0.16, this.palette.woodWarm, -bp.width * 0.5 + sideFenceW * 0.5, 0.6, 0),
          this.makeBox(sideFenceW, 1.2, 0.16, this.palette.woodWarm, bp.width * 0.5 - sideFenceW * 0.5, 0.6, 0),
          this.makeBox(postW, 2.2, postW, this.palette.woodDark, -openingW * 0.5, 1.1, 0),
          this.makeBox(postW, 2.2, postW, this.palette.woodDark, openingW * 0.5, 1.1, 0),
          this.makeBox(openingW + 0.4, 0.22, 0.26, this.palette.woodDark, 0, 2.15, 0),
        );
        const pivot = new THREE.Group();
        pivot.position.set(-openingW * 0.5 + 0.1, 0, 0);
        const leafW = openingW - 0.2;
        pivot.add(
          this.makeBox(leafW, 0.18, 0.1, this.palette.woodWarm, leafW * 0.5, 0.45, 0),
          this.makeBox(leafW, 0.18, 0.1, this.palette.woodWarm, leafW * 0.5, 1.45, 0),
          this.makeBox(leafW * 0.9, 1.3, 0.08, this.palette.plankOak, leafW * 0.5, 0.95, 0),
          this.makeBox(0.16, 1.25, 0.14, this.palette.iron, leafW * 0.12, 0.95, 0),
        );
        group.add(pivot);
        refs.doorPivot = pivot;
        break;
      }

      case 'framed-window': {
        group.add(
          this.makeBox(bp.width, 0.95, bp.depth, this.palette.plankOak, 0, 0.475, 0),
          this.makeBox(bp.width, 0.95, bp.depth, this.palette.plankOak, 0, bp.height - 0.475, 0),
          this.makeBox(1.15, 1.15, bp.depth, this.palette.plankOak, -1.22, 1.5, 0),
          this.makeBox(1.15, 1.15, bp.depth, this.palette.plankOak, 1.22, 1.5, 0),
          this.makeBox(1.28, 1.08, 0.08, this.palette.windowGlow, 0, 1.5, 0),
          this.makeBox(1.36, 0.12, bp.depth + 0.14, this.palette.woodDark, 0, 0.96, 0),
          this.makeBox(1.36, 0.12, bp.depth + 0.1, this.palette.woodDark, 0, 2.04, 0),
          this.makeBox(0.1, 1.08, bp.depth + 0.06, this.palette.woodDark, 0, 1.5, 0),
        );
        break;
      }

      case 'small-house':
      case 'medium-house':
      case 'large-house':
      case 'log-cabin':
      case 'storage-building':
      case 'craft-workshop': {
        this.buildHouseStructure(bp, group, refs, isPreview);
        break;
      }

      case 'defensive-wall': {
        group.add(this.makeBox(bp.width, 2.2, bp.depth, this.palette.stone, 0, 0.55, 0));
        group.add(this.makeBox(bp.width, 1.4, bp.depth * 0.72, this.palette.woodDark, 0, 2.3, 0));
        group.add(this.makeBox(bp.width + 0.12, 0.18, bp.depth + 0.22, this.palette.plankOak, 0, 2.95, 0));
        for (let sx = -1.7; sx <= 1.71; sx += 0.85) {
          group.add(this.makeBox(0.42, 0.65, 0.24, this.palette.woodWarm, sx, 3.3, bp.depth * 0.34));
        }
        break;
      }

      case 'watchtower': {
        // Foundation stone plinth with underground skirt
        group.add(this.makeBox(bp.width, 2.1, bp.depth, this.palette.stoneBrick, 0, -0.45, 0));
        // Four corner pillars rising to platform
        const postH = 4.6;
        for (const [px, pz] of [
          [-1.65, -1.65],
          [1.65, -1.65],
          [-1.65, 1.65],
          [1.65, 1.65],
        ]) {
          group.add(this.makeBox(0.36, postH, 0.36, this.palette.woodDark, px, 0.6 + postH * 0.5, pz));
        }
        // Mid stone bastion walling (with front opening)
        group.add(
          this.makeBox(bp.width - 0.2, 2.4, 0.32, this.palette.stone, 0, 1.8, -1.7),
          this.makeBox(0.32, 2.4, bp.depth - 0.2, this.palette.stone, -1.7, 1.8, 0),
          this.makeBox(0.32, 2.4, bp.depth - 0.2, this.palette.stone, 1.7, 1.8, 0),
        );
        // Elevated platform & railings
        group.add(
          this.makeBox(bp.width + 0.3, 0.24, bp.depth + 0.3, this.palette.plankOak, 0, 4.9, 0),
          this.makeBox(bp.width + 0.3, 0.85, 0.16, this.palette.woodDark, 0, 5.4, -2.05),
          this.makeBox(bp.width + 0.3, 0.85, 0.16, this.palette.woodDark, 0, 5.4, 2.05),
          this.makeBox(0.16, 0.85, bp.depth + 0.3, this.palette.woodDark, -2.05, 5.4, 0),
          this.makeBox(0.16, 0.85, bp.depth + 0.3, this.palette.woodDark, 2.05, 5.4, 0),
        );
        // Roof canopy & lantern
        const roofCone = new THREE.Mesh(
          new THREE.ConeGeometry(3.2, 1.9, 4),
          this.palette.roofSlate,
        );
        roofCone.position.y = 6.9;
        roofCone.rotation.y = Math.PI * 0.25;
        roofCone.castShadow = true;
        this.disposables.push(roofCone.geometry);
        group.add(roofCone);
        const lantern = this.makeBox(0.32, 0.42, 0.32, this.palette.lanternGlow, 0, 5.85, 1.95, false);
        group.add(lantern);
        if (!isPreview) {
          const pt = new THREE.PointLight(0xffb454, 4.5, 18, 1.7);
          pt.position.set(0, 5.8, 2.2);
          group.add(pt);
          refs.lampLights = [pt];
        }
        break;
      }

      case 'wooden-chest':
      case 'reinforced-storage-box': {
        const isIron = bp.id === 'reinforced-storage-box';
        const bodyMat = isIron ? this.palette.plankOak : this.palette.woodWarm;
        const trimMat = isIron ? this.palette.iron : this.palette.woodDark;
        group.add(this.makeBox(bp.width, bp.height * 0.62, bp.depth, bodyMat, 0, bp.height * 0.31, 0));
        group.add(this.makeBox(bp.width + 0.05, 0.1, bp.depth + 0.05, trimMat, 0, 0.06, 0));
        const lidPivot = new THREE.Group();
        lidPivot.position.set(0, bp.height * 0.62, -bp.depth * 0.5);
        lidPivot.add(
          this.makeBox(bp.width + 0.04, bp.height * 0.35, bp.depth + 0.04, trimMat, 0, bp.height * 0.175, bp.depth * 0.5),
          this.makeBox(0.16, 0.18, 0.08, this.palette.iron, 0, 0.04, bp.depth + 0.03),
        );
        group.add(lidPivot);
        refs.chestLidPivot = lidPivot;
        break;
      }

      case 'build-workbench':
      case 'build-crafting-table': {
        const isTable = bp.id === 'build-crafting-table';
        group.add(this.makeBox(bp.width, 0.14, bp.depth, this.palette.plankOak, 0, 0.86, 0));
        for (const [lx, lz] of [
          [-bp.width * 0.42, -bp.depth * 0.38],
          [bp.width * 0.42, -bp.depth * 0.38],
          [-bp.width * 0.42, bp.depth * 0.38],
          [bp.width * 0.42, bp.depth * 0.38],
        ]) {
          group.add(this.makeBox(0.14, 0.84, 0.14, this.palette.woodDark, lx, 0.42, lz));
        }
        group.add(this.makeBox(bp.width * 0.85, 0.08, bp.depth * 0.72, this.palette.woodWarm, 0, 0.28, 0));
        if (isTable) {
          group.add(
            this.makeBox(0.42, 0.07, 0.26, this.palette.clothGreen, -0.35, 0.96, 0.08),
            this.makeBox(0.5, 0.06, 0.12, this.palette.iron, 0.28, 0.95, -0.1),
          );
        } else {
          group.add(this.makeBox(0.45, 0.12, 0.3, this.palette.iron, 0.45, 0.98, 0));
        }
        break;
      }

      case 'build-forge': {
        group.add(
          this.makeBox(1.5, 1.0, 1.3, this.palette.stone, -0.35, 0.5, -0.1),
          this.makeBox(0.85, 1.65, 0.85, this.palette.stoneBrick, -0.55, 1.15, -0.25),
          this.makeBox(0.72, 0.24, 0.6, this.palette.emberGlow, -0.1, 0.92, 0.15, false),
          // Anvil next to hearth
          this.makeBox(0.62, 0.52, 0.48, this.palette.woodDark, 0.72, 0.26, 0.18),
          this.makeBox(0.76, 0.26, 0.34, this.palette.iron, 0.72, 0.65, 0.18),
        );
        break;
      }

      case 'build-furnace': {
        const base = new THREE.Mesh(this.cylGeo(0.72, 0.86, 1.38, 8), this.palette.stone);
        base.position.y = 0.69;
        base.castShadow = true;
        base.receiveShadow = true;
        const chimney = new THREE.Mesh(this.cylGeo(0.36, 0.5, 1.05, 8), this.palette.stoneBrick);
        chimney.position.y = 1.85;
        chimney.castShadow = true;
        const glow = this.makeBox(0.52, 0.48, 0.22, this.palette.emberGlow, 0, 0.45, 0.68, false);
        group.add(base, chimney, glow);
        break;
      }

      case 'small-farm-plot':
      case 'large-farm-field': {
        const w = bp.width;
        const d = bp.depth;
        const soilMesh = this.makeBox(w - 0.22, 0.24, d - 0.22, this.palette.soil, 0, 0.12, 0, false);
        group.add(
          soilMesh,
          this.makeBox(w, 0.28, 0.18, this.palette.woodDark, 0, 0.14, d * 0.5 - 0.08),
          this.makeBox(w, 0.28, 0.18, this.palette.woodDark, 0, 0.14, -d * 0.5 + 0.08),
          this.makeBox(0.18, 0.28, d, this.palette.woodDark, -w * 0.5 + 0.08, 0.14, 0),
          this.makeBox(0.18, 0.28, d, this.palette.woodDark, w * 0.5 - 0.08, 0.14, 0),
        );
        refs.soilMesh = soilMesh;
        const stages: THREE.Group[] = [];
        const accentMeshes: THREE.Mesh[] = [];
        const cols = bp.id === 'large-farm-field' ? 4 : 2;
        const rows = bp.id === 'large-farm-field' ? 3 : 2;
        for (let st = 1; st <= 3; st++) {
          const stGroup = new THREE.Group();
          stGroup.visible = isPreview ? st === 3 : false;
          const h = st === 1 ? 0.18 : st === 2 ? 0.48 : 0.85;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cx = -w * 0.3 + (cols > 1 ? (c / (cols - 1)) * w * 0.6 : 0);
              const cz = -d * 0.3 + (rows > 1 ? (r / (rows - 1)) * d * 0.6 : 0);
              const mat = st === 3 ? this.palette.wheatGold : this.palette.cropSprout;
              const tuft = new THREE.Mesh(this.cylGeo(0.12 + st * 0.03, 0.18 + st * 0.03, h, 6), mat);
              tuft.position.set(cx, 0.2 + h * 0.5, cz);
              tuft.castShadow = st >= 2;
              stGroup.add(tuft);
              if (st === 3) {
                accentMeshes.push(tuft);
              }
            }
          }
          group.add(stGroup);
          stages.push(stGroup);
        }
        refs.cropStages = stages;
        refs.cropAccentMeshes = accentMeshes;
        break;
      }

      case 'farm-water-trough': {
        group.add(
          this.makeBox(1.86, 0.35, 1.24, this.palette.stone, 0, 0.175, 0),
          this.makeBox(1.64, 0.52, 0.96, this.palette.woodDark, 0, 0.56, 0.04),
          this.makeBox(1.44, 0.14, 0.76, this.palette.waterPool, 0, 0.78, 0.04, false),
          this.makeBox(0.16, 1.45, 0.16, this.palette.woodDark, -0.78, 0.725, -0.42),
          this.makeBox(0.16, 1.45, 0.16, this.palette.woodDark, 0.78, 0.725, -0.42),
          this.makeBox(1.76, 0.18, 0.24, this.palette.roofCedar, 0, 1.48, -0.42),
        );
        break;
      }

      case 'farm-chicken-coop': {
        const w = bp.width;
        const d = bp.depth;
        group.add(
          this.makeBox(w, 0.22, d, this.palette.stone, 0, 0.11, 0),
          this.makeBox(w - 0.3, 1.15, d - 0.3, this.palette.plankOak, 0, 0.78, -0.05),
          this.makeBox(0.42, 0.65, 0.12, this.palette.woodDark, 0, 0.54, d * 0.42),
          this.makeBox(w + 0.12, 0.16, d * 0.6, this.palette.roofCedar, 0, 1.54, -d * 0.22),
          this.makeBox(w + 0.12, 0.16, d * 0.6, this.palette.roofCedar, 0, 1.54, d * 0.22),
          this.makeBox(0.14, 0.75, 0.14, this.palette.woodDark, -w * 0.44, 0.4, d * 0.44),
          this.makeBox(0.14, 0.75, 0.14, this.palette.woodDark, w * 0.44, 0.4, d * 0.44),
        );
        break;
      }

      case 'farm-animal-pen': {
        const w = bp.width;
        const d = bp.depth;
        // Covered barn back shelter + fenced front paddock
        group.add(
          this.makeBox(w, 0.2, d * 0.45, this.palette.stone, 0, 0.1, -d * 0.25),
          this.makeBox(w * 0.92, 1.85, 0.24, this.palette.plankOak, 0, 1.0, -d * 0.46),
          this.makeBox(0.24, 1.85, d * 0.42, this.palette.plankOak, -w * 0.44, 1.0, -d * 0.26),
          this.makeBox(0.24, 1.85, d * 0.42, this.palette.plankOak, w * 0.44, 1.0, -d * 0.26),
          this.makeBox(w + 0.2, 0.18, d * 0.52, this.palette.roofCedar, 0, 2.08, -d * 0.24),
          // Fenced front yard + hay trough
          this.makeBox(0.18, 1.05, 0.18, this.palette.woodDark, -w * 0.46, 0.525, d * 0.44),
          this.makeBox(0.18, 1.05, 0.18, this.palette.woodDark, w * 0.46, 0.525, d * 0.44),
          this.makeBox(0.16, 0.95, d * 0.46, this.palette.woodWarm, -w * 0.46, 0.65, d * 0.22),
          this.makeBox(0.16, 0.95, d * 0.46, this.palette.woodWarm, w * 0.46, 0.65, d * 0.22),
          this.makeBox(w * 0.34, 0.12, 0.12, this.palette.woodWarm, -w * 0.29, 0.65, d * 0.44),
          this.makeBox(w * 0.34, 0.12, 0.12, this.palette.woodWarm, w * 0.29, 0.65, d * 0.44),
          this.makeBox(1.3, 0.34, 0.55, this.palette.wheatGold, -0.9, 0.22, 0.15),
        );
        break;
      }

      case 'farm-silo-shed': {
        const w = bp.width;
        const d = bp.depth;
        group.add(
          this.makeBox(w, 0.24, d, this.palette.stoneBrick, 0, 0.12, 0),
          this.makeBox(w - 0.16, 1.75, d - 0.16, this.palette.plankOak, 0, 1.1, 0),
          this.makeBox(0.85, 1.4, 0.16, this.palette.woodDark, 0, 0.92, d * 0.45),
          this.makeBox(w + 0.18, 0.18, d + 0.18, this.palette.roofTerracotta, 0, 2.08, 0),
          this.makeBox(w * 0.5, 0.35, d * 0.5, this.palette.roofTerracotta, 0, 2.32, 0),
        );
        break;
      }

      case 'wooden-fence': {
        group.add(
          this.makeBox(0.22, 1.15, 0.22, this.palette.woodDark, -bp.width * 0.44, 0.575, 0),
          this.makeBox(0.22, 1.15, 0.22, this.palette.woodDark, 0, 0.575, 0),
          this.makeBox(0.22, 1.15, 0.22, this.palette.woodDark, bp.width * 0.44, 0.575, 0),
          this.makeBox(bp.width, 0.14, 0.1, this.palette.woodWarm, 0, 0.42, 0),
          this.makeBox(bp.width, 0.14, 0.1, this.palette.woodWarm, 0, 0.88, 0),
        );
        break;
      }

      case 'oak-bed': {
        group.add(
          this.makeBox(1.22, 0.26, 2.06, this.palette.woodDark, 0, 0.22, 0),
          this.makeBox(1.22, 0.85, 0.16, this.palette.woodDark, 0, 0.425, -0.98),
          this.makeBox(1.1, 0.18, 1.88, this.palette.linen, 0, 0.38, 0.02),
          this.makeBox(1.12, 0.2, 1.32, this.palette.clothGreen, 0, 0.4, 0.3),
          this.makeBox(0.76, 0.14, 0.36, this.palette.linen, 0, 0.5, -0.68),
        );
        break;
      }

      case 'dining-table': {
        group.add(this.makeBox(bp.width, 0.12, bp.depth, this.palette.plankOak, 0, 0.78, 0));
        for (const [lx, lz] of [
          [-0.78, -0.4],
          [0.78, -0.4],
          [-0.78, 0.4],
          [0.78, 0.4],
        ]) {
          group.add(this.makeBox(0.12, 0.76, 0.12, this.palette.woodDark, lx, 0.38, lz));
        }
        break;
      }

      case 'wooden-chair': {
        group.add(
          this.makeBox(0.56, 0.08, 0.54, this.palette.plankOak, 0, 0.46, 0),
          this.makeBox(0.56, 0.54, 0.09, this.palette.woodDark, 0, 0.74, -0.23),
        );
        for (const [lx, lz] of [
          [-0.22, -0.22],
          [0.22, -0.22],
          [-0.22, 0.22],
          [0.22, 0.22],
        ]) {
          group.add(this.makeBox(0.08, 0.45, 0.08, this.palette.woodDark, lx, 0.225, lz));
        }
        break;
      }

      case 'lantern-post': {
        group.add(
          this.makeBox(0.45, 0.32, 0.45, this.palette.stone, 0, 0.16, 0),
          this.makeBox(0.18, 2.75, 0.18, this.palette.woodDark, 0, 1.38, 0),
          this.makeBox(0.16, 0.14, 0.62, this.palette.woodDark, 0, 2.65, 0.24),
          this.makeBox(0.28, 0.38, 0.28, this.palette.lanternGlow, 0, 2.38, 0.46, false),
          this.makeBox(0.34, 0.08, 0.34, this.palette.iron, 0, 2.58, 0.46),
        );
        if (!isPreview) {
          const light = new THREE.PointLight(0xffb84d, 5.2, 16, 1.7);
          light.position.set(0, 2.35, 0.48);
          group.add(light);
          refs.lampLights = [light];
        }
        break;
      }

      case 'storage-shelf': {
        group.add(
          this.makeBox(0.12, bp.height, bp.depth, this.palette.woodDark, -bp.width * 0.46, bp.height * 0.5, 0),
          this.makeBox(0.12, bp.height, bp.depth, this.palette.woodDark, bp.width * 0.46, bp.height * 0.5, 0),
        );
        for (const sy of [0.22, 0.88, 1.54]) {
          group.add(this.makeBox(bp.width, 0.08, bp.depth, this.palette.plankOak, 0, sy, 0));
        }
        group.add(
          this.makeBox(0.36, 0.24, 0.28, this.palette.linen, -0.35, 1.04, 0),
          this.makeBox(0.32, 0.28, 0.26, this.palette.clothGreen, 0.32, 1.72, 0),
        );
        break;
      }

      case 'stone-fireplace': {
        group.add(
          this.makeBox(bp.width, 0.32, bp.depth, this.palette.stoneBrick, 0, 0.16, 0),
          this.makeBox(0.38, 1.35, bp.depth * 0.9, this.palette.stone, -bp.width * 0.36, 0.85, 0),
          this.makeBox(0.38, 1.35, bp.depth * 0.9, this.palette.stone, bp.width * 0.36, 0.85, 0),
          this.makeBox(bp.width, 1.35, 0.32, this.palette.stone, 0, 0.85, -bp.depth * 0.34),
          this.makeBox(bp.width + 0.16, 0.24, bp.depth + 0.08, this.palette.woodDark, 0, 1.58, 0),
          this.makeBox(0.86, 1.3, 0.62, this.palette.stoneBrick, 0, 2.25, -0.14),
          this.makeBox(0.7, 0.36, 0.42, this.palette.emberGlow, 0, 0.42, 0.06, false),
        );
        break;
      }

      default: {
        const woa3d = bp.modelPath ? resolveExternalWoa3dModel(bp.modelPath) : undefined;
        if (woa3d) {
          const built = buildGroupFromWoa3dModel(woa3d, {
            categoryHint:
              bp.category === 'furniture' || bp.isDecorative ? 'decorations' : 'buildings',
          });
          group.add(built.group);
          this.disposables.push(...built.disposables);
        } else {
          group.add(
            this.makeBox(bp.width, bp.height, bp.depth, this.palette.plankOak, 0, bp.height * 0.5, 0),
          );
        }
        break;
      }
    }

    // Tag meshes with shadow flags & convert to preview tint if previewing
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (isPreview) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.material = this.palette.previewValidMat;
        } else {
          mesh.userData.__origCastShadow = mesh.castShadow;
          mesh.userData.__origReceiveShadow = mesh.receiveShadow;
          mesh.castShadow = Boolean(mesh.userData.__origCastShadow) && shadowsEnabled;
          mesh.receiveShadow = Boolean(mesh.userData.__origReceiveShadow) && shadowsEnabled;
        }
      }
    });

    return refs;
  }

  private buildHouseStructure(
    bp: BuildingBlueprint,
    group: THREE.Group,
    refs: BuiltStructureMeshRefs,
    isPreview: boolean,
  ): void {
    const w = bp.width;
    const d = bp.depth;
    const wh = bp.wallHeight ?? 2.8;
    const rh = bp.roofHeight ?? 2.2;
    const wallThick = 0.28;

    const wallMat =
      bp.id === 'log-cabin'
        ? this.palette.woodWarm
        : bp.id === 'large-house'
          ? this.palette.plasterCream
          : bp.id === 'medium-house'
            ? this.palette.plasterCream
            : this.palette.plankOak;

    const roofMat =
      bp.id === 'medium-house'
        ? this.palette.roofTerracotta
        : bp.id === 'large-house' || bp.id === 'craft-workshop'
          ? this.palette.roofSlate
          : this.palette.roofCedar;

    // 1. Stone Foundation Plinth extending -1.6m into terrain so zero gaps appear on slopes
    group.add(this.makeBox(w + 0.24, 1.98, d + 0.24, this.palette.stone, 0, -0.64, 0));
    group.add(this.makeBox(w - 0.1, 0.14, d - 0.1, this.palette.plankOak, 0, 0.36, 0));

    // 2. Back & Side Walls (full height)
    group.add(
      this.makeBox(w, wh, wallThick, wallMat, 0, 0.35 + wh * 0.5, -d * 0.5 + wallThick * 0.5),
      this.makeBox(wallThick, wh, d - wallThick * 2, wallMat, -w * 0.5 + wallThick * 0.5, 0.35 + wh * 0.5, 0),
      this.makeBox(wallThick, wh, d - wallThick * 2, wallMat, w * 0.5 - wallThick * 0.5, 0.35 + wh * 0.5, 0),
    );

    // 3. Front Wall with centered doorway opening
    const doorW = bp.doorOffset ? bp.doorOffset.halfW * 2 : 1.32;
    const doorH = bp.doorOffset ? bp.doorOffset.height : 2.2;
    const frontLeftW = Math.max(0.5, (w - doorW) * 0.5);
    const frontZ = d * 0.5 - wallThick * 0.5;
    group.add(
      this.makeBox(frontLeftW, wh, wallThick, wallMat, -doorW * 0.5 - frontLeftW * 0.5, 0.35 + wh * 0.5, frontZ),
      this.makeBox(frontLeftW, wh, wallThick, wallMat, doorW * 0.5 + frontLeftW * 0.5, 0.35 + wh * 0.5, frontZ),
      this.makeBox(doorW + 0.16, Math.max(0.35, wh - doorH), wallThick, wallMat, 0, 0.35 + doorH + (wh - doorH) * 0.5, frontZ),
    );

    // Corner Timber Framing Posts
    for (const [cx, cz] of [
      [-w * 0.5, -d * 0.5],
      [w * 0.5, -d * 0.5],
      [-w * 0.5, d * 0.5],
      [w * 0.5, d * 0.5],
    ]) {
      group.add(this.makeBox(0.24, wh + 0.12, 0.24, this.palette.woodDark, cx, 0.35 + wh * 0.5, cz));
    }

    // 4. Side Luminous Windows
    for (const sx of [-w * 0.5 - 0.02, w * 0.5 + 0.02]) {
      group.add(this.makeBox(0.08, 0.85, 1.05, this.palette.windowGlow, sx, 1.75, 0, false));
      group.add(this.makeBox(0.12, 0.96, 1.16, this.palette.woodDark, sx, 1.75, 0));
    }

    // 5. Complete Gap-Free Gable Roof with solid gable triangles and generous eaves
    const eaves = 0.42;
    const roofW = w + eaves * 2;
    const roofD = d + eaves * 2;
    const slopeLen = Math.hypot(roofW * 0.5 + 0.12, rh);
    const roofAngle = Math.atan2(rh, roofW * 0.5);
    const roofBaseY = 0.35 + wh;

    const leftRoof = this.makeBox(slopeLen, 0.18, roofD, roofMat, -roofW * 0.25, roofBaseY + rh * 0.5, 0);
    leftRoof.rotation.z = roofAngle;
    const rightRoof = this.makeBox(slopeLen, 0.18, roofD, roofMat, roofW * 0.25, roofBaseY + rh * 0.5, 0);
    rightRoof.rotation.z = -roofAngle;

    const gableFill = new THREE.Mesh(this.gableGeo(w, rh, d), wallMat);
    gableFill.position.set(0, roofBaseY, 0);
    gableFill.castShadow = true;
    gableFill.receiveShadow = true;

    const ridgeBeam = this.makeBox(0.24, 0.24, roofD + 0.1, this.palette.woodDark, 0, roofBaseY + rh + 0.04, 0);
    group.add(leftRoof, rightRoof, gableFill, ridgeBeam);

    // Ceiling joists visible inside
    for (const cz of [-d * 0.28, 0, d * 0.28]) {
      group.add(this.makeBox(w - 0.2, 0.16, 0.18, this.palette.woodDark, 0, roofBaseY - 0.06, cz));
    }

    // 6. Chimney on medium / large house & cabin
    if (bp.id === 'medium-house' || bp.id === 'large-house' || bp.id === 'log-cabin') {
      group.add(
        this.makeBox(0.85, wh + rh + 1.25, 0.85, this.palette.stoneBrick, w * 0.32, (wh + rh + 1.25) * 0.5, -d * 0.22),
      );
    }

    // 7. Hinged Door Leaf (starts CLOSED at rotation.y = 0)
    if (bp.hasDoor) {
      const leafW = doorW - 0.1;
      const leafH = doorH - 0.08;
      const doorMat = bp.tier === 'reinforced' ? this.palette.iron : this.palette.woodDark;
      const pivot = new THREE.Group();
      pivot.position.set(-doorW * 0.5 + 0.05, 0.36, frontZ);
      pivot.add(
        this.makeBox(leafW, leafH, 0.1, doorMat, leafW * 0.5, leafH * 0.5, 0),
        this.makeBox(0.1, 0.16, 0.18, this.palette.iron, leafW - 0.14, leafH * 0.46, 0.06),
      );
      group.add(pivot);
      refs.doorPivot = pivot;
    }

    // 8. Front Entry Step & Lantern
    group.add(
      this.makeBox(doorW + 0.7, 0.24, 0.72, this.palette.stone, 0, 0.14, d * 0.5 + 0.34),
      this.makeBox(0.24, 0.32, 0.24, this.palette.lanternGlow, doorW * 0.5 + 0.32, 2.25, d * 0.5 + 0.14, false),
    );
    if (!isPreview && (bp.id === 'large-house' || bp.id === 'craft-workshop')) {
      const pt = new THREE.PointLight(0xffb454, 4.2, 14, 1.7);
      pt.position.set(doorW * 0.5 + 0.32, 2.25, d * 0.5 + 0.35);
      group.add(pt);
      refs.lampLights = [pt];
    }

    // 9. Functional Interior Props for Storage Building & Craft Workshop
    if (bp.id === 'storage-building') {
      const chest = this.makeBox(1.5, 0.85, 0.85, this.palette.woodWarm, 0, 0.78, -1.0);
      const band = this.makeBox(1.54, 0.14, 0.88, this.palette.iron, 0, 1.14, -1.0);
      group.add(chest, band);
    } else if (bp.id === 'craft-workshop') {
      const bench = this.makeBox(1.75, 0.85, 0.9, this.palette.plankOak, -1.35, 0.78, -0.85);
      const anvil = this.makeBox(0.6, 0.55, 0.42, this.palette.iron, 1.4, 0.64, -0.75);
      group.add(bench, anvil);
    }
  }

  private readonly outlineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0.08, -0.5),
    new THREE.Vector3(0.5, 0.08, -0.5),
    new THREE.Vector3(0.5, 0.08, 0.5),
    new THREE.Vector3(-0.5, 0.08, 0.5),
    new THREE.Vector3(-0.5, 0.08, -0.5),
  ]);
  private readonly outlineValidMat = new THREE.LineBasicMaterial({ color: 0x38d97c });
  private readonly outlineInvalidMat = new THREE.LineBasicMaterial({ color: 0xef4444 });

  public createPreviewGroup(bp: BuildingBlueprint): THREE.Group {
    const refs = this.buildStructure(bp, false, true);
    const borderLine = new THREE.Line(this.outlineGeo, this.outlineValidMat);
    borderLine.scale.set(bp.width, 1, bp.depth);
    borderLine.name = 'PreviewFootprintOutline';
    refs.group.add(borderLine);
    return refs.group;
  }

  public applyPreviewTint(group: THREE.Group, valid: boolean): void {
    const targetMat = valid ? this.palette.previewValidMat : this.palette.previewInvalidMat;
    const targetLineMat = valid ? this.outlineValidMat : this.outlineInvalidMat;
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.material !== targetMat) {
          mesh.material = targetMat;
        }
      } else if ((obj as THREE.Line).isLine) {
        const line = obj as THREE.Line;
        if (line.material !== targetLineMat) {
          line.material = targetLineMat;
        }
      }
    });
  }

  public dispose(): void {
    this.outlineGeo.dispose();
    this.outlineValidMat.dispose();
    this.outlineInvalidMat.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.geoCache.clear();
  }
}
