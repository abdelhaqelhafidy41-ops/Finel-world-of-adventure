import * as THREE from 'three';
import {
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  groundHeightAt,
  groundSlopeAt,
} from '../math/noise';
import { sampleWalkableBridgeHeight } from '../world/BridgeSystem';
import type { WorldCollider } from '../types';
import type {
  SyncedEntityDelta,
  WorldEntitySnapshot,
} from '../../../shared/multiplayerProtocol';
import type { DamageSystem } from './DamageSystem';
import type { EnemyRig, EnemySharedAssets } from './EnemyRig';
import { EnemyRig as EnemyRigClass } from './EnemyRig';
import { HealthComponent } from './HealthComponent';
import type {
  BossAttackState,
} from '../../../shared/multiplayerProtocol';
import type {
  CombatTarget,
  DamagePacket,
  DamageResult,
  EnemyArchetypeConfig,
  EnemyArchetypeId,
  EnemyBehaviorState,
} from './combatTypes';

export const ENEMY_ARCHETYPES: Record<EnemyArchetypeId, EnemyArchetypeConfig> = {
  bandit_scout: {
    id: 'bandit_scout',
    name: 'Bandit Scout',
    nameAr: 'كشّاف اللصوص',
    maxHealth: 65,
    damage: 11,
    damageType: 'slash',
    moveSpeed: 2.2,
    chaseSpeed: 5.4,
    detectionRange: 16.5,
    attackRange: 2.1,
    attackCooldown: 1.25,
    attackWindup: 0.38,
    leashRange: 38,
    patrolRadius: 11,
    hitRadius: 0.65,
    hitHeight: 1.85,
    knockback: 4.5,
    damageReduction: 0.05,
    xpReward: 35,
    coinReward: 8,
    respawnDelay: 42,
    aggression: 0.9,
  },
  thorn_stalker: {
    id: 'thorn_stalker',
    name: 'Thorn Stalker',
    nameAr: 'متعقّب الأشواك',
    maxHealth: 50,
    damage: 9,
    damageType: 'pierce',
    moveSpeed: 2.6,
    chaseSpeed: 6.1,
    detectionRange: 15.0,
    attackRange: 1.95,
    attackCooldown: 1.05,
    attackWindup: 0.3,
    leashRange: 34,
    patrolRadius: 12,
    hitRadius: 0.58,
    hitHeight: 1.55,
    knockback: 3.6,
    damageReduction: 0,
    xpReward: 28,
    coinReward: 6,
    respawnDelay: 38,
    aggression: 0.95,
  },
  stone_sentinel: {
    id: 'stone_sentinel',
    name: 'Stone Sentinel',
    nameAr: 'حارس الحجر',
    maxHealth: 120,
    damage: 18,
    damageType: 'blunt',
    moveSpeed: 1.6,
    chaseSpeed: 3.8,
    detectionRange: 18.0,
    attackRange: 2.55,
    attackCooldown: 1.75,
    attackWindup: 0.55,
    leashRange: 32,
    patrolRadius: 9,
    hitRadius: 0.9,
    hitHeight: 2.5,
    knockback: 7.5,
    damageReduction: 0.18,
    xpReward: 70,
    coinReward: 16,
    respawnDelay: 55,
    aggression: 0.85,
  },
  ancient_monster: {
    id: 'ancient_monster',
    name: 'Ancient Monster',
    nameAr: 'الوحش القديم',
    maxHealth: 95,
    damage: 16,
    damageType: 'slash',
    moveSpeed: 2.1,
    chaseSpeed: 5.8,
    detectionRange: 18.5,
    attackRange: 2.3,
    attackCooldown: 1.3,
    attackWindup: 0.38,
    leashRange: 38,
    patrolRadius: 11,
    hitRadius: 0.78,
    hitHeight: 2.15,
    knockback: 5.4,
    damageReduction: 0.1,
    xpReward: 65,
    coinReward: 18,
    respawnDelay: 52,
    aggression: 0.95,
  },
  ancient_guardian: {
    id: 'ancient_guardian',
    name: 'Ancient Guardian',
    nameAr: 'الحارس العتيق',
    isBoss: true,
    maxHealth: 420,
    damage: 26,
    damageType: 'arcane',
    moveSpeed: 1.8,
    chaseSpeed: 4.3,
    detectionRange: 24.0,
    attackRange: 3.1,
    attackCooldown: 1.85,
    attackWindup: 0.65,
    leashRange: 44,
    patrolRadius: 10,
    hitRadius: 1.25,
    hitHeight: 3.3,
    knockback: 9.0,
    damageReduction: 0.22,
    xpReward: 260,
    coinReward: 85,
    respawnDelay: 120,
    aggression: 1.0,
  },
};

const _singleTargetScratch: CombatTarget[] = [];
const _hitsScratch: CombatTarget[] = [];
const ENEMY_DRAW_DIST_SQ = 135 * 135;
const ENEMY_SHADOW_DIST_SQ = 52 * 52;
const STEER_DETOUR_ANGLES = [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57, 2.08, -2.08] as const;

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

export interface RemoteCombatPlayerTarget {
  playerId: string;
  position: THREE.Vector3;
  isAlive: boolean;
}

export interface EnemyUpdateContext {
  dt: number;
  elapsed: number;
  camera: THREE.Camera | null;
  playerTarget: CombatTarget;
  localPlayerId?: string;
  remoteTargets?: RemoteCombatPlayerTarget[];
  damageSystem: DamageSystem;
  queryCollidersNear: (x: number, z: number) => WorldCollider[];
  isVillageClearance: (x: number, z: number) => boolean;
  onEnemySwing?: (enemy: EnemyController) => void;
  onEnemyAttackHit?: (enemy: EnemyController, result: DamageResult) => void;
  onEnemyAttackRemotePlayer?: (
    enemy: EnemyController,
    targetPlayerId: string,
    damage: number,
  ) => void;
  drawDistSq?: number;
  midDistSq?: number;
  shadowDistSq?: number;
  shadowsEnabled?: boolean;
  simThrottleScale?: number;
}

