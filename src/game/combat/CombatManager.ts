import * as THREE from 'three';
import {
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  getBiomeAt,
  groundHeightAt,
  groundSlopeAt,
  seededRandom,
} from '../math/noise';
import type { BiomeType, WorldCollider } from '../types';
import type { ResolvedGraphicsProfile } from '../engine/GraphicsQualityManager';
import type {
  SyncedEntityDelta,
  WorldEntitySnapshot,
} from '../../../shared/multiplayerProtocol';
import type { SavedQuestTargetEntry } from '../save/saveTypes';
import {
  enemyTypeMatches,
  normalizeEnemyTypeAlias,
  resolveChunkIdAt,
  type QuestTargetLifecycleState,
} from '../world/WorldEntityRegistry';
import {
  findSafeClearColliderPoint,
  findValidQuestTargetPoint,
  isPointBlockedByColliders,
  validateQuestTargetLocation,
} from '../world/WorldPlacementValidator';
import { worldToChunkCoords } from '../world/ChunkManager';
import { DamageSystem } from './DamageSystem';
import {
  EnemyController,
  type EnemyUpdateContext,
  type RemoteCombatPlayerTarget,
} from './EnemyController';
import { createEnemySharedAssets, type EnemySharedAssets } from './EnemyRig';
import { HealthComponent } from './HealthComponent';
import type {
  CombatEnemyHudTarget,
  CombatTarget,
  DamagePacket,
  DamageResult,
  EnemyArchetypeConfig,
  EnemyArchetypeId,
} from './combatTypes';
import type {
  Weapon,
  WeaponAttackAnimType,
  WeaponAttackContext,
  WeaponStats,
} from './weapons/Weapon';
import { BowWeapon } from './weapons/BowWeapon';
import { WeaponRegistry } from './weapons/WeaponRegistry';
import type { WildlifeManager } from '../wildlife/WildlifeManager';

interface HitSpark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scale: number;
  life: number;
  maxLife: number;
}

const MAX_SPARK_INSTANCES = 20;
const _sparkDummy = new THREE.Object3D();
const _animalFwdDir = new THREE.Vector3();

export interface CombatManagerOptions {
  scene: THREE.Scene;
  contactShadowMap: THREE.Texture;
  isSoftwareGl: boolean;
  seed: number;
  playerMaxHealth: number;
  playerPosition: THREE.Vector3;
  weaponMount?: THREE.Group;
  isVillageClearance: (x: number, z: number) => boolean;
  onPlayerDamaged: (result: DamageResult, packet: DamagePacket) => void;
  onPlayerDefeated: () => void;
  onEnemyHit?: (enemy: EnemyController, result: DamageResult) => void;
  onEnemyDefeated?: (
    enemy: EnemyController,
    killMeta?: import('./EnemyController').EnemyKillMetadata,
  ) => void;
  onEnemySwing?: (enemy: EnemyController) => void;
}

const UNARMED_COOLDOWN = 0.38;
const UNARMED_HIT_DELAY = 0.08;
const UNARMED_DAMAGE = 9;
const UNARMED_RANGE = 2.0;
const UNARMED_KNOCKBACK = 3.2;

const _unarmedScratch: EnemyController[] = [];

/**
 * Modular third-person CombatManager coordinating:
 * - WeaponRegistry & active Weapon instances (Sword, Axe, Bow, or Unarmed)
 * - Attack cooldowns, hit detection & projectile simulation
 * - Enemy spawning, aggression, chasing, attacks & death rewards
 * - DamageSystem & HealthComponent integration
 */
export interface QuestTargetBinding {
  questId: string;
  objectiveId: string;
  enemyType: string;
  lifecycle: QuestTargetLifecycleState;
}

export interface EnemyBlueprintRecord {
  readonly id: string;
  readonly archetypeId: EnemyArchetypeId;
  x: number;
  y?: number;
  z: number;
  readonly seed: number;
  chunkId: string;
  defeated: boolean;
  savedHp: number | null;
  controller: EnemyController | null;
  questTarget?: QuestTargetBinding;
  isDynamicQuestSpawn?: boolean;
  exactPosition?: boolean;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  customArchetype?: Partial<EnemyArchetypeConfig>;
  respawnEnabled?: boolean;
  respawnDelaySeconds?: number;
  isModSpawn?: boolean;
  modId?: string;
  modSpawnId?: string;
}

export class CombatManager {
  public readonly damageSystem = new DamageSystem();
  public readonly weaponRegistry = new WeaponRegistry();
  public readonly enemies: EnemyController[] = [];
  public readonly playerHealth: HealthComponent;
  public readonly playerTarget: CombatTarget;

  private readonly enemyBlueprints: EnemyBlueprintRecord[] = [];
  private enemyStreamDist = 145;
  private readonly scene: THREE.Scene;
  private readonly assets: EnemySharedAssets;
  private weaponMount: THREE.Group | null;
  private activeWeapon: Weapon | null = null;

  private attackCooldownTimer = 0;
  private lastAttackTotalCooldown = UNARMED_COOLDOWN;
  private pendingHitTimer = -1;
  private pendingAttackWeapon: Weapon | null = null;
  private pendingAttackOrigin = new THREE.Vector3();
  private pendingAttackYaw = 0;
  private pendingAttackId = '';
  private nextAttackSeq = 0;

  private bowCharging = false;
  private bowChargeElapsed = 0;
  private bowChargeMinTime = 0.2;
  private bowChargeDuration = 2.0;
  private pendingBowChargeFactor = 1.0;
  private readonly pendingBowLaunchOrigin = new THREE.Vector3();
  private readonly pendingAimTargetPoint = new THREE.Vector3();
  private hasPendingBowOrigin = false;
  private hasPendingAimTarget = false;

  private recentTarget: EnemyController | null = null;
  private recentTargetTimer = 0;

  // Lightweight pooled combat VFX (slash arc + hit sparks)
  private readonly slashMesh: THREE.Mesh;
  private readonly slashGeo: THREE.RingGeometry;
  private readonly slashMat: THREE.MeshBasicMaterial;
  private slashTimer = 0;

  private readonly sparkPool: HitSpark[] = [];
  private readonly sparkMesh: THREE.InstancedMesh;
  private readonly sparkGeo: THREE.OctahedronGeometry;
  private readonly sparkMat: THREE.MeshBasicMaterial;
  private readonly weaponAttackCtx: WeaponAttackContext;
  private readonly enemyUpdateCtx: EnemyUpdateContext;
  private readonly spawnHitSparksCb: (x: number, y: number, z: number, count: number) => void;
  private readonly onWeaponEnemyHitCb: (enemy: EnemyController, result: DamageResult) => void;
  private readonly onEnemyAttackHitCb: () => void;
  private sparkScale = 1.0;
  private networkRemoteControlled = false;
  private isChunkLoadedCb?: (cx: number, cz: number) => boolean;
  private queryCollidersNearCb?: (x: number, z: number) => WorldCollider[];
  private readonly lastSyncSnapshot = new Map<
    string,
    {
      x: number;
      y: number;
      z: number;
      yaw: number;
      state: string;
      hp: number;
      isDead: boolean;
      targetPlayerId?: string;
      bossPhase?: number;
      attackState?: string;
    }
  >();

  constructor(private readonly options: CombatManagerOptions) {
    this.scene = options.scene;
    this.weaponMount = options.weaponMount ?? null;
    this.assets = createEnemySharedAssets(options.contactShadowMap);

    this.spawnHitSparksCb = (x, y, z, count) => this.spawnHitSparks(x, y, z, count);
    this.onWeaponEnemyHitCb = (enemy, result) => {
      this.recentTarget = enemy;
      this.recentTargetTimer = 5.5;
      this.options.onEnemyHit?.(enemy, result);
    };
    this.onEnemyAttackHitCb = () => {
      this.spawnHitSparks(
        this.playerTarget.position.x,
        this.playerTarget.position.y + 1.05,
        this.playerTarget.position.z,
        5,
      );
    };

    this.playerHealth = new HealthComponent({
      maxHealth: options.playerMaxHealth,
      invulnerabilityDuration: 0.45,
      damageReduction: 0,
    });

    this.playerTarget = {
      id: 'player',
      name: 'Adventurer',
      nameAr: 'المغامر',
      faction: 'player',
      health: this.playerHealth,
      position: options.playerPosition,
      hitRadius: 0.48,
      hitHeight: 1.85,
      onDamaged: (result, packet) => options.onPlayerDamaged(result, packet),
      onDeath: () => options.onPlayerDefeated(),
    };

    this.weaponAttackCtx = {
      origin: options.playerPosition,
      yaw: 0,
      scene: this.scene,
      damageSystem: this.damageSystem,
      enemies: this.enemies,
      wildlife: null,
      spawnHitSparks: this.spawnHitSparksCb,
      onEnemyHit: this.onWeaponEnemyHitCb,
      onPlayerWeaponHit: undefined,
    };

    this.enemyUpdateCtx = {
      dt: 0,
      elapsed: 0,
      camera: null,
      playerTarget: this.playerTarget,
      damageSystem: this.damageSystem,
      queryCollidersNear: () => [],
      isVillageClearance: options.isVillageClearance,
      onEnemySwing: options.onEnemySwing,
      onEnemyAttackHit: this.onEnemyAttackHitCb,
      simThrottleScale: 1,
    };

    // Slash arc mesh for melee swings
    this.slashGeo = new THREE.RingGeometry(
      0.95,
      1.55,
      18,
      1,
      -Math.PI * 0.38,
      Math.PI * 0.76,
    );
    this.slashGeo.rotateX(-Math.PI / 2);
    this.slashMat = new THREE.MeshBasicMaterial({
      color: 0xf7e4a1,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.slashMesh = new THREE.Mesh(this.slashGeo, this.slashMat);
    this.slashMesh.visible = false;
    this.scene.add(this.slashMesh);

    // Hit spark InstancedMesh (1 draw call instead of 20)
    this.sparkGeo = new THREE.OctahedronGeometry(0.085, 0);
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.sparkMesh = new THREE.InstancedMesh(
      this.sparkGeo,
      this.sparkMat,
      MAX_SPARK_INSTANCES,
    );
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.matrixAutoUpdate = false;
    this.scene.add(this.sparkMesh);

    for (let i = 0; i < MAX_SPARK_INSTANCES; i++) {
      this.sparkPool.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        scale: 1,
        life: 0,
        maxLife: 0.25,
      });
    }

    this.spawnEnemies(options.seed, options.isSoftwareGl, options.isVillageClearance);
  }

