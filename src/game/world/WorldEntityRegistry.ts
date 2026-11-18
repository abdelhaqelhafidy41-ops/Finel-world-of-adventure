import { toChunkKey, worldToChunkCoords } from './ChunkManager';

export type AuthoritativeEntityType =
  | 'villager'
  | 'npc'
  | 'enemy'
  | 'thief'
  | 'monster'
  | 'boss'
  | 'animal';

export type QuestTargetLifecycleState =
  | 'QUEST_TARGET_REQUIRED'
  | 'SPAWN_REQUESTED'
  | 'SPAWNED'
  | 'ACTIVE'
  | 'DEFEATED';

export interface AuthoritativeQuestTargetRef {
  questId: string;
  objectiveId: string;
  enemyType: string;
  lifecycle: QuestTargetLifecycleState;
}

export interface AuthoritativeEntityRecord {
  entityId: string;
  type: AuthoritativeEntityType;
  worldId: string;
  chunkId: string;
  position: { x: number; y: number; z: number };
  state: string;
  alive: boolean;
  loaded: boolean;
  valid: boolean;
  visibleInWorld: boolean;
  name?: string;
  nameAr?: string;
  role?: string;
  archetype?: string;
  questTarget?: AuthoritativeQuestTargetRef;
}

export interface AuthoritativeQuestTargetPlan {
  questId: string;
  objectiveId: string;
  enemyType: string;
  canonicalType: string;
  requiredCount: number;
  currentCount: number;
  lifecycle: QuestTargetLifecycleState;
  worldId: string;
  chunkId: string;
  targetX?: number;
  targetZ?: number;
  loaded: boolean;
  cancelled: boolean;
}

const ENEMY_ALIAS_MAP: Record<string, string> = {
  thief: 'bandit_scout',
  thieves: 'bandit_scout',
  bandit: 'bandit_scout',
  bandits: 'bandit_scout',
  bandit_scout: 'bandit_scout',
  raider: 'bandit_scout',
  stalker: 'thorn_stalker',
  thorn_stalker: 'thorn_stalker',
  sentinel: 'stone_sentinel',
  golem: 'stone_sentinel',
  stone_sentinel: 'stone_sentinel',
  monster: 'ancient_monster',
  monsters: 'ancient_monster',
  ancient_monster: 'ancient_monster',
  boss: 'ancient_guardian',
  guardian: 'ancient_guardian',
  ancient_guardian: 'ancient_guardian',
};

/**
 * Resolves friendly or plural quest target names (e.g. "thief", "thieves",
 * "monster", "boss") to the canonical combat archetype ID while preserving
 * wildcard tags like `any` and `animal:*`.
 */
export function normalizeEnemyTypeAlias(rawType: string): string {
  const clean = rawType.trim().toLowerCase();
  if (!clean) return 'any';
  if (clean === 'any' || clean.startsWith('animal:')) return clean;
  return ENEMY_ALIAS_MAP[clean] ?? clean;
}

export function enemyTypeMatches(expectedType: string, actualType: string): boolean {
  const expected = normalizeEnemyTypeAlias(expectedType);
  if (expected === 'any') return true;
  if (expected === 'animal:any') {
    return actualType.trim().toLowerCase().startsWith('animal:');
  }
  const actual = normalizeEnemyTypeAlias(actualType);
  return expected === actual;
}

export function resolveChunkIdAt(x: number, z: number, chunkSize = 120): string {
  const { cx, cz } = worldToChunkCoords(x, z, chunkSize);
  return toChunkKey(cx, cz);
}

/**
 * Authoritative map-marker rule:
 * A marker is ONLY valid if the entity is alive, valid, loaded in the active world,
 * not hidden/culled, and (if a quest target) its quest is not cancelled and target is not defeated.
 */