export interface EnemyKillMetadata {
  killerSourceId?: string;
  weaponId?: string;
  causedByPlayer: boolean;
  isEnvironmentalDeath: boolean;
}

export interface EnemySpawnConfig {
  id: string;
  archetypeId: EnemyArchetypeId;
  x: number;
  y?: number;
  z: number;
  seed: number;
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
  modId?: string;
  modContentId?: string;
  onDefeated?: (enemy: EnemyController, killMeta?: EnemyKillMetadata) => void;
}

/**
 * Modular EnemyController managing an individual enemy's health, aggression,
 * detection range, chase navigation, telegraphed attack cooldowns, stagger/knockback,
 * death collapse, and timed respawn.
 */
export class EnemyController implements CombatTarget {
  public readonly id: string;
  public readonly modId?: string;
  public readonly modContentId?: string;
  public readonly name: string;
  public readonly nameAr: string;
  public readonly faction = 'enemy' as const;
  public readonly archetype: EnemyArchetypeConfig;
  public readonly health: HealthComponent;
  public readonly position = new THREE.Vector3();
  public readonly homePosition = new THREE.Vector3();
  public readonly hitRadius: number;
  public readonly hitHeight: number;
  public readonly rig: EnemyRig;

  public state: EnemyBehaviorState = 'patrol';
  public aggro = false;
  public yaw = 0;
  public networkRemoteControlled = false;
  public targetPlayerId: string | null = null;
  public bossPhase = 1;
  public attackState: BossAttackState = 'idle';

  private readonly velocity = new THREE.Vector3();
  private readonly knockbackVel = new THREE.Vector3();
  private readonly patrolTarget = new THREE.Vector3();
  private readonly onDefeatedCb?: (
    enemy: EnemyController,
    killMeta?: EnemyKillMetadata,
  ) => void;
  private readonly isSoftwareGl: boolean;
  private readonly respawnEnabled: boolean;
  private readonly initialRotationX: number;
  private readonly initialRotationZ: number;
  private readonly initialScaleX: number;
  private readonly initialScaleY: number;
  private readonly initialScaleZ: number;

  private rngState: number;
  private stateTimer = 1.5;
  private patrolPauseTimer = 0;
  private deathElapsed = 0;
  private respawnTimer = 0;
  private pendingDt = 0;
  private frameTick: number;
  private lastAttackerPlayerId: string | null = null;
  private lastAttackerTimer = 0;
  private readonly threatByPlayer = new Map<string, number>();
  private attackComboIndex = 0;
  private readonly remoteTargetPos = new THREE.Vector3();
  private remoteTargetYaw = 0;
  private hasRemoteTarget = false;
  private steerDetourSign = 1;
  private steerStallTimer = 0;
  private readonly targetResultScratch: {
    playerId: string;
    isLocal: boolean;
    position: THREE.Vector3;
    dist: number;
    dx: number;
    dz: number;
  } = {
    playerId: 'local',
    isLocal: true,
    position: this.position,
    dist: 0,
    dx: 0,
    dz: 0,
  };

  constructor(
    config: EnemySpawnConfig,
    assets: EnemySharedAssets,
    scene: THREE.Scene,
    isSoftwareGl: boolean,
  ) {
    this.isSoftwareGl = isSoftwareGl;
    const baseArchetype = ENEMY_ARCHETYPES[config.archetypeId];
    const archetype: EnemyArchetypeConfig = config.customArchetype
      ? {
          ...baseArchetype,
          ...config.customArchetype,
          respawnDelay:
            config.respawnDelaySeconds ??
            config.customArchetype.respawnDelay ??
            baseArchetype.respawnDelay,
        }
      : {
          ...baseArchetype,
          ...(typeof config.respawnDelaySeconds === 'number'
            ? { respawnDelay: config.respawnDelaySeconds }
            : {}),
        };
    this.id = config.id;
    this.modId = config.modId;
    this.modContentId = config.modContentId;
    this.archetype = archetype;
    this.name = archetype.name;
    this.nameAr = archetype.nameAr;
    this.hitRadius = archetype.hitRadius;
    this.hitHeight = archetype.hitHeight;
    this.onDefeatedCb = config.onDefeated;
    this.respawnEnabled = config.respawnEnabled !== false;
    this.initialRotationX = config.rotationX ?? 0;
    this.initialRotationZ = config.rotationZ ?? 0;
    this.initialScaleX = Math.max(0.05, config.scaleX ?? 1);
    this.initialScaleY = Math.max(0.05, config.scaleY ?? 1);
    this.initialScaleZ = Math.max(0.05, config.scaleZ ?? 1);

    this.rngState = ((config.seed * 2654435761) >>> 0) || 4242;
    this.frameTick = config.seed & 3;
    this.yaw =
      typeof config.rotationY === 'number' && Number.isFinite(config.rotationY)
        ? config.rotationY
        : this.nextRand() * Math.PI * 2 - Math.PI;

    this.health = new HealthComponent({
      maxHealth: archetype.maxHealth,
      invulnerabilityDuration: 0.14,
      damageReduction: archetype.damageReduction,
    });

    const y =
      typeof config.y === 'number' && Number.isFinite(config.y)
        ? config.y
        : groundHeightAt(config.x, config.z);
    this.position.set(config.x, y, config.z);
    this.homePosition.copy(this.position);
    this.patrolTarget.copy(this.position);

    this.rig = new EnemyRigClass(archetype.id, assets, isSoftwareGl);
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(this.initialRotationX, this.yaw, this.initialRotationZ);
    this.rig.root.scale.set(this.initialScaleX, this.initialScaleY, this.initialScaleZ);
    scene.add(this.rig.root);

    this.pickNextPatrolPoint();
  }

