import type { BiomeType, NpcRoutinePeriod, WeatherState } from '../types';
import type { QuestStatus } from '../quest/questTypes';
import {
  CORE_PROTECTED_IDS,
  resolveModCrossReference,
  resolveModObjectIdentifier,
} from './ModNamespaceRegistry';
import type { ModDiagnostic } from './modTypes';

export type ModSpawnMode =
  | 'absolute'
  | 'relative_to_world_spawn'
  | 'relative_to_reference'
  | 'random_in_area';

export type ModSpawnContentType =
  | 'item'
  | 'weapon'
  | 'armor'
  | 'tool'
  | 'consumable'
  | 'resource'
  | 'npc'
  | 'character'
  | 'monster'
  | 'animal'
  | 'building'
  | 'decoration';

export interface ModSpawnVec3 {
  x: number;
  y: number;
  z: number;
}

export interface ModSpawnPositionConfig {
  x: number;
  y?: number;
  z: number;
}

export interface ModSpawnAreaConfig {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
  quantity: number;
  minDistance: number;
  seed?: number;
}

export interface ModSpawnConditions {
  onNewWorld: boolean;
  onWorldLoad: boolean;
  onChunkLoad: boolean;
  onAreaEnter: boolean;
  areaEnterRadius?: number;
  timeOfDay?: {
    startHour?: number;
    endHour?: number;
    periods?: NpcRoutinePeriod[];
  };
  weather?: WeatherState[];
  biomes?: BiomeType[];
  playerDistance?: {
    min?: number;
    max?: number;
  };
  questId?: string;
  questStatus?: QuestStatus[];
  requiredFlag?: string;
  forbiddenFlag?: string;
  maxActiveInstances: number;
  respawn: {
    enabled: boolean;
    delaySeconds: number;
    oneTime: boolean;
  };
  perPlayerPickup: boolean;
  snapToGround?: boolean;
}

export interface ModSpawnDefinition {
  /** Globally unique namespaced spawn rule ID (${modId}:spawn:${localId}) */
  id: string;
  spawnId: string;
  modId: string;
  contentId: string;
  contentType: ModSpawnContentType;
  sourceFile: string;
  enabled: boolean;
  mode: ModSpawnMode;
  unsupportedMode?: string;
  position: ModSpawnPositionConfig;
  hasExplicitY: boolean;
  rotation: ModSpawnVec3;
  rotationUnit: 'radians' | 'degrees';
  scale: ModSpawnVec3;
  referenceObjectId?: string;
  referenceType?: string;
  area?: ModSpawnAreaConfig;
  quantity: number;
  conditions: ModSpawnConditions;
  behavior?: string;
  validationError?: {
    code: string;
    message: string;
  };
  raw: Record<string, unknown>;
}

export type ModSpawnRuntimeStatus =
  | 'spawned'
  | 'pending_chunk'
  | 'pending_condition'
  | 'collected'
  | 'defeated'
  | 'waiting_respawn'
  | 'disabled'
  | 'failed';