  public setWeaponMount(mount: THREE.Group): void {
    this.weaponMount = mount;
    if (this.activeWeapon) {
      this.activeWeapon.onEquip(mount);
    }
  }

  public setWildlifeManager(wildlife: WildlifeManager | null): void {
    this.weaponAttackCtx.wildlife = wildlife;
  }

  public setOnPlayerWeaponHit(cb: ((hitCount: number) => void) | undefined): void {
    this.weaponAttackCtx.onPlayerWeaponHit = cb;
  }

  public setBowWorldCallbacks(opts: {
    queryCollidersNear?: (x: number, z: number) => WorldCollider[];
    onArrowStick?: (
      x: number,
      y: number,
      z: number,
      material?: 'wood' | 'stone' | 'water' | 'dirt',
    ) => void;
    onArrowFly?: (x: number, y: number, z: number) => void;
    onEnvironmentStrike?: (
      material: 'wood' | 'stone',
      x: number,
      y: number,
      z: number,
    ) => void;
    onHeadshotHit?: (
      targetKind: 'enemy' | 'animal',
      x: number,
      y: number,
      z: number,
    ) => void;
    npcRayTest?: WeaponAttackContext['npcRayTest'];
    onNpcHit?: WeaponAttackContext['onNpcHit'];
  }): void {
    this.weaponAttackCtx.queryCollidersNear = opts.queryCollidersNear;
    this.weaponAttackCtx.onArrowStick = opts.onArrowStick;
    this.weaponAttackCtx.onArrowFly = opts.onArrowFly;
    this.weaponAttackCtx.onEnvironmentStrike = opts.onEnvironmentStrike;
    this.weaponAttackCtx.onHeadshotHit = opts.onHeadshotHit;
    this.weaponAttackCtx.npcRayTest = opts.npcRayTest;
    this.weaponAttackCtx.onNpcHit = opts.onNpcHit;
  }

  public setMultiplayerCallbacks(opts: {
    multiplayerAuthoritative: boolean;
    npcStrikeTest?: WeaponAttackContext['npcStrikeTest'];
    playerStrikeTest?: WeaponAttackContext['playerStrikeTest'];
    playerRayTest?: WeaponAttackContext['playerRayTest'];
    onMultiplayerMeleeHit?: WeaponAttackContext['onMultiplayerMeleeHit'];
    onMultiplayerArrowFired?: WeaponAttackContext['onMultiplayerArrowFired'];
    onMultiplayerProjectileHit?: WeaponAttackContext['onMultiplayerProjectileHit'];
  }): void {
    this.weaponAttackCtx.multiplayerAuthoritative = opts.multiplayerAuthoritative;
    this.weaponAttackCtx.npcStrikeTest = opts.npcStrikeTest;
    this.weaponAttackCtx.playerStrikeTest = opts.playerStrikeTest;
    this.weaponAttackCtx.playerRayTest = opts.playerRayTest;
    this.weaponAttackCtx.onMultiplayerMeleeHit = opts.onMultiplayerMeleeHit;
    this.weaponAttackCtx.onMultiplayerArrowFired = opts.onMultiplayerArrowFired;
    this.weaponAttackCtx.onMultiplayerProjectileHit = opts.onMultiplayerProjectileHit;
  }

