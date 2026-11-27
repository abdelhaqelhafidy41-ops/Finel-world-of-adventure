import * as THREE from 'three';
import type { Woa3dModelDescriptor } from './modTypes';

type Woa3dModelLookup = (modelRefOrId: string) => Woa3dModelDescriptor | undefined;

let externalModelResolver: Woa3dModelLookup | null = null;

export function setExternalWoa3dModelProvider(provider: Woa3dModelLookup | null): void {
  externalModelResolver = provider;
}

export function resolveExternalWoa3dModel(
  modelRefOrId: string | undefined,
): Woa3dModelDescriptor | undefined {
  if (!modelRefOrId || !externalModelResolver) return undefined;
  return externalModelResolver(modelRefOrId);
}

export interface BuiltWoa3dModelResult {
  group: THREE.Group;
  disposables: Array<{ dispose: () => void }>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function parseColorNumber(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/^#/, '').replace(/^0x/i, '');
    const parsed = Number.parseInt(cleaned, 16);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseVec3(
  raw: unknown,
  defaultVal: [number, number, number],
): [number, number, number] {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return [raw, raw, raw];
  }
  if (Array.isArray(raw)) {
    return [
      typeof raw[0] === 'number' && Number.isFinite(raw[0]) ? raw[0] : defaultVal[0],
      typeof raw[1] === 'number' && Number.isFinite(raw[1]) ? raw[1] : defaultVal[1],
      typeof raw[2] === 'number' && Number.isFinite(raw[2]) ? raw[2] : defaultVal[2],
    ];
  }
  if (isRecord(raw)) {
    return [
      typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : defaultVal[0],
      typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : defaultVal[1],
      typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : defaultVal[2],
    ];
  }
  return defaultVal;
}

function parsePartRotation(part: Record<string, unknown>): [number, number, number] {
  if (isRecord(part.rotationDeg) || Array.isArray(part.rotationDeg)) {
    const deg = parseVec3(part.rotationDeg, [0, 0, 0]);
    const k = Math.PI / 180;
    return [deg[0] * k, deg[1] * k, deg[2] * k];
  }
  const vec = parseVec3(part.rotation, [0, 0, 0]);
  const unit =
    typeof part.rotationUnit === 'string' ? part.rotationUnit.trim().toLowerCase() : 'radians';
  if (unit === 'deg' || unit === 'degree' || unit === 'degrees') {
    const k = Math.PI / 180;
    return [vec[0] * k, vec[1] * k, vec[2] * k];
  }
  return vec;
}

function createPrimitiveGeometry(part: Record<string, unknown>): THREE.BufferGeometry {
  const shape = String(
    part.shape ?? part.type ?? part.primitive ?? part.geometryType ?? 'box',
  )
    .trim()
    .toLowerCase();

  const sizeArr = parseVec3(part.size ?? part.dimensions, [
    typeof part.width === 'number' ? part.width : 0.4,
    typeof part.height === 'number' ? part.height : 0.4,
    typeof part.depth === 'number' ? part.depth : 0.4,
  ]);
  const sx = Math.max(0.01, sizeArr[0]);
  const sy = Math.max(0.01, sizeArr[1]);
  const sz = Math.max(0.01, sizeArr[2]);

  if (shape === 'cylinder' || shape === 'tube') {
    const rTop =
      typeof part.radiusTop === 'number' && part.radiusTop >= 0
        ? part.radiusTop
        : typeof part.radius === 'number' && part.radius > 0
          ? part.radius
          : Math.max(sx, sz) * 0.5;
    const rBottom =
      typeof part.radiusBottom === 'number' && part.radiusBottom >= 0
        ? part.radiusBottom
        : rTop;
    const segs =
      typeof part.segments === 'number' && part.segments >= 3
        ? Math.min(32, Math.trunc(part.segments))
        : 10;
    return new THREE.CylinderGeometry(rTop, rBottom, sy, segs);
  }

  if (shape === 'sphere' || shape === 'orb' || shape === 'ball') {
    const r =
      typeof part.radius === 'number' && part.radius > 0
        ? part.radius
        : Math.max(sx, sy, sz) * 0.5;
    const segs =
      typeof part.segments === 'number' && part.segments >= 4
        ? Math.min(24, Math.trunc(part.segments))
        : 12;
    return new THREE.SphereGeometry(r, segs, Math.max(6, Math.trunc(segs * 0.75)));
  }

  if (shape === 'cone' || shape === 'pyramid' || shape === 'spike') {
    const r =
      typeof part.radius === 'number' && part.radius > 0
        ? part.radius
        : Math.max(sx, sz) * 0.5;
    const radial = shape === 'pyramid' ? 4 : 8;
    return new THREE.ConeGeometry(r, sy, radial);
  }

  if (shape === 'capsule') {
    const r =
      typeof part.radius === 'number' && part.radius > 0
        ? part.radius
        : Math.min(sx, sz) * 0.45;
    const len = Math.max(0.02, sy - r * 2);
    return new THREE.CapsuleGeometry(r, len, 4, 8);
  }

  if (shape === 'torus' || shape === 'ring') {
    const r =
      typeof part.radius === 'number' && part.radius > 0
        ? part.radius
        : Math.max(sx, sy) * 0.42;
    const tube =
      typeof part.tube === 'number' && part.tube > 0 ? part.tube : r * 0.24;
    return new THREE.TorusGeometry(r, tube, 8, 18);
  }

  if (shape === 'octahedron' || shape === 'crystal' || shape === 'gem') {
    const r =
      typeof part.radius === 'number' && part.radius > 0
        ? part.radius
        : Math.max(sx, sy, sz) * 0.5;
    return new THREE.OctahedronGeometry(r, 0);
  }

  if (shape === 'plane' || shape === 'quad') {
    return new THREE.PlaneGeometry(sx, sy);
  }

  return new THREE.BoxGeometry(sx, sy, sz);
}

function buildCustomBufferGeometry(rawGeo: Record<string, unknown>): THREE.BufferGeometry | null {
  const posArr = Array.isArray(rawGeo.positions)
    ? rawGeo.positions
    : Array.isArray(rawGeo.vertices)
      ? rawGeo.vertices
      : null;
  if (!posArr || posArr.length < 9) return null;

  const flatPositions: number[] = [];
  for (const item of posArr) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      flatPositions.push(item);
    } else if (Array.isArray(item) && item.length >= 3) {
      flatPositions.push(Number(item[0]) || 0, Number(item[1]) || 0, Number(item[2]) || 0);
    }
  }
  if (flatPositions.length < 9) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(flatPositions, 3));

  if (Array.isArray(rawGeo.indices) && rawGeo.indices.length >= 3) {
    const cleanIdx = rawGeo.indices
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      .map((n) => Math.trunc(n));
    if (cleanIdx.length >= 3) {
      geo.setIndex(cleanIdx);
    }
  }

  if (Array.isArray(rawGeo.normals) && rawGeo.normals.length >= 3) {
    const flatNormals: number[] = [];
    for (const item of rawGeo.normals) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        flatNormals.push(item);
      } else if (Array.isArray(item) && item.length >= 3) {
        flatNormals.push(Number(item[0]) || 0, Number(item[1]) || 1, Number(item[2]) || 0);
      }
    }
    if (flatNormals.length === flatPositions.length) {
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(flatNormals, 3));
    } else {
      geo.computeVertexNormals();
    }
  } else {
    geo.computeVertexNormals();
  }

  if (Array.isArray(rawGeo.uvs) && rawGeo.uvs.length >= 2) {
    const flatUvs: number[] = [];
    for (const item of rawGeo.uvs) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        flatUvs.push(item);
      } else if (Array.isArray(item) && item.length >= 2) {
        flatUvs.push(Number(item[0]) || 0, Number(item[1]) || 0);
      }
    }
    if (flatUvs.length > 0) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(flatUvs, 2));
    }
  }

  return geo;
}