export interface ModSpawnDiagnosticEntry {
  modId: string;
  contentId: string;
  spawnId: string;
  contentType: ModSpawnContentType;
  mode: ModSpawnMode | string;
  configuredCoords: ModSpawnPositionConfig;
  resolvedCoords: ModSpawnVec3 | null;
  rotation: ModSpawnVec3;
  scale: ModSpawnVec3;
  status: ModSpawnRuntimeStatus;
  targetChunk: string | null;
  alreadySpawned: boolean;
  saved: boolean;
  failedCondition?: string;
  errorCode?: string;
  error?: string;
  instanceCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteNum(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeRotationUnit(raw: Record<string, unknown>): 'radians' | 'degrees' {
  const unit =
    typeof raw.rotationUnit === 'string'
      ? raw.rotationUnit.trim().toLowerCase()
      : typeof raw.angleUnit === 'string'
        ? raw.angleUnit.trim().toLowerCase()
        : '';
  if (unit === 'deg' || unit === 'degree' || unit === 'degrees') return 'degrees';
  if (unit === 'rad' || unit === 'radian' || unit === 'radians') return 'radians';
  if (
    raw.rotationDeg !== undefined ||
    raw.rotationDegrees !== undefined ||
    raw.rotationXDeg !== undefined ||
    raw.rotationYDeg !== undefined ||
    raw.rotationZDeg !== undefined
  ) {
    return 'degrees';
  }
  return 'radians';
}

function toRadians(val: number, unit: 'radians' | 'degrees'): number {
  return unit === 'degrees' ? (val * Math.PI) / 180 : val;
}

function readVec3(
  raw: Record<string, unknown>,
  nestedKeys: string[],
  xKeys: string[],
  yKeys: string[],
  zKeys: string[],
): { x?: number; y?: number; z?: number; invalidReason?: string } {
  for (const nk of nestedKeys) {
    const nested = raw[nk];
    if (Array.isArray(nested)) {
      const x = finiteNum(nested[0]);
      const y = finiteNum(nested[1]);
      const z = finiteNum(nested[2]);
      if (x === undefined && nested[0] !== undefined) {
        return { invalidReason: `Invalid non-finite coordinate in "${nk}[0]".` };
      }
      if (y === undefined && nested[1] !== undefined) {
        return { invalidReason: `Invalid non-finite coordinate in "${nk}[1]".` };
      }
      if (z === undefined && nested[2] !== undefined) {
        return { invalidReason: `Invalid non-finite coordinate in "${nk}[2]".` };
      }
      return { x, y, z };
    }
    if (isRecord(nested)) {
      const x = finiteNum(nested.x);
      const y = finiteNum(nested.y);
      const z = finiteNum(nested.z);
      if (nested.x !== undefined && x === undefined) {
        return { invalidReason: `Invalid non-finite value for "${nk}.x".` };
      }
      if (nested.y !== undefined && y === undefined) {
        return { invalidReason: `Invalid non-finite value for "${nk}.y".` };
      }
      if (nested.z !== undefined && z === undefined) {
        return { invalidReason: `Invalid non-finite value for "${nk}.z".` };
      }
      return { x, y, z };
    }
    if (typeof nested === 'number' && Number.isFinite(nested)) {
      return { x: nested, y: nested, z: nested };
    }
  }

  let x: number | undefined;
  let y: number | undefined;
  let z: number | undefined;

  for (const k of xKeys) {
    if (raw[k] !== undefined) {
      x = finiteNum(raw[k]);
      if (x === undefined) return { invalidReason: `Invalid non-finite value for "${k}".` };
      break;
    }
  }
  for (const k of yKeys) {
    if (raw[k] !== undefined) {
      y = finiteNum(raw[k]);
      if (y === undefined) return { invalidReason: `Invalid non-finite value for "${k}".` };
      break;
    }
  }
  for (const k of zKeys) {
    if (raw[k] !== undefined) {
      z = finiteNum(raw[k]);
      if (z === undefined) return { invalidReason: `Invalid non-finite value for "${k}".` };
      break;
    }
  }

  return { x, y, z };
}

export function normalizeModSpawnContentType(
  rawType: unknown,
  fallbackCategory?: string,
): ModSpawnContentType | null {
  const candidate =
    typeof rawType === 'string' && rawType.trim()
      ? rawType.trim().toLowerCase()
      : typeof fallbackCategory === 'string'
        ? fallbackCategory.trim().toLowerCase()
        : '';

  switch (candidate) {
    case 'item':
    case 'items':
    case 'relic':
    case 'artifact':
      return 'item';
    case 'weapon':
    case 'weapons':
    case 'sword':
    case 'axe':
    case 'bow':
    case 'spear':
    case 'crossbow':
    case 'knife':
      return 'weapon';
    case 'armor':
    case 'armour':
    case 'equipment':
      return 'armor';
    case 'tool':
    case 'tools':
      return 'tool';
    case 'consumable':
    case 'consumables':
    case 'food':
    case 'potion':
      return 'consumable';
    case 'resource':
    case 'resources':
    case 'material':
      return 'resource';
    case 'npc':
    case 'npcs':
      return 'npc';
    case 'character':
    case 'characters':
      return 'character';
    case 'monster':
    case 'monsters':
    case 'enemy':
    case 'enemies':
      return 'monster';
    case 'animal':
    case 'animals':
    case 'creature':
    case 'creatures':
    case 'wildlife':
      return 'animal';
    case 'building':
    case 'buildings':
    case 'structure':
    case 'structures':
      return 'building';
    case 'decoration':
    case 'decorations':
    case 'decor':
    case 'furniture':
    case 'prop':
      return 'decoration';
    default:
      return null;
  }
}

export function normalizeModSpawnMode(rawMode: unknown): {
  mode: ModSpawnMode | null;
  rawLabel: string;
} {
  if (rawMode === undefined || rawMode === null || rawMode === '') {
    return { mode: 'absolute', rawLabel: 'absolute' };
  }
  if (typeof rawMode !== 'string') {
    return { mode: null, rawLabel: String(rawMode) };
  }
  const normalized = rawMode
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'absolute':
    case 'absolute_coordinates':
    case 'absolute_coords':
    case 'exact':
    case 'fixed':
    case 'world':
    case 'world_coordinates':
      return { mode: 'absolute', rawLabel: rawMode.trim() };
    case 'relative_to_world_spawn':
    case 'relative_world_spawn':
    case 'world_spawn':
    case 'spawn_relative':
    case 'relative_to_spawn':
      return { mode: 'relative_to_world_spawn', rawLabel: rawMode.trim() };
    case 'relative_to_reference':
    case 'relative_to_object':
    case 'relative_to_reference_object':
    case 'reference_object':
    case 'reference':
    case 'relative_object':
      return { mode: 'relative_to_reference', rawLabel: rawMode.trim() };
    case 'random_in_area':
    case 'random_within_area':
    case 'random_area':
    case 'random_position_within_area':
    case 'area_random':
    case 'area':
      return { mode: 'random_in_area', rawLabel: rawMode.trim() };
    default:
      return { mode: null, rawLabel: rawMode.trim() };
  }
}

const VALID_BIOMES = new Set<string>(['Plains', 'Forest', 'Desert', 'Mountains', 'Beach']);
const VALID_WEATHERS = new Set<string>(['clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog']);
const VALID_PERIODS = new Set<string>(['morning', 'midday', 'evening', 'night']);
function normalizeQuestStatus(raw: string): QuestStatus | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'not_started' || normalized === 'available') return 'available';
  if (normalized === 'active') return 'active';
  if (normalized === 'ready_to_complete' || normalized === 'ready') return 'ready';
  if (normalized === 'completed') return 'completed';
  return null;
}