  public setNetworkRemoteControlled(remote: boolean): void {
    if (this.networkRemoteControlled === remote) return;
    this.networkRemoteControlled = remote;
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].setNetworkRemoteControlled(remote);
    }
  }

  public setMultiplayerTargets(
    localPlayerId: string | undefined,
    remoteTargets: RemoteCombatPlayerTarget[],
    onEnemyAttackRemotePlayer?: (
      enemy: EnemyController,
      targetPlayerId: string,
      damage: number,
    ) => void,
  ): void {
    this.enemyUpdateCtx.localPlayerId = localPlayerId;
    this.enemyUpdateCtx.remoteTargets = remoteTargets;
    this.enemyUpdateCtx.onEnemyAttackRemotePlayer = onEnemyAttackRemotePlayer;
  }

  public applyAuthoritativeEnemyDamage(
    enemyId: string,
    hp: number,
    maxHp: number,
    killed: boolean,
    attackerX?: number,
    attackerZ?: number,
    attackerId?: string,
  ): { enemy: EnemyController; justKilled: boolean } | null {
    const enemy = this.enemies.find((e) => e.id === enemyId);
    if (!enemy) {
      if (killed) {
        const bp = this.enemyBlueprints.find((b) => b.id === enemyId);
        if (bp) {
          bp.defeated = true;
          if (bp.questTarget) {
            bp.questTarget.lifecycle = 'DEFEATED';
          }
        }
      }
      return null;
    }
    const justKilled = enemy.applyAuthoritativeHealth(
      hp,
      maxHp,
      killed,
      attackerX,
      attackerZ,
      attackerId,
    );
    if (!killed) {
      this.recentTarget = enemy;
      this.recentTargetTimer = 5.5;
    } else if (this.recentTarget === enemy) {
      this.recentTarget = null;
    }
    return { enemy, justKilled };
  }

  public exportSyncDeltas(
    centers: Array<{ x: number; z: number }>,
    maxCount = 8,
    maxRadius = 80,
  ): SyncedEntityDelta[] {
    if (this.networkRemoteControlled || centers.length === 0) return [];
    const rSq = maxRadius * maxRadius;
    const deltas: SyncedEntityDelta[] = [];

    for (let pass = 0; pass < 2 && deltas.length < maxCount; pass++) {
      for (let i = 0; i < this.enemies.length && deltas.length < maxCount; i++) {
        const e = this.enemies[i];
        const qTarget = this.getQuestTargetForEnemy(e.id);
        const isPriority = Boolean(qTarget) || e.archetype.isBoss;
        if (pass === 0 && !isPriority) continue;
        if (pass === 1 && isPriority) continue;

        let near = false;
        if (qTarget || e.archetype.isBoss) {
          near = true;
        } else {
          for (let c = 0; c < centers.length; c++) {
            const dx = e.position.x - centers[c].x;
            const dz = e.position.z - centers[c].z;
            if (dx * dx + dz * dz <= rSq) {
              near = true;
              break;
            }
          }
        }
        if (!near) continue;

        const isDead = e.state === 'dead';
        const hp = Math.round(e.health.getCurrentHealth());
        const prev = this.lastSyncSnapshot.get(e.id);
        if (isDead && prev?.isDead) {
          continue;
        }

        const bossPhase = e.archetype.isBoss ? e.bossPhase : undefined;
        const attackState = e.archetype.isBoss ? e.attackState : undefined;

        const moved =
          !prev ||
          Math.abs(e.position.x - prev.x) > 0.08 ||
          Math.abs(e.position.y - prev.y) > 0.08 ||
          Math.abs(e.position.z - prev.z) > 0.08 ||
          Math.abs(e.yaw - prev.yaw) > 0.06 ||
          prev.state !== e.state ||
          prev.hp !== hp ||
          prev.isDead !== isDead ||
          prev.targetPlayerId !== (e.targetPlayerId ?? undefined) ||
          prev.bossPhase !== bossPhase ||
          prev.attackState !== attackState;

        if (!moved) continue;

        const x = Math.round(e.position.x * 100) / 100;
        const y = Math.round(e.position.y * 100) / 100;
        const z = Math.round(e.position.z * 100) / 100;
        const yaw = Math.round(e.yaw * 1000) / 1000;
        const targetPlayerId = e.targetPlayerId ?? undefined;

        this.lastSyncSnapshot.set(e.id, {
          x,
          y,
          z,
          yaw,
          state: e.state,
          hp,
          isDead,
          targetPlayerId,
          bossPhase,
          attackState,
        });

        const chunkId = resolveChunkIdAt(e.position.x, e.position.z);

        deltas.push({
          id: e.id,
          kind: 'enemy',
          archetype: e.archetype.id,
          worldId: 'world-main',
          chunkId,
          x,
          y,
          z,
          yaw,
          state: e.state,
          hp,
          maxHp: e.health.getMaxHealth(),
          alive: !isDead,
          loaded: true,
          isDead,
          ...(qTarget ? { questTarget: { ...qTarget } } : {}),
          ...(targetPlayerId ? { targetPlayerId } : {}),
          ...(e.archetype.isBoss
            ? {
                isBoss: true,
                bossPhase: e.bossPhase,
                attackState: e.attackState,
              }
            : {}),
        });
      }
    }

    return deltas;
  }

  public applySyncDeltas(deltas: SyncedEntityDelta[]): void {
    for (let i = 0; i < deltas.length; i++) {
      const d = deltas[i];
      if (d.kind !== 'enemy') continue;
      let enemy = this.enemies.find((e) => e.id === d.id);
      if (!enemy && !d.isDead) {
        enemy = this.upsertSyncedEnemy(d) ?? undefined;
      }
      if (enemy) {
        enemy.applyRemoteSync(d);
      }
      const bp = this.enemyBlueprints.find((b) => b.id === d.id);
      if (bp) {
        if (d.isDead) {
          bp.defeated = true;
          if (bp.questTarget) {
            bp.questTarget.lifecycle = 'DEFEATED';
          }
        }
        if (d.questTarget) {
          bp.questTarget = {
            questId: d.questTarget.questId,
            objectiveId: d.questTarget.objectiveId,
            enemyType: d.questTarget.enemyType ?? d.archetype ?? bp.archetypeId,
            lifecycle: (d.isDead ? 'DEFEATED' : d.questTarget.lifecycle) as QuestTargetLifecycleState,
          };
        }
      }
    }
  }

  public restoreEntitySnapshots(snaps: WorldEntitySnapshot[]): void {
    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i];
      if (s.kind !== 'enemy') continue;
      let enemy = this.enemies.find((e) => e.id === s.id);
      if (!enemy && !s.isDead && s.hp > 0) {
        enemy = this.upsertSyncedEnemy(s) ?? undefined;
      }
      if (enemy) {
        enemy.applyPersistedSnapshot(s);
      }
      const bp = this.enemyBlueprints.find((b) => b.id === s.id);
      if (bp) {
        if (s.isDead || s.hp <= 0) {
          bp.defeated = true;
          if (bp.questTarget) {
            bp.questTarget.lifecycle = 'DEFEATED';
          }
        }
        if (s.questTarget) {
          bp.questTarget = {
            questId: s.questTarget.questId,
            objectiveId: s.questTarget.objectiveId,
            enemyType: s.questTarget.enemyType ?? s.archetype ?? bp.archetypeId,
            lifecycle: (s.isDead ? 'DEFEATED' : s.questTarget.lifecycle) as QuestTargetLifecycleState,
          };
        }
      }
    }
  }

  public getQuestTargetBinding(id: string): QuestTargetBinding | undefined {
    return this.getQuestTargetForEnemy(id);
  }

  private getQuestTargetForEnemy(id: string): QuestTargetBinding | undefined {
    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      if (this.enemyBlueprints[i].id === id) {
        return this.enemyBlueprints[i].questTarget;
      }
    }
    return undefined;
  }

  private resolveValidArchetype(raw?: string): EnemyArchetypeId {
    const norm = normalizeEnemyTypeAlias(raw ?? 'bandit_scout');
    if (
      norm === 'bandit_scout' ||
      norm === 'thorn_stalker' ||
      norm === 'stone_sentinel' ||
      norm === 'ancient_monster' ||
      norm === 'ancient_guardian'
    ) {
      return norm;
    }
    return 'bandit_scout';
  }

  private upsertSyncedEnemy(
    data: Pick<SyncedEntityDelta, 'id' | 'archetype' | 'x' | 'z' | 'isDead' | 'questTarget'>,
  ): EnemyController | null {
    const existingBp = this.enemyBlueprints.find((b) => b.id === data.id);
    if (existingBp) {
      if (data.isDead) {
        existingBp.defeated = true;
        return existingBp.controller;
      }
      if (!existingBp.controller) {
        existingBp.x = data.x;
        existingBp.z = data.z;
        existingBp.chunkId = resolveChunkIdAt(data.x, data.z);
        this.materializeEnemy(existingBp);
      }
      return existingBp.controller;
    }

    if (data.isDead) return null;
    const archetypeId = this.resolveValidArchetype(data.archetype);
    const bp: EnemyBlueprintRecord = {
      id: data.id,
      archetypeId,
      x: data.x,
      z: data.z,
      seed: Math.abs(Math.round(data.x * 17 + data.z * 31)) + 991,
      chunkId: resolveChunkIdAt(data.x, data.z),
      defeated: false,
      savedHp: null,
      controller: null,
      isDynamicQuestSpawn: Boolean(data.questTarget),
      ...(data.questTarget
        ? {
            questTarget: {
              questId: data.questTarget.questId,
              objectiveId: data.questTarget.objectiveId,
              enemyType: data.questTarget.enemyType ?? archetypeId,
              lifecycle: data.questTarget.lifecycle as QuestTargetLifecycleState,
            },
          }
        : {}),
    };
    this.enemyBlueprints.push(bp);
    this.materializeEnemy(bp);
    return bp.controller;
  }

  public equipWeapon(weaponId: string | null): boolean {
    if (this.activeWeapon?.stats.id === weaponId) {
      return true;
    }
    this.cancelBowCharge();
    if (this.activeWeapon) {
      this.activeWeapon.onUnequip();
      this.activeWeapon = null;
    }
    if (!weaponId) {
      return true;
    }

    const next = this.weaponRegistry.getOrCreate(weaponId);
    if (!next) return false;

    this.activeWeapon = next;
    if (this.weaponMount) {
      next.onEquip(this.weaponMount);
    }
    return true;
  }

  public getEquippedWeapon(): Weapon | null {
    return this.activeWeapon;
  }

  public getEquippedWeaponStats(): WeaponStats | null {
    return this.activeWeapon ? this.activeWeapon.stats : null;
  }

  public isRangedWeaponEquipped(): boolean {
    return Boolean(this.activeWeapon?.stats.isRanged);
  }

  public isChargingBow(): boolean {
    return this.bowCharging;
  }

  public getBowChargeProgress(): number {
    if (!this.bowCharging) return 0;
    return Math.max(
      0,
      Math.min(1, this.bowChargeElapsed / Math.max(0.05, this.bowChargeDuration)),
    );
  }

  public isBowMaxCharged(): boolean {
    return this.bowCharging && this.getBowChargeProgress() >= 0.995;
  }

  public beginBowCharge(): boolean {
    if (!this.canPlayerAttack()) return false;
    if (!this.activeWeapon || !this.activeWeapon.stats.isRanged) return false;
    const cfg =
      this.activeWeapon instanceof BowWeapon
        ? this.activeWeapon.getChargeConfig()
        : null;
    this.bowChargeMinTime = cfg?.minChargeTime ?? 0.2;
    this.bowChargeDuration =
      cfg?.chargeDuration ?? this.activeWeapon.stats.chargeDuration ?? 2.0;
    this.bowChargeElapsed = 0;
    this.bowCharging = true;
    this.setBowDrawVisual(true, 0);
    return true;
  }

  public updateBowCharge(dt: number): void {
    if (!this.bowCharging) return;
    if (!this.activeWeapon?.stats.isRanged || !this.playerHealth.isAlive()) {
      this.cancelBowCharge();
      return;
    }
    this.bowChargeElapsed = Math.min(
      this.bowChargeDuration,
      this.bowChargeElapsed + Math.max(0, dt),
    );
    this.setBowDrawVisual(true, this.getBowChargeProgress());
  }

  public setBowDrawVisual(active: boolean, charge: number): void {
    if (this.activeWeapon instanceof BowWeapon) {
      this.activeWeapon.setDrawState(active, charge);
    }
  }

  public getBowNockWorldPosition(out: THREE.Vector3): boolean {
    if (this.activeWeapon instanceof BowWeapon) {
      return this.activeWeapon.getNockWorldPosition(out);
    }
    return false;
  }

  public getEquippedBowWeapon(): BowWeapon | null {
    return this.activeWeapon instanceof BowWeapon ? this.activeWeapon : null;
  }

  public updateBowTrajectoryPreview(
    launchOrigin: THREE.Vector3,
    initialVel: THREE.Vector3,
    gravity: number,
    chargeFactor: number,
    queryCollidersNear: ((x: number, z: number) => WorldCollider[]) | undefined,
    visible: boolean,
  ): void {
    if (this.activeWeapon instanceof BowWeapon) {
      this.activeWeapon.updateTrajectoryPreview(
        this.scene,
        launchOrigin,
        initialVel,
        gravity,
        chargeFactor,
        queryCollidersNear,
        visible,
      );
    }
  }

  public hideBowTrajectoryPreview(): void {
    if (this.activeWeapon instanceof BowWeapon) {
      this.activeWeapon.hideTrajectoryPreview();
    }
  }

  public releaseBowCharge(
    origin: THREE.Vector3,
    yaw: number,
    launchOrigin?: THREE.Vector3,
    aimTargetPoint?: THREE.Vector3,
  ): {
    fired: boolean;
    cancelledTooShort: boolean;
    chargeFactor: number;
    staminaCost: number;
  } {
    if (!this.bowCharging || !this.activeWeapon?.stats.isRanged) {
      this.cancelBowCharge();
      return {
        fired: false,
        cancelledTooShort: false,
        chargeFactor: 0,
        staminaCost: 0,
      };
    }

    if (this.bowChargeElapsed < this.bowChargeMinTime) {
      this.cancelBowCharge();
      return {
        fired: false,
        cancelledTooShort: true,
        chargeFactor: 0,
        staminaCost: 0,
      };
    }

    const chargeFactor = this.getBowChargeProgress();
    const staminaCost = this.activeWeapon.stats.staminaCost ?? 4;
    this.bowCharging = false;
    this.bowChargeElapsed = 0;
    this.pendingBowChargeFactor = chargeFactor;
    this.hasPendingBowOrigin = Boolean(launchOrigin);
    if (launchOrigin) {
      this.pendingBowLaunchOrigin.copy(launchOrigin);
    }
    this.hasPendingAimTarget = Boolean(aimTargetPoint);
    if (aimTargetPoint) {
      this.pendingAimTargetPoint.copy(aimTargetPoint);
    }

    this.setBowDrawVisual(false, 0);
    this.hideBowTrajectoryPreview();

    if (!this.canPlayerAttack()) {
      return {
        fired: false,
        cancelledTooShort: false,
        chargeFactor,
        staminaCost,
      };
    }

    const weapon = this.activeWeapon;
    this.attackCooldownTimer = weapon.stats.cooldown;
    this.lastAttackTotalCooldown = weapon.stats.cooldown;
    this.pendingHitTimer = -1;

    const atkCtx = this.setWeaponAttackContext(origin, yaw);
    atkCtx.bowChargeFactor = this.pendingBowChargeFactor;
    atkCtx.bowLaunchOrigin = this.hasPendingBowOrigin
      ? this.pendingBowLaunchOrigin
      : undefined;
    atkCtx.aimTargetPoint = this.hasPendingAimTarget
      ? this.pendingAimTargetPoint
      : undefined;
    weapon.executeHit(atkCtx);
    return {
      fired: true,
      cancelledTooShort: false,
      chargeFactor,
      staminaCost,
    };
  }

  public cancelBowCharge(): boolean {
    const wasCharging = this.bowCharging;
    this.bowCharging = false;
    this.bowChargeElapsed = 0;
    this.hasPendingBowOrigin = false;
    this.hasPendingAimTarget = false;
    this.setBowDrawVisual(false, 0);
    this.hideBowTrajectoryPreview();
    return wasCharging;
  }

  public getAttackAnimationSpec(): {
    type: WeaponAttackAnimType;
    duration: number;
  } {
    if (!this.activeWeapon) {
      return { type: 'unarmed_punch', duration: 0.24 };
    }
    return {
      type: this.activeWeapon.stats.attackAnim,
      duration: this.activeWeapon.stats.swingDuration,
    };
  }

  public getAttackCooldownRatio(): number {
    if (this.lastAttackTotalCooldown <= 0) return 0;
    return Math.max(
      0,
      Math.min(1, this.attackCooldownTimer / this.lastAttackTotalCooldown),
    );
  }

  public canPlayerAttack(): boolean {
    return this.attackCooldownTimer <= 0 && this.playerHealth.isAlive();
  }

  public triggerPlayerAttack(origin: THREE.Vector3, yaw: number): boolean {
    if (!this.canPlayerAttack()) return false;

    const weapon = this.activeWeapon;
    const cooldown = weapon ? weapon.stats.cooldown : UNARMED_COOLDOWN;
    const hitDelay = weapon ? weapon.stats.hitDelay : UNARMED_HIT_DELAY;

    this.attackCooldownTimer = cooldown;
    this.lastAttackTotalCooldown = cooldown;
    this.pendingHitTimer = hitDelay;
    this.pendingAttackWeapon = weapon;
    this.pendingAttackOrigin.copy(origin);
    this.pendingAttackYaw = yaw;
    this.pendingAttackId = `atk_${++this.nextAttackSeq}_${Date.now().toString(36)}`;

    // Show sweeping melee slash arc only for melee weapons
    if (weapon && !weapon.stats.isRanged) {
      this.slashTimer = 0.22;
      this.slashMesh.visible = true;
      this.slashMesh.position.set(origin.x, origin.y + 1.02, origin.z);
      this.slashMesh.rotation.set(0, yaw - Math.PI * 0.5, 0);
      this.slashMesh.scale.setScalar(weapon.stats.range / 2.6);
      this.slashMat.opacity = 0.62;
    }

    return true;
  }

  public setExternalDamageMultiplier(multiplier: number): void {
    this.damageSystem.setPlayerDamageMultiplier(multiplier);
  }

  public syncPlayerStats(currentHealth: number, maxHealth: number): void {
    this.playerHealth.setMaxHealth(maxHealth, false);
    this.playerHealth.syncHealth(currentHealth);
  }

  public resetPlayerAndAggro(): void {
    this.cancelBowCharge();
    this.playerHealth.revive(1);
    this.attackCooldownTimer = 0;
    this.pendingHitTimer = -1;
    this.recentTarget = null;
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].clearAggro();
    }
  }

  public exportDefeatedEnemyIds(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      const bp = this.enemyBlueprints[i];
      if (bp.defeated || bp.controller?.state === 'dead') {
        bp.defeated = true;
        out.push(bp.id);
      }
    }
    return out;
  }

  public restoreDefeatedEnemies(defeatedIds: string[]): void {
    const set = new Set(defeatedIds);
    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      const bp = this.enemyBlueprints[i];
      bp.defeated = set.has(bp.id);
      if (bp.defeated && bp.controller) {
        bp.controller.setDefeatedSilent();
      }
    }
  }

  /**
   * Returns all logically alive enemies (both streamed-in and unloaded blueprints)
   * so quests and world map markers always know valid spawnable targets without
   * forcing distant 3D enemy models into memory.
   */
  public getLogicalEnemyLocations(): Array<{
    id: string;
    archetypeId: EnemyArchetypeId;
    x: number;
    z: number;
    loaded: boolean;
  }> {
    const out: Array<{
      id: string;
      archetypeId: EnemyArchetypeId;
      x: number;
      z: number;
      loaded: boolean;
    }> = [];
    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      const bp = this.enemyBlueprints[i];
      if (bp.defeated || bp.controller?.state === 'dead') continue;
      out.push({
        id: bp.id,
        archetypeId: bp.archetypeId,
        x: bp.controller ? bp.controller.position.x : bp.x,
        z: bp.controller ? bp.controller.position.z : bp.z,
        loaded: Boolean(bp.controller),
      });
    }
    return out;
  }

  public getHudTarget(): CombatEnemyHudTarget | null {
    if (!this.recentTarget || this.recentTargetTimer <= 0) return null;
    if (this.recentTarget.health.isDead()) return null;
    return {
      id: this.recentTarget.id,
      name: this.recentTarget.name,
      nameAr: this.recentTarget.nameAr,
      health: this.recentTarget.health.getCurrentHealth(),
      maxHealth: this.recentTarget.health.getMaxHealth(),
      isBoss: Boolean(this.recentTarget.archetype.isBoss),
      bossPhase: this.recentTarget.bossPhase,
      attackState: this.recentTarget.attackState,
      targetPlayerId: this.recentTarget.targetPlayerId,
    };
  }

  public getActiveBossHudTarget(
    playerPos: THREE.Vector3,
    maxDist = 42,
  ): CombatEnemyHudTarget | null {
    const maxDistSq = maxDist * maxDist;
    let bestBoss: EnemyController | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.archetype.isBoss || e.state === 'dead' || e.health.isDead()) continue;
      const dx = e.position.x - playerPos.x;
      const dz = e.position.z - playerPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > maxDistSq) continue;
      const engagedBonus = e.aggro || this.recentTarget === e ? -150 : 0;
      const score = dSq + engagedBonus;
      if (score < bestScore) {
        bestScore = score;
        bestBoss = e;
      }
    }

    if (!bestBoss) return null;
    return {
      id: bestBoss.id,
      name: bestBoss.name,
      nameAr: bestBoss.nameAr,
      health: bestBoss.health.getCurrentHealth(),
      maxHealth: bestBoss.health.getMaxHealth(),
      isBoss: true,
      bossPhase: bestBoss.bossPhase,
      attackState: bestBoss.attackState,
      targetPlayerId: bestBoss.targetPlayerId,
    };
  }

  private spawnEnemies(
    seed: number,
    isSoftwareGl: boolean,
    isVillageClearance: (x: number, z: number) => boolean,
  ): void {
    const rng = seededRandom(seed + 7717);

    const pickSpawn = (
      biomes: string[],
      minRadius: number,
      maxRadius: number,
    ): { x: number; z: number } => {
      for (let attempt = 0; attempt < 48; attempt++) {
        const r = minRadius + rng() * (maxRadius - minRadius);
        const angle = rng() * Math.PI * 2;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (x * x + z * z > (PLAYABLE_RADIUS - 24) * (PLAYABLE_RADIUS - 24)) continue;
        if (isVillageClearance(x, z)) continue;
        if (Math.hypot(x, z - 4) < 30) continue;

        const biome = getBiomeAt(x, z);
        if (biomes.length > 0 && !biomes.includes(biome)) continue;

        const h = groundHeightAt(x, z);
        if (h < WATER_LEVEL + 0.65) continue;
        if (groundSlopeAt(x, z, h) > 0.3) continue;
        return { x, z };
      }

      const fallbackAngle = rng() * Math.PI * 2;
      const fallbackR = 38 + rng() * 50;
      return {
        x: Math.cos(fallbackAngle) * fallbackR,
        z: Math.sin(fallbackAngle) * fallbackR,
      };
    };

    const placements: Array<{ archetypeId: EnemyArchetypeId; x: number; z: number }> = [];

    for (let i = 0; i < 2; i++) {
      const spot = pickSpawn(['Plains', 'Forest'], 34, 58);
      placements.push({ archetypeId: 'bandit_scout', x: spot.x, z: spot.z });
    }
    for (let i = 0; i < 10; i++) {
      const spot = pickSpawn(['Plains', 'Forest'], 62, 240);
      placements.push({ archetypeId: 'bandit_scout', x: spot.x, z: spot.z });
    }
    for (let i = 0; i < 8; i++) {
      const spot = pickSpawn(['Forest'], 52, 260);
      placements.push({ archetypeId: 'thorn_stalker', x: spot.x, z: spot.z });
    }
    for (let i = 0; i < 6; i++) {
      const spot = pickSpawn(['Mountains', 'Desert'], 95, 320);
      placements.push({ archetypeId: 'stone_sentinel', x: spot.x, z: spot.z });
    }
    for (let i = 0; i < 6; i++) {
      const spot = pickSpawn(['Mountains', 'Forest', 'Desert'], 95, 260);
      placements.push({ archetypeId: 'ancient_monster', x: spot.x, z: spot.z });
    }
    for (let i = 0; i < 2; i++) {
      const spot = pickSpawn(['Mountains', 'Desert', 'Plains'], 135, 310);
      placements.push({ archetypeId: 'ancient_guardian', x: spot.x, z: spot.z });
    }

    this.enemyBlueprints.length = 0;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      this.enemyBlueprints.push({
        id: `enemy-${p.archetypeId}-${i}`,
        archetypeId: p.archetypeId,
        x: p.x,
        z: p.z,
        seed: seed + i * 53 + 811,
        chunkId: resolveChunkIdAt(p.x, p.z),
        defeated: false,
        savedHp: null,
        controller: null,
      });
    }

    // Stream in only enemies near the initial spawn point; distant enemies stay logical until approached
    this.streamEnemies(new THREE.Vector3(0, 0, 4), true);
  }

  public exportQuestTargetState(): SavedQuestTargetEntry[] {
    const out: SavedQuestTargetEntry[] = [];
    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      const bp = this.enemyBlueprints[i];
      if (!bp.questTarget) continue;
      out.push({
        id: bp.id,
        archetypeId: bp.archetypeId,
        x: bp.controller ? bp.controller.position.x : bp.x,
        z: bp.controller ? bp.controller.position.z : bp.z,
        hp: bp.controller
          ? Math.round(bp.controller.health.getCurrentHealth())
          : bp.savedHp,
        defeated: bp.defeated || bp.controller?.state === 'dead',
        questId: bp.questTarget.questId,
        objectiveId: bp.questTarget.objectiveId,
        enemyType: bp.questTarget.enemyType,
      });
    }
    return out;
  }

  public restoreQuestTargetState(entries: readonly SavedQuestTargetEntry[]): void {
    if (!entries || entries.length === 0) return;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const existing = this.enemyBlueprints.find((b) => b.id === entry.id);
      const validArchetype = this.resolveValidArchetype(entry.archetypeId);
      if (existing) {
        existing.x = entry.x;
        existing.z = entry.z;
        existing.chunkId = resolveChunkIdAt(entry.x, entry.z);
        existing.defeated = entry.defeated;
        existing.savedHp = entry.hp;
        existing.isDynamicQuestSpawn = entry.id.startsWith('qtarget:');
        existing.questTarget = {
          questId: entry.questId,
          objectiveId: entry.objectiveId,
          enemyType: entry.enemyType,
          lifecycle: entry.defeated ? 'DEFEATED' : 'SPAWN_REQUESTED',
        };
        if (existing.defeated && existing.controller) {
          existing.controller.setDefeatedSilent();
        }
        continue;
      }

      this.enemyBlueprints.push({
        id: entry.id,
        archetypeId: validArchetype,
        x: entry.x,
        z: entry.z,
        seed: Math.abs(Math.round(entry.x * 19 + entry.z * 29 + i * 71)) + 1301,
        chunkId: resolveChunkIdAt(entry.x, entry.z),
        defeated: entry.defeated,
        savedHp: entry.hp,
        controller: null,
        isDynamicQuestSpawn: true,
        questTarget: {
          questId: entry.questId,
          objectiveId: entry.objectiveId,
          enemyType: entry.enemyType,
          lifecycle: entry.defeated ? 'DEFEATED' : 'SPAWN_REQUESTED',
        },
      });
    }
  }

  private preferredBiomesForArchetype(
    archetypeId: EnemyArchetypeId,
    targetBiome?: BiomeType,
  ): readonly BiomeType[] | undefined {
    if (targetBiome) return [targetBiome];
    switch (archetypeId) {
      case 'bandit_scout':
        return ['Plains', 'Forest'];
      case 'thorn_stalker':
        return ['Forest'];
      case 'stone_sentinel':
        return ['Mountains', 'Desert'];
      case 'ancient_monster':
        return ['Mountains', 'Forest', 'Desert'];
      case 'ancient_guardian':
        return ['Mountains', 'Desert', 'Plains'];
    }
  }

  /**
   * Ensures every active kill_enemies quest objective has enough valid, non-defeated
   * targets scheduled in the world (and transitions lifecycles across
   * QUEST_TARGET_REQUIRED -> SPAWN_REQUESTED -> SPAWNED -> ACTIVE -> DEFEATED).
   * Prevents duplicate spawns via deterministic IDs `qtarget:${questId}:${objectiveId}:${slot}`
   * and auto-recovers any missing/invalid target positions.
   */
  public ensureQuestTargets(
    objectives: ReadonlyArray<{
      questId: string;
      objectiveId: string;
      enemyType: string;
      remainingCount: number;
      requiredCount?: number;
      targetX?: number;
      targetZ?: number;
      targetBiome?: BiomeType;
    }>,
    opts: {
      playerPos: THREE.Vector3;
      isVillageClearance: (x: number, z: number) => boolean;
      queryCollidersNear?: (x: number, z: number) => WorldCollider[];
      isChunkLoaded?: (cx: number, cz: number) => boolean;
    },
  ): void {
    const activeKeys = new Set<string>();
    for (let i = 0; i < objectives.length; i++) {
      const o = objectives[i];
      if (o.enemyType.startsWith('animal:')) continue;
      if (o.remainingCount > 0) {
        activeKeys.add(`${o.questId}:${o.objectiveId}`);
      }
    }

    // Release quest bindings for completed or cancelled quests
    for (let i = this.enemyBlueprints.length - 1; i >= 0; i--) {
      const bp = this.enemyBlueprints[i];
      if (!bp.questTarget) continue;
      const key = `${bp.questTarget.questId}:${bp.questTarget.objectiveId}`;
      if (!activeKeys.has(key)) {
        bp.questTarget = undefined;
      }
    }

    for (let i = 0; i < objectives.length; i++) {
      const obj = objectives[i];
      if (obj.enemyType.startsWith('animal:') || obj.remainingCount <= 0) continue;

      const canonicalArchetype = this.resolveValidArchetype(obj.enemyType);
      const hasExplicitAnchor =
        typeof obj.targetX === 'number' &&
        Number.isFinite(obj.targetX) &&
        typeof obj.targetZ === 'number' &&
        Number.isFinite(obj.targetZ);
      // Only restrict by archetype biome when there is no explicit quest location;
      // explicit quest locations (e.g. Abandoned Cabin, Desert Ruins, Camps) must spawn at that site.
      const allowedBiomes = hasExplicitAnchor
        ? undefined
        : this.preferredBiomesForArchetype(canonicalArchetype, obj.targetBiome);
      const anchorX = hasExplicitAnchor ? obj.targetX! : opts.playerPos.x;
      const anchorZ = hasExplicitAnchor ? obj.targetZ! : opts.playerPos.z;
      const QUEST_AREA_BIND_RADIUS = 55;
      const QUEST_AREA_RECOVER_RADIUS = 85;

      // Count already bound alive blueprints and recover any invalid or far-out-of-zone unloaded positions
      const bound: EnemyBlueprintRecord[] = [];
      for (let b = 0; b < this.enemyBlueprints.length; b++) {
        const bp = this.enemyBlueprints[b];
        if (
          bp.questTarget &&
          bp.questTarget.questId === obj.questId &&
          bp.questTarget.objectiveId === obj.objectiveId
        ) {
          if (bp.defeated || bp.controller?.state === 'dead') {
            bp.questTarget.lifecycle = 'DEFEATED';
            continue;
          }
          // Recovery: verify unloaded bound targets sit on valid land and inside the explicit quest area
          if (!bp.controller) {
            const distFromAnchor = Math.hypot(bp.x - anchorX, bp.z - anchorZ);
            const tooFarFromExplicitAnchor =
              hasExplicitAnchor && distFromAnchor > QUEST_AREA_RECOVER_RADIUS;
            const ok =
              !tooFarFromExplicitAnchor &&
              validateQuestTargetLocation(bp.x, bp.z, {
                radius: 0.85,
                minHeightAboveWater: 0.65,
                waterBuffer: 2.5,
                maxSlope: 0.38,
                outsideVillage: true,
                isVillageClearance: opts.isVillageClearance,
                queryCollidersNear: opts.queryCollidersNear,
              });
            if (!ok) {
              // If this was an ambient world enemy that is far from the quest zone, unbind it
              // so we can spawn a proper quest target inside the quest zone instead of teleporting ambient mobs
              if (tooFarFromExplicitAnchor && !bp.isDynamicQuestSpawn) {
                bp.questTarget = undefined;
                continue;
              }
              const recovered = findValidQuestTargetPoint(anchorX, anchorZ, {
                radius: 0.85,
                minHeightAboveWater: 0.65,
                waterBuffer: 2.5,
                maxSlope: hasExplicitAnchor ? 0.38 : 0.32,
                outsideVillage: true,
                isVillageClearance: opts.isVillageClearance,
                queryCollidersNear: opts.queryCollidersNear,
                allowedBiomes,
                minRadius: hasExplicitAnchor ? 4 : 34,
                maxRadius: hasExplicitAnchor ? 52 : 165,
              });
              bp.x = recovered.x;
              bp.z = recovered.z;
              bp.chunkId = resolveChunkIdAt(bp.x, bp.z);
            }
          }
          bp.questTarget.lifecycle = bp.controller ? 'ACTIVE' : 'SPAWN_REQUESTED';
          bound.push(bp);
        }
      }

      // If more non-engaged targets are bound than remain needed, unbind furthest non-aggro extras
      if (bound.length > obj.remainingCount) {
        bound.sort((a, b) => {
          const ax = a.controller ? a.controller.position.x : a.x;
          const az = a.controller ? a.controller.position.z : a.z;
          const bx = b.controller ? b.controller.position.x : b.x;
          const bz = b.controller ? b.controller.position.z : b.z;
          return Math.hypot(ax - anchorX, az - anchorZ) - Math.hypot(bx - anchorX, bz - anchorZ);
        });
        for (let k = bound.length - 1; k >= obj.remainingCount; k--) {
          const extra = bound[k];
          if (!extra.controller?.aggro) {
            extra.questTarget = undefined;
            bound.splice(k, 1);
          }
        }
      }

      if (bound.length >= obj.remainingCount) continue;

      // Rebind existing alive deterministic dynamic slots for this quest if unbound
      const slotPrefix = `qtarget:${obj.questId}:${obj.objectiveId}:`;
      const existingSlotIds = new Set<string>();
      for (let b = 0; b < this.enemyBlueprints.length; b++) {
        const bp = this.enemyBlueprints[b];
        if (!bp.id.startsWith(slotPrefix)) continue;
        existingSlotIds.add(bp.id);
        if (
          bound.length < obj.remainingCount &&
          !bp.defeated &&
          bp.controller?.state !== 'dead' &&
          !bp.questTarget
        ) {
          bp.questTarget = {
            questId: obj.questId,
            objectiveId: obj.objectiveId,
            enemyType: obj.enemyType,
            lifecycle: bp.controller ? 'ACTIVE' : 'SPAWN_REQUESTED',
          };
          bound.push(bp);
        }
      }

      if (bound.length >= obj.remainingCount) continue;

      // Bind existing alive unbound world blueprints inside the quest area first.
      // CRITICAL: When an explicit quest anchor (e.g. Abandoned Cabin) is set, NEVER bind
      // distant ambient enemies hundreds of meters away across the map.
      const candidates = this.enemyBlueprints
        .filter((bp) => {
          if (
            bp.defeated ||
            bp.controller?.state === 'dead' ||
            bp.questTarget ||
            bp.id.startsWith('qtarget:') ||
            !enemyTypeMatches(obj.enemyType, bp.archetypeId)
          ) {
            return false;
          }
          if (hasExplicitAnchor) {
            const ex = bp.controller ? bp.controller.position.x : bp.x;
            const ez = bp.controller ? bp.controller.position.z : bp.z;
            if (Math.hypot(ex - anchorX, ez - anchorZ) > QUEST_AREA_BIND_RADIUS) {
              return false;
            }
          }
          return true;
        })
        .sort((a, b) => {
          const ax = a.controller ? a.controller.position.x : a.x;
          const az = a.controller ? a.controller.position.z : a.z;
          const bx = b.controller ? b.controller.position.x : b.x;
          const bz = b.controller ? b.controller.position.z : b.z;
          return (
            Math.hypot(ax - anchorX, az - anchorZ) - Math.hypot(bx - anchorX, bz - anchorZ)
          );
        });

      let needed = obj.remainingCount - bound.length;
      for (let c = 0; c < candidates.length && needed > 0; c++) {
        const bp = candidates[c];
        bp.questTarget = {
          questId: obj.questId,
          objectiveId: obj.objectiveId,
          enemyType: obj.enemyType,
          lifecycle: bp.controller ? 'ACTIVE' : 'SPAWN_REQUESTED',
        };
        bound.push(bp);
        needed--;
      }

      // Dynamically spawn any remaining required quest targets using deterministic slot IDs
      if (needed > 0) {
        const maxSlotIndex = Math.max(obj.requiredCount ?? obj.remainingCount, obj.remainingCount) + 12;
        let nextSlot = 0;
        for (let s = 0; s < needed; s++) {
          while (nextSlot < maxSlotIndex && existingSlotIds.has(`${slotPrefix}${nextSlot}`)) {
            nextSlot++;
          }
          const slotId = `${slotPrefix}${nextSlot}`;
          existingSlotIds.add(slotId);
          nextSlot++;

          const spreadAngle = s * 2.39996 + 0.4;
          const spreadR = hasExplicitAnchor
            ? s === 0
              ? 4
              : 9 + s * 4.5
            : s === 0
              ? 0
              : 14 + s * 6;
          const searchX = anchorX + Math.cos(spreadAngle) * spreadR;
          const searchZ = anchorZ + Math.sin(spreadAngle) * spreadR;

          let picked = findValidQuestTargetPoint(searchX, searchZ, {
            radius: 0.85,
            minHeightAboveWater: 0.65,
            waterBuffer: 2.5,
            maxSlope: hasExplicitAnchor ? 0.38 : 0.32,
            outsideVillage: true,
            isVillageClearance: opts.isVillageClearance,
            queryCollidersNear: opts.queryCollidersNear,
            allowedBiomes,
            minRadius: hasExplicitAnchor
              ? 0
              : s === 0 && !opts.isVillageClearance(searchX, searchZ)
                ? 0
                : 28,
            maxRadius: hasExplicitAnchor ? 42 : 170,
          });

          // Secondary wider fallback inside the quest area if local terrain around the cabin/camp is steep
          if (
            hasExplicitAnchor &&
            !validateQuestTargetLocation(picked.x, picked.z, {
              radius: 0.85,
              minHeightAboveWater: 0.65,
              waterBuffer: 2.0,
              maxSlope: 0.46,
              outsideVillage: true,
              isVillageClearance: opts.isVillageClearance,
              queryCollidersNear: opts.queryCollidersNear,
            })
          ) {
            picked = findValidQuestTargetPoint(anchorX, anchorZ, {
              radius: 0.85,
              minHeightAboveWater: 0.65,
              waterBuffer: 2.0,
              maxSlope: 0.46,
              outsideVillage: true,
              isVillageClearance: opts.isVillageClearance,
              queryCollidersNear: opts.queryCollidersNear,
              minRadius: 6,
              maxRadius: 72,
            });
          }

          let spawnX = picked.x;
          let spawnZ = picked.z;
          // Nudge away if overlapping another bound quest target from the same objective
          for (let b = 0; b < bound.length; b++) {
            const bc = bound[b].controller;
            const bx = bc ? bc.position.x : bound[b].x;
            const bz = bc ? bc.position.z : bound[b].z;
            if (Math.hypot(spawnX - bx, spawnZ - bz) < 4.5) {
              const alt = findValidQuestTargetPoint(
                spawnX + Math.cos(s + 1.2) * (hasExplicitAnchor ? 8 : 14),
                spawnZ + Math.sin(s + 1.2) * (hasExplicitAnchor ? 8 : 14),
                {
                  radius: 0.85,
                  minHeightAboveWater: 0.65,
                  waterBuffer: 2.5,
                  maxSlope: hasExplicitAnchor ? 0.38 : 0.32,
                  outsideVillage: true,
                  isVillageClearance: opts.isVillageClearance,
                  queryCollidersNear: opts.queryCollidersNear,
                  allowedBiomes,
                  minRadius: hasExplicitAnchor ? 5 : 8,
                  maxRadius: hasExplicitAnchor ? 36 : 80,
                },
              );
              spawnX = alt.x;
              spawnZ = alt.z;
              break;
            }
          }

          const chunkId = resolveChunkIdAt(spawnX, spawnZ);
          const dynamicBp: EnemyBlueprintRecord = {
            id: slotId,
            archetypeId: canonicalArchetype,
            x: spawnX,
            z: spawnZ,
            seed: Math.abs(Math.round(spawnX * 19 + spawnZ * 29 + nextSlot * 71)) + 1301,
            chunkId,
            defeated: false,
            savedHp: null,
            controller: null,
            isDynamicQuestSpawn: true,
            questTarget: {
              questId: obj.questId,
              objectiveId: obj.objectiveId,
              enemyType: obj.enemyType,
              // Stage transitions QUEST_TARGET_REQUIRED -> SPAWN_REQUESTED
              lifecycle: 'SPAWN_REQUESTED',
            },
          };
          this.enemyBlueprints.push(dynamicBp);
          bound.push(dynamicBp);
        }
      }
    }
  }

  public releaseQuestTargets(questId: string): void {
    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      const bp = this.enemyBlueprints[i];
      if (bp.questTarget?.questId === questId) {
        bp.questTarget = undefined;
      }
    }
  }

  public getBlueprintsSnapshot(): readonly EnemyBlueprintRecord[] {
    return this.enemyBlueprints;
  }

  public spawnVillageDefenseRaiders(
    villageId: string,
    centerX: number,
    centerZ: number,
    villageRadius: number,
    count: number,
    isVillageClearance: (x: number, z: number) => boolean,
    queryCollidersNear?: (x: number, z: number) => WorldCollider[],
  ): number {
    this.clearVillageDefenseRaiders(villageId);
    const total = Math.max(1, Math.min(5, count));
    let spawned = 0;
    for (let i = 0; i < total; i++) {
      const angle = (i / total) * Math.PI * 2 + 0.55;
      const dist = Math.max(28, villageRadius + 10);
      const searchX = centerX + Math.cos(angle) * dist;
      const searchZ = centerZ + Math.sin(angle) * dist;
      const picked = findValidQuestTargetPoint(searchX, searchZ, {
        radius: 0.85,
        minHeightAboveWater: 0.65,
        waterBuffer: 2.5,
        maxSlope: 0.34,
        outsideVillage: true,
        isVillageClearance,
        queryCollidersNear,
        minRadius: 6,
        maxRadius: 60,
      });
      const bp: EnemyBlueprintRecord = {
        id: `vdef_${villageId}_${i}_${Date.now().toString(36)}`,
        archetypeId: 'bandit_scout',
        x: picked.x,
        z: picked.z,
        seed: Math.abs(Math.round(picked.x * 13 + picked.z * 31 + i * 97)) + 409,
        chunkId: resolveChunkIdAt(picked.x, picked.z),
        defeated: false,
        savedHp: null,
        controller: null,
        isDynamicQuestSpawn: true,
      };
      this.enemyBlueprints.push(bp);
      this.materializeEnemy(bp, queryCollidersNear);
      if (bp.controller) {
        spawned++;
      }
    }
    return spawned;
  }

  public clearVillageDefenseRaiders(villageId?: string): void {
    const prefix = villageId ? `vdef_${villageId}_` : 'vdef_';
    for (let i = this.enemyBlueprints.length - 1; i >= 0; i--) {
      const bp = this.enemyBlueprints[i];
      if (!bp.id.startsWith(prefix)) continue;
      if (bp.controller) {
        if (this.recentTarget === bp.controller) {
          this.recentTarget = null;
          this.recentTargetTimer = 0;
        }
        const idx = this.enemies.indexOf(bp.controller);
        if (idx !== -1) this.enemies.splice(idx, 1);
        bp.controller.dispose();
        bp.controller = null;
      }
      this.enemyBlueprints.splice(i, 1);
    }
  }

  public registerModEnemyBlueprint(opts: {
    id: string;
    archetypeId: EnemyArchetypeId;
    x: number;
    y?: number;
    z: number;
    seed: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    customArchetype?: Partial<EnemyArchetypeConfig>;
    respawnEnabled?: boolean;
    respawnDelaySeconds?: number;
    defeated?: boolean;
    savedHp?: number;
    modId?: string;
    modSpawnId?: string;
    materializeNow?: boolean;
  }): EnemyBlueprintRecord {
    this.unregisterModEnemyBlueprint(opts.id);
    const bp: EnemyBlueprintRecord = {
      id: opts.id,
      archetypeId: opts.archetypeId,
      x: opts.x,
      y: opts.y,
      z: opts.z,
      seed: opts.seed,
      chunkId: resolveChunkIdAt(opts.x, opts.z),
      defeated: Boolean(opts.defeated),
      savedHp: typeof opts.savedHp === 'number' && Number.isFinite(opts.savedHp) ? opts.savedHp : null,
      controller: null,
      exactPosition: true,
      rotationX: opts.rotationX,
      rotationY: opts.rotationY,
      rotationZ: opts.rotationZ,
      scaleX: opts.scaleX,
      scaleY: opts.scaleY,
      scaleZ: opts.scaleZ,
      customArchetype: opts.customArchetype,
      respawnEnabled: opts.respawnEnabled,
      respawnDelaySeconds: opts.respawnDelaySeconds,
      isModSpawn: true,
      modId: opts.modId,
      modSpawnId: opts.modSpawnId,
    };
    this.enemyBlueprints.push(bp);
    if (opts.materializeNow !== false && !bp.defeated) {
      this.materializeEnemy(bp);
    }
    return bp;
  }

  public getModEnemyController(id: string): EnemyController | null {
    return this.enemyBlueprints.find((b) => b.id === id)?.controller ?? null;
  }

  public unregisterModEnemyBlueprint(id: string): void {
    for (let i = this.enemyBlueprints.length - 1; i >= 0; i--) {
      const bp = this.enemyBlueprints[i];
      if (bp.id !== id) continue;
      if (bp.controller) {
        if (this.recentTarget === bp.controller) {
          this.recentTarget = null;
          this.recentTargetTimer = 0;
        }
        const idx = this.enemies.indexOf(bp.controller);
        if (idx !== -1) this.enemies.splice(idx, 1);
        bp.controller.dispose();
        bp.controller = null;
      }
      this.enemyBlueprints.splice(i, 1);
    }
  }

  public isEnemyBlueprintDefeated(id: string): boolean {
    const bp = this.enemyBlueprints.find((b) => b.id === id);
    return Boolean(bp?.defeated);
  }

  private materializeEnemy(
    bp: EnemyBlueprintRecord,
    queryCollidersNear?: (x: number, z: number) => WorldCollider[],
  ): void {
    if (bp.controller || bp.defeated) return;
    if (queryCollidersNear && !bp.exactPosition) {
      const h = groundHeightAt(bp.x, bp.z);
      const cols = queryCollidersNear(bp.x, bp.z);
      if (h < WATER_LEVEL + 0.5 || isPointBlockedByColliders(bp.x, bp.z, 0.75, cols, { y: h })) {
        const safe = findSafeClearColliderPoint(
          bp.x,
          bp.z,
          0.75,
          queryCollidersNear,
          0.6,
          0.34,
          30,
        );
        bp.x = safe.x;
        bp.z = safe.z;
        bp.chunkId = resolveChunkIdAt(bp.x, bp.z);
      }
    }
    if (bp.questTarget) {
      bp.questTarget.lifecycle = 'SPAWNED';
    }
    const enemy = new EnemyController(
      {
        id: bp.id,
        archetypeId: bp.archetypeId,
        x: bp.x,
        y: bp.y,
        z: bp.z,
        seed: bp.seed,
        exactPosition: bp.exactPosition,
        rotationX: bp.rotationX,
        rotationY: bp.rotationY,
        rotationZ: bp.rotationZ,
        scaleX: bp.scaleX,
        scaleY: bp.scaleY,
        scaleZ: bp.scaleZ,
        customArchetype: bp.customArchetype,
        respawnEnabled: bp.respawnEnabled,
        respawnDelaySeconds: bp.respawnDelaySeconds,
        ...(bp.modId ? { modId: bp.modId } : {}),
        onDefeated: (defeated, killMeta) => {
          bp.defeated = true;
          if (bp.questTarget) {
            bp.questTarget.lifecycle = 'DEFEATED';
          }
          this.options.onEnemyDefeated?.(defeated, killMeta);
        },
      },
      this.assets,
      this.scene,
      this.options.isSoftwareGl,
    );
    if (bp.savedHp !== null && bp.savedHp > 0 && bp.savedHp < enemy.health.getMaxHealth()) {
      enemy.health.syncHealth(bp.savedHp);
    }
    enemy.setNetworkRemoteControlled(this.networkRemoteControlled);
    bp.controller = enemy;
    if (bp.questTarget) {
      bp.questTarget.lifecycle = 'ACTIVE';
    }
    this.enemies.push(enemy);
  }

  private unloadEnemy(bp: EnemyBlueprintRecord): void {
    const enemy = bp.controller;
    if (!enemy) return;
    if (enemy.state === 'dead' || enemy.health.isDead()) {
      bp.defeated = true;
      if (bp.questTarget) {
        bp.questTarget.lifecycle = 'DEFEATED';
      }
    } else {
      bp.savedHp = enemy.health.getCurrentHealth();
      bp.x = enemy.position.x;
      bp.z = enemy.position.z;
      bp.chunkId = resolveChunkIdAt(bp.x, bp.z);
      if (bp.questTarget) {
        bp.questTarget.lifecycle = 'SPAWN_REQUESTED';
      }
    }
    if (this.recentTarget === enemy) {
      this.recentTarget = null;
      this.recentTargetTimer = 0;
    }
    const idx = this.enemies.indexOf(enemy);
    if (idx !== -1) {
      this.enemies.splice(idx, 1);
    }
    enemy.dispose();
    bp.controller = null;
  }

  public streamEnemies(
    playerPosOrCenters: THREE.Vector3 | ReadonlyArray<{ x: number; z: number }>,
    immediate = false,
    isChunkLoadedFn?: (cx: number, cz: number) => boolean,
    queryCollidersNear?: (x: number, z: number) => WorldCollider[],
  ): void {
    const centers: ReadonlyArray<{ x: number; z: number }> = Array.isArray(
      playerPosOrCenters,
    )
      ? playerPosOrCenters
      : [playerPosOrCenters as THREE.Vector3];
    if (centers.length === 0) return;

    const loadDist = Math.max(80, this.enemyStreamDist);
    const unloadDist = loadDist + 40;
    const loadDistSq = loadDist * loadDist;
    const unloadDistSq = unloadDist * unloadDist;

    let spawnedThisFrame = 0;
    const maxSpawnsPerFrame = immediate ? 64 : 3;

    for (let i = 0; i < this.enemyBlueprints.length; i++) {
      const bp = this.enemyBlueprints[i];
      if (bp.defeated) {
        if (bp.questTarget) bp.questTarget.lifecycle = 'DEFEATED';
        if (bp.controller && bp.controller.state === 'dead') {
          let minDeadDistSq = Infinity;
          for (let c = 0; c < centers.length; c++) {
            const dx = centers[c].x - bp.controller.position.x;
            const dz = centers[c].z - bp.controller.position.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < minDeadDistSq) minDeadDistSq = dSq;
          }
          if (minDeadDistSq > unloadDistSq) {
            this.unloadEnemy(bp);
          }
        }
        continue;
      }

      const ex = bp.controller ? bp.controller.position.x : bp.x;
      const ez = bp.controller ? bp.controller.position.z : bp.z;
      bp.chunkId = resolveChunkIdAt(ex, ez);
      const { cx, cz } = worldToChunkCoords(ex, ez, 120);
      const chunkLoaded = isChunkLoadedFn ? isChunkLoadedFn(cx, cz) : true;

      let minDistSq = Infinity;
      let nearestCenterIdx = 0;
      for (let c = 0; c < centers.length; c++) {
        const dx = centers[c].x - ex;
        const dz = centers[c].z - ez;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
          nearestCenterIdx = c;
        }
      }
      const chunkReady = nearestCenterIdx > 0 ? true : chunkLoaded;

      const closeQuestTarget = Boolean(bp.questTarget) && minDistSq <= 55 * 55;
      if (bp.controller) {
        if (minDistSq > unloadDistSq || (!chunkReady && !closeQuestTarget && minDistSq > loadDistSq)) {
          this.unloadEnemy(bp);
        }
      } else if (
        (chunkReady || closeQuestTarget) &&
        minDistSq <= loadDistSq &&
        (spawnedThisFrame < maxSpawnsPerFrame || Boolean(bp.questTarget))
      ) {
        this.materializeEnemy(bp, queryCollidersNear);
        spawnedThisFrame++;
      } else if (bp.questTarget) {
        bp.questTarget.lifecycle = 'SPAWN_REQUESTED';
      }
    }
  }

  private setWeaponAttackContext(
    origin: THREE.Vector3,
    yaw: number,
  ): WeaponAttackContext {
    this.weaponAttackCtx.origin = origin;
    this.weaponAttackCtx.yaw = yaw;
    return this.weaponAttackCtx;
  }

  private executeUnarmedPunch(ctx: WeaponAttackContext): void {
    this.damageSystem.detectMeleeArcHits(
      ctx.origin,
      ctx.yaw,
      UNARMED_RANGE,
      Math.PI * 0.65,
      this.enemies,
      _unarmedScratch,
    );

    for (let i = 0; i < _unarmedScratch.length; i++) {
      const enemy = _unarmedScratch[i];
      if (ctx.multiplayerAuthoritative) {
        const hx = enemy.position.x;
        const hy = enemy.position.y + enemy.hitHeight * 0.55;
        const hz = enemy.position.z;
        this.spawnHitSparks(hx, hy, hz, 4);
        ctx.onMultiplayerMeleeHit?.({
          attackId: ctx.attackId,
          targetKind: 'enemy',
          targetId: enemy.id,
          archetype: enemy.archetype.id,
          weaponId: 'unarmed',
          x: hx,
          y: hy,
          z: hz,
          isCrit: false,
        });
        continue;
      }

      const packet = this.damageSystem.createPacket({
        amount: UNARMED_DAMAGE,
        damageType: 'physical',
        sourceId: 'player:unarmed',
        sourcePosition: ctx.origin,
        knockback: UNARMED_KNOCKBACK,
        isCrit: false,
      });
      const result = this.damageSystem.applyDamage(enemy, packet);
      if (result.applied) {
        this.spawnHitSparks(
          enemy.position.x,
          enemy.position.y + enemy.hitHeight * 0.55,
          enemy.position.z,
          4,
        );
        this.recentTarget = enemy;
        this.recentTargetTimer = 5.5;
        this.options.onEnemyHit?.(enemy, result);
      }
    }

    if (ctx.wildlife) {
      _animalFwdDir.set(Math.sin(ctx.yaw), 0, Math.cos(ctx.yaw));
      const animals = ctx.wildlife.findAnimalsInStrikeArc(
        ctx.origin,
        _animalFwdDir,
        UNARMED_RANGE,
        Math.cos(Math.PI * 0.65 * 0.5),
      );
      for (let i = 0; i < animals.length; i++) {
        const { animal } = animals[i];
        if (ctx.multiplayerAuthoritative) {
          const hx = animal.position.x;
          const hy = animal.position.y + 0.55;
          const hz = animal.position.z;
          this.spawnHitSparks(hx, hy, hz, 3);
          ctx.onMultiplayerMeleeHit?.({
            attackId: ctx.attackId,
            targetKind: 'animal',
            targetId: animal.id,
            archetype: animal.species,
            weaponId: 'unarmed',
            x: hx,
            y: hy,
            z: hz,
            isCrit: false,
          });
          continue;
        }

        const res = ctx.wildlife.damageAnimal(
          animal.id,
          UNARMED_DAMAGE,
          ctx.origin.x,
          ctx.origin.z,
          'player:unarmed',
        );
        if (res.hit) {
          this.spawnHitSparks(
            animal.position.x,
            animal.position.y + 0.55,
            animal.position.z,
            3,
          );
        }
      }
    }

    if (ctx.multiplayerAuthoritative && ctx.npcStrikeTest) {
      _animalFwdDir.set(Math.sin(ctx.yaw), 0, Math.cos(ctx.yaw));
      const npcs = ctx.npcStrikeTest(
        ctx.origin,
        _animalFwdDir,
        UNARMED_RANGE,
        Math.cos(Math.PI * 0.65 * 0.5),
      );
      for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];
        const hx = npc.position.x;
        const hy = npc.position.y + npc.hitHeight * 0.55;
        const hz = npc.position.z;
        this.spawnHitSparks(hx, hy, hz, 3);
        ctx.onMultiplayerMeleeHit?.({
          attackId: ctx.attackId,
          targetKind: 'npc',
          targetId: npc.id,
          archetype: npc.role,
          weaponId: 'unarmed',
          x: hx,
          y: hy,
          z: hz,
          isCrit: false,
        });
      }
    }

    if (ctx.multiplayerAuthoritative && ctx.playerStrikeTest) {
      _animalFwdDir.set(Math.sin(ctx.yaw), 0, Math.cos(ctx.yaw));
      const hitPlayers = ctx.playerStrikeTest(
        ctx.origin,
        _animalFwdDir,
        UNARMED_RANGE,
        Math.cos(Math.PI * 0.65 * 0.5),
      );
      for (let i = 0; i < hitPlayers.length; i++) {
        const pl = hitPlayers[i];
        const hx = pl.position.x;
        const hy = pl.position.y + pl.hitHeight * 0.55;
        const hz = pl.position.z;
        this.spawnHitSparks(hx, hy, hz, 3);
        ctx.onMultiplayerMeleeHit?.({
          attackId: ctx.attackId,
          targetKind: 'player',
          targetId: pl.playerId,
          archetype: 'player',
          weaponId: 'unarmed',
          x: hx,
          y: hy,
          z: hz,
          isCrit: false,
        });
      }
    }
  }

  public applyGraphicsProfile(profile: ResolvedGraphicsProfile): void {
    this.sparkScale = profile.particleScale;
    this.enemyStreamDist = Math.max(85, profile.enemyDrawDist);
    const renderBandDist = this.enemyStreamDist + 42;
    this.enemyUpdateCtx.drawDistSq = renderBandDist * renderBandDist;
    this.enemyUpdateCtx.midDistSq = profile.enemyMidDist * profile.enemyMidDist;
    this.enemyUpdateCtx.shadowDistSq =
      profile.entityShadowDist * profile.entityShadowDist;
    this.enemyUpdateCtx.shadowsEnabled = profile.shadowEnabled;
    this.enemyUpdateCtx.simThrottleScale = profile.simThrottleScale;
  }

  public getActiveParticleCount(): number {
    return this.sparkMesh.visible ? this.sparkMesh.count : 0;
  }

  public spawnHitSparks(x: number, y: number, z: number, count: number): void {
    const targetCount = Math.max(1, Math.round(count * this.sparkScale));
    let spawned = 0;
    for (let i = 0; i < this.sparkPool.length; i++) {
      const s = this.sparkPool[i];
      if (s.life <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.4 + Math.random() * 3.2;
        s.pos.set(x, y, z);
        s.scale = 0.8 + Math.random() * 0.7;
        s.vel.set(
          Math.cos(angle) * speed,
          1.4 + Math.random() * 2.2,
          Math.sin(angle) * speed,
        );
        s.maxLife = 0.22 + Math.random() * 0.14;
        s.life = s.maxLife;
        spawned++;
        if (spawned >= targetCount) break;
      }
    }
    if (spawned > 0) {
      this.syncSparkInstances();
    }
  }

  private syncSparkInstances(): void {
    let activeCount = 0;
    for (let i = 0; i < this.sparkPool.length; i++) {
      const s = this.sparkPool[i];
      if (s.life > 0) {
        _sparkDummy.position.copy(s.pos);
        _sparkDummy.scale.setScalar(s.scale);
        _sparkDummy.updateMatrix();
        this.sparkMesh.setMatrixAt(activeCount, _sparkDummy.matrix);
        activeCount++;
      }
    }
    this.sparkMesh.count = activeCount;
    this.sparkMesh.visible = activeCount > 0;
    if (activeCount > 0) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    camera: THREE.Camera | null,
    queryCollidersNear: (x: number, z: number) => WorldCollider[],
    isVillageClearance: (x: number, z: number) => boolean,
  ): void {
    if (dt <= 0) return;

    this.playerHealth.update(dt);

    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    }

    if (this.recentTargetTimer > 0) {
      this.recentTargetTimer = Math.max(0, this.recentTargetTimer - dt);
      if (this.recentTargetTimer <= 0 || this.recentTarget?.health.isDead()) {
        this.recentTarget = null;
      }
    }

    if (this.pendingHitTimer >= 0) {
      this.pendingHitTimer -= dt;
      if (this.pendingHitTimer <= 0) {
        this.pendingHitTimer = -1;
        this.pendingAttackOrigin.copy(playerPos);
        const atkCtx = this.setWeaponAttackContext(
          this.pendingAttackOrigin,
          this.pendingAttackYaw,
        );
        atkCtx.attackId = this.pendingAttackId;
        atkCtx.bowChargeFactor = this.pendingBowChargeFactor;
        atkCtx.queryCollidersNear = queryCollidersNear ?? this.queryCollidersNearCb;
        if (this.pendingAttackWeapon) {
          this.pendingAttackWeapon.executeHit(atkCtx);
        } else {
          this.executeUnarmedPunch(atkCtx);
        }
      }
    }

    // Update all instantiated weapons (e.g., Bow arrows still in flight after weapon switch)
    const tickWeaponCtx = this.setWeaponAttackContext(playerPos, this.pendingAttackYaw);
    tickWeaponCtx.queryCollidersNear = queryCollidersNear;
    const instantiated = this.weaponRegistry.getInstantiatedWeapons();
    for (let i = 0; i < instantiated.length; i++) {
      instantiated[i].update(dt, tickWeaponCtx);
    }

    // Update slash arc fade
    if (this.slashTimer > 0) {
      this.slashTimer = Math.max(0, this.slashTimer - dt);
      const t = this.slashTimer / 0.22;
      this.slashMat.opacity = 0.62 * t;
      this.slashMesh.rotation.y += dt * 4.5;
      if (this.slashTimer <= 0) {
        this.slashMesh.visible = false;
      }
    }

    // Update hit spark particles in single InstancedMesh
    let anySparkUpdated = false;
    for (let i = 0; i < this.sparkPool.length; i++) {
      const s = this.sparkPool[i];
      if (s.life > 0) {
        anySparkUpdated = true;
        s.life -= dt;
        if (s.life > 0) {
          s.vel.y -= 9.8 * dt;
          s.pos.addScaledVector(s.vel, dt);
          s.scale = 0.3 + (s.life / s.maxLife) * 0.9;
        }
      }
    }
    if (anySparkUpdated) {
      this.syncSparkInstances();
    }

    this.queryCollidersNearCb = queryCollidersNear;
    // Stream enemies in/out by player distance (progressive 3-per-frame queue, chunk-gated)
    this.streamEnemies(
      playerPos,
      false,
      this.isChunkLoadedCb,
      queryCollidersNear ?? this.queryCollidersNearCb,
    );

    // Update active enemies with cached context (zero per-frame allocations)
    const enemyCtx = this.enemyUpdateCtx;
    enemyCtx.dt = dt;
    enemyCtx.elapsed = elapsed;
    enemyCtx.camera = camera;
    enemyCtx.queryCollidersNear = queryCollidersNear;
    enemyCtx.isVillageClearance = isVillageClearance;

    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(enemyCtx);
    }
  }

  public setWorldQueryCallbacks(opts: {
    isChunkLoaded?: (cx: number, cz: number) => boolean;
    queryCollidersNear?: (x: number, z: number) => WorldCollider[];
  }): void {
    this.isChunkLoadedCb = opts.isChunkLoaded;
    if (opts.queryCollidersNear) {
      this.queryCollidersNearCb = opts.queryCollidersNear;
    }
  }

  public getCombatIntensity(playerPos: THREE.Vector3): number {
    let best = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.health.isAlive()) continue;
      if (e.state === 'patrol' || e.state === 'dead') continue;
      const dist = e.position.distanceTo(playerPos);
      if (dist > 28) continue;
      const distFactor = Math.max(0, Math.min(1, 1 - dist / 28));
      const stateWeight =
        e.state === 'attack_windup' || e.state === 'attack_recover'
          ? 1.0
          : e.state === 'stagger'
            ? 0.9
            : 0.78;
      const score = Math.min(1, (0.35 + distFactor * 0.65) * stateWeight);
      if (score > best) best = score;
    }
    return best;
  }

  public dispose(): void {
    this.weaponRegistry.disposeAll();
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].dispose();
    }
    this.enemies.length = 0;
    this.slashGeo.dispose();
    this.slashMat.dispose();
    this.slashMesh.removeFromParent();
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
    this.sparkMesh.dispose();
    this.sparkMesh.removeFromParent();
    this.assets.dispose();
  }
}