export function isEntityMarkerEligible(
  record: AuthoritativeEntityRecord,
  cancelledQuestIds?: ReadonlySet<string>,
): boolean {
  if (!record.alive || !record.valid || !record.loaded || !record.visibleInWorld) {
    return false;
  }
  if (
    !Number.isFinite(record.position.x) ||
    !Number.isFinite(record.position.y) ||
    !Number.isFinite(record.position.z)
  ) {
    return false;
  }
  if (record.questTarget) {
    if (record.questTarget.lifecycle === 'DEFEATED') return false;
    if (cancelledQuestIds?.has(record.questTarget.questId)) return false;
  }
  return true;
}

/**
 * Single source of truth for world entities across 3D scene, minimap, full map, and multiplayer sync.
 */
export class WorldEntityRegistry {
  public worldId: string;
  private readonly entities = new Map<string, AuthoritativeEntityRecord>();
  private readonly questPlans = new Map<string, AuthoritativeQuestTargetPlan>();
  private readonly cancelledQuestIds = new Set<string>();

  constructor(worldId = 'world-main') {
    this.worldId = worldId;
  }

  public setWorldId(worldId: string): void {
    this.worldId = worldId;
  }

  public clear(): void {
    this.entities.clear();
    this.questPlans.clear();
  }

  public markQuestCancelled(questId: string): void {
    this.cancelledQuestIds.add(questId);
    for (const [key, plan] of this.questPlans) {
      if (plan.questId === questId) {
        this.questPlans.delete(key);
      }
    }
    for (const record of this.entities.values()) {
      if (record.questTarget?.questId === questId) {
        record.questTarget = undefined;
      }
    }
  }

  public clearQuestCancellation(questId: string): void {
    this.cancelledQuestIds.delete(questId);
  }

  public isQuestCancelled(questId: string): boolean {
    return this.cancelledQuestIds.has(questId);
  }

  public upsertEntity(record: AuthoritativeEntityRecord): void {
    this.entities.set(record.entityId, record);
  }

  public removeEntity(entityId: string): void {
    this.entities.delete(entityId);
  }

  public getEntity(entityId: string): AuthoritativeEntityRecord | undefined {
    return this.entities.get(entityId);
  }

  /**
   * Replaces all records of the given prefix/predicate cleanly during a sync pass.
   */
  public pruneNotIn(activeIds: ReadonlySet<string>, types: ReadonlySet<AuthoritativeEntityType>): void {
    for (const [id, rec] of this.entities) {
      if (types.has(rec.type) && !activeIds.has(id)) {
        this.entities.delete(id);
      }
    }
  }

  public setQuestTargetPlans(plans: AuthoritativeQuestTargetPlan[]): void {
    this.questPlans.clear();
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (p.cancelled || this.cancelledQuestIds.has(p.questId)) continue;
      this.questPlans.set(`${p.questId}:${p.objectiveId}`, p);
    }
  }

  public getQuestTargetPlans(): AuthoritativeQuestTargetPlan[] {
    return Array.from(this.questPlans.values());
  }

  public getVisibleVillagers(): AuthoritativeEntityRecord[] {
    const out: AuthoritativeEntityRecord[] = [];
    for (const rec of this.entities.values()) {
      if ((rec.type === 'villager' || rec.type === 'npc') && isEntityMarkerEligible(rec, this.cancelledQuestIds)) {
        out.push(rec);
      }
    }
    return out;
  }

  public getVisibleAnimals(): AuthoritativeEntityRecord[] {
    const out: AuthoritativeEntityRecord[] = [];
    for (const rec of this.entities.values()) {
      if (rec.type === 'animal' && isEntityMarkerEligible(rec, this.cancelledQuestIds)) {
        out.push(rec);
      }
    }
    return out;
  }

  public getActiveQuestTargets(): AuthoritativeEntityRecord[] {
    const out: AuthoritativeEntityRecord[] = [];
    for (const rec of this.entities.values()) {
      if (!rec.questTarget) continue;
      if (!isEntityMarkerEligible(rec, this.cancelledQuestIds)) continue;
      if (rec.questTarget.lifecycle !== 'ACTIVE' && rec.questTarget.lifecycle !== 'SPAWNED') {
        continue;
      }
      out.push(rec);
    }
    return out;
  }

  public getAllEntities(): AuthoritativeEntityRecord[] {
    return Array.from(this.entities.values());
  }
}