function parseConditions(
  raw: Record<string, unknown>,
  defaultQuantity: number,
): ModSpawnConditions {
  const condObj = isRecord(raw.conditions)
    ? raw.conditions
    : isRecord(raw.condition)
      ? raw.condition
      : raw;

  const triggersObj = isRecord(condObj.triggers)
    ? condObj.triggers
    : isRecord(raw.triggers)
      ? raw.triggers
      : condObj;

  const onNewWorld =
    typeof triggersObj.onNewWorld === 'boolean'
      ? triggersObj.onNewWorld
      : typeof condObj.onNewWorld === 'boolean'
        ? condObj.onNewWorld
        : true;
  const onWorldLoad =
    typeof triggersObj.onWorldLoad === 'boolean'
      ? triggersObj.onWorldLoad
      : typeof condObj.onWorldLoad === 'boolean'
        ? condObj.onWorldLoad
        : true;
  const onChunkLoad =
    typeof triggersObj.onChunkLoad === 'boolean'
      ? triggersObj.onChunkLoad
      : typeof condObj.onChunkLoad === 'boolean'
        ? condObj.onChunkLoad
        : true;

  let onAreaEnter = false;
  let areaEnterRadius: number | undefined;
  const rawAreaEnter = triggersObj.onAreaEnter ?? condObj.onAreaEnter;
  if (typeof rawAreaEnter === 'boolean') {
    onAreaEnter = rawAreaEnter;
  } else if (isRecord(rawAreaEnter)) {
    onAreaEnter = rawAreaEnter.enabled !== false;
    areaEnterRadius = finiteNum(rawAreaEnter.radius);
  }
  const enterRadiusOverride = finiteNum(condObj.areaEnterRadius ?? raw.areaEnterRadius);
  if (enterRadiusOverride !== undefined && enterRadiusOverride > 0) {
    areaEnterRadius = enterRadiusOverride;
    onAreaEnter = true;
  }

  let timeOfDay: ModSpawnConditions['timeOfDay'];
  const rawTime = condObj.timeOfDay ?? raw.timeOfDay;
  if (isRecord(rawTime)) {
    const startHour = finiteNum(rawTime.startHour ?? rawTime.minHour ?? rawTime.from);
    const endHour = finiteNum(rawTime.endHour ?? rawTime.maxHour ?? rawTime.to);
    const periods = Array.isArray(rawTime.periods)
      ? rawTime.periods
          .filter((p): p is NpcRoutinePeriod => typeof p === 'string' && VALID_PERIODS.has(p.trim().toLowerCase()))
          .map((p) => p.trim().toLowerCase() as NpcRoutinePeriod)
      : undefined;
    if (startHour !== undefined || endHour !== undefined || (periods && periods.length > 0)) {
      timeOfDay = {
        ...(startHour !== undefined ? { startHour } : {}),
        ...(endHour !== undefined ? { endHour } : {}),
        ...(periods && periods.length > 0 ? { periods } : {}),
      };
    }
  } else if (typeof rawTime === 'string' && VALID_PERIODS.has(rawTime.trim().toLowerCase())) {
    timeOfDay = { periods: [rawTime.trim().toLowerCase() as NpcRoutinePeriod] };
  } else if (Array.isArray(rawTime)) {
    const periods = rawTime
      .filter((p): p is string => typeof p === 'string' && VALID_PERIODS.has(p.trim().toLowerCase()))
      .map((p) => p.trim().toLowerCase() as NpcRoutinePeriod);
    if (periods.length > 0) timeOfDay = { periods };
  }

  const rawWeather = condObj.weather ?? raw.weather;
  let weather: WeatherState[] | undefined;
  if (typeof rawWeather === 'string' && VALID_WEATHERS.has(rawWeather.trim().toLowerCase())) {
    weather = [rawWeather.trim().toLowerCase() as WeatherState];
  } else if (Array.isArray(rawWeather)) {
    const wList = rawWeather
      .filter((w): w is string => typeof w === 'string' && VALID_WEATHERS.has(w.trim().toLowerCase()))
      .map((w) => w.trim().toLowerCase() as WeatherState);
    if (wList.length > 0) weather = wList;
  }

  const rawBiomes = condObj.biomes ?? condObj.biome ?? raw.biomes ?? raw.biome;
  let biomes: BiomeType[] | undefined;
  const resolveBiome = (val: string): BiomeType | null => {
    for (const b of VALID_BIOMES) {
      if (b.toLowerCase() === val.trim().toLowerCase()) return b as BiomeType;
    }
    return null;
  };
  if (typeof rawBiomes === 'string') {
    const b = resolveBiome(rawBiomes);
    if (b) biomes = [b];
  } else if (Array.isArray(rawBiomes)) {
    const bList = rawBiomes
      .filter((v): v is string => typeof v === 'string')
      .map(resolveBiome)
      .filter((b): b is BiomeType => b !== null);
    if (bList.length > 0) biomes = bList;
  }

  const rawDist = condObj.playerDistance ?? raw.playerDistance;
  let playerDistance: ModSpawnConditions['playerDistance'];
  if (isRecord(rawDist)) {
    const min = finiteNum(rawDist.min);
    const max = finiteNum(rawDist.max);
    if (min !== undefined || max !== undefined) {
      playerDistance = {
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
  } else {
    const minD = finiteNum(condObj.minPlayerDistance ?? raw.minPlayerDistance);
    const maxD = finiteNum(condObj.maxPlayerDistance ?? raw.maxPlayerDistance);
    if (minD !== undefined || maxD !== undefined) {
      playerDistance = {
        ...(minD !== undefined ? { min: minD } : {}),
        ...(maxD !== undefined ? { max: maxD } : {}),
      };
    }
  }

  const questIdRaw = condObj.questId ?? raw.questId;
  const questId = typeof questIdRaw === 'string' && questIdRaw.trim() ? questIdRaw.trim() : undefined;
  const rawQStatus = condObj.questStatus ?? raw.questStatus;
  let questStatus: QuestStatus[] | undefined;
  if (typeof rawQStatus === 'string') {
    const normalized = normalizeQuestStatus(rawQStatus);
    if (normalized) questStatus = [normalized];
  } else if (Array.isArray(rawQStatus)) {
    const qList = rawQStatus
      .filter((s): s is string => typeof s === 'string')
      .map(normalizeQuestStatus)
      .filter((s): s is QuestStatus => s !== null);
    if (qList.length > 0) questStatus = qList;
  }

  const reqFlag = condObj.requiredFlag ?? condObj.dialogueFlag ?? raw.requiredFlag;
  const forbFlag = condObj.forbiddenFlag ?? raw.forbiddenFlag;

  const maxActiveRaw = finiteNum(
    condObj.maxActiveInstances ?? raw.maxActiveInstances ?? condObj.maxInstances ?? raw.maxInstances,
  );
  const maxActiveInstances =
    maxActiveRaw !== undefined && maxActiveRaw >= 1
      ? Math.trunc(maxActiveRaw)
      : Math.max(1, defaultQuantity);

  const rawRespawn = condObj.respawn ?? raw.respawn;
  let respawnEnabled = false;
  let respawnDelaySeconds = 0;
  let oneTime = true;

  if (typeof rawRespawn === 'boolean') {
    respawnEnabled = rawRespawn;
    oneTime = !rawRespawn;
    respawnDelaySeconds = rawRespawn ? 120 : 0;
  } else if (isRecord(rawRespawn)) {
    oneTime =
      typeof rawRespawn.oneTime === 'boolean'
        ? rawRespawn.oneTime
        : rawRespawn.enabled === true
          ? false
          : true;
    respawnEnabled =
      typeof rawRespawn.enabled === 'boolean' ? rawRespawn.enabled : !oneTime;
    const delay = finiteNum(rawRespawn.delaySeconds ?? rawRespawn.delay ?? rawRespawn.cooldownSeconds);
    respawnDelaySeconds = delay !== undefined && delay >= 0 ? delay : respawnEnabled ? 120 : 0;
  }

  if (typeof condObj.oneTime === 'boolean') {
    oneTime = condObj.oneTime;
    if (oneTime) respawnEnabled = false;
  } else if (typeof raw.oneTime === 'boolean') {
    oneTime = raw.oneTime;
    if (oneTime) respawnEnabled = false;
  }

  const respawnDelayTop = finiteNum(condObj.respawnDelaySeconds ?? raw.respawnDelaySeconds);
  if (respawnDelayTop !== undefined && respawnDelayTop >= 0) {
    respawnDelaySeconds = respawnDelayTop;
    if (respawnDelayTop > 0 && rawRespawn === undefined) {
      respawnEnabled = true;
      oneTime = false;
    }
  }

  const perPlayerPickup = Boolean(
    condObj.perPlayerPickup ?? raw.perPlayerPickup ?? condObj.perPlayer ?? raw.perPlayer ?? false,
  );
  const snapToGround =
    typeof condObj.snapToGround === 'boolean'
      ? condObj.snapToGround
      : typeof raw.snapToGround === 'boolean'
        ? raw.snapToGround
        : undefined;

  return {
    onNewWorld,
    onWorldLoad,
    onChunkLoad,
    onAreaEnter,
    ...(areaEnterRadius !== undefined ? { areaEnterRadius } : {}),
    ...(timeOfDay ? { timeOfDay } : {}),
    ...(weather ? { weather } : {}),
    ...(biomes ? { biomes } : {}),
    ...(playerDistance ? { playerDistance } : {}),
    ...(questId ? { questId } : {}),
    ...(questStatus ? { questStatus } : {}),
    ...(typeof reqFlag === 'string' && reqFlag.trim() ? { requiredFlag: reqFlag.trim() } : {}),
    ...(typeof forbFlag === 'string' && forbFlag.trim() ? { forbiddenFlag: forbFlag.trim() } : {}),
    maxActiveInstances,
    respawn: {
      enabled: respawnEnabled,
      delaySeconds: respawnDelaySeconds,
      oneTime,
    },
    perPlayerPickup,
    ...(snapToGround !== undefined ? { snapToGround } : {}),
  };
}

export function sanitizeModSpawnDefinition(
  modId: string,
  raw: unknown,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
  defaults?: {
    contentId?: string;
    contentType?: ModSpawnContentType;
    index?: number;
  },
): ModSpawnDefinition | null {
  if (!isRecord(raw)) return null;

  const rawContentId =
    typeof raw.contentId === 'string' && raw.contentId.trim()
      ? raw.contentId.trim()
      : typeof raw.targetId === 'string' && raw.targetId.trim()
        ? raw.targetId.trim()
        : typeof raw.objectId === 'string' && raw.objectId.trim()
          ? raw.objectId.trim()
          : typeof raw.entityId === 'string' && raw.entityId.trim()
            ? raw.entityId.trim()
            : typeof raw.itemId === 'string' && raw.itemId.trim()
              ? raw.itemId.trim()
              : defaults?.contentId ?? '';

  const contentType = normalizeModSpawnContentType(
    raw.contentType ?? raw.targetType ?? raw.objectType ?? raw.category,
    defaults?.contentType,
  );

  const localSpawnId =
    typeof raw.spawnId === 'string' && raw.spawnId.trim()
      ? raw.spawnId.trim()
      : typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : `${rawContentId || 'spawn'}_${(defaults?.index ?? 0) + 1}`;

  const cleanSpawnSlug = localSpawnId.replace(/[^a-z0-9._:-]+/gi, '_');
  const fullIdRes = resolveModObjectIdentifier(
    modId,
    cleanSpawnSlug.includes(':') ? cleanSpawnSlug : `spawn_${cleanSpawnSlug}`,
    CORE_PROTECTED_IDS,
  );
  const fullRuleId = fullIdRes.ok
    ? fullIdRes.fullId
    : `${modId}:spawn_${Date.now()}_${defaults?.index ?? 0}`;

  const contentId = rawContentId ? resolveModCrossReference(modId, rawContentId) : '';

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;

  const rawModeVal = raw.mode ?? raw.positionMode ?? raw.spawnMode ?? raw.placementMode;
  const modeInfo = normalizeModSpawnMode(rawModeVal);
  const mode: ModSpawnMode = modeInfo.mode ?? 'absolute';

  const posVec = readVec3(
    raw,
    ['position', 'coordinates', 'coords', 'offset'],
    ['x', 'posX', 'coordX', 'offsetX'],
    ['y', 'posY', 'coordY', 'offsetY'],
    ['z', 'posZ', 'coordZ', 'offsetZ'],
  );

  const rotUnit = normalizeRotationUnit(raw);
  const rotVec = readVec3(
    raw,
    ['rotation', 'rotationDeg', 'rotationDegrees'],
    ['rotationX', 'rotX', 'rotationXDeg'],
    ['rotationY', 'rotY', 'yaw', 'rotationYDeg'],
    ['rotationZ', 'rotZ', 'rotationZDeg'],
  );

  const scaleVec = readVec3(
    raw,
    ['scale'],
    ['scaleX'],
    ['scaleY'],
    ['scaleZ'],
  );

  const quantityRaw = finiteNum(raw.quantity ?? raw.count);
  const quantity =
    quantityRaw !== undefined && quantityRaw >= 1 ? Math.trunc(quantityRaw) : 1;

  // Area parsing for random_in_area
  let area: ModSpawnAreaConfig | undefined;
  const areaObj = isRecord(raw.area) ? raw.area : isRecord(raw.bounds) ? raw.bounds : raw;
  const minX = finiteNum(areaObj.minX);
  const maxX = finiteNum(areaObj.maxX);
  const minZ = finiteNum(areaObj.minZ);
  const maxZ = finiteNum(areaObj.maxZ);
  if (minX !== undefined && maxX !== undefined && minZ !== undefined && maxZ !== undefined) {
    const areaQtyRaw = finiteNum(areaObj.quantity ?? areaObj.count ?? quantity);
    const areaQty = areaQtyRaw !== undefined && areaQtyRaw >= 1 ? Math.trunc(areaQtyRaw) : quantity;
    const minDist = finiteNum(areaObj.minDistance ?? raw.minDistance) ?? 0;
    const minY = finiteNum(areaObj.minY);
    const maxY = finiteNum(areaObj.maxY);
    const areaSeed = finiteNum(areaObj.seed ?? raw.seed);
    area = {
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
      ...(minY !== undefined ? { minY } : {}),
      ...(maxY !== undefined ? { maxY } : {}),
      quantity: areaQty,
      minDistance: Math.max(0, minDist),
      ...(areaSeed !== undefined ? { seed: Math.trunc(areaSeed) } : {}),
    };
  }

  const refObjRaw =
    raw.referenceObjectId ?? raw.referenceId ?? raw.reference ?? raw.anchorId;
  const referenceObjectId =
    typeof refObjRaw === 'string' && refObjRaw.trim() ? refObjRaw.trim() : undefined;
  const refTypeRaw = raw.referenceType ?? raw.referenceKind;
  const referenceType =
    typeof refTypeRaw === 'string' && refTypeRaw.trim() ? refTypeRaw.trim().toLowerCase() : undefined;

  const scaleX = scaleVec.x ?? 1;
  const scaleY = scaleVec.y ?? 1;
  const scaleZ = scaleVec.z ?? 1;

  const rotX = toRadians(rotVec.x ?? 0, rotUnit);
  const rotY = toRadians(rotVec.y ?? 0, rotUnit);
  const rotZ = toRadians(rotVec.z ?? 0, rotUnit);

  const conditions = parseConditions(raw, area?.quantity ?? quantity);

  // Validation checks (explicit failure diagnostics, never silent fallbacks)
  let validationError: ModSpawnDefinition['validationError'];

  if (!contentId) {
    validationError = {
      code: 'SPAWN_MISSING_CONTENT_ID',
      message: `Spawn rule "${localSpawnId}" in "${sourceFile}" is missing a target "contentId".`,
    };
  } else if (!contentType) {
    validationError = {
      code: 'SPAWN_UNSUPPORTED_CONTENT_TYPE',
      message: `Spawn rule "${localSpawnId}" in "${sourceFile}" has unsupported contentType "${String(raw.contentType ?? '')}".`,
    };
  } else if (modeInfo.mode === null) {
    validationError = {
      code: 'UNSUPPORTED_SPAWN_MODE',
      message: `Spawn rule "${localSpawnId}" in "${sourceFile}" uses unsupported spawn mode "${modeInfo.rawLabel}".`,
    };
  } else if (posVec.invalidReason) {
    validationError = {
      code: 'INVALID_SPAWN_COORDINATES',
      message: `Spawn rule "${localSpawnId}" in "${sourceFile}": ${posVec.invalidReason}`,
    };
  } else if (rotVec.invalidReason) {
    validationError = {
      code: 'INVALID_SPAWN_ROTATION',
      message: `Spawn rule "${localSpawnId}" in "${sourceFile}": ${rotVec.invalidReason}`,
    };
  } else if (scaleVec.invalidReason || scaleX <= 0 || scaleY <= 0 || scaleZ <= 0) {
    validationError = {
      code: 'INVALID_SPAWN_SCALE',
      message: `Spawn rule "${localSpawnId}" in "${sourceFile}": scale axes must be finite positive numbers > 0.`,
    };
  } else if (
    (mode === 'absolute' || mode === 'relative_to_world_spawn' || mode === 'relative_to_reference') &&
    (posVec.x === undefined || posVec.z === undefined)
  ) {
    validationError = {
      code: 'MISSING_SPAWN_COORDINATES',
      message: `Spawn rule "${localSpawnId}" (${mode}) in "${sourceFile}" requires numeric x and z coordinates.`,
    };
  } else if (mode === 'relative_to_reference' && !referenceObjectId) {
    validationError = {
      code: 'MISSING_REFERENCE_OBJECT',
      message: `Spawn rule "${localSpawnId}" (${mode}) in "${sourceFile}" requires "referenceObjectId".`,
    };
  } else if (mode === 'random_in_area' && !area) {
    validationError = {
      code: 'INVALID_SPAWN_AREA',
      message: `Spawn rule "${localSpawnId}" (random_in_area) in "${sourceFile}" requires minX, maxX, minZ, maxZ.`,
    };
  }

  if (validationError) {
    diagnostics.push({
      code: validationError.code,
      severity: 'warning',
      message: validationError.message,
    });
  }

  return {
    id: fullRuleId,
    spawnId: localSpawnId,
    modId,
    contentId,
    contentType: contentType ?? 'item',
    sourceFile,
    enabled,
    mode,
    ...(modeInfo.mode === null ? { unsupportedMode: modeInfo.rawLabel } : {}),
    position: {
      x: posVec.x ?? 0,
      ...(posVec.y !== undefined ? { y: posVec.y } : {}),
      z: posVec.z ?? 0,
    },
    hasExplicitY: posVec.y !== undefined,
    rotation: {
      x: rotX,
      y: rotY,
      z: rotZ,
    },
    rotationUnit: rotUnit,
    scale: {
      x: scaleX,
      y: scaleY,
      z: scaleZ,
    },
    ...(referenceObjectId ? { referenceObjectId } : {}),
    ...(referenceType ? { referenceType } : {}),
    ...(area ? { area } : {}),
    quantity: area?.quantity ?? quantity,
    conditions,
    ...(typeof raw.behavior === 'string' && raw.behavior.trim()
      ? { behavior: raw.behavior.trim() }
      : {}),
    ...(validationError ? { validationError } : {}),
    raw,
  };
}

/**
 * Extracts inline `spawnConfig` / `spawn` / `worldSpawn` / `spawns` declarations from any
 * mod content JSON entry without mutating the entry itself.
 */
export function extractInlineSpawnDefinitions(
  modId: string,
  rawEntry: unknown,
  contentId: string,
  contentType: ModSpawnContentType,
  sourceFile: string,
  diagnostics: ModDiagnostic[],
): ModSpawnDefinition[] {
  if (!isRecord(rawEntry)) return [];
  const rawList: unknown[] = [];
  for (const key of ['spawnConfig', 'spawnConfigs', 'spawn', 'worldSpawn', 'spawns']) {
    const val = rawEntry[key];
    if (Array.isArray(val)) {
      rawList.push(...val);
    } else if (isRecord(val)) {
      rawList.push(val);
    }
  }
  if (rawList.length === 0) return [];

  const out: ModSpawnDefinition[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const def = sanitizeModSpawnDefinition(modId, rawList[i], sourceFile, diagnostics, {
      contentId,
      contentType,
      index: i,
    });
    if (def) out.push(def);
  }
  return out;
}