  private nextRand(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState & 0x7fffffff) / 0x80000000;
  }

  public onDamaged = (result: DamageResult, packet: DamagePacket): void => {
    if (!result.applied) return;
    this.rig.triggerHitFlash();
    this.aggro = true;
    const isHeavy =
      this.archetype.id === 'stone_sentinel' || this.archetype.id === 'ancient_guardian';

    if (packet.sourceId) {
      const threatKey = packet.sourceId.startsWith('player') ? '__local__' : packet.sourceId;
      this.threatByPlayer.set(
        threatKey,
        (this.threatByPlayer.get(threatKey) ?? 0) + Math.max(1, result.finalAmount),
      );
    }
    if (this.archetype.isBoss && this.health.getHealthRatio() <= 0.5) {
      this.bossPhase = 2;
    }

    const dx = this.position.x - packet.sourcePosition.x;
    const dz = this.position.z - packet.sourcePosition.z;
    const dist = Math.hypot(dx, dz) || 1;
    const kb = packet.knockback * (this.archetype.isBoss ? 0.2 : isHeavy ? 0.4 : 1);
    this.knockbackVel.set((dx / dist) * kb, 0, (dz / dist) * kb);

    if (!result.killed) {
      // Heavy sentinels and bosses keep poise during attack windup
      const hasPoise = isHeavy && this.state === 'attack_windup';
      if (!hasPoise) {
        this.state = 'stagger';
        this.stateTimer = 0.22;
        this.attackState = 'idle';
      }
    }
  };

  public onDeath = (packet: DamagePacket): void => {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.aggro = false;
    this.attackState = 'idle';
    this.threatByPlayer.clear();
    this.deathElapsed = 0;
    this.respawnTimer = this.archetype.respawnDelay;
    this.velocity.set(0, 0, 0);
    const killerSourceId = packet?.sourceId;
    const causedByPlayer = Boolean(
      killerSourceId && (killerSourceId === 'player' || killerSourceId.startsWith('player:')),
    );
    const weaponId =
      killerSourceId && killerSourceId.startsWith('player:')
        ? killerSourceId.slice('player:'.length)
        : undefined;
    const isEnvironmentalDeath = Boolean(
      !causedByPlayer &&
        killerSourceId &&
        (killerSourceId.startsWith('env') ||
          killerSourceId === 'environment' ||
          killerSourceId === 'fall' ||
          killerSourceId === 'water'),
    );
    this.onDefeatedCb?.(this, {
      killerSourceId,
      weaponId,
      causedByPlayer,
      isEnvironmentalDeath,
    });
  };

  public clearAggro(): void {
    if (this.state === 'dead') return;
    this.aggro = false;
    this.targetPlayerId = null;
    this.lastAttackerPlayerId = null;
    this.lastAttackerTimer = 0;
    this.threatByPlayer.clear();
    this.attackState = 'idle';
    this.state = 'patrol';
    this.pickNextPatrolPoint();
  }

  public setDefeatedSilent(): void {
    this.state = 'dead';
    this.aggro = false;
    this.targetPlayerId = null;
    this.lastAttackerPlayerId = null;
    this.threatByPlayer.clear();
    this.attackState = 'idle';
    this.deathElapsed = 10;
    this.respawnTimer = this.archetype.respawnDelay;
    this.velocity.set(0, 0, 0);
    this.health.syncHealth(0);
    this.rig.root.visible = false;
  }

  public setNetworkRemoteControlled(remote: boolean): void {
    this.networkRemoteControlled = remote;
  }

  public applyAuthoritativeHealth(
    hp: number,
    maxHp: number,
    dead: boolean,
    attackerX?: number,
    attackerZ?: number,
    attackerId?: string,
  ): boolean {
    if (maxHp > 0 && maxHp !== this.health.getMaxHealth()) {
      this.health.setMaxHealth(maxHp, false);
    }

    if (!dead && hp > 0 && this.state === 'dead') {
      this.respawnAtHome();
    }

    const prevHp = this.health.getCurrentHealth();
    this.health.syncHealth(dead ? 0 : hp);
    this.rig.triggerHitFlash();
    const dealtDamage = Math.max(1, prevHp - Math.max(0, hp));
    if (this.archetype.isBoss && this.health.getHealthRatio() <= 0.5) {
      this.bossPhase = 2;
    }

    if (
      !dead &&
      attackerX !== undefined &&
      attackerZ !== undefined &&
      !this.networkRemoteControlled
    ) {
      this.aggro = true;
      if (attackerId) {
        this.lastAttackerPlayerId = attackerId;
        this.lastAttackerTimer = 8.0;
        this.threatByPlayer.set(
          attackerId,
          (this.threatByPlayer.get(attackerId) ?? 0) + dealtDamage,
        );
        // Switch immediately to highest-threat attacker
        let topId = attackerId;
        let topThreat = -1;
        for (const [pid, thr] of this.threatByPlayer.entries()) {
          if (thr > topThreat) {
            topThreat = thr;
            topId = pid;
          }
        }
        this.targetPlayerId = topId;
      }
      const isHeavy =
        this.archetype.id === 'stone_sentinel' || this.archetype.id === 'ancient_guardian';
      const dx = this.position.x - attackerX;
      const dz = this.position.z - attackerZ;
      const dist = Math.hypot(dx, dz) || 1;
      const kb = this.archetype.isBoss ? 1.0 : isHeavy ? 1.8 : 4.2;
      this.knockbackVel.set((dx / dist) * kb, 0, (dz / dist) * kb);
      const hasPoise = isHeavy && this.state === 'attack_windup';
      if (!hasPoise) {
        this.state = 'stagger';
        this.stateTimer = 0.22;
        this.attackState = 'idle';
      }
    }

    if (dead || hp <= 0) {
      const justKilled = this.state !== 'dead';
      this.health.syncHealth(0);
      this.state = 'dead';
      this.aggro = false;
      this.targetPlayerId = null;
      this.threatByPlayer.clear();
      this.attackState = 'idle';
      if (justKilled) {
        this.deathElapsed = 0;
        this.respawnTimer = this.archetype.respawnDelay;
        this.velocity.set(0, 0, 0);
        this.onDefeatedCb?.(this, {
          killerSourceId: attackerId,
          weaponId:
            attackerId && attackerId.startsWith('player:')
              ? attackerId.slice('player:'.length)
              : undefined,
          causedByPlayer: Boolean(attackerId),
          isEnvironmentalDeath: false,
        });
      }
      return justKilled;
    }

    return false;
  }

  public applyRemoteSync(delta: SyncedEntityDelta): void {
    if (delta.isDead === false && this.state === 'dead') {
      this.respawnAtHome();
    } else if (delta.isDead && this.state !== 'dead') {
      this.setDefeatedSilent();
    }

    if (typeof delta.hp === 'number' && !delta.isDead) {
      this.health.syncHealth(delta.hp);
      if (this.archetype.isBoss && this.health.getHealthRatio() <= 0.5) {
        this.bossPhase = 2;
      }
    }

    this.targetPlayerId = delta.targetPlayerId ?? null;
    if (typeof delta.bossPhase === 'number' && Number.isFinite(delta.bossPhase)) {
      this.bossPhase = Math.max(1, Math.min(4, Math.round(delta.bossPhase)));
    }
    if (
      delta.attackState === 'idle' ||
      delta.attackState === 'windup_strike' ||
      delta.attackState === 'windup_slam' ||
      delta.attackState === 'enraged_roar' ||
      delta.attackState === 'recover'
    ) {
      this.attackState = delta.attackState;
    }

    const groundY = Math.max(WATER_LEVEL + 0.05, groundHeightAt(delta.x, delta.z));
    this.remoteTargetPos.set(
      delta.x,
      Number.isFinite(delta.y) ? delta.y : groundY,
      delta.z,
    );
    this.remoteTargetYaw = delta.yaw;

    if (!this.hasRemoteTarget) {
      this.position.copy(this.remoteTargetPos);
      this.yaw = delta.yaw;
      this.hasRemoteTarget = true;
    }

    if (this.state !== 'dead' && !delta.isDead) {
      const validStates: EnemyBehaviorState[] = [
        'patrol',
        'chase',
        'attack_windup',
        'attack_recover',
        'stagger',
      ];
      if (validStates.includes(delta.state as EnemyBehaviorState)) {
        this.state = delta.state as EnemyBehaviorState;
        this.aggro = this.state !== 'patrol';
      }
    }
  }

  public applyPersistedSnapshot(snap: WorldEntitySnapshot): void {
    if (snap.isDead || snap.hp <= 0) {
      this.setDefeatedSilent();
      return;
    }

    if (this.state === 'dead') {
      this.respawnAtHome();
    }
    if (snap.maxHp > 0 && snap.maxHp !== this.health.getMaxHealth()) {
      this.health.setMaxHealth(snap.maxHp, false);
    }
    this.health.syncHealth(snap.hp);
    this.targetPlayerId = snap.targetPlayerId ?? null;
    if (typeof snap.bossPhase === 'number' && Number.isFinite(snap.bossPhase)) {
      this.bossPhase = Math.max(1, Math.min(4, Math.round(snap.bossPhase)));
    } else if (this.archetype.isBoss) {
      this.bossPhase = this.health.getHealthRatio() <= 0.5 ? 2 : 1;
    }
    if (
      snap.attackState === 'idle' ||
      snap.attackState === 'windup_strike' ||
      snap.attackState === 'windup_slam' ||
      snap.attackState === 'enraged_roar' ||
      snap.attackState === 'recover'
    ) {
      this.attackState = snap.attackState;
    }

    const groundY = Math.max(WATER_LEVEL + 0.05, groundHeightAt(snap.x, snap.z));
    const y = Number.isFinite(snap.y) ? snap.y : groundY;
    this.position.set(snap.x, y, snap.z);
    this.yaw = Number.isFinite(snap.yaw) ? snap.yaw : this.yaw;
    this.remoteTargetPos.copy(this.position);
    this.remoteTargetYaw = this.yaw;
    this.hasRemoteTarget = true;
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.yaw;
    this.rig.root.visible = true;

    const validStates: EnemyBehaviorState[] = [
      'patrol',
      'chase',
      'attack_windup',
      'attack_recover',
      'stagger',
    ];
    if (validStates.includes(snap.state as EnemyBehaviorState)) {
      this.state = snap.state as EnemyBehaviorState;
      this.aggro = this.state !== 'patrol';
    } else {
      this.state = 'patrol';
      this.aggro = false;
    }
  }

  private pickNextPatrolPoint(): void {
    const angle = this.nextRand() * Math.PI * 2;
    const r = this.archetype.patrolRadius * (0.35 + this.nextRand() * 0.65);
    const tx = this.homePosition.x + Math.cos(angle) * r;
    const tz = this.homePosition.z + Math.sin(angle) * r;
    this.patrolTarget.set(tx, groundHeightAt(tx, tz), tz);
    this.patrolPauseTimer = 0.8 + this.nextRand() * 2.2;
  }

  private selectBestPlayerTarget(
    ctx: EnemyUpdateContext,
    maxRange: number,
  ): {
    playerId: string;
    isLocal: boolean;
    position: THREE.Vector3;
    dist: number;
    dx: number;
    dz: number;
  } | null {
    const localId = ctx.localPlayerId ?? 'local';
    let hasProximity = false;
    let bestProxId = '';
    let bestProxIsLocal = false;
    let bestProxPos: THREE.Vector3 | null = null;
    let bestProxDist = Infinity;
    let bestProxDx = 0;
    let bestProxDz = 0;

    let hasScored = false;
    let bestScore = -Infinity;
    let bestScoredId = '';
    let bestScoredIsLocal = false;
    let bestScoredPos: THREE.Vector3 | null = null;
    let bestScoredDist = 0;
    let bestScoredDx = 0;
    let bestScoredDz = 0;

    const totalParticipants = 1 + (ctx.remoteTargets ? ctx.remoteTargets.length : 0);
    for (let i = -1; i < totalParticipants - 1; i++) {
      let playerId: string;
      let isLocal: boolean;
      let position: THREE.Vector3;
      let isAlive: boolean;

      if (i === -1) {
        playerId = localId;
        isLocal = true;
        position = ctx.playerTarget.position;
        isAlive = ctx.playerTarget.health.isAlive();
      } else {
        const rt = ctx.remoteTargets![i];
        playerId = rt.playerId;
        isLocal = false;
        position = rt.position;
        isAlive = rt.isAlive;
      }

      if (!isAlive) {
        this.threatByPlayer.delete(playerId);
        if (isLocal) this.threatByPlayer.delete('__local__');
        continue;
      }
      if (ctx.isVillageClearance(position.x, position.z)) continue;

      const dx = position.x - this.position.x;
      const dz = position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxRange) continue;

      if (!hasProximity || dist < bestProxDist) {
        hasProximity = true;
        bestProxId = playerId;
        bestProxIsLocal = isLocal;
        bestProxPos = position;
        bestProxDist = dist;
        bestProxDx = dx;
        bestProxDz = dz;
      }

      const directThreat = this.threatByPlayer.get(playerId) ?? 0;
      const localThreat = isLocal ? (this.threatByPlayer.get('__local__') ?? 0) : 0;
      const threat = directThreat + localThreat;
      const recentAttackerBonus =
        this.lastAttackerTimer > 0 && this.lastAttackerPlayerId === playerId ? 14 : 0;
      const stickyBonus = this.targetPlayerId === playerId ? 5 : 0;
      const score = threat * 0.45 + recentAttackerBonus + stickyBonus - dist * 1.35;

      if (score > bestScore) {
        bestScore = score;
        hasScored = true;
        bestScoredId = playerId;
        bestScoredIsLocal = isLocal;
        bestScoredPos = position;
        bestScoredDist = dist;
        bestScoredDx = dx;
        bestScoredDz = dz;
      }
    }

    if (hasScored && bestScoredPos) {
      const res = this.targetResultScratch;
      res.playerId = bestScoredId;
      res.isLocal = bestScoredIsLocal;
      res.position = bestScoredPos;
      res.dist = bestScoredDist;
      res.dx = bestScoredDx;
      res.dz = bestScoredDz;
      return res;
    }

    if (hasProximity && bestProxPos) {
      const res = this.targetResultScratch;
      res.playerId = bestProxId;
      res.isLocal = bestProxIsLocal;
      res.position = bestProxPos;
      res.dist = bestProxDist;
      res.dx = bestProxDx;
      res.dz = bestProxDz;
      return res;
    }

    return null;
  }

  public update(ctx: EnemyUpdateContext): void {
    const { dt, elapsed, playerTarget, camera } = ctx;
    const dxViewer = playerTarget.position.x - this.position.x;
    const dzViewer = playerTarget.position.z - this.position.z;
    const distSqToViewer = dxViewer * dxViewer + dzViewer * dzViewer;

    let minDistSqToAnyPlayer = distSqToViewer;
    if (ctx.remoteTargets && ctx.remoteTargets.length > 0) {
      for (let i = 0; i < ctx.remoteTargets.length; i++) {
        const rt = ctx.remoteTargets[i];
        const rx = rt.position.x - this.position.x;
        const rz = rt.position.z - this.position.z;
        const rSq = rx * rx + rz * rz;
        if (rSq < minDistSqToAnyPlayer) {
          minDistSqToAnyPlayer = rSq;
        }
      }
    }

    const drawDistSq = ctx.drawDistSq ?? ENEMY_DRAW_DIST_SQ;
    const midDistSq = ctx.midDistSq ?? ENEMY_SHADOW_DIST_SQ;
    const shadowDistSq = ctx.shadowDistSq ?? ENEMY_SHADOW_DIST_SQ;
    const shadowsEnabled = ctx.shadowsEnabled ?? !this.isSoftwareGl;

    if (this.state === 'dead') {
      this.health.update(dt);
      this.deathElapsed += dt;
      this.respawnTimer -= dt;

      if (this.deathElapsed <= 2.4 && distSqToViewer <= drawDistSq) {
        this.rig.root.visible = true;
        this.rig.setLodDetail(false);
        this.rig.updateAnimation(dt, elapsed, 'dead', 0, this.deathElapsed);
      } else {
        this.rig.root.visible = false;
      }

      if (
        this.respawnEnabled &&
        !this.networkRemoteControlled &&
        this.respawnTimer <= 0 &&
        minDistSqToAnyPlayer > 28 * 28
      ) {
        this.respawnAtHome();
      }
      return;
    }

    const simThrottleScale = ctx.simThrottleScale ?? 1;
    const visibleToLocalViewer = distSqToViewer <= drawDistSq;
    this.rig.root.visible = visibleToLocalViewer;
    if (visibleToLocalViewer) {
      this.rig.setLodDetail(distSqToViewer > midDistSq);
      this.rig.setShadowCasting(shadowsEnabled && distSqToViewer <= shadowDistSq);
    }

    // 200m+ (40000) or beyond draw distance: sleeping/inactive simulation
    if (minDistSqToAnyPlayer > drawDistSq || minDistSqToAnyPlayer > 40000) {
      if (!this.networkRemoteControlled) {
        this.aggro = false;
        this.targetPlayerId = null;
        this.state = 'patrol';
      }
      this.pendingDt = 0;
      return;
    }

    this.frameTick++;

    if (this.networkRemoteControlled) {
      this.health.update(dt);
      let horizSpeed = 0;
      if (this.hasRemoteTarget) {
        const dx = this.remoteTargetPos.x - this.position.x;
        const dz = this.remoteTargetPos.z - this.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 100) {
          this.position.copy(this.remoteTargetPos);
          this.yaw = this.remoteTargetYaw;
          this.velocity.set(0, 0, 0);
        } else {
          const prevX = this.position.x;
          const prevZ = this.position.z;
          this.position.x = THREE.MathUtils.damp(this.position.x, this.remoteTargetPos.x, 11, dt);
          this.position.y = THREE.MathUtils.damp(this.position.y, this.remoteTargetPos.y, 11, dt);
          this.position.z = THREE.MathUtils.damp(this.position.z, this.remoteTargetPos.z, 11, dt);
          this.yaw = dampAngle(this.yaw, this.remoteTargetYaw, 11, dt);
          const safeDt = Math.max(0.008, dt);
          const vx = (this.position.x - prevX) / safeDt;
          const vz = (this.position.z - prevZ) / safeDt;
          horizSpeed = Math.min(this.archetype.chaseSpeed * 1.15, Math.hypot(vx, vz));
          this.velocity.set(vx, 0, vz);
        }
      } else {
        this.velocity.set(0, 0, 0);
      }

      this.rig.root.position.copy(this.position);
      this.rig.root.rotation.set(this.initialRotationX, this.yaw, this.initialRotationZ);
      this.rig.root.scale.set(this.initialScaleX, this.initialScaleY, this.initialScaleZ);
      if (visibleToLocalViewer) {
        const animStride =
          distSqToViewer > midDistSq
            ? simThrottleScale >= 2
              ? 3
              : 2
            : simThrottleScale >= 2 && distSqToViewer > 22 * 22
              ? 2
              : 1;
        if (animStride === 1 || this.frameTick % animStride === 0) {
          this.rig.updateAnimation(dt * animStride, elapsed, this.state, horizSpeed, 0);
          const showBar =
            this.health.getHealthRatio() < 0.999 || distSqToViewer <= 16.5 * 16.5;
          this.rig.updateHealthBar(this.health.getHealthRatio(), showBar, camera);
        }
      }
      return;
    }

    // Distance-tiered simulation throttling:
    // 0-40m (<=1600): full simulation
    // 40-100m (1600..10000): reduced simulation
    // 100-200m (>10000): low-frequency simulation
    const nearSimSq = Math.min(midDistSq, 1600);
    let simStride = 1;
    if (minDistSqToAnyPlayer > 10000) {
      if (!this.aggro && this.state === 'patrol') {
        simStride = simThrottleScale >= 2 ? 9 : 6;
      } else {
        simStride = simThrottleScale >= 2 ? 4 : 3;
      }
    } else if (minDistSqToAnyPlayer > nearSimSq) {
      if (!this.aggro && this.state === 'patrol') {
        simStride = simThrottleScale >= 2 ? 5 : 3;
      } else if (simThrottleScale >= 2 && minDistSqToAnyPlayer > 3600) {
        simStride = 2;
      }
    }

    let stepDt = dt;
    if (simStride > 1) {
      this.pendingDt += dt;
      if (this.frameTick % simStride !== 0) {
        return;
      }
      stepDt = this.pendingDt;
      this.pendingDt = 0;
    } else if (this.pendingDt > 0) {
      stepDt = dt + this.pendingDt;
      this.pendingDt = 0;
    }

    if (this.lastAttackerTimer > 0) {
      this.lastAttackerTimer = Math.max(0, this.lastAttackerTimer - stepDt);
      if (this.lastAttackerTimer <= 0) {
        this.lastAttackerPlayerId = null;
      }
    }
    if (this.threatByPlayer.size > 0) {
      const decay = Math.exp(-0.22 * stepDt);
      for (const [pid, val] of this.threatByPlayer.entries()) {
        const nextVal = val * decay;
        if (nextVal < 0.25) {
          this.threatByPlayer.delete(pid);
        } else {
          this.threatByPlayer.set(pid, nextVal);
        }
      }
    }

    this.health.update(stepDt);
    if (this.archetype.isBoss) {
      this.bossPhase = this.health.getHealthRatio() <= 0.5 ? 2 : 1;
    }

    // Apply knockback decay
    let hasKnockback = false;
    if (this.knockbackVel.lengthSq() > 0.01) {
      this.position.x += this.knockbackVel.x * stepDt;
      this.position.z += this.knockbackVel.z * stepDt;
      this.knockbackVel.multiplyScalar(Math.exp(-10 * stepDt));
      hasKnockback = true;
    } else {
      this.knockbackVel.set(0, 0, 0);
    }

    const distFromHome = Math.hypot(
      this.position.x - this.homePosition.x,
      this.position.z - this.homePosition.z,
    );
    const activeTarget = this.selectBestPlayerTarget(
      ctx,
      this.archetype.detectionRange * 1.9,
    );
    if (activeTarget) {
      this.targetPlayerId = activeTarget.playerId;
    } else if (!this.aggro) {
      this.targetPlayerId = null;
    }

    let knownSteerH: number | null = null;
    let moved = hasKnockback;

    // State machine
    if (this.state === 'stagger') {
      this.attackState = 'idle';
      this.stateTimer -= stepDt;
      this.velocity.set(0, 0, 0);
      if (this.stateTimer <= 0) {
        this.state = activeTarget ? 'chase' : 'patrol';
      }
    } else if (this.state === 'attack_windup') {
      this.velocity.set(0, 0, 0);
      const aimDx = activeTarget ? activeTarget.dx : dxViewer;
      const aimDz = activeTarget ? activeTarget.dz : dzViewer;
      this.yaw = dampAngle(this.yaw, Math.atan2(aimDx, aimDz), 12, stepDt);
      this.stateTimer -= stepDt;
      if (this.stateTimer <= 0) {
        const isSlam = this.attackState === 'windup_slam';
        this.executeMeleeAttack(ctx, activeTarget, isSlam);
        this.state = 'attack_recover';
        this.attackState = 'recover';
        const cooldownScale = this.archetype.isBoss && this.bossPhase >= 2 ? 0.78 : 1;
        this.stateTimer = this.archetype.attackCooldown * cooldownScale;
      }
    } else if (this.state === 'attack_recover') {
      this.attackState = 'recover';
      this.velocity.set(0, 0, 0);
      const aimDx = activeTarget ? activeTarget.dx : dxViewer;
      const aimDz = activeTarget ? activeTarget.dz : dzViewer;
      this.yaw = dampAngle(this.yaw, Math.atan2(aimDx, aimDz), 7, stepDt);
      this.stateTimer -= stepDt;
      if (this.stateTimer <= 0) {
        this.attackState = 'idle';
        this.state = this.aggro && activeTarget ? 'chase' : 'patrol';
      }
    } else if (this.state === 'chase') {
      this.attackState = 'idle';
      if (!activeTarget || distFromHome > this.archetype.leashRange) {
        this.aggro = false;
        this.targetPlayerId = null;
        this.state = 'patrol';
        this.pickNextPatrolPoint();
      } else if (activeTarget.dist <= this.archetype.attackRange) {
        this.state = 'attack_windup';
        this.attackComboIndex += 1;
        this.attackState =
          this.archetype.isBoss && (this.bossPhase >= 2 || this.attackComboIndex % 2 === 0)
            ? 'windup_slam'
            : 'windup_strike';
        this.stateTimer =
          this.attackState === 'windup_slam'
            ? this.archetype.attackWindup * 1.15
            : this.archetype.attackWindup;
        this.velocity.set(0, 0, 0);
      } else {
        const speedMult = this.archetype.isBoss && this.bossPhase >= 2 ? 1.14 : 1;
        knownSteerH = this.steerToward(
          activeTarget.position.x,
          activeTarget.position.z,
          this.archetype.chaseSpeed * speedMult,
          stepDt,
          ctx,
        );
        if (knownSteerH !== null) moved = true;
      }
    } else {
      this.attackState = 'idle';
      // Patrol state: check detection range + aggression across ALL alive players
      const effectiveDetect =
        this.archetype.detectionRange * (0.75 + 0.25 * this.archetype.aggression);
      if (activeTarget && activeTarget.dist <= effectiveDetect) {
        this.aggro = true;
        this.targetPlayerId = activeTarget.playerId;
        this.state = 'chase';
      } else if (this.patrolPauseTimer > 0) {
        this.patrolPauseTimer -= stepDt;
        this.velocity.set(0, 0, 0);
      } else {
        const pdx = this.patrolTarget.x - this.position.x;
        const pdz = this.patrolTarget.z - this.position.z;
        if (pdx * pdx + pdz * pdz < 1.2 * 1.2) {
          this.pickNextPatrolPoint();
          this.velocity.set(0, 0, 0);
        } else {
          knownSteerH = this.steerToward(
            this.patrolTarget.x,
            this.patrolTarget.z,
            this.archetype.moveSpeed,
            stepDt,
            ctx,
          );
          if (knownSteerH !== null) moved = true;
        }
      }
    }

    // Clamp to ground & resolve nearby obstacle colliders only if position changed
    if (moved) {
      const pushed = this.resolveColliders(ctx.queryCollidersNear);
      let rawH: number;
      if (!pushed && !hasKnockback && knownSteerH !== null) {
        rawH = knownSteerH;
      } else {
        const postBridgeY = sampleWalkableBridgeHeight(
          this.position.x,
          this.position.z,
          this.position.y,
          ctx.queryCollidersNear(this.position.x, this.position.z),
        );
        rawH =
          postBridgeY !== null
            ? postBridgeY
            : groundHeightAt(this.position.x, this.position.z);
      }
      this.position.y = Math.max(WATER_LEVEL + 0.05, rawH);
    }

    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.set(this.initialRotationX, this.yaw, this.initialRotationZ);
    this.rig.root.scale.set(this.initialScaleX, this.initialScaleY, this.initialScaleZ);

    if (visibleToLocalViewer) {
      const animSkip =
        simStride === 1 && simThrottleScale >= 2 && distSqToViewer > 22 * 22
          ? this.frameTick % 2 !== 0
          : false;
      if (!animSkip) {
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        this.rig.updateAnimation(
          simStride === 1 && simThrottleScale >= 2 && distSqToViewer > 22 * 22
            ? stepDt * 2
            : stepDt,
          elapsed,
          this.state,
          horizSpeed,
          0,
        );
        const showBar =
          this.health.getHealthRatio() < 0.999 || distSqToViewer <= 16.5 * 16.5;
        this.rig.updateHealthBar(this.health.getHealthRatio(), showBar, camera);
      }
    }
  }

  private steerToward(
    tx: number,
    tz: number,
    speed: number,
    dt: number,
    ctx: EnemyUpdateContext,
  ): number | null {
    const dx = tx - this.position.x;
    const dz = tz - this.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const baseNx = dx / dist;
    const baseNz = dz / dist;
    const step = speed * dt;
    const maxPlayR = PLAYABLE_RADIUS - 14;
    const maxPlayRSq = maxPlayR * maxPlayR;

    const nearbyColliders = ctx.queryCollidersNear(this.position.x, this.position.z);

    for (let i = 0; i < STEER_DETOUR_ANGLES.length; i++) {
      const ang = STEER_DETOUR_ANGLES[i] * this.steerDetourSign;
      let nx = baseNx;
      let nz = baseNz;
      if (ang !== 0) {
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        nx = baseNx * cos - baseNz * sin;
        nz = baseNx * sin + baseNz * cos;
      }

      const nextX = this.position.x + nx * step;
      const nextZ = this.position.z + nz * step;
      if (nextX * nextX + nextZ * nextZ > maxPlayRSq) continue;
      if (ctx.isVillageClearance(nextX, nextZ)) continue;

      const bridgeY = sampleWalkableBridgeHeight(nextX, nextZ, this.position.y, nearbyColliders);
      const nextH = bridgeY !== null ? bridgeY : groundHeightAt(nextX, nextZ);
      if (bridgeY === null) {
        if (nextH < WATER_LEVEL + 0.25) continue;
        const nextSlope = groundSlopeAt(nextX, nextZ, nextH);
        // Only block steep UPHILL climbs so enemies/bandits can always walk downhill or traverse hills
        if (nextSlope > 0.48 && nextH > this.position.y + 0.08) continue;
      }

      // Also check a slight lookahead so enemy routes smoothly before hugging a shoreline
      const probeX = this.position.x + nx * Math.max(0.75, step * 2.2);
      const probeZ = this.position.z + nz * Math.max(0.75, step * 2.2);
      const probeBridgeY = sampleWalkableBridgeHeight(probeX, probeZ, nextH, nearbyColliders);
      const probeH = probeBridgeY !== null ? probeBridgeY : groundHeightAt(probeX, probeZ);
      if (
        i < STEER_DETOUR_ANGLES.length - 2 &&
        ((probeBridgeY === null && probeH < WATER_LEVEL + 0.15) || ctx.isVillageClearance(probeX, probeZ))
      ) {
        continue;
      }

      if (i === 0) {
        this.steerStallTimer = 0;
      }
      this.position.x = nextX;
      this.position.z = nextZ;
      this.velocity.set(nx * speed, 0, nz * speed);
      this.yaw = dampAngle(this.yaw, Math.atan2(nx, nz), 9.5, dt);
      return nextH;
    }

    this.steerStallTimer += dt;
    if (this.steerStallTimer > 0.75) {
      this.steerDetourSign *= -1;
      this.steerStallTimer = 0;
    }
    if (this.state === 'patrol') {
      this.pickNextPatrolPoint();
    }
    this.velocity.set(0, 0, 0);
    return null;
  }

  private resolveColliders(
    queryCollidersNear: (x: number, z: number) => WorldCollider[],
  ): boolean {
    const colliders = queryCollidersNear(this.position.x, this.position.z);
    let pushed = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.kind === 'box') {
        if (c.walkableTop || c.tag === 'roof') continue;
        if (this.position.y >= c.maxY - 0.08 || this.position.y + 1.8 <= c.minY + 0.05) {
          continue;
        }
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const cos = Math.cos(c.yaw);
        const sin = Math.sin(c.yaw);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const r = this.hitRadius;
        if (Math.abs(lx) < c.halfW + r && Math.abs(lz) < c.halfD + r) {
          const closestX = Math.max(-c.halfW, Math.min(c.halfW, lx));
          const closestZ = Math.max(-c.halfD, Math.min(c.halfD, lz));
          const offX = lx - closestX;
          const offZ = lz - closestZ;
          const distSq = offX * offX + offZ * offZ;
          if (distSq < r * r) {
            let pushLX = 0;
            let pushLZ = 0;
            if (distSq > 1e-8) {
              const dist = Math.sqrt(distSq);
              const push = r - dist + 0.004;
              pushLX = (offX / dist) * push;
              pushLZ = (offZ / dist) * push;
            } else {
              const penX = c.halfW - Math.abs(lx) + r + 0.004;
              const penZ = c.halfD - Math.abs(lz) + r + 0.004;
              if (penX < penZ) {
                pushLX = (lx >= 0 ? 1 : -1) * penX;
              } else {
                pushLZ = (lz >= 0 ? 1 : -1) * penZ;
              }
            }
            this.position.x += pushLX * cos + pushLZ * sin;
            this.position.z += -pushLX * sin + pushLZ * cos;
            pushed = true;
          }
        }
      } else {
        const minR = c.radius + this.hitRadius;
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minR * minR && dSq > 0.0001) {
          const d = Math.sqrt(dSq);
          const push = minR - d;
          this.position.x += (dx / d) * push;
          this.position.z += (dz / d) * push;
          pushed = true;
        }
      }
    }
    return pushed;
  }

  private executeMeleeAttack(
    ctx: EnemyUpdateContext,
    activeTarget: {
      playerId: string;
      isLocal: boolean;
      position: THREE.Vector3;
      dist: number;
    } | null,
    isSlam = false,
  ): void {
    ctx.onEnemySwing?.(this);
    const hitDamage = isSlam
      ? Math.round(this.archetype.damage * 1.25)
      : this.archetype.damage;
    if (activeTarget && !activeTarget.isLocal) {
      const dx = activeTarget.position.x - this.position.x;
      const dz = activeTarget.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= this.archetype.attackRange + (isSlam ? 0.95 : 0.58)) {
        ctx.onEnemyAttackRemotePlayer?.(this, activeTarget.playerId, hitDamage);
      }
      return;
    }

    _singleTargetScratch.length = 0;
    _singleTargetScratch.push(ctx.playerTarget);

    _hitsScratch.length = 0;
    ctx.damageSystem.detectMeleeArcHits(
      this.position,
      this.yaw,
      this.archetype.attackRange + (isSlam ? 0.95 : 0.45),
      isSlam ? Math.PI * 1.15 : Math.PI * 0.85,
      _singleTargetScratch,
      _hitsScratch,
    );

    if (_hitsScratch.length > 0) {
      const packet = ctx.damageSystem.createPacket({
        amount: hitDamage,
        damageType: this.archetype.damageType,
        sourceId: this.id,
        sourcePosition: this.position,
        knockback: this.archetype.knockback * (isSlam ? 1.25 : 1),
        isCrit: isSlam,
      });
      const result = ctx.damageSystem.applyDamage(ctx.playerTarget, packet);
      if (result.applied) {
        ctx.onEnemyAttackHit?.(this, result);
      }
    }
  }

  private respawnAtHome(): void {
    this.health.revive(1);
    this.position.copy(this.homePosition);
    this.velocity.set(0, 0, 0);
    this.knockbackVel.set(0, 0, 0);
    this.aggro = false;
    this.targetPlayerId = null;
    this.lastAttackerPlayerId = null;
    this.lastAttackerTimer = 0;
    this.threatByPlayer.clear();
    this.bossPhase = 1;
    this.attackState = 'idle';
    this.state = 'patrol';
    this.deathElapsed = 0;
    this.rig.root.position.copy(this.position);
    this.rig.root.visible = true;
    this.pickNextPatrolPoint();
  }

  public dispose(): void {
    this.rig.dispose();
  }
}
