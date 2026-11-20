import {
  BIOME_LABELS,
  QUEST_STATUS_LABELS,
  UI_TEXT,
  VILLAGE_KIND_LABELS,
  getLocalizedVillageName,
  translateInteractableLabel,
  type Language,
} from '../i18n/translations';
import {
  LAKE_CENTER_X,
  LAKE_CENTER_Z,
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  WORLD_HALF,
  getBiomeAt,
  getCoastlineZAt,
  getEastRiverCenterXAt,
  getRiverCenterXAt,
  getWestRiverCenterXAt,
  groundHeightAt,
} from '../math/noise';
import type { QuestDefinition, QuestView } from '../quest/questTypes';
import type { CoopObjectiveState } from '../../../shared/multiplayerProtocol';
import type { WorldLandmark } from '../types';
import type { VillageSite } from './VillageManager';
import type {
  AuthoritativeQuestTargetPlan,
  QuestTargetLifecycleState,
} from './WorldEntityRegistry';
import type { StoryMapMarkerInput } from '../story/storyTypes';
import type { SideQuestMapMarkerInput } from '../sidequest/sideQuestTypes';

export type MapMarkerKind =
  | 'village'
  | 'village_service'
  | 'quest_active'
  | 'quest_target'
  | 'quest_turnin'
  | 'quest_available'
  | 'side_quest_available'
  | 'side_quest_active'
  | 'side_quest_giver'
  | 'side_quest_target'
  | 'side_quest_turnin'
  | 'coop_objective'
  | 'location'
  | 'herb'
  | 'resource'
  | 'region'
  | 'waypoint'
  | 'friend'
  | 'room_player'
  | 'party_member';

export type MapMarkerCategory =
  | 'village'
  | 'quest'
  | 'location'
  | 'herb'
  | 'resource'
  | 'waypoint'
  | 'players';

export interface MapWaypoint {
  x: number;
  z: number;
  label?: string;
}

export interface MapPlayerPin {
  id: string;
  name: string;
  relationship: 'party' | 'friend' | 'room_player';
  x: number;
  z: number;
  isDead?: boolean;
  partyIndex?: number;
  partyColor?: string;
  level?: number;
  health?: number;
  maxHealth?: number;
  online?: boolean;
  distanceMeters?: number;
  directionLabel?: string;
}

export interface MapAnimalEntry {
  id: string;
  species: string;
  x: number;
  z: number;
}

export interface FogOfWarState {
  gridSize: number;
  discoveredB64: string;
}

export interface MapMarker {
  id: string;
  kind: MapMarkerKind;
  category: MapMarkerCategory;
  label: string;
  subtitle?: string;
  x: number;
  z: number;
  discovered: boolean;
  radius?: number;
  questId?: string;
  tracked?: boolean;
  minZoom?: number;
  markerColor?: string;
  partyIndex?: number;
  distanceMeters?: number;
  directionLabel?: string;
  online?: boolean;
}

export interface MapNpcEntry {
  id: string;
  name: string;
  role: string;
  x: number;
  z: number;
  alive?: boolean;
  loaded?: boolean;
  valid?: boolean;
}

export interface MapQuestTargetEntry {
  entityId: string;
  questId: string;
  objectiveId: string;
  enemyType: string;
  lifecycle: QuestTargetLifecycleState;
  worldId: string;
  chunkId: string;
  x: number;
  z: number;
  loaded: boolean;
  label?: string;
  labelAr?: string;
}

export interface MapInteractableEntry {
  id: string;
  label: string;
  kind: string;
  x: number;
  z: number;
  collected: boolean;
}

export interface MapVillageEntry {
  id: string;
  name: string;
  nameAr?: string;
  kind: string;
  centerX: number;
  centerZ: number;
}

export interface MapWorldData {
  seed: number;
  villageSite: VillageSite | null;
  villages?: MapVillageEntry[];
  landmarks: WorldLandmark[];
  npcs: MapNpcEntry[];
  animals?: MapAnimalEntry[];
  players?: MapPlayerPin[];
  interactables: MapInteractableEntry[];
  activeQuests: QuestView[];
  availableQuests: QuestView[];
  questDefs: QuestDefinition[];
  questTargets?: MapQuestTargetEntry[];
  questTargetPlans?: AuthoritativeQuestTargetPlan[];
  coopObjective?: CoopObjectiveState | null;
  storyMarkers?: StoryMapMarkerInput[];
  sideQuestMarkers?: SideQuestMapMarkerInput[];
  waypoint?: MapWaypoint | null;
  showPartyMembers?: boolean;
  showNonPartyPlayers?: boolean;
  getItemCount: (itemId: string) => number;
}

export interface MapRenderParams {
  playerX: number;
  playerZ: number;
  headingDeg: number;
  markers: MapMarker[];
  hoveredMarkerId: string | null;
  selectedMarkerId: string | null;
  hiddenCategories?: Set<MapMarkerCategory>;
  npcs?: MapNpcEntry[];
  villages?: MapVillageEntry[];
  waypoint?: MapWaypoint | null;
  lang: Language;
  elapsedSec: number;
}

export interface MiniMapRenderParams {
  playerX: number;
  playerZ: number;
  headingDeg: number;
  markers: MapMarker[];
  npcs: MapNpcEntry[];
  animals?: MapAnimalEntry[];
  players?: MapPlayerPin[];
  villages?: MapVillageEntry[];
  waypoint?: MapWaypoint | null;
  rotateWithPlayer: boolean;
  showPartyMembers?: boolean;
  circular?: boolean;
  radiusMeters?: number;
  lang: Language;
  elapsedSec: number;
}

export const MAP_WORLD_HALF = WORLD_HALF; // 3600m half-span => 7200x7200 generated world
export const MAP_MIN_ZOOM = 0.55;
export const MAP_MAX_ZOOM = 64.0;
const TERRAIN_CACHE_RES = 640;
const FOG_GRID_SIZE = 144; // 50m per cell across 7200m world

export class MapManager {
  private centerX = 0;
  private centerZ = 0;
  private zoom = 1.85;

  private terrainCanvas: HTMLCanvasElement | null = null;
  private cachedSeed: number | null = null;
  private cachedVillageKey = '';

  private readonly fogGrid = new Uint8Array(FOG_GRID_SIZE * FOG_GRID_SIZE);
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogImageData: ImageData | null = null;
  private fogDirty = true;

  public getCenter(): { x: number; z: number } {
    return { x: this.centerX, z: this.centerZ };
  }

  public getZoom(): number {
    return this.zoom;
  }

  public resetView(): void {
    this.centerX = 0;
    this.centerZ = 0;
    this.zoom = 1.85;
  }