export function buildGroupFromWoa3dModel(
  model: Woa3dModelDescriptor | undefined,
  options?: {
    categoryHint?: string;
    fallbackColor?: number;
  },
): BuiltWoa3dModelResult {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  if (model) {
    group.name = `woa3d:${model.id}`;
    group.userData.woa3dModelId = model.id;
    group.userData.woa3dPath = model.relativePath;
  }

  const raw = model?.raw;
  if (raw) {
    const partsSource = Array.isArray(raw.parts)
      ? raw.parts
      : Array.isArray(raw.meshes)
        ? raw.meshes
        : Array.isArray(raw.primitives)
          ? raw.primitives
          : Array.isArray(raw.elements)
            ? raw.elements
            : null;

    if (partsSource && partsSource.length > 0) {
      for (const rawPart of partsSource) {
        if (!isRecord(rawPart)) continue;
        const geo = isRecord(rawPart.geometry)
          ? buildCustomBufferGeometry(rawPart.geometry) ?? createPrimitiveGeometry(rawPart)
          : createPrimitiveGeometry(rawPart);
        const color = parseColorNumber(
          rawPart.color ?? rawPart.hex ?? raw.primaryColor,
          options?.fallbackColor ?? 0xd7e3ef,
        );
        const emissive = parseColorNumber(rawPart.emissive ?? raw.emissive, 0x000000);
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive,
          emissiveIntensity:
            typeof rawPart.emissiveIntensity === 'number'
              ? rawPart.emissiveIntensity
              : emissive !== 0
                ? 0.45
                : 0,
          metalness:
            typeof rawPart.metalness === 'number'
              ? Math.max(0, Math.min(1, rawPart.metalness))
              : 0.35,
          roughness:
            typeof rawPart.roughness === 'number'
              ? Math.max(0.05, Math.min(1, rawPart.roughness))
              : 0.48,
          ...(typeof rawPart.opacity === 'number' && rawPart.opacity < 1
            ? { transparent: true, opacity: Math.max(0.05, rawPart.opacity) }
            : {}),
        });
        const mesh = new THREE.Mesh(geo, mat);
        const pos = parseVec3(rawPart.position ?? rawPart.offset, [0, 0, 0]);
        const rot = parsePartRotation(rawPart);
        const scale = parseVec3(rawPart.scale, [1, 1, 1]);
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.scale.set(
          Math.max(0.001, scale[0]),
          Math.max(0.001, scale[1]),
          Math.max(0.001, scale[2]),
        );
        mesh.castShadow = rawPart.castShadow !== false;
        mesh.receiveShadow = rawPart.receiveShadow !== false;
        group.add(mesh);
        disposables.push(geo, mat);
      }
    } else if (isRecord(raw.geometry)) {
      const geo = buildCustomBufferGeometry(raw.geometry);
      if (geo) {
        const color = parseColorNumber(raw.color ?? raw.primaryColor, options?.fallbackColor ?? 0xd7e3ef);
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.45,
          metalness: 0.35,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        disposables.push(geo, mat);
      }
    }

    if (group.children.length > 0) {
      const rootScale = parseVec3(raw.scale, [1, 1, 1]);
      group.scale.set(
        Math.max(0.001, rootScale[0]),
        Math.max(0.001, rootScale[1]),
        Math.max(0.001, rootScale[2]),
      );
      return { group, disposables };
    }
  }

  // Stylized category fallback when .woa3d contains metadata without explicit mesh primitives
  const category = (model?.canonicalCategory ?? options?.categoryHint ?? 'models').toLowerCase();
  const accentColor = parseColorNumber(raw?.color ?? raw?.primaryColor, options?.fallbackColor ?? 0x7cb8ff);

  if (category === 'weapons' || category === 'tools') {
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x4c3222, roughness: 0.72, metalness: 0.1 });
    const metalMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.18,
      roughness: 0.25,
      metalness: 0.85,
    });
    const gripGeo = new THREE.CylinderGeometry(0.026, 0.028, 0.22, 8);
    gripGeo.rotateX(Math.PI * 0.5);
    const guardGeo = new THREE.BoxGeometry(0.22, 0.04, 0.045);
    const bladeGeo = new THREE.BoxGeometry(0.07, 0.022, 0.78);
    const tipGeo = new THREE.ConeGeometry(0.048, 0.16, 4);
    tipGeo.rotateX(Math.PI * 0.5);

    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, 0, 0.02);
    const guard = new THREE.Mesh(guardGeo, metalMat);
    guard.position.set(0, 0, 0.13);
    const blade = new THREE.Mesh(bladeGeo, metalMat);
    blade.position.set(0, 0, 0.54);
    blade.castShadow = true;
    const tip = new THREE.Mesh(tipGeo, metalMat);
    tip.position.set(0, 0, 1.0);
    tip.castShadow = true;

    group.add(grip, guard, blade, tip);
    disposables.push(gripMat, metalMat, gripGeo, guardGeo, bladeGeo, tipGeo);
    return { group, disposables };
  }

  if (category === 'decorations' || category === 'buildings') {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.85, metalness: 0.12 });
    const topMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.15,
      roughness: 0.4,
      metalness: 0.45,
    });
    const baseGeo = new THREE.BoxGeometry(1.1, 0.45, 1.1);
    const pillarGeo = new THREE.CylinderGeometry(0.32, 0.42, 1.1, 8);
    const crownGeo = new THREE.OctahedronGeometry(0.38, 0);

    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, 0.225, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    const pillar = new THREE.Mesh(pillarGeo, baseMat);
    pillar.position.set(0, 0.95, 0);
    pillar.castShadow = true;
    const crown = new THREE.Mesh(crownGeo, topMat);
    crown.position.set(0, 1.75, 0);
    crown.castShadow = true;

    group.add(base, pillar, crown);
    disposables.push(baseMat, topMat, baseGeo, pillarGeo, crownGeo);
    return { group, disposables };
  }

  const crystalMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.22,
    roughness: 0.3,
    metalness: 0.4,
  });
  const crystalGeo = new THREE.OctahedronGeometry(0.28, 0);
  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.castShadow = true;
  group.add(crystal);
  disposables.push(crystalMat, crystalGeo);
  return { group, disposables };
}
