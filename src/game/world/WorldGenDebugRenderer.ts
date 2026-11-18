import * as THREE from 'three';
import { groundHeightAt } from '../math/noise';
import type { BuildingValidationReport } from './BuildingValidator';
import type { VillageSiteRecord } from './VillageManager';
import type { WorldInteractable } from './WorldManager';
import type { WorldGenTelemetry } from './WorldPlacementValidator';

interface DisposableEntry {
  dispose: () => void;
}

/**
 * Dev-only 3D world generation overlay showing village centers, footprint radii,
 * active resource spawns, rejected markers, and building validation bounds/colliders.
 */
export class WorldGenDebugRenderer {
  private readonly root = new THREE.Group();
  private readonly disposables: DisposableEntry[] = [];
  private visible = false;
  private built = false;

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'WorldGenDebugRoot';
    this.root.visible = false;
    this.scene.add(this.root);
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public isBuilt(): boolean {
    return this.built;
  }

  public setVisible(enabled: boolean): void {
    this.visible = enabled;
    this.root.visible = enabled;
  }

  public clear(): void {
    while (this.root.children.length > 0) {
      this.root.remove(this.root.children[0]);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.built = false;
  }

  public rebuild(
    villages: readonly VillageSiteRecord[],
    interactables: readonly WorldInteractable[],
    telemetry: WorldGenTelemetry,
    buildingReports: readonly BuildingValidationReport[] = [],
  ): void {
    this.clear();

    // Shared geometries & materials
    const pillarGeo = new THREE.CylinderGeometry(0.45, 0.45, 28, 8);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xf0c24b,
      transparent: true,
      opacity: 0.85,
    });
    const procPillarMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
    });
    const curatedRingMat = new THREE.LineBasicMaterial({
      color: 0xf0c24b,
      transparent: true,
      opacity: 0.72,
    });
    const resDotGeo = new THREE.SphereGeometry(0.48, 6, 5);
    const resDotMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    const rejVillageGeo = new THREE.OctahedronGeometry(1.4, 0);
    const rejVillageMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const rejResGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    const rejResMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });

    // Building validation shared assets
    const unitBoxBaseGeo = new THREE.BoxGeometry(1, 1, 1);
    const unitEdgesGeo = new THREE.EdgesGeometry(unitBoxBaseGeo);
    unitBoxBaseGeo.dispose();

    const validBoxMat = new THREE.LineBasicMaterial({ color: 0x22c55e });
    const warnBoxMat = new THREE.LineBasicMaterial({ color: 0xeab308 });
    const invalidBoxMat = new THREE.LineBasicMaterial({ color: 0xef4444 });
    const roofValidMat = new THREE.LineBasicMaterial({ color: 0x4ade80 });
    const roofWarnMat = new THREE.LineBasicMaterial({ color: 0xfacc15 });
    const roofInvalidMat = new THREE.LineBasicMaterial({ color: 0xf87171 });
    const wallColliderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    const floorColliderMat = new THREE.LineBasicMaterial({ color: 0x10b981 });
    const roofColliderMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
    const pathLineMat = new THREE.LineBasicMaterial({ color: 0xe0f2fe });

    const markerGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const doorMarkerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const entryMarkerMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const thresholdMarkerMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    this.disposables.push(
      pillarGeo,
      pillarMat,
      procPillarMat,
      ringMat,
      curatedRingMat,
      resDotGeo,
      resDotMat,
      rejVillageGeo,
      rejVillageMat,
      rejResGeo,
      rejResMat,
      unitEdgesGeo,
      validBoxMat,
      warnBoxMat,
      invalidBoxMat,
      roofValidMat,
      roofWarnMat,
      roofInvalidMat,
      wallColliderMat,
      floorColliderMat,
      roofColliderMat,
      pathLineMat,
      markerGeo,
      doorMarkerMat,
      entryMarkerMat,
      thresholdMarkerMat,
    );

    const circleSegments = 40;
    const circlePts: THREE.Vector3[] = [];
    for (let i = 0; i <= circleSegments; i++) {
      const a = (i / circleSegments) * Math.PI * 2;
      circlePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const unitCircleGeo = new THREE.BufferGeometry().setFromPoints(circlePts);
    this.disposables.push(unitCircleGeo);

    // 1. Village centers, footprint rings, and text sprites
    for (const v of villages) {
      const cy = groundHeightAt(v.centerX, v.centerZ);
      const pillar = new THREE.Mesh(
        pillarGeo,
        v.isProcedural ? procPillarMat : pillarMat,
      );
      pillar.position.set(v.centerX, cy + 14, v.centerZ);
      this.root.add(pillar);

      const ring = new THREE.LineLoop(
        unitCircleGeo,
        v.isProcedural ? ringMat : curatedRingMat,
      );
      const rad = Math.max(24, v.clearanceRadius);
      ring.scale.set(rad, 1, rad);
      ring.position.set(v.centerX, cy + 1.2, v.centerZ);
      this.root.add(ring);

      const labelSprite = this.createLabelSprite(
        `${v.name} [${v.kind}]`,
        v.isProcedural ? '#7dd3fc' : '#fde68a',
      );
      labelSprite.position.set(v.centerX, cy + 31, v.centerZ);
      this.root.add(labelSprite);
    }

    // 2. Resource node dots (instanced for minimal draw calls)
    const activeResources = interactables.filter(
      (item) => item.kind === 'resource' && !item.collected,
    );
    if (activeResources.length > 0) {
      const resInst = new THREE.InstancedMesh(
        resDotGeo,
        resDotMat,
        activeResources.length,
      );
      const dummy = new THREE.Object3D();
      for (let i = 0; i < activeResources.length; i++) {
        const r = activeResources[i];
        dummy.position.set(r.x, r.y + 3.2, r.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        resInst.setMatrixAt(i, dummy.matrix);
      }
      resInst.instanceMatrix.needsUpdate = true;
      resInst.frustumCulled = false;
      this.root.add(resInst);
    }

    // 3. Rejected village candidate markers
    if (telemetry.rejectedVillageSamples.length > 0) {
      const rejInst = new THREE.InstancedMesh(
        rejVillageGeo,
        rejVillageMat,
        telemetry.rejectedVillageSamples.length,
      );
      const dummy = new THREE.Object3D();
      for (let i = 0; i < telemetry.rejectedVillageSamples.length; i++) {
        const sample = telemetry.rejectedVillageSamples[i];
        const sy = Math.max(groundHeightAt(sample.x, sample.z), 0);
        dummy.position.set(sample.x, sy + 5.0, sample.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rejInst.setMatrixAt(i, dummy.matrix);
      }
      rejInst.instanceMatrix.needsUpdate = true;
      rejInst.frustumCulled = false;
      this.root.add(rejInst);
    }

    // 4. Rejected resource spawn markers
    if (telemetry.rejectedResourceSamples.length > 0) {
      const rejResInst = new THREE.InstancedMesh(
        rejResGeo,
        rejResMat,
        telemetry.rejectedResourceSamples.length,
      );
      const dummy = new THREE.Object3D();
      for (let i = 0; i < telemetry.rejectedResourceSamples.length; i++) {
        const sample = telemetry.rejectedResourceSamples[i];
        const sy = Math.max(groundHeightAt(sample.x, sample.z), 0);
        dummy.position.set(sample.x, sy + 3.5, sample.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rejResInst.setMatrixAt(i, dummy.matrix);
      }
      rejResInst.instanceMatrix.needsUpdate = true;
      rejResInst.frustumCulled = false;
      this.root.add(rejResInst);
    }

    // 5. Developer Building Validation Bounds (green = valid, yellow = warning, red = invalid)
    for (let i = 0; i < buildingReports.length; i++) {
      const rep = buildingReports[i];
      const dbg = rep.debug;
      const bodyMat =
        rep.status === 'invalid'
          ? invalidBoxMat
          : rep.status === 'warning'
            ? warnBoxMat
            : validBoxMat;
      const roofMat =
        rep.status === 'invalid'
          ? roofInvalidMat
          : rep.status === 'warning'
            ? roofWarnMat
            : roofValidMat;

      // 5a. Building wall/footprint wireframe bounds
      const wallBox = new THREE.LineSegments(unitEdgesGeo, bodyMat);
      wallBox.scale.set(dbg.width, dbg.wallHeight, dbg.depth);
      wallBox.position.set(dbg.cx, dbg.anchorY + dbg.wallHeight * 0.5, dbg.cz);
      wallBox.rotation.y = dbg.yaw;
      this.root.add(wallBox);

      // 5b. Roof coverage wireframe bounds
      const roofSpanY = Math.max(0.25, dbg.roofMaxLocalY - dbg.roofMinLocalY);
      const roofMidY = (dbg.roofMinLocalY + dbg.roofMaxLocalY) * 0.5;
      const roofBox = new THREE.LineSegments(unitEdgesGeo, roofMat);
      roofBox.scale.set(dbg.roofWidth, roofSpanY, dbg.roofDepth);
      roofBox.position.set(dbg.cx, dbg.anchorY + roofMidY, dbg.cz);
      roofBox.rotation.y = dbg.yaw;
      this.root.add(roofBox);

      // 5c. Door, exterior entrance, and interior threshold markers + connector line
      const doorDot = new THREE.Mesh(markerGeo, doorMarkerMat);
      doorDot.position.set(dbg.doorWorldPos.x, dbg.doorWorldPos.y + 1.0, dbg.doorWorldPos.z);
      this.root.add(doorDot);

      const entryDot = new THREE.Mesh(markerGeo, entryMarkerMat);
      entryDot.position.set(
        dbg.doorEntryWorldPos.x,
        dbg.doorEntryWorldPos.y + 0.65,
        dbg.doorEntryWorldPos.z,
      );
      this.root.add(entryDot);

      const thresholdDot = new THREE.Mesh(markerGeo, thresholdMarkerMat);
      thresholdDot.position.set(
        dbg.doorThresholdWorldPos.x,
        dbg.doorThresholdWorldPos.y + 0.65,
        dbg.doorThresholdWorldPos.z,
      );
      this.root.add(thresholdDot);

      const doorPathGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(
          dbg.doorEntryWorldPos.x,
          dbg.doorEntryWorldPos.y + 0.65,
          dbg.doorEntryWorldPos.z,
        ),
        new THREE.Vector3(
          dbg.doorWorldPos.x,
          dbg.doorWorldPos.y + 1.0,
          dbg.doorWorldPos.z,
        ),
        new THREE.Vector3(
          dbg.doorThresholdWorldPos.x,
          dbg.doorThresholdWorldPos.y + 0.65,
          dbg.doorThresholdWorldPos.z,
        ),
      ]);
      this.disposables.push(doorPathGeo);
      const doorPathLine = new THREE.Line(doorPathGeo, pathLineMat);
      this.root.add(doorPathLine);

      // 5d. Building BoxColliders (walls, floor, roof)
      for (let c = 0; c < dbg.colliders.length; c++) {
        const col = dbg.colliders[c];
        const colMat =
          rep.status === 'invalid'
            ? invalidBoxMat
            : col.tag === 'roof'
              ? roofColliderMat
              : col.tag === 'floor'
                ? floorColliderMat
                : wallColliderMat;
        const colHeight = Math.max(0.12, col.maxY - col.minY);
        const colWire = new THREE.LineSegments(unitEdgesGeo, colMat);
        colWire.scale.set(col.halfW * 2, colHeight, col.halfD * 2);
        colWire.position.set(col.x, (col.minY + col.maxY) * 0.5, col.z);
        colWire.rotation.y = col.yaw;
        this.root.add(colWire);
      }
    }

    this.built = true;
  }

  private createLabelSprite(text: string, colorHex: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(10, 18, 15, 0.82)';
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(8, 8, 496, 80, 16);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.slice(0, 32), 256, 48);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    this.disposables.push(texture, mat);

    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(22, 4.2, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  public dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}