  public centerOn(x: number, z: number, nextZoom?: number): void {
    if (nextZoom !== undefined) {
      this.zoom = clamp(nextZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
    }
    this.centerX = clamp(x, -MAP_WORLD_HALF, MAP_WORLD_HALF);
    this.centerZ = clamp(z, -MAP_WORLD_HALF, MAP_WORLD_HALF);
  }

  public resetFog(): void {
    this.fogGrid.fill(0);
    this.fogDirty = true;
  }

  public revealAround(wx: number, wz: number, radiusMeters = 190): boolean {
    const cellMeters = (MAP_WORLD_HALF * 2) / FOG_GRID_SIZE;
    const cx = Math.floor(((wx + MAP_WORLD_HALF) / (MAP_WORLD_HALF * 2)) * FOG_GRID_SIZE);
    const cz = Math.floor(((wz + MAP_WORLD_HALF) / (MAP_WORLD_HALF * 2)) * FOG_GRID_SIZE);
    const cellSpan = Math.ceil(radiusMeters / cellMeters);
    const rSq = radiusMeters * radiusMeters;
    let changed = false;

    for (let dz = -cellSpan; dz <= cellSpan; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= FOG_GRID_SIZE) continue;
      const cellCenterZ = -MAP_WORLD_HALF + (gz + 0.5) * cellMeters;
      const distZ = cellCenterZ - wz;

      for (let dx = -cellSpan; dx <= cellSpan; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= FOG_GRID_SIZE) continue;
        const cellCenterX = -MAP_WORLD_HALF + (gx + 0.5) * cellMeters;
        const distX = cellCenterX - wx;

        if (distX * distX + distZ * distZ <= rSq) {
          const idx = gz * FOG_GRID_SIZE + gx;
          if (this.fogGrid[idx] === 0) {
            this.fogGrid[idx] = 1;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.fogDirty = true;
    }
    return changed;
  }

  public isWorldPointDiscovered(wx: number, wz: number): boolean {
    const gx = clamp(
      Math.floor(((wx + MAP_WORLD_HALF) / (MAP_WORLD_HALF * 2)) * FOG_GRID_SIZE),
      0,
      FOG_GRID_SIZE - 1,
    );
    const gz = clamp(
      Math.floor(((wz + MAP_WORLD_HALF) / (MAP_WORLD_HALF * 2)) * FOG_GRID_SIZE),
      0,
      FOG_GRID_SIZE - 1,
    );
    return this.fogGrid[gz * FOG_GRID_SIZE + gx] === 1;
  }

  public exportFogState(): FogOfWarState {
    const byteLen = Math.ceil(this.fogGrid.length / 8);
    const packed = new Uint8Array(byteLen);
    for (let i = 0; i < this.fogGrid.length; i++) {
      if (this.fogGrid[i]) {
        packed[i >> 3] |= 1 << (i & 7);
      }
    }
    let bin = '';
    for (let i = 0; i < packed.length; i++) {
      bin += String.fromCharCode(packed[i]);
    }
    return {
      gridSize: FOG_GRID_SIZE,
      discoveredB64: btoa(bin),
    };
  }

  public restoreFogState(
    saved?: FogOfWarState | null,
    landmarks?: WorldLandmark[],
    playerX = 0,
    playerZ = 4,
  ): void {
    this.fogGrid.fill(0);
    let restoredFromSaved = false;

    if (saved && saved.gridSize === FOG_GRID_SIZE && saved.discoveredB64) {
      try {
        const bin = atob(saved.discoveredB64);
        const total = this.fogGrid.length;
        for (let i = 0; i < total; i++) {
          const byteIdx = i >> 3;
          if (byteIdx >= bin.length) break;
          const code = bin.charCodeAt(byteIdx);
          if ((code & (1 << (i & 7))) !== 0) {
            this.fogGrid[i] = 1;
          }
        }
        restoredFromSaved = true;
      } catch {
        this.fogGrid.fill(0);
      }
    }

    if (!restoredFromSaved) {
      this.revealAround(0, 4, 210);
      if (landmarks) {
        for (const lm of landmarks) {
          if (lm.discovered) {
            this.revealAround(lm.x, lm.z, 130);
          }
        }
      }
    }

    this.revealAround(playerX, playerZ, 190);
    this.fogDirty = true;
  }

  private ensureFogCanvas(): HTMLCanvasElement | null {
    if (!this.fogCanvas) {
      this.fogCanvas = document.createElement('canvas');
      this.fogCanvas.width = FOG_GRID_SIZE;
      this.fogCanvas.height = FOG_GRID_SIZE;
    }
    if (!this.fogDirty && this.fogImageData) {
      return this.fogCanvas;
    }

    const ctx = this.fogCanvas.getContext('2d');
    if (!ctx) return null;

    if (!this.fogImageData) {
      this.fogImageData = ctx.createImageData(FOG_GRID_SIZE, FOG_GRID_SIZE);
    }

    const data = this.fogImageData.data;
    const len = this.fogGrid.length;
    for (let i = 0; i < len; i++) {
      const p = i * 4;
      if (this.fogGrid[i] === 1) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      } else {
        data[p] = 7;
        data[p + 1] = 17;
        data[p + 2] = 13;
        data[p + 3] = 228;
      }
    }
    ctx.putImageData(this.fogImageData, 0, 0);
    this.fogDirty = false;
    return this.fogCanvas;
  }

  public getPixelsPerMeter(viewWidth: number, viewHeight: number): number {
    const baseSize = Math.min(viewWidth, viewHeight);
    return (baseSize / (MAP_WORLD_HALF * 2)) * this.zoom;
  }

  public worldToScreen(
    wx: number,
    wz: number,
    viewWidth: number,
    viewHeight: number,
  ): { sx: number; sy: number } {
    const ppm = this.getPixelsPerMeter(viewWidth, viewHeight);
    return {
      sx: viewWidth * 0.5 + (wx - this.centerX) * ppm,
      sy: viewHeight * 0.5 + (wz - this.centerZ) * ppm,
    };
  }

  public screenToWorld(
    sx: number,
    sy: number,
    viewWidth: number,
    viewHeight: number,
  ): { wx: number; wz: number } {
    const ppm = this.getPixelsPerMeter(viewWidth, viewHeight) || 1;
    return {
      wx: this.centerX + (sx - viewWidth * 0.5) / ppm,
      wz: this.centerZ + (sy - viewHeight * 0.5) / ppm,
    };
  }

  public panByScreenDelta(
    dx: number,
    dy: number,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const ppm = this.getPixelsPerMeter(viewWidth, viewHeight) || 1;
    this.centerX = clamp(
      this.centerX - dx / ppm,
      -MAP_WORLD_HALF,
      MAP_WORLD_HALF,
    );
    this.centerZ = clamp(
      this.centerZ - dy / ppm,
      -MAP_WORLD_HALF,
      MAP_WORLD_HALF,
    );
  }

  public panByMeters(dx: number, dz: number): void {
    this.centerX = clamp(this.centerX + dx, -MAP_WORLD_HALF, MAP_WORLD_HALF);
    this.centerZ = clamp(this.centerZ + dz, -MAP_WORLD_HALF, MAP_WORLD_HALF);
  }

  public zoomAtScreenPoint(
    factor: number,
    sx: number,
    sy: number,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const before = this.screenToWorld(sx, sy, viewWidth, viewHeight);
    const nextZoom = clamp(this.zoom * factor, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
    this.zoom = nextZoom;
    const ppm = this.getPixelsPerMeter(viewWidth, viewHeight) || 1;
    this.centerX = clamp(
      before.wx - (sx - viewWidth * 0.5) / ppm,
      -MAP_WORLD_HALF,
      MAP_WORLD_HALF,
    );
    this.centerZ = clamp(
      before.wz - (sy - viewHeight * 0.5) / ppm,
      -MAP_WORLD_HALF,
      MAP_WORLD_HALF,
    );
  }

  public setZoomCentered(nextZoom: number): void {
    this.zoom = clamp(nextZoom, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  }

  public prewarmTerrain(
    seed: number,
    villageSite: VillageSite | null,
    villages?: MapVillageEntry[],
  ): void {
    this.ensureTerrainCache(seed, villageSite, villages);
  }

  private ensureTerrainCache(
    seed: number,
    villageSite: VillageSite | null,
    villages?: MapVillageEntry[],
  ): void {
    const vBase = villageSite
      ? `${villageSite.centerX.toFixed(1)},${villageSite.centerZ.toFixed(1)}`
      : 'none';
    const vCount = villages ? villages.length : 0;
    const vKey = `${vBase}:${vCount}`;

    if (
      this.terrainCanvas &&
      this.cachedSeed === seed &&
      this.cachedVillageKey === vKey
    ) {
      return;
    }

    const canvas = this.terrainCanvas ?? document.createElement('canvas');
    canvas.width = TERRAIN_CACHE_RES;
    canvas.height = TERRAIN_CACHE_RES;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = TERRAIN_CACHE_RES;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;
    const stepMeters = (MAP_WORLD_HALF * 2) / size;

    // Sample elevation grid first so we can compute crisp cartographic hillshading + contours
    const heights = new Float32Array(size * size);
    for (let py = 0; py < size; py++) {
      const wz = -MAP_WORLD_HALF + ((py + 0.5) / size) * (MAP_WORLD_HALF * 2);
      for (let px = 0; px < size; px++) {
        const wx = -MAP_WORLD_HALF + ((px + 0.5) / size) * (MAP_WORLD_HALF * 2);
        heights[py * size + px] = groundHeightAt(wx, wz);
      }
    }

    for (let py = 0; py < size; py++) {
      const wz = -MAP_WORLD_HALF + ((py + 0.5) / size) * (MAP_WORLD_HALF * 2);
      const pyU = Math.max(0, py - 1);
      const pyD = Math.min(size - 1, py + 1);

      for (let px = 0; px < size; px++) {
        const wx = -MAP_WORLD_HALF + ((px + 0.5) / size) * (MAP_WORLD_HALF * 2);
        const pxL = Math.max(0, px - 1);
        const pxR = Math.min(size - 1, px + 1);

        const h = heights[py * size + px];
        const hL = heights[py * size + pxL];
        const hR = heights[py * size + pxR];
        const hU = heights[pyU * size + px];
        const hD = heights[pyD * size + px];

        const idx = (py * size + px) * 4;

        if (h < WATER_LEVEL) {
          const depth = Math.min(1, Math.max(0, (WATER_LEVEL - h) / 7.5));
          const shorelineGlow = h > -0.45 ? 1 - (WATER_LEVEL - h) / 0.45 : 0;
          data[idx] = Math.round(44 - depth * 20 + shorelineGlow * 28);
          data[idx + 1] = Math.round(126 - depth * 42 + shorelineGlow * 34);
          data[idx + 2] = Math.round(148 - depth * 28 + shorelineGlow * 22);
          data[idx + 3] = 255;
          continue;
        }

        // NW directional light hillshade
        const dHdx = (hR - hL) / (2 * stepMeters);
        const dHdz = (hD - hU) / (2 * stepMeters);
        const shadeDot = clamp(
          0.88 - dHdx * 0.58 - dHdz * 0.52,
          0.56,
          1.22,
        );

        const biome = getBiomeAt(wx, wz);
        const elevNorm = clamp(h / 54, 0, 1);

        let r = 92;
        let g = 142;
        let b = 70;

        if (biome === 'Desert') {
          r = 204 + elevNorm * 24;
          g = 166 + elevNorm * 18;
          b = 104 + elevNorm * 14;
        } else if (biome === 'Beach') {
          r = 216;
          g = 195;
          b = 138;
        } else if (biome === 'Mountains') {
          if (h > 43) {
            r = 228;
            g = 235;
            b = 240;
          } else {
            r = 100 + elevNorm * 72;
            g = 107 + elevNorm * 68;
            b = 106 + elevNorm * 64;
          }
        } else if (biome === 'Forest') {
          r = 52 + elevNorm * 22;
          g = 98 + elevNorm * 28;
          b = 49 + elevNorm * 16;
        } else {
          r = 90 + elevNorm * 34;
          g = 140 + elevNorm * 30;
          b = 67 + elevNorm * 18;
        }

        // Subtle elevation contour bands every 9 meters above 4m
        let contourMult = 1;
        if (h > 4) {
          const mod = h % 9;
          if (mod < 0.36) {
            contourMult = 0.91;
          }
        }
        // Coastal shoreline edge ink
        const nearWater =
          hL < WATER_LEVEL ||
          hR < WATER_LEVEL ||
          hU < WATER_LEVEL ||
          hD < WATER_LEVEL;
        if (nearWater) {
          contourMult *= 0.82;
        }

        // Outer mountain veil beyond playable boundary
        const radial = Math.hypot(wx, wz);
        const edgeDim =
          radial > PLAYABLE_RADIUS
            ? 1 - clamp((radial - PLAYABLE_RADIUS) / 110, 0, 0.42)
            : 1;

        data[idx] = clamp(Math.round(r * shadeDot * contourMult * edgeDim), 0, 255);
        data[idx + 1] = clamp(
          Math.round(g * shadeDot * contourMult * edgeDim),
          0,
          255,
        );
        data[idx + 2] = clamp(
          Math.round(b * shadeDot * contourMult * edgeDim),
          0,
          255,
        );
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const toCache = (wx: number, wz: number) => ({
      x: ((wx + MAP_WORLD_HALF) / (MAP_WORLD_HALF * 2)) * size,
      y: ((wz + MAP_WORLD_HALF) / (MAP_WORLD_HALF * 2)) * size,
    });

    // Draw deterministic rivers onto cached terrain map so streams stay crisp at every zoom
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokeRiver = (
      getX: (z: number) => number,
      zStart: number,
      zEndStep: number,
      widthPx: number,
    ) => {
      ctx.beginPath();
      let started = false;
      for (let z = zStart; z <= 950; z += zEndStep) {
        const rx = getX(z);
        const coastZ = getCoastlineZAt(rx);
        if (z > coastZ + 28) break;
        const pt = toCache(rx, z);
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }
      if (started) {
        ctx.strokeStyle = 'rgba(138, 203, 219, 0.42)';
        ctx.lineWidth = widthPx + 1.2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(46, 138, 162, 0.92)';
        ctx.lineWidth = widthPx;
        ctx.stroke();
      }
    };
    strokeRiver(getRiverCenterXAt, -350, 22, 1.8);
    strokeRiver(getWestRiverCenterXAt, -1420, 34, 1.9);
    strokeRiver(getEastRiverCenterXAt, -1320, 34, 1.8);
    ctx.restore();

    // Draw deterministic Oakhollow & regional village roads onto cached map
    if (villageSite) {
      const cx = villageSite.centerX;
      const cz = villageSite.centerZ;
      const center = toCache(cx, cz);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Regional highway trails connected via Prim Minimum Spanning Tree so all settlements link naturally
      if (villages && villages.length > 1) {
        ctx.strokeStyle = 'rgba(199, 174, 126, 0.45)';
        ctx.lineWidth = 1.5;

        const visited = new Set<number>([0]);
        while (visited.size < villages.length) {
          let bestA = -1;
          let bestB = -1;
          let bestDistSq = Infinity;
          for (const i of visited) {
            for (let j = 0; j < villages.length; j++) {
              if (visited.has(j)) continue;
              const dx = villages[i].centerX - villages[j].centerX;
              const dz = villages[i].centerZ - villages[j].centerZ;
              const dSq = dx * dx + dz * dz;
              if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestA = i;
                bestB = j;
              }
            }
          }
          if (bestA === -1 || bestB === -1) break;
          visited.add(bestB);

          const va = villages[bestA];
          const vb = villages[bestB];
          const pA = toCache(va.centerX, va.centerZ);
          const pB = toCache(vb.centerX, vb.centerZ);
          const ctrlX = (va.centerX + vb.centerX) * 0.5 + (vb.centerZ - va.centerZ) * 0.09;
          const ctrlZ = (va.centerZ + vb.centerZ) * 0.5 - (vb.centerX - va.centerX) * 0.09;
          const ctrl = toCache(ctrlX, ctrlZ);

          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, pB.x, pB.y);
          ctx.stroke();
        }

        ctx.fillStyle = 'rgba(219, 198, 158, 0.72)';
        for (const v of villages) {
          if (v.id === 'oakhollow') continue;
          const dest = toCache(v.centerX, v.centerZ);
          ctx.beginPath();
          ctx.arc(dest.x, dest.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.strokeStyle = 'rgba(214, 191, 146, 0.78)';

      // Approach trail from Sunlit Glade (0, 4) to Village Plaza
      const spawnPt = toCache(0, 4);
      const midPt = toCache(cx * 0.45, cz * 0.45 + 6);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(spawnPt.x, spawnPt.y);
      ctx.quadraticCurveTo(midPt.x, midPt.y, center.x, center.y);
      ctx.stroke();

      // Village cross streets (N-S & E-W)
      const nEnd = toCache(cx, cz - 26);
      const sEnd = toCache(cx, cz + 26);
      const wEnd = toCache(cx - 26, cz);
      const eEnd = toCache(cx + 31, cz);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(nEnd.x, nEnd.y);
      ctx.lineTo(sEnd.x, sEnd.y);
      ctx.moveTo(wEnd.x, wEnd.y);
      ctx.lineTo(eEnd.x, eEnd.y);
      ctx.stroke();

      // Central Square Plaza disc
      const plazaR = (9.5 / (MAP_WORLD_HALF * 2)) * size;
      ctx.fillStyle = 'rgba(219, 198, 158, 0.85)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, plazaR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    this.terrainCanvas = canvas;
    this.cachedSeed = seed;
    this.cachedVillageKey = vKey;
  }

  public buildMarkers(input: MapWorldData & { lang: Language }): MapMarker[] {
    const markers: MapMarker[] = [];
    const t = UI_TEXT[input.lang];
    const npcById = new Map(input.npcs.map((n) => [n.id, n]));
    const defById = new Map(input.questDefs.map((d) => [d.id, d]));

    const localizeInteractable = (id: string, fallback: string) =>
      translateInteractableLabel(id, fallback, input.lang);

    // 1. Primary & Regional Village markers + zoomed service markers
    if (input.villages && input.villages.length > 0) {
      for (const v of input.villages) {
        const discovered =
          v.id === 'oakhollow' || this.isWorldPointDiscovered(v.centerX, v.centerZ);
        if (!discovered) continue;
        markers.push({
          id: `village-${v.id}`,
          kind: 'village',
          category: 'village',
          label:
            v.id === 'oakhollow'
              ? t.mapVillageName
              : input.lang === 'ar' && v.nameAr
                ? v.nameAr
                : getLocalizedVillageName(v.id, v.name, input.lang),
          subtitle:
            v.id === 'oakhollow'
              ? t.mapVillageSubtitle
              : VILLAGE_KIND_LABELS[input.lang][v.kind] ?? v.kind,
          x: v.centerX,
          z: v.centerZ,
          discovered: true,
        });
      }
    } else if (input.villageSite) {
      markers.push({
        id: 'village-oakhollow',
        kind: 'village',
        category: 'village',
        label: t.mapVillageName,
        subtitle: t.mapVillageSubtitle,
        x: input.villageSite.centerX,
        z: input.villageSite.centerZ,
        discovered: true,
      });
    }

    const serviceIds = new Set([
      'village-well',
      'village-bakery',
      'village-apothecary',
      'village-outfitters',
      'village-farm',
    ]);
    for (const item of input.interactables) {
      if (!serviceIds.has(item.id)) continue;
      if (!this.isWorldPointDiscovered(item.x, item.z)) continue;
      markers.push({
        id: `svc-${item.id}`,
        kind: 'village_service',
        category: 'village',
        label: localizeInteractable(item.id, item.label),
        subtitle: t.mapVillageServiceTag,
        x: item.x,
        z: item.z,
        discovered: true,
        minZoom: 1.75,
      });
    }

    // 2. Quest Markers (Active, Ready to Turn In, and Available)
    const uncollectedHerbs = input.interactables.filter(
      (i) => i.kind === 'herb' && !i.collected,
    );

    const findNearestHerb = (fromX: number, fromZ: number) => {
      let best: MapInteractableEntry | null = null;
      let bestDistSq = Infinity;
      for (const h of uncollectedHerbs) {
        const dSq = (h.x - fromX) ** 2 + (h.z - fromZ) ** 2;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          best = h;
        }
      }
      return best;
    };

    const activeQuestById = new Map<string, QuestView>();
    for (const q of input.activeQuests) {
      activeQuestById.set(q.id, q);
    }

    const loadedQuestTargetKeys = new Set<string>();
    if (input.questTargets && input.questTargets.length > 0) {
      for (const qt of input.questTargets) {
        const q = activeQuestById.get(qt.questId);
        if (!q || q.status === 'ready') continue;
        if (!qt.loaded || qt.lifecycle === 'DEFEATED') continue;
        if (!Number.isFinite(qt.x) || !Number.isFinite(qt.z)) continue;
        loadedQuestTargetKeys.add(`${qt.questId}:${qt.objectiveId}`);
        const objView =
          q.objectives.find((o) => o.id === qt.objectiveId) ??
          q.objectives.find((o) => o.active && !o.completed);
        const enemyLabel =
          input.lang === 'ar' ? (qt.labelAr ?? qt.label ?? q.title) : (qt.label ?? q.title);
        markers.push({
          id: `quest-target-${qt.questId}-${qt.entityId}`,
          kind: 'quest_target',
          category: 'quest',
          label: enemyLabel,
          subtitle: objView?.description ?? q.currentObjectiveText,
          x: qt.x,
          z: qt.z,
          discovered: true,
          questId: q.id,
          tracked: q.tracked,
          markerColor: '#ef4444',
        });
      }
    }

    if (input.questTargetPlans && input.questTargetPlans.length > 0) {
      for (const plan of input.questTargetPlans) {
        if (plan.cancelled || plan.loaded || plan.lifecycle === 'DEFEATED') continue;
        const q = activeQuestById.get(plan.questId);
        if (!q || q.status === 'ready') continue;
        if (loadedQuestTargetKeys.has(`${plan.questId}:${plan.objectiveId}`)) continue;
        if (typeof plan.targetX !== 'number' || typeof plan.targetZ !== 'number') continue;
        if (!Number.isFinite(plan.targetX) || !Number.isFinite(plan.targetZ)) continue;
        const objView =
          q.objectives.find((o) => o.id === plan.objectiveId) ??
          q.objectives.find((o) => o.active && !o.completed);
        markers.push({
          id: `quest-zone-${plan.questId}-${plan.objectiveId}`,
          kind: 'quest_active',
          category: 'quest',
          label: q.title,
          subtitle: `${objView?.description ?? q.currentObjectiveText} (${plan.chunkId})`,
          x: plan.targetX,
          z: plan.targetZ,
          discovered: true,
          radius: 75,
          questId: q.id,
          tracked: q.tracked,
        });
      }
    }

    for (const q of input.activeQuests) {
      const def = defById.get(q.id);
      if (q.status === 'ready') {
        const turnInId = q.turnInNpcId ?? q.giverNpcId;
        const npc = npcById.get(turnInId);
        if (npc) {
          markers.push({
            id: `quest-turnin-${q.id}`,
            kind: 'quest_turnin',
            category: 'quest',
            label: q.title,
            subtitle: `${QUEST_STATUS_LABELS[input.lang].ready} · ${npc.name}`,
            x: npc.x,
            z: npc.z,
            discovered: true,
            questId: q.id,
            tracked: q.tracked,
          });
        }
        continue;
      }

      const activeObjView =
        q.objectives.find((o) => o.active && !o.completed) ??
        q.objectives.find((o) => !o.completed);
      const activeObjDef = def?.objectives.find((o) => o.id === activeObjView?.id);
      if (!activeObjDef) continue;

      let tx: number | null = null;
      let tz: number | null = null;
      let areaRadius: number | undefined;

      if (activeObjDef.type === 'reach_location') {
        tx = activeObjDef.x;
        tz = activeObjDef.z;
        areaRadius = activeObjDef.radius;
      } else if (activeObjDef.type === 'explore_area') {
        if (activeObjDef.areaCenter) {
          tx = activeObjDef.areaCenter.x;
          tz = activeObjDef.areaCenter.z;
          areaRadius = activeObjDef.areaCenter.radius;
        } else if (activeObjDef.biome === 'Desert') {
          tx = 205;
          tz = 26;
          areaRadius = 64;
        } else if (activeObjDef.minLandmarks) {
          const nextLandmark = input.landmarks.find(
            (l) => !l.discovered && l.kind !== 'herb',
          );
          if (nextLandmark) {
            tx = nextLandmark.x;
            tz = nextLandmark.z;
          }
        }
      } else if (activeObjDef.type === 'talk_to_npc') {
        const npc = npcById.get(activeObjDef.npcId);
        if (npc) {
          tx = npc.x;
          tz = npc.z;
        }
      } else if (activeObjDef.type === 'deliver_items') {
        const count = input.getItemCount(activeObjDef.itemId);
        if (count >= activeObjDef.requiredCount) {
          const npc = npcById.get(activeObjDef.targetNpcId);
          if (npc) {
            tx = npc.x;
            tz = npc.z;
          }
        } else if (activeObjDef.itemId === 'meadow-herb') {
          const nearHerb = findNearestHerb(
            input.villageSite?.centerX ?? 0,
            input.villageSite?.centerZ ?? 0,
          );
          if (nearHerb) {
            tx = nearHerb.x;
            tz = nearHerb.z;
          }
        }
      } else if (activeObjDef.type === 'collect_items') {
        if (activeObjDef.itemId === 'meadow-herb') {
          const nearHerb = findNearestHerb(0, 0);
          if (nearHerb) {
            tx = nearHerb.x;
            tz = nearHerb.z;
          }
        }
      }

      if (tx !== null && tz !== null) {
        markers.push({
          id: `quest-active-${q.id}`,
          kind: 'quest_active',
          category: 'quest',
          label: q.title,
          subtitle: activeObjView?.description ?? q.currentObjectiveText,
          x: tx,
          z: tz,
          discovered: true,
          radius: areaRadius,
          questId: q.id,
          tracked: q.tracked,
        });
      }
    }

    const npcAvailCount = new Map<string, number>();
    for (const q of input.availableQuests) {
      const npc = npcById.get(q.giverNpcId);
      if (!npc) continue;
      const idx = npcAvailCount.get(npc.id) ?? 0;
      npcAvailCount.set(npc.id, idx + 1);
      const offsetAngle = idx * 0.9;
      const offsetDist = idx === 0 ? 0 : 4.5;
      markers.push({
        id: `quest-avail-${q.id}`,
        kind: 'quest_available',
        category: 'quest',
        label: q.title,
        subtitle: `${QUEST_STATUS_LABELS[input.lang].available} · ${npc.name}`,
        x: npc.x + Math.cos(offsetAngle) * offsetDist,
        z: npc.z + Math.sin(offsetAngle) * offsetDist,
        discovered: true,
        questId: q.id,
      });
    }

    // 3. Discovered Important Locations & Discovered Regions
    for (const lm of input.landmarks) {
      if (lm.kind === 'herb' || lm.kind === 'village') continue;
      const isRevealed =
        lm.discovered || this.isWorldPointDiscovered(lm.x, lm.z);
      if (!isRevealed) continue;

      markers.push({
        id: `lm-${lm.id}`,
        kind: 'location',
        category: 'location',
        label: localizeInteractable(lm.id, lm.name),
        subtitle: t.mapDiscoveredTag,
        x: lm.x,
        z: lm.z,
        discovered: true,
      });
    }

    const regions: Array<{
      id: string;
      label: string;
      biome: string;
      x: number;
      z: number;
    }> = [
      {
        id: 'region-lake',
        label: t.mapRegionLake,
        biome: BIOME_LABELS[input.lang].Forest,
        x: LAKE_CENTER_X,
        z: LAKE_CENTER_Z,
      },
      {
        id: 'region-desert',
        label: t.mapRegionDesert,
        biome: BIOME_LABELS[input.lang].Desert,
        x: 215,
        z: 24,
      },
      {
        id: 'region-peaks',
        label: t.mapRegionMountains,
        biome: BIOME_LABELS[input.lang].Mountains,
        x: -12,
        z: -245,
      },
      {
        id: 'region-coast',
        label: t.mapRegionCoast,
        biome: BIOME_LABELS[input.lang].Beach,
        x: 12,
        z: getCoastlineZAt(12) + 8,
      },
    ];

    for (const reg of regions) {
      if (!this.isWorldPointDiscovered(reg.x, reg.z)) continue;
      markers.push({
        id: reg.id,
        kind: 'region',
        category: 'location',
        label: reg.label,
        subtitle: reg.biome,
        x: reg.x,
        z: reg.z,
        discovered: true,
      });
    }

    // 4. Discovered Uncollected Herb Patches & Resource Nodes
    for (const item of uncollectedHerbs) {
      if (!this.isWorldPointDiscovered(item.x, item.z)) continue;
      markers.push({
        id: `herb-${item.id}`,
        kind: 'herb',
        category: 'herb',
        label: t.mapHerbPatchName,
        subtitle: BIOME_LABELS[input.lang][getBiomeAt(item.x, item.z)],
        x: item.x,
        z: item.z,
        discovered: true,
        minZoom: 1.05,
      });
    }

    for (const item of input.interactables) {
      if (item.kind !== 'resource' || item.collected) continue;
      if (!this.isWorldPointDiscovered(item.x, item.z)) continue;
      markers.push({
        id: `res-${item.id}`,
        kind: 'resource',
        category: 'resource',
        label: localizeInteractable(item.id, item.label),
        subtitle: `${t.mapLegendResource} · ${BIOME_LABELS[input.lang][getBiomeAt(item.x, item.z)]}`,
        x: item.x,
        z: item.z,
        discovered: true,
        minZoom: 1.65,
      });
    }

    // 5. Personal Waypoint
    if (input.waypoint) {
      markers.push({
        id: 'personal-waypoint',
        kind: 'waypoint',
        category: 'waypoint',
        label: input.waypoint.label || t.waypointLabel,
        subtitle: `${BIOME_LABELS[input.lang][getBiomeAt(input.waypoint.x, input.waypoint.z)]} · X ${Math.round(input.waypoint.x)} Z ${Math.round(input.waypoint.z)}`,
        x: input.waypoint.x,
        z: input.waypoint.z,
        discovered: true,
      });
    }

    // 6. Active room Party Members, Friends & Room Players
    if (input.players && input.players.length > 0) {
      for (const p of input.players) {
        if (p.relationship === 'party') {
          if (input.showPartyMembers === false) continue;
          const tagNum = (p.partyIndex ?? 0) + 1;
          const offlineSuffix =
            p.online === false ? ` · ${t.profileFriendsCategoryOffline}` : '';
          const levelSuffix = p.level ? ` · ${t.levelShort} ${p.level}` : '';
          markers.push({
            id: `player-${p.id}`,
            kind: 'party_member',
            category: 'players',
            label: `P${tagNum} · ${p.name}`,
            subtitle: `${t.partyMemberTag}${levelSuffix}${offlineSuffix}`,
            x: p.x,
            z: p.z,
            discovered: true,
            markerColor: p.partyColor ?? '#f472b6',
            partyIndex: p.partyIndex,
            distanceMeters: p.distanceMeters,
            directionLabel: p.directionLabel,
            online: p.online,
          });
        } else {
          if (input.showNonPartyPlayers === false) continue;
          markers.push({
            id: `player-${p.id}`,
            kind: p.relationship === 'friend' ? 'friend' : 'room_player',
            category: 'players',
            label: p.name,
            subtitle:
              p.relationship === 'friend'
                ? t.mapLegendFriend
                : t.mapLegendRoomPlayer,
            x: p.x,
            z: p.z,
            discovered: true,
            distanceMeters: p.distanceMeters,
            directionLabel: p.directionLabel,
          });
        }
      }
    }

    // 7. Active Party Cooperative Objective Marker
    if (
      input.coopObjective &&
      input.coopObjective.status === 'active' &&
      typeof input.coopObjective.targetX === 'number' &&
      typeof input.coopObjective.targetZ === 'number'
    ) {
      markers.push({
        id: `coop-${input.coopObjective.objectiveId}`,
        kind: 'coop_objective',
        category: 'quest',
        label: input.coopObjective.title,
        subtitle: `${t.coopObjectiveActiveLabel} · ${input.coopObjective.progress}/${input.coopObjective.targetCount}`,
        x: input.coopObjective.targetX,
        z: input.coopObjective.targetZ,
        discovered: true,
        radius: input.coopObjective.targetRadius ?? 22,
        tracked: true,
        markerColor: '#2dd4bf',
      });
    }

    // 8. Main Story Campaign Markers (validated coordinates only)
    if (input.storyMarkers && input.storyMarkers.length > 0) {
      for (const sm of input.storyMarkers) {
        if (!Number.isFinite(sm.x) || !Number.isFinite(sm.z)) continue;
        const kind: MapMarkerKind =
          sm.id.startsWith('story-turnin-')
            ? 'quest_turnin'
            : sm.id.startsWith('story-avail-')
              ? 'quest_available'
              : sm.role === 'enemy'
                ? 'quest_target'
                : 'quest_active';
        markers.push({
          id: sm.id,
          kind,
          category: 'quest',
          label: sm.label,
          subtitle: sm.subtitle,
          x: sm.x,
          z: sm.z,
          discovered: true,
          radius: sm.radius,
          questId: sm.questId,
          tracked: sm.tracked,
          ...(kind === 'quest_target' ? { markerColor: '#ef4444' } : {}),
        });
      }
    }

    // 9. Side Quest Markers (validated dry-land coordinates)
    if (input.sideQuestMarkers && input.sideQuestMarkers.length > 0) {
      for (const sqm of input.sideQuestMarkers) {
        if (!Number.isFinite(sqm.x) || !Number.isFinite(sqm.z)) continue;
        markers.push({
          id: sqm.id,
          kind: sqm.markerKind,
          category: 'quest',
          label: sqm.label,
          subtitle: sqm.subtitle,
          x: sqm.x,
          z: sqm.z,
          discovered: true,
          radius: sqm.radius,
          questId: sqm.sideQuestId,
          tracked: sqm.tracked,
          markerColor:
            sqm.markerKind === 'side_quest_target'
              ? '#fb7185'
              : sqm.markerKind === 'side_quest_turnin'
                ? '#34d399'
                : sqm.markerKind === 'side_quest_active'
                  ? '#22d3ee'
                  : '#38bdf8',
        });
      }
    }

    return markers;
  }

  public isMarkerVisible(
    marker: MapMarker,
    hiddenCategories?: Set<MapMarkerCategory>,
  ): boolean {
    if (hiddenCategories?.has(marker.category)) return false;
    if (marker.minZoom !== undefined && this.zoom < marker.minZoom) return false;
    return true;
  }

  public hitTestMarker(
    sx: number,
    sy: number,
    viewWidth: number,
    viewHeight: number,
    markers: MapMarker[],
    hiddenCategories?: Set<MapMarkerCategory>,
  ): MapMarker | null {
    const ordered = sortMarkersForDraw(markers);
    let best: MapMarker | null = null;
    let bestDistSq = Infinity;

    for (let i = ordered.length - 1; i >= 0; i--) {
      const m = ordered[i];
      if (!this.isMarkerVisible(m, hiddenCategories)) continue;
      const pos = this.worldToScreen(m.x, m.z, viewWidth, viewHeight);
      const hitRadius =
        m.kind === 'region'
          ? 24
          : m.kind === 'village' || m.kind === 'waypoint'
            ? 18
            : m.kind.startsWith('quest') ||
                m.kind.startsWith('side_quest_') ||
                m.kind === 'coop_objective' ||
                m.kind === 'party_member' ||
                m.kind === 'friend' ||
                m.kind === 'room_player'
              ? 17
              : 13;
      const dx = sx - pos.sx;
      const dy = sy - pos.sy;
      const dSq = dx * dx + dy * dy;
      if (dSq <= hitRadius * hitRadius && dSq < bestDistSq) {
        best = m;
        bestDistSq = dSq;
      }
    }
    return best;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    viewWidth: number,
    viewHeight: number,
    dpr: number,
    worldSeed: number,
    villageSite: VillageSite | null,
    params: MapRenderParams,
  ): void {
    this.ensureTerrainCache(worldSeed, villageSite, params.villages);
    const fogCanvas = this.ensureFogCanvas();

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Deep chart backdrop
    ctx.fillStyle = '#07110d';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    const ppm = this.getPixelsPerMeter(viewWidth, viewHeight);
    const fullMeters = MAP_WORLD_HALF * 2;
    const visMinWx = Math.max(
      -MAP_WORLD_HALF,
      this.centerX - (viewWidth * 0.5) / ppm,
    );
    const visMaxWx = Math.min(
      MAP_WORLD_HALF,
      this.centerX + (viewWidth * 0.5) / ppm,
    );
    const visMinWz = Math.max(
      -MAP_WORLD_HALF,
      this.centerZ - (viewHeight * 0.5) / ppm,
    );
    const visMaxWz = Math.min(
      MAP_WORLD_HALF,
      this.centerZ + (viewHeight * 0.5) / ppm,
    );

    if (visMaxWx > visMinWx && visMaxWz > visMinWz) {
      const dstX = viewWidth * 0.5 + (visMinWx - this.centerX) * ppm;
      const dstY = viewHeight * 0.5 + (visMinWz - this.centerZ) * ppm;
      const dstW = (visMaxWx - visMinWx) * ppm;
      const dstH = (visMaxWz - visMinWz) * ppm;

      const u0 = (visMinWx + MAP_WORLD_HALF) / fullMeters;
      const v0 = (visMinWz + MAP_WORLD_HALF) / fullMeters;
      const uSpan = (visMaxWx - visMinWx) / fullMeters;
      const vSpan = (visMaxWz - visMinWz) / fullMeters;

      if (this.terrainCanvas) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          this.terrainCanvas,
          u0 * this.terrainCanvas.width,
          v0 * this.terrainCanvas.height,
          uSpan * this.terrainCanvas.width,
          vSpan * this.terrainCanvas.height,
          dstX,
          dstY,
          dstW,
          dstH,
        );
      }

      // Fog of War overlay over unexplored regions
      if (fogCanvas) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          fogCanvas,
          u0 * fogCanvas.width,
          v0 * fogCanvas.height,
          uSpan * fogCanvas.width,
          vSpan * fogCanvas.height,
          dstX,
          dstY,
          dstW,
          dstH,
        );
        ctx.restore();
      }
    }

    // Subtle cartographic grid
    this.drawCoordinateGrid(ctx, viewWidth, viewHeight, ppm);

    // Playable valley circle
    const origin = this.worldToScreen(0, 0, viewWidth, viewHeight);
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 245, 232, 0.22)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(origin.sx, origin.sy, PLAYABLE_RADIUS * ppm, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Active quest target area rings (behind pins)
    for (const m of params.markers) {
      if (!this.isMarkerVisible(m, params.hiddenCategories)) continue;
      if (
        m.radius &&
        (m.kind === 'quest_active' ||
          m.kind === 'quest_turnin' ||
          m.kind === 'side_quest_active' ||
          m.kind === 'side_quest_target' ||
          m.kind === 'side_quest_turnin' ||
          m.kind === 'coop_objective')
      ) {
        const pos = this.worldToScreen(m.x, m.z, viewWidth, viewHeight);
        const rPx = m.radius * ppm;
        const pulse = 0.72 + Math.sin(params.elapsedSec * 2.6) * 0.18;
        const isSideQuestRing = m.kind.startsWith('side_quest_');
        ctx.save();
        ctx.fillStyle = isSideQuestRing
          ? m.tracked
            ? 'rgba(34, 211, 238, 0.14)'
            : 'rgba(56, 189, 248, 0.10)'
          : m.tracked
            ? 'rgba(235, 180, 62, 0.14)'
            : 'rgba(134, 214, 152, 0.10)';
        ctx.strokeStyle = isSideQuestRing
          ? m.tracked
            ? `rgba(34, 211, 238, ${pulse})`
            : 'rgba(56, 189, 248, 0.65)'
          : m.tracked
            ? `rgba(247, 203, 92, ${pulse})`
            : 'rgba(134, 214, 152, 0.65)';
        ctx.lineWidth = 1.75;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(pos.sx, pos.sy, Math.max(10, rPx), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Eligible authoritative villager dots when zoomed into villages (mirrors minimap)
    if (
      this.zoom >= 1.85 &&
      params.npcs &&
      params.npcs.length > 0 &&
      !params.hiddenCategories?.has('village')
    ) {
      ctx.save();
      ctx.fillStyle = '#7fe094';
      ctx.strokeStyle = '#09140e';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < params.npcs.length; i++) {
        const npc = params.npcs[i];
        if (npc.alive === false || npc.loaded === false || npc.valid === false) continue;
        const pos = this.worldToScreen(npc.x, npc.z, viewWidth, viewHeight);
        if (pos.sx < -20 || pos.sx > viewWidth + 20 || pos.sy < -20 || pos.sy > viewHeight + 20) {
          continue;
        }
        ctx.beginPath();
        ctx.arc(pos.sx, pos.sy, 3.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw markers sorted by priority
    const orderedMarkers = sortMarkersForDraw(params.markers);
    for (const m of orderedMarkers) {
      if (!this.isMarkerVisible(m, params.hiddenCategories)) continue;
      const pos = this.worldToScreen(m.x, m.z, viewWidth, viewHeight);
      if (
        pos.sx < -80 ||
        pos.sx > viewWidth + 80 ||
        pos.sy < -80 ||
        pos.sy > viewHeight + 80
      ) {
        continue;
      }

      const isHighlighted =
        m.id === params.hoveredMarkerId || m.id === params.selectedMarkerId;

      if (m.kind === 'region') {
        this.drawRegionLabel(ctx, pos.sx, pos.sy, m.label, isHighlighted);
      } else if (m.kind === 'herb') {
        this.drawHerbMarker(ctx, pos.sx, pos.sy, isHighlighted);
      } else if (m.kind === 'resource') {
        this.drawResourceMarker(ctx, pos.sx, pos.sy, isHighlighted);
      } else if (m.kind === 'location') {
        this.drawLocationMarker(
          ctx,
          pos.sx,
          pos.sy,
          m,
          isHighlighted,
          this.zoom >= 1.25 || isHighlighted,
        );
      } else if (m.kind === 'village_service') {
        this.drawVillageServiceMarker(ctx, pos.sx, pos.sy, m, isHighlighted);
      } else if (m.kind === 'village') {
        this.drawVillageMarker(ctx, pos.sx, pos.sy, m, isHighlighted);
      } else if (m.kind === 'waypoint') {
        this.drawWaypointMarker(
          ctx,
          pos.sx,
          pos.sy,
          m.label,
          isHighlighted,
          params.elapsedSec,
        );
      } else if (
        m.kind === 'party_member' ||
        m.kind === 'friend' ||
        m.kind === 'room_player'
      ) {
        this.drawPlayerPinMarker(
          ctx,
          pos.sx,
          pos.sy,
          m,
          isHighlighted,
          params.elapsedSec,
        );
      } else {
        this.drawQuestMarker(
          ctx,
          pos.sx,
          pos.sy,
          m,
          isHighlighted,
          params.elapsedSec,
        );
      }
    }

    // Player position & directional view cone on top
    const pPos = this.worldToScreen(
      params.playerX,
      params.playerZ,
      viewWidth,
      viewHeight,
    );
    this.drawPlayerMarker(
      ctx,
      pPos.sx,
      pPos.sy,
      params.headingDeg,
      params.elapsedSec,
    );

    // Cartographic scale bar
    this.drawScaleBar(ctx, viewWidth, viewHeight, ppm, params.lang);

    ctx.restore();
  }

  /**
   * Lightweight cached 2D HUD Mini-Map renderer representing the player's local neighborhood
   * in the exact same coordinate space and terrain/fog data as the full world map.
   */
  public renderMiniMap(
    ctx: CanvasRenderingContext2D,
    sizePx: number,
    dpr: number,
    worldSeed: number,
    villageSite: VillageSite | null,
    params: MiniMapRenderParams,
  ): void {
    this.ensureTerrainCache(worldSeed, villageSite, params.villages);
    const fogCanvas = this.ensureFogCanvas();

    const halfPx = sizePx * 0.5;
    const viewRadiusMeters = params.radiusMeters ?? 210;
    const ppm = halfPx / viewRadiusMeters;
    const rotRad = params.rotateWithPlayer
      ? -(params.headingDeg * Math.PI) / 180
      : 0;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Backdrop
    ctx.fillStyle = '#07110d';
    ctx.fillRect(0, 0, sizePx, sizePx);

    // Clip shape
    ctx.beginPath();
    if (params.circular) {
      ctx.arc(halfPx, halfPx, halfPx - 0.5, 0, Math.PI * 2);
    } else {
      ctx.roundRect(0.5, 0.5, sizePx - 1, sizePx - 1, 10);
    }
    ctx.clip();

    // Crop source terrain & fog canvas around player (extra diagonal headroom for rotation)
    const sampleHalfMeters = viewRadiusMeters * 1.5;
    const fullMeters = MAP_WORLD_HALF * 2;
    const toNorm = (m: number) => (m + MAP_WORLD_HALF) / fullMeters;

    const minXNorm = toNorm(params.playerX - sampleHalfMeters);
    const maxXNorm = toNorm(params.playerX + sampleHalfMeters);
    const minZNorm = toNorm(params.playerZ - sampleHalfMeters);
    const maxZNorm = toNorm(params.playerZ + sampleHalfMeters);

    const drawTerrainHalfPx = sampleHalfMeters * ppm;

    ctx.save();
    ctx.translate(halfPx, halfPx);
    if (rotRad !== 0) {
      ctx.rotate(rotRad);
    }

    if (this.terrainCanvas) {
      const sx = clamp(minXNorm * TERRAIN_CACHE_RES, 0, TERRAIN_CACHE_RES - 1);
      const sy = clamp(minZNorm * TERRAIN_CACHE_RES, 0, TERRAIN_CACHE_RES - 1);
      const ex = clamp(maxXNorm * TERRAIN_CACHE_RES, sx + 1, TERRAIN_CACHE_RES);
      const ey = clamp(maxZNorm * TERRAIN_CACHE_RES, sy + 1, TERRAIN_CACHE_RES);

      const dx = ((sx / TERRAIN_CACHE_RES) * fullMeters - MAP_WORLD_HALF - params.playerX) * ppm;
      const dy = ((sy / TERRAIN_CACHE_RES) * fullMeters - MAP_WORLD_HALF - params.playerZ) * ppm;
      const dw = (((ex - sx) / TERRAIN_CACHE_RES) * fullMeters) * ppm;
      const dh = (((ey - sy) / TERRAIN_CACHE_RES) * fullMeters) * ppm;

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        this.terrainCanvas,
        sx,
        sy,
        ex - sx,
        ey - sy,
        dx,
        dy,
        dw,
        dh,
      );
    }

    if (fogCanvas) {
      const sx = clamp(minXNorm * FOG_GRID_SIZE, 0, FOG_GRID_SIZE - 1);
      const sy = clamp(minZNorm * FOG_GRID_SIZE, 0, FOG_GRID_SIZE - 1);
      const ex = clamp(maxXNorm * FOG_GRID_SIZE, sx + 1, FOG_GRID_SIZE);
      const ey = clamp(maxZNorm * FOG_GRID_SIZE, sy + 1, FOG_GRID_SIZE);

      const dx = ((sx / FOG_GRID_SIZE) * fullMeters - MAP_WORLD_HALF - params.playerX) * ppm;
      const dy = ((sy / FOG_GRID_SIZE) * fullMeters - MAP_WORLD_HALF - params.playerZ) * ppm;
      const dw = (((ex - sx) / FOG_GRID_SIZE) * fullMeters) * ppm;
      const dh = (((ey - sy) / FOG_GRID_SIZE) * fullMeters) * ppm;

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fogCanvas, sx, sy, ex - sx, ey - sy, dx, dy, dw, dh);
    }

    // Subtle distance ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, drawTerrainHalfPx * 0.42, 0, Math.PI * 2);
    ctx.stroke();

    // Optional nearby wildlife markers (small organic dots within 120m)
    if (params.animals && params.animals.length > 0) {
      ctx.fillStyle = 'rgba(216, 179, 128, 0.85)';
      for (let i = 0; i < params.animals.length; i++) {
        const a = params.animals[i];
        const rx = (a.x - params.playerX) * ppm;
        const rz = (a.z - params.playerZ) * ppm;
        if (rx * rx + rz * rz > (halfPx * 0.94) ** 2) continue;
        ctx.beginPath();
        ctx.arc(rx, rz, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Nearby authoritative NPC dots (eligible live/loaded/valid villagers only)
    for (let i = 0; i < params.npcs.length; i++) {
      const npc = params.npcs[i];
      if (npc.alive === false || npc.loaded === false || npc.valid === false) continue;
      const rx = (npc.x - params.playerX) * ppm;
      const rz = (npc.z - params.playerZ) * ppm;
      if (rx * rx + rz * rz > (halfPx * 0.94) ** 2) continue;
      ctx.fillStyle = '#7fe094';
      ctx.strokeStyle = '#09140e';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(rx, rz, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Active room Party Members, Friends & Room Players on Mini-Map
    if (params.players && params.players.length > 0) {
      const clampEdgeR = halfPx - 7;
      for (let i = 0; i < params.players.length; i++) {
        const pl = params.players[i];
        const isParty = pl.relationship === 'party';
        if (isParty && params.showPartyMembers === false) {
          continue;
        }
        const rx = (pl.x - params.playerX) * ppm;
        const rz = (pl.z - params.playerZ) * ppm;
        const distPx = Math.hypot(rx, rz);
        const isFriend = pl.relationship === 'friend';
        const fillColor = isParty
          ? (pl.partyColor ?? '#f472b6')
          : isFriend
            ? '#4ade80'
            : '#38bdf8';
        const shortName = pl.name.length > 9 ? `${pl.name.slice(0, 8)}…` : pl.name;
        const distMeters =
          typeof pl.distanceMeters === 'number'
            ? Math.round(pl.distanceMeters)
            : Math.round(Math.hypot(pl.x - params.playerX, pl.z - params.playerZ));

        if (distPx <= halfPx * 0.94) {
          ctx.save();
          if (pl.online === false) {
            ctx.globalAlpha = 0.52;
          }
          if (isParty || isFriend) {
            ctx.strokeStyle = isParty ? fillColor : 'rgba(74, 222, 128, 0.55)';
            ctx.lineWidth = isParty ? 1.5 : 1.2;
            ctx.beginPath();
            ctx.arc(rx, rz, isParty ? 6.2 : 5.2, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = fillColor;
          ctx.strokeStyle = '#09140e';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(rx, rz, isParty ? 4.4 : isFriend ? 3.8 : 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (isParty) {
            ctx.fillStyle = '#08120d';
            ctx.font = '800 6.5px "Outfit", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`P${(pl.partyIndex ?? 0) + 1}`, rx, rz + 0.3);

            if (sizePx >= 76) {
              ctx.save();
              ctx.translate(rx, rz);
              if (rotRad !== 0) {
                ctx.rotate(-rotRad);
              }
              const tagText = `${shortName} ${distMeters}m`;
              ctx.font = '600 7.5px "Plus Jakarta Sans", "Noto Sans Arabic", sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.strokeStyle = 'rgba(7, 15, 11, 0.95)';
              ctx.lineWidth = 2.6;
              ctx.strokeText(tagText, 0, 7.5);
              ctx.fillStyle = fillColor;
              ctx.fillText(tagText, 0, 7.5);
              ctx.restore();
            }
          }
          ctx.restore();
        } else if (isParty || isFriend) {
          const ang = Math.atan2(rz, rx);
          const edgeX = Math.cos(ang) * clampEdgeR;
          const edgeY = Math.sin(ang) * clampEdgeR;
          this.drawMiniEdgeArrow(
            ctx,
            edgeX,
            edgeY,
            ang,
            fillColor,
          );
          if (isParty && sizePx >= 76) {
            const insetR = Math.max(12, clampEdgeR - 14);
            const lx = Math.cos(ang) * insetR;
            const ly = Math.sin(ang) * insetR;
            ctx.save();
            if (pl.online === false) {
              ctx.globalAlpha = 0.6;
            }
            ctx.translate(lx, ly);
            if (rotRad !== 0) {
              ctx.rotate(-rotRad);
            }
            const dirText = pl.directionLabel ? ` ${pl.directionLabel}` : '';
            const edgeLabel =
              sizePx >= 104
                ? `P${(pl.partyIndex ?? 0) + 1} ${distMeters}m${dirText}`
                : `${distMeters}m${dirText}`;
            ctx.font = '700 7px "Outfit", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'rgba(7, 15, 11, 0.95)';
            ctx.lineWidth = 2.6;
            ctx.strokeText(edgeLabel, 0, 0);
            ctx.fillStyle = fillColor;
            ctx.fillText(edgeLabel, 0, 0);
            ctx.restore();
          }
        }
      }
    }

    // Nearby markers (villages, discovered locations, quests, waypoint)
    const maxRenderRadius = halfPx * 0.96;
    const ordered = sortMarkersForDraw(params.markers);
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i];
      if (m.kind === 'region' || m.kind === 'herb' || m.kind === 'village_service') {
        continue;
      }
      const rx = (m.x - params.playerX) * ppm;
      const rz = (m.z - params.playerZ) * ppm;
      const distPx = Math.hypot(rx, rz);

      if (m.kind === 'waypoint') {
        if (distPx <= maxRenderRadius) {
          this.drawMiniWaypointPin(ctx, rx, rz, 4.5);
        } else {
          const clampR = halfPx - 7;
          const ang = Math.atan2(rz, rx);
          this.drawMiniEdgeArrow(
            ctx,
            Math.cos(ang) * clampR,
            Math.sin(ang) * clampR,
            ang,
            '#38bdf8',
          );
        }
        continue;
      }

      if (
        (m.kind.startsWith('quest') ||
          m.kind.startsWith('side_quest_') ||
          m.kind === 'coop_objective') &&
        distPx > maxRenderRadius
      ) {
        if (
          m.tracked ||
          m.kind === 'quest_turnin' ||
          m.kind === 'side_quest_turnin' ||
          m.kind === 'coop_objective' ||
          m.kind === 'quest_target' ||
          m.kind === 'side_quest_target'
        ) {
          const clampR = halfPx - 7;
          const ang = Math.atan2(rz, rx);
          this.drawMiniEdgeArrow(
            ctx,
            Math.cos(ang) * clampR,
            Math.sin(ang) * clampR,
            ang,
            m.kind === 'coop_objective'
              ? '#2dd4bf'
              : m.kind === 'quest_target'
                ? '#ef4444'
                : m.kind === 'side_quest_target'
                  ? '#fb7185'
                  : m.kind === 'quest_turnin'
                    ? '#4ade80'
                    : m.kind === 'side_quest_turnin'
                      ? '#34d399'
                      : m.kind.startsWith('side_quest_')
                        ? '#22d3ee'
                        : '#facc15',
          );
        }
        continue;
      }

      if (distPx > maxRenderRadius) continue;

      if (m.kind === 'village') {
        ctx.fillStyle = '#e79e4f';
        ctx.strokeStyle = '#09140e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(rx, rz - 4.2);
        ctx.lineTo(rx + 4.2, rz);
        ctx.lineTo(rx + 3, rz);
        ctx.lineTo(rx + 3, rz + 3.8);
        ctx.lineTo(rx - 3, rz + 3.8);
        ctx.lineTo(rx - 3, rz);
        ctx.lineTo(rx - 4.2, rz);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (m.kind === 'location') {
        ctx.fillStyle = '#7dd3fc';
        ctx.strokeStyle = '#09140e';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(rx, rz - 3.6);
        ctx.lineTo(rx + 3.6, rz);
        ctx.lineTo(rx, rz + 3.6);
        ctx.lineTo(rx - 3.6, rz);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (m.kind === 'coop_objective') {
        ctx.fillStyle = '#2dd4bf';
        ctx.strokeStyle = '#09140e';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(rx, rz, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (m.kind === 'quest_target' || m.kind === 'side_quest_target') {
        ctx.fillStyle = m.kind === 'side_quest_target' ? '#fb7185' : '#ef4444';
        ctx.strokeStyle = '#09140e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(rx, rz - 4.2);
        ctx.lineTo(rx + 4.2, rz);
        ctx.lineTo(rx, rz + 4.2);
        ctx.lineTo(rx - 4.2, rz);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(rx, rz, 1.3, 0, Math.PI * 2);
        ctx.fill();
      } else if (m.kind.startsWith('side_quest_')) {
        const isTurnIn = m.kind === 'side_quest_turnin';
        const isActive = m.kind === 'side_quest_active';
        ctx.fillStyle = isTurnIn ? '#34d399' : isActive ? '#22d3ee' : '#38bdf8';
        ctx.strokeStyle = '#09140e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(rx, rz, 4.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (m.kind.startsWith('quest')) {
        const isTurnIn = m.kind === 'quest_turnin';
        ctx.fillStyle = isTurnIn ? '#4ade80' : '#facc15';
        ctx.strokeStyle = '#09140e';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(rx, rz, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore(); // undo world rotation

    // Center Player Chevron
    ctx.save();
    ctx.translate(halfPx, halfPx);
    if (!params.rotateWithPlayer) {
      ctx.rotate((params.headingDeg * Math.PI) / 180);
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#09140e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(4.6, 4.6);
    ctx.lineTo(0, 2.0);
    ctx.lineTo(-4.6, 4.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North ("N") compass marker on border
    ctx.save();
    const northAngle = params.rotateWithPlayer
      ? -Math.PI * 0.5 + rotRad
      : -Math.PI * 0.5;
    const northDist = halfPx - 8;
    const nx = halfPx + Math.cos(northAngle) * northDist;
    const ny = halfPx + Math.sin(northAngle) * northDist;
    ctx.fillStyle = 'rgba(11, 22, 16, 0.85)';
    ctx.beginPath();
    ctx.arc(nx, ny, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e5a93c';
    ctx.font = '700 8px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.4);
    ctx.restore();

    ctx.restore();
  }

  private drawMiniWaypointPin(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#09140e';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMiniEdgeArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angleRad: number,
    color: string,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#09140e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(4.5, 0);
    ctx.lineTo(-3.2, 3.2);
    ctx.lineTo(-1.5, 0);
    ctx.lineTo(-3.2, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawCoordinateGrid(
    ctx: CanvasRenderingContext2D,
    viewWidth: number,
    viewHeight: number,
    ppm: number,
  ): void {
    const step =
      this.zoom >= 24
        ? 25
        : this.zoom >= 10
          ? 50
          : this.zoom >= 5
            ? 100
            : this.zoom >= 2
              ? 250
              : 500;
    const minWx = Math.max(
      -MAP_WORLD_HALF,
      Math.floor((this.centerX - (viewWidth * 0.5) / ppm) / step) * step,
    );
    const maxWx = Math.min(
      MAP_WORLD_HALF,
      Math.ceil((this.centerX + (viewWidth * 0.5) / ppm) / step) * step,
    );
    const minWz = Math.max(
      -MAP_WORLD_HALF,
      Math.floor((this.centerZ - (viewHeight * 0.5) / ppm) / step) * step,
    );
    const maxWz = Math.min(
      MAP_WORLD_HALF,
      Math.ceil((this.centerZ + (viewHeight * 0.5) / ppm) / step) * step,
    );

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.065)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = minWx; x <= maxWx; x += step) {
      const sx = viewWidth * 0.5 + (x - this.centerX) * ppm;
      if (sx < 0 || sx > viewWidth) continue;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewHeight);
    }
    for (let z = minWz; z <= maxWz; z += step) {
      const sy = viewHeight * 0.5 + (z - this.centerZ) * ppm;
      if (sy < 0 || sy > viewHeight) continue;
      ctx.moveTo(0, sy);
      ctx.lineTo(viewWidth, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawRegionLabel(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    label: string,
    highlighted: boolean,
  ): void {
    ctx.save();
    ctx.font = '600 11px "Outfit", "Noto Sans Arabic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '0.06em';
    ctx.fillStyle = highlighted ? '#ffffff' : 'rgba(241, 246, 236, 0.78)';
    ctx.strokeStyle = 'rgba(8, 16, 12, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(label.toUpperCase(), sx, sy);
    ctx.fillText(label.toUpperCase(), sx, sy);
    ctx.restore();
  }

  private drawHerbMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    highlighted: boolean,
  ): void {
    ctx.save();
    const r = highlighted ? 5.5 : 3.8;
    ctx.fillStyle = '#5ee08a';
    ctx.strokeStyle = '#09150f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawResourceMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    highlighted: boolean,
  ): void {
    ctx.save();
    const s = highlighted ? 4.8 : 3.4;
    ctx.translate(sx, sy);
    ctx.fillStyle = '#d4a359';
    ctx.strokeStyle = '#0b1610';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.rect(-s, -s, s * 2, s * 2);
    ctx.fill();
    ctx.stroke();
    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, s + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLocationMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    marker: MapMarker,
    highlighted: boolean,
    showLabel: boolean,
  ): void {
    ctx.save();
    const r = highlighted ? 7 : 5.5;
    ctx.translate(sx, sy);
    ctx.fillStyle = '#7dd3fc';
    ctx.strokeStyle = '#09150f';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (showLabel) {
      this.drawPinLabel(ctx, 0, r + 11, marker.label, highlighted);
    }
    ctx.restore();
  }

  private drawVillageServiceMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    marker: MapMarker,
    highlighted: boolean,
  ): void {
    ctx.save();
    ctx.translate(sx, sy);
    const s = highlighted ? 6.5 : 5;
    ctx.fillStyle = '#f3b768';
    ctx.strokeStyle = '#0c1611';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-s, -s, s * 2, s * 2, 2.5);
    ctx.fill();
    ctx.stroke();

    if (this.zoom >= 2.15 || highlighted) {
      this.drawPinLabel(ctx, 0, s + 10, marker.label, highlighted);
    }
    ctx.restore();
  }

  private drawVillageMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    marker: MapMarker,
    highlighted: boolean,
  ): void {
    ctx.save();
    ctx.translate(sx, sy);
    const scale = highlighted ? 1.15 : 1;
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(229, 169, 60, 0.22)';
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e79e4f';
    ctx.strokeStyle = '#0c1611';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(9, -1);
    ctx.lineTo(6.5, -1);
    ctx.lineTo(6.5, 8);
    ctx.lineTo(-6.5, 8);
    ctx.lineTo(-6.5, -1);
    ctx.lineTo(-9, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawPinLabel(ctx, 0, 19, marker.label, highlighted, '#f7d89c');
    ctx.restore();
  }

  private drawWaypointMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    label: string,
    highlighted: boolean,
    elapsedSec: number,
  ): void {
    ctx.save();
    ctx.translate(sx, sy);

    const pulseR = 13 + Math.sin(elapsedSec * 3.4) * 2.2;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
    ctx.stroke();

    const r = highlighted ? 10 : 8.5;
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#08130e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawPinLabel(ctx, 0, r + 12, label, highlighted, '#bae6fd');
    ctx.restore();
  }

  private drawQuestMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    marker: MapMarker,
    highlighted: boolean,
    elapsedSec: number,
  ): void {
    ctx.save();
    ctx.translate(sx, sy);

    const isCoop = marker.kind === 'coop_objective';
    const isSideTarget = marker.kind === 'side_quest_target';
    const isSideTurnIn = marker.kind === 'side_quest_turnin';
    const isSideActive = marker.kind === 'side_quest_active';
    const isSideAvail =
      marker.kind === 'side_quest_available' || marker.kind === 'side_quest_giver';
    const isSide = marker.kind.startsWith('side_quest_');
    const isTarget = marker.kind === 'quest_target' || isSideTarget;
    const isTurnIn = marker.kind === 'quest_turnin' || isSideTurnIn;
    const isActive = marker.kind === 'quest_active' || isSideActive;
    const color = isCoop
      ? '#2dd4bf'
      : isSideTarget
        ? '#fb7185'
        : isTarget
          ? '#ef4444'
          : isSideTurnIn
            ? '#34d399'
            : isTurnIn
              ? '#4ade80'
              : isSideActive
                ? '#22d3ee'
                : isSideAvail
                  ? '#38bdf8'
                  : isActive
                    ? '#facc15'
                    : '#f59e0b';
    const symbol = isCoop
      ? '◈'
      : isTarget
        ? '✕'
        : isTurnIn
          ? '?'
          : isSideActive
            ? '◆'
            : isSideAvail
              ? '!'
              : isActive
                ? '★'
                : '!';

    if (marker.tracked || isTarget) {
      const ringR = (isTarget ? 11 : 12) + Math.sin(elapsedSec * 3.5) * 2;
      ctx.strokeStyle = isCoop
        ? 'rgba(45, 212, 191, 0.78)'
        : isSideTarget
          ? 'rgba(251, 113, 133, 0.8)'
          : isTarget
            ? 'rgba(239, 68, 68, 0.78)'
            : isSide
              ? 'rgba(34, 211, 238, 0.76)'
              : 'rgba(250, 204, 21, 0.72)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    const r = highlighted ? 10.5 : 8.5;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#09140e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0b1510';
    ctx.font = '700 11px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, 0, 0.5);

    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (marker.tracked || highlighted || this.zoom >= 1.9) {
      this.drawPinLabel(
        ctx,
        0,
        r + 11,
        marker.label,
        highlighted,
        isCoop ? '#99f6e4' : isSide ? '#bae6fd' : '#fef08a',
      );
    }
    ctx.restore();
  }

  private drawPlayerPinMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    marker: MapMarker,
    highlighted: boolean,
    elapsedSec: number,
  ): void {
    const isParty = marker.kind === 'party_member';
    const isFriend = marker.kind === 'friend';
    const fill = isParty
      ? (marker.markerColor ?? '#f472b6')
      : isFriend
        ? '#4ade80'
        : '#38bdf8';
    const labelColor = isParty ? fill : isFriend ? '#bbf7d0' : '#bae6fd';

    ctx.save();
    ctx.translate(sx, sy);
    if (isParty && marker.online === false) {
      ctx.globalAlpha = 0.55;
    }

    if (isParty || isFriend) {
      const pulseR = (isParty ? 13 : 11) + Math.sin(elapsedSec * 3.1) * 1.8;
      ctx.strokeStyle = isParty ? fill : 'rgba(74, 222, 128, 0.52)';
      ctx.lineWidth = isParty ? 1.8 : 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    const r = highlighted ? 9.5 : isParty ? 8.2 : isFriend ? 6.8 : 5.8;
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#09140e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isParty) {
      ctx.fillStyle = '#08120d';
      ctx.font = '800 8px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`P${(marker.partyIndex ?? 0) + 1}`, 0, 0.4);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }

    if (highlighted) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    const displayLabel =
      isParty &&
      typeof marker.distanceMeters === 'number' &&
      marker.directionLabel
        ? `${marker.label} (${marker.distanceMeters}m ${marker.directionLabel})`
        : marker.label;

    this.drawPinLabel(ctx, 0, r + 11, displayLabel, highlighted, labelColor);
    ctx.restore();
  }

  private drawPlayerMarker(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    headingDeg: number,
    elapsedSec: number,
  ): void {
    const rad = (headingDeg * Math.PI) / 180;
    ctx.save();
    ctx.translate(sx, sy);

    const pulseR = 14 + Math.sin(elapsedSec * 3) * 2.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.beginPath();
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(rad);

    const coneLen = 34;
    const coneHalfAngle = 0.48;
    const coneGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, coneLen);
    coneGrad.addColorStop(0, 'rgba(255, 255, 255, 0.40)');
    coneGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(
      0,
      0,
      coneLen,
      -Math.PI * 0.5 - coneHalfAngle,
      -Math.PI * 0.5 + coneHalfAngle,
    );
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#09140e';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -10.5);
    ctx.lineTo(7.5, 7.5);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-7.5, 7.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private drawPinLabel(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    text: string,
    highlighted: boolean,
    color = '#eef5eb',
  ): void {
    ctx.save();
    ctx.font = `${highlighted ? '600' : '500'} 11px "Plus Jakarta Sans", "Noto Sans Arabic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(7, 15, 11, 0.92)';
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, ox, oy);
    ctx.fillStyle = highlighted ? '#ffffff' : color;
    ctx.fillText(text, ox, oy);
    ctx.restore();
  }

  private drawScaleBar(
    ctx: CanvasRenderingContext2D,
    viewWidth: number,
    viewHeight: number,
    ppm: number,
    lang: Language,
  ): void {
    const candidates = [5, 10, 15, 25, 50, 100, 250, 500, 1000, 1500];
    let meters = candidates[0];
    for (const c of candidates) {
      meters = c;
      if (c * ppm >= 60 && c * ppm <= 150) {
        break;
      }
      if (c * ppm > 150) {
        break;
      }
    }
    const barPx = meters * ppm;
    const x = viewWidth - barPx - 20;
    const y = viewHeight - 20;
    const unit = lang === 'ar' ? 'م' : 'm';

    ctx.save();
    ctx.fillStyle = 'rgba(11, 22, 16, 0.86)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 10, y - 24, barPx + 20, 32, 8);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#e5a93c';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + barPx, y);
    ctx.lineTo(x + barPx, y - 5);
    ctx.stroke();

    ctx.fillStyle = '#e4ede0';
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${meters}${unit}`, x + barPx * 0.5, y - 5);
    ctx.restore();
  }
}

function sortMarkersForDraw(markers: MapMarker[]): MapMarker[] {
  const rank: Record<MapMarkerKind, number> = {
    region: 1,
    resource: 2,
    herb: 3,
    location: 4,
    village_service: 5,
    village: 6,
    side_quest_giver: 7,
    side_quest_available: 8,
    quest_available: 9,
    side_quest_active: 10,
    quest_active: 11,
    side_quest_turnin: 12,
    quest_turnin: 13,
    side_quest_target: 14,
    quest_target: 15,
    coop_objective: 16,
    waypoint: 17,
    room_player: 18,
    friend: 19,
    party_member: 20,
  };
  return [...markers].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
