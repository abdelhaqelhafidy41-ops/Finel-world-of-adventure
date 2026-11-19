import * as THREE from 'three';
import type {
  DoorState,
  NpcBehaviorState,
  NpcDialogueChoice,
  NpcDialogueSession,
  NpcRole,
  NpcRoutinePeriod,
  WorldCollider,
} from '../types';
import type { DialogueNpcProfile } from '../dialogue/dialogueTypes';
import type { EnemyController } from '../combat/EnemyController';
import type { DamageSystem } from '../combat/DamageSystem';
import {
  groundHeightAt,
  groundSlopeAt,
  seededRandom,
} from '../math/noise';
import { sampleWalkableBridgeHeight } from '../world/BridgeSystem';
import {
  findNearestValidLand,
  findSafeClearColliderPoint,
  isLand,
  isPointBlockedByColliders,
  isValidNPCSpawnLocation,
  isWater,
} from '../world/WorldPlacementValidator';
import { AR_NPC_META } from '../i18n/arContent';
import { ROLE_LABELS, type Language } from '../i18n/translations';
import { getNpcPersona } from './npcPersonalities';
import { NpcRig, type NpcSharedAssets } from './NpcRig';
import type { WorldEntitySnapshot } from '../../../shared/multiplayerProtocol';

export interface NpcPoint2D {
  x: number;
  z: number;
}

export interface NpcBedTarget {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

export interface NpcRoutineSlot {
  period: NpcRoutinePeriod;
  activityLabel: string;
  anchor: NpcPoint2D;
  mode: 'station' | 'wander' | 'work' | 'patrol' | 'sleep';
  wanderRadius: number;
  facingYaw?: number;
  waypoints?: NpcPoint2D[];
}

export interface NpcConfig {
  id: string;
  name: string;
  nameAr?: string;
  role: NpcRole;
  title: string;
  titleAr?: string;
  spawn: NpcPoint2D;
  walkSpeed?: number;
  interactionRadius?: number;
  homeId?: string;
  homeDoorId?: string;
  bedId?: string;
  workplaceId?: string;
  homeEntryPos?: NpcPoint2D;
  homeThresholdPos?: NpcPoint2D;
  bedPos?: NpcBedTarget;
  workplacePos?: NpcPoint2D;
  greetings: Record<NpcRoutinePeriod, string>;
  greetingsAr?: Record<NpcRoutinePeriod, string>;
  choices: NpcDialogueChoice[];
  choicesAr?: NpcDialogueChoice[];
  schedule: NpcRoutineSlot[];
  routineLabelsAr?: Record<NpcRoutinePeriod, string>;
  location?: string;
  locationAr?: string;
  personality?: string;
  personalityAr?: string;
  suggestedPrompts?: string[];
  suggestedPromptsAr?: string[];
  chunkKey?: string;
  seed?: number;
}

export interface NpcTickContext {
  dt: number;
  elapsed: number;
  period: NpcRoutinePeriod;
  playerPos: THREE.Vector3;
  queryCollidersNear: (x: number, z: number) => WorldCollider[];
  otherNpcPositions: Array<{ id: string; x: number; z: number }>;
  partyMemberPositions?: Array<{ playerId: string; x: number; z: number }>;
  enemies?: readonly EnemyController[];
  damageSystem?: DamageSystem | null;
  getDoorState?: (doorId: string) => DoorState;
  requestDoorOpen?: (doorId: string, npcId: string) => DoorState;
  requestDoorClose?: (doorId: string, npcId: string) => void;
}

export type NpcSleepNavStage =
  | 'outdoor'
  | 'going_to_door'
  | 'entering_door'
  | 'going_to_bed'
  | 'sleeping'
  | 'exiting_door';

export interface NpcBlackboard {
  currentPeriod: NpcRoutinePeriod;
  activeSlot: NpcRoutineSlot;
  waypointIndex: number;
  targetPoint: NpcPoint2D | null;
  waitTimer: number;
  stuckTimer: number;
  lastDistToTarget: number;
  sleepStage: NpcSleepNavStage;
  sleepStageStuckTimer: number;
  memory: Record<string, unknown>;
}

export interface PersistedNpcLogicalState {
  id: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHealth: number;
  isDead: boolean;
  dialogueState: 'idle' | 'talking';
  questState: string;
  lastPeriod: NpcRoutinePeriod;
  sleepStage: NpcSleepNavStage;
}

export interface NpcAIModule {
  onAttach?: (npc: NPCBase) => void;
  decide: (npc: NPCBase, ctx: NpcTickContext) => void;
}

/**
 * Modular routine AI supporting daily work/patrol/wander schedules PLUS
 * full doorway -> house interior -> assigned bed sleeping & morning wake navigation.
 */
export class BasicRoutineAI implements NpcAIModule {
  public decide(npc: NPCBase, ctx: NpcTickContext): void {
    if (npc.isTalking()) {
      npc.setBehaviorState('talking');
      npc.stopMoving();
      npc.faceToward(ctx.playerPos.x, ctx.playerPos.z, ctx.dt);
      return;
    }

    if (npc.updateAlertReaction(ctx.dt)) {
      return;
    }

    const bb = npc.blackboard;
    if (bb.currentPeriod !== ctx.period) {
      const prevPeriod = bb.currentPeriod;
      bb.currentPeriod = ctx.period;
      bb.activeSlot = npc.getRoutineForPeriod(ctx.period);
      bb.waypointIndex = 0;
      bb.targetPoint = null;
      bb.waitTimer = 0.25;
      bb.stuckTimer = 0;
      bb.sleepStageStuckTimer = 0;

      if (ctx.period === 'night' && npc.hasAssignedHome()) {
        if (bb.sleepStage === 'outdoor' || bb.sleepStage === 'exiting_door') {
          bb.sleepStage = 'going_to_door';
          bb.sleepStageStuckTimer = 0;
          delete bb.memory.exitSubStage;
        }
      } else if (
        prevPeriod === 'night' &&
        (bb.sleepStage === 'sleeping' ||
          bb.sleepStage === 'going_to_bed' ||
          bb.sleepStage === 'entering_door' ||
          bb.sleepStage === 'going_to_door')
      ) {
        if (bb.sleepStage === 'going_to_door') {
          bb.sleepStage = 'outdoor';
          bb.sleepStageStuckTimer = 0;
        } else {
          bb.sleepStage = 'exiting_door';
          bb.sleepStageStuckTimer = 0;
          bb.memory.exitSubStage = 'to_threshold';
        }
      }
    }

    if (npc.isEscorting()) {
      const target = npc.getEscortTarget();
      if (target) {
        if (bb.sleepStage === 'sleeping' || bb.sleepStage === 'going_to_bed' || bb.sleepStage === 'entering_door') {
          npc.wakeToMorningOutdoor();
        }
        const dist = npc.distanceTo2D(target.x, target.z);
        if (dist > 48) {
          npc.placeAt(target.x - 1.8, target.z - 1.8);
          npc.setBehaviorState('idle');
          npc.stopMoving();
          return;
        }
        if (dist > 2.6) {
          npc.setBehaviorState('walking');
          npc.navigateToward(target.x, target.z, ctx, 2.2, npc.getWalkSpeed() * 1.18);
        } else {
          npc.stopMoving();
          npc.setBehaviorState('idle');
          npc.faceToward(target.x, target.z, ctx.dt);
        }
        return;
      }
    }

    // Handle active house entry & indoor sleeping transitions
    if (npc.hasAssignedHome() && (ctx.period === 'night' || bb.sleepStage !== 'outdoor')) {
      if (this.updateHomeAndSleepRoutine(npc, ctx)) {
        return;
      }
    }

    if (
      npc.role === 'guard' &&
      bb.sleepStage === 'outdoor' &&
      ctx.enemies &&
      ctx.damageSystem &&
      ctx.enemies.length > 0
    ) {
      if (this.updateGuardCombat(npc, ctx)) {
        return;
      }
    }

    const slot = bb.activeSlot;

    // 1. Patrol mode
    if (slot.mode === 'patrol' && slot.waypoints && slot.waypoints.length > 0) {
      if (bb.waitTimer > 0) {
        bb.waitTimer -= ctx.dt;
        npc.setBehaviorState('idle');
        npc.stopMoving();
        return;
      }

      const wp = slot.waypoints[bb.waypointIndex % slot.waypoints.length];
      const arrived = npc.navigateToward(wp.x, wp.z, ctx, 0.9);
      if (arrived || bb.stuckTimer > 2.2) {
        bb.stuckTimer = 0;
        bb.waypointIndex = (bb.waypointIndex + 1) % slot.waypoints.length;
        bb.waitTimer = 1.4 + npc.nextRandom() * 1.6;
        npc.setBehaviorState('idle');
        npc.stopMoving();
      } else {
        npc.setBehaviorState('walking');
      }
      return;
    }

    // 2. Station mode
    if (slot.mode === 'station') {
      const dist = npc.distanceTo2D(slot.anchor.x, slot.anchor.z);
      if (dist > 0.85 && bb.stuckTimer < 2.5) {
        npc.setBehaviorState('walking');
        npc.navigateToward(slot.anchor.x, slot.anchor.z, ctx, 0.75);
      } else {
        npc.stopMoving();
        npc.setBehaviorState('idle');
        if (slot.facingYaw !== undefined) {
          npc.rotateTowardYaw(slot.facingYaw, ctx.dt);
        }
      }
      return;
    }

    // 3. Work mode
    if (slot.mode === 'work') {
      const distAnchor = npc.distanceTo2D(slot.anchor.x, slot.anchor.z);
      if (!bb.targetPoint && distAnchor > slot.wanderRadius + 1.5 && bb.stuckTimer < 2.5) {
        npc.setBehaviorState('walking');
        npc.navigateToward(slot.anchor.x, slot.anchor.z, ctx, 1.0);
        return;
      }

      if (bb.targetPoint) {
        const arrived = npc.navigateToward(bb.targetPoint.x, bb.targetPoint.z, ctx, 0.75);
        if (arrived || bb.stuckTimer > 1.8) {
          bb.targetPoint = null;
          bb.stuckTimer = 0;
          bb.waitTimer = 3.5 + npc.nextRandom() * 3.5;
          npc.stopMoving();
          npc.setBehaviorState('working');
        } else {
          npc.setBehaviorState('wandering');
        }
      } else {
        npc.stopMoving();
        bb.waitTimer -= ctx.dt;
        npc.setBehaviorState(bb.waitTimer > 1.0 ? 'working' : 'idle');
        if (bb.waitTimer <= 0) {
          bb.targetPoint = npc.pickSafePointNear(slot.anchor.x, slot.anchor.z, slot.wanderRadius, ctx.queryCollidersNear);
          bb.stuckTimer = 0;
        }
      }
      return;
    }

    // 4. Wander mode
    if (bb.targetPoint) {
      const arrived = npc.navigateToward(bb.targetPoint.x, bb.targetPoint.z, ctx, 0.85);
      if (arrived || bb.stuckTimer > 2.0) {
        bb.targetPoint = null;
        bb.stuckTimer = 0;
        bb.waitTimer = 2.4 + npc.nextRandom() * 3.6;
        npc.stopMoving();
        npc.setBehaviorState('idle');
      } else {
        const distAnchor = npc.distanceTo2D(slot.anchor.x, slot.anchor.z);
        npc.setBehaviorState(distAnchor > slot.wanderRadius + 3 ? 'walking' : 'wandering');
      }
    } else {
      npc.stopMoving();
      npc.setBehaviorState('idle');
      bb.waitTimer -= ctx.dt;
      if (bb.waitTimer <= 0) {
        bb.targetPoint = npc.pickSafePointNear(slot.anchor.x, slot.anchor.z, slot.wanderRadius, ctx.queryCollidersNear);
        bb.stuckTimer = 0;
      }
    }
  }

  private updateGuardCombat(npc: NPCBase, ctx: NpcTickContext): boolean {
    const enemies = ctx.enemies;
    const damageSystem = ctx.damageSystem;
    if (!enemies || !damageSystem) return false;

    const bb = npc.blackboard;
    const cooldown = typeof bb.memory.guardAttackCooldown === 'number'
      ? Math.max(0, bb.memory.guardAttackCooldown - ctx.dt)
      : 0;
    bb.memory.guardAttackCooldown = cooldown;

    const post = npc.getRoutineForPeriod('morning').anchor;
    let nearestEnemy: EnemyController | null = null;
    let bestDistSq = 18 * 18;
    const maxLeashSq = 38 * 38;
    const partyAssistDistSq = 18 * 18;
    const partyPositions = ctx.partyMemberPositions;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.health.isAlive() || enemy.state === 'dead') continue;
      const anchorDx = enemy.position.x - post.x;
      const anchorDz = enemy.position.z - post.z;
      if (anchorDx * anchorDx + anchorDz * anchorDz > maxLeashSq) continue;

      const dx = enemy.position.x - npc.position.x;
      const dz = enemy.position.z - npc.position.z;
      const dSq = dx * dx + dz * dz;
      let threatensParty = false;
      if (partyPositions && partyPositions.length > 0) {
        for (let p = 0; p < partyPositions.length; p++) {
          const pdx = enemy.position.x - partyPositions[p].x;
          const pdz = enemy.position.z - partyPositions[p].z;
          if (pdx * pdx + pdz * pdz <= partyAssistDistSq) {
            threatensParty = true;
            break;
          }
        }
      }
      const effectiveDistSq = threatensParty ? Math.min(dSq, bestDistSq - 1) : dSq;
      if (effectiveDistSq < bestDistSq || (threatensParty && !nearestEnemy)) {
        bestDistSq = dSq;
        nearestEnemy = enemy;
      }
    }

    if (!nearestEnemy) return false;

    const dist = Math.sqrt(bestDistSq);
    if (dist <= 2.25) {
      npc.stopMoving();
      npc.faceToward(nearestEnemy.position.x, nearestEnemy.position.z, ctx.dt);
      npc.setBehaviorState('working');
      if (cooldown <= 0) {
        damageSystem.applyDamage(nearestEnemy, {
          amount: 14,
          damageType: 'slash',
          sourceId: npc.id,
          sourcePosition: npc.position,
          knockback: 4.5,
          isCrit: false,
        });
        bb.memory.guardAttackCooldown = 1.05;
      }
      return true;
    }

    npc.setBehaviorState('walking');
    npc.navigateToward(
      nearestEnemy.position.x,
      nearestEnemy.position.z,
      ctx,
      1.85,
      4.1,
    );
    return true;
  }

  private updateHomeAndSleepRoutine(npc: NPCBase, ctx: NpcTickContext): boolean {
    const bb = npc.blackboard;
    const doorEntry = npc.homeEntryPos;
    const threshold = npc.homeThresholdPos;
    const bed = npc.bedPos;
    const doorId = npc.getHomeDoorId();
    if (!doorEntry || !bed) return false;

    bb.sleepStageStuckTimer += ctx.dt;

    if (ctx.period === 'night') {
      if (bb.sleepStage === 'sleeping') {
        bb.sleepStageStuckTimer = 0;
        npc.stopMoving();
        npc.setBehaviorState('sleeping');
        if (bed.yaw !== undefined) {
          npc.rotateTowardYaw(bed.yaw, ctx.dt * 2);
        }
        return true;
      }

      if (bb.sleepStage === 'going_to_door') {
        const distToDoor = npc.distanceTo2D(doorEntry.x, doorEntry.z);
        if (distToDoor <= 2.4 && doorId) {
          ctx.requestDoorOpen?.(doorId, npc.id);
        }
        if (bb.sleepStageStuckTimer > 12.0 && distToDoor > 2.0) {
          // Safe exterior fallback outside front door if outdoor obstacle blocked path
          const safe = findSafeClearColliderPoint(
            doorEntry.x,
            doorEntry.z,
            0.55,
            ctx.queryCollidersNear,
            0.5,
            0.36,
            10,
          );
          npc.placeAt(safe.x, safe.z);
          bb.sleepStageStuckTimer = 0;
          if (doorId) ctx.requestDoorOpen?.(doorId, npc.id);
        }
        const arrived = distToDoor <= 0.72 || npc.navigateToward(doorEntry.x, doorEntry.z, ctx, 0.72);
        if (arrived) {
          npc.stopMoving();
          npc.faceToward(threshold?.x ?? bed.x, threshold?.z ?? bed.z, ctx.dt);
          if (doorId) {
            const state = ctx.requestDoorOpen?.(doorId, npc.id) ?? ctx.getDoorState?.(doorId) ?? 'OPEN';
            if (state !== 'OPEN') {
              npc.setBehaviorState('idle');
              return true;
            }
          }
          bb.sleepStage = 'entering_door';
          bb.sleepStageStuckTimer = 0;
          bb.stuckTimer = 0;
          npc.resetIndoorStuckMonitor();
        } else {
          npc.setBehaviorState('walking');
        }
        return true;
      }

      if (bb.sleepStage === 'entering_door') {
        const doorState = doorId
          ? ctx.requestDoorOpen?.(doorId, npc.id) ?? ctx.getDoorState?.(doorId) ?? 'OPEN'
          : 'OPEN';
        if (doorState !== 'OPEN') {
          npc.stopMoving();
          npc.setBehaviorState('idle');
          return true;
        }
        const target = threshold ?? { x: bed.x, z: bed.z };
        const arrived = npc.navigateIndoors(
          target.x,
          bed.y,
          target.z,
          ctx.dt,
          0.48,
          ctx.queryCollidersNear,
          true,
        );
        npc.setBehaviorState('walking');
        if (arrived || bb.sleepStageStuckTimer > 7.5) {
          if (!arrived) {
            npc.position.set(target.x, bed.y, target.z);
            npc.rig.root.position.copy(npc.position);
          }
          if (doorId) {
            ctx.requestDoorClose?.(doorId, npc.id);
          }
          bb.sleepStage = 'going_to_bed';
          bb.sleepStageStuckTimer = 0;
          npc.resetIndoorStuckMonitor();
        }
        return true;
      }

      if (bb.sleepStage === 'going_to_bed') {
        const doorOpen = !doorId || (ctx.getDoorState?.(doorId) ?? 'CLOSED') === 'OPEN';
        const arrived = npc.navigateIndoors(
          bed.x,
          bed.y,
          bed.z,
          ctx.dt,
          0.55,
          ctx.queryCollidersNear,
          doorOpen,
        );
        if (arrived || bb.sleepStageStuckTimer > 8.5) {
          if (!arrived) {
            npc.position.set(bed.x, bed.y, bed.z);
            npc.rig.root.position.copy(npc.position);
          }
          npc.stopMoving();
          bb.sleepStage = 'sleeping';
          bb.sleepStageStuckTimer = 0;
          npc.setBehaviorState('sleeping');
        } else {
          npc.setBehaviorState('walking');
        }
        return true;
      }
    } else {
      if (bb.sleepStage === 'going_to_door') {
        // Morning arrived before villager reached door; cleanly resume outdoor day routine
        if (doorId) ctx.requestDoorClose?.(doorId, npc.id);
        bb.sleepStage = 'outdoor';
        bb.sleepStageStuckTimer = 0;
        return false;
      }

      // Morning wake -> walk indoors to threshold -> request door open -> pass doorway cleanly -> close door
      if (bb.sleepStage === 'sleeping' || bb.sleepStage === 'going_to_bed' || bb.sleepStage === 'entering_door') {
        bb.sleepStage = 'exiting_door';
        bb.sleepStageStuckTimer = 0;
        bb.memory.exitSubStage = 'to_threshold';
        npc.resetIndoorStuckMonitor();
      }

      if (bb.sleepStage === 'exiting_door') {
        const waitTarget = threshold ?? doorEntry;
        if (bb.memory.exitSubStage !== 'through_door') {
          const doorOpen = !doorId || (ctx.getDoorState?.(doorId) ?? 'CLOSED') === 'OPEN';
          const distThreshold = npc.distanceTo2D(waitTarget.x, waitTarget.z);
          if (bb.sleepStageStuckTimer > 8.5 && distThreshold > 0.58) {
            // Unblock from bed/table geometry inside cottage to doorway threshold
            npc.position.set(waitTarget.x, bed.y, waitTarget.z);
            npc.rig.root.position.copy(npc.position);
            bb.sleepStageStuckTimer = 0;
          }
          const atThreshold =
            npc.distanceTo2D(waitTarget.x, waitTarget.z) <= 0.58 ||
            npc.navigateIndoors(
              waitTarget.x,
              bed.y,
              waitTarget.z,
              ctx.dt,
              0.55,
              ctx.queryCollidersNear,
              doorOpen,
            );
          if (atThreshold) {
            npc.stopMoving();
            npc.faceToward(doorEntry.x, doorEntry.z, ctx.dt);
            if (doorId) {
              const dState = ctx.requestDoorOpen?.(doorId, npc.id) ?? ctx.getDoorState?.(doorId) ?? 'OPEN';
              if (dState !== 'OPEN') {
                npc.setBehaviorState('idle');
                return true;
              }
            }
            bb.memory.exitSubStage = 'through_door';
            bb.sleepStageStuckTimer = 0;
            npc.resetIndoorStuckMonitor();
          } else {
            npc.setBehaviorState('walking');
          }
          return true;
        }

        const dState = doorId
          ? ctx.requestDoorOpen?.(doorId, npc.id) ?? ctx.getDoorState?.(doorId) ?? 'OPEN'
          : 'OPEN';
        if (dState !== 'OPEN') {
          npc.stopMoving();
          npc.setBehaviorState('idle');
          return true;
        }
        const entryGroundY = groundHeightAt(doorEntry.x, doorEntry.z);
        const arrivedAtEntry = npc.navigateIndoors(
          doorEntry.x,
          entryGroundY,
          doorEntry.z,
          ctx.dt,
          0.52,
          ctx.queryCollidersNear,
          true,
        );
        // Verify NPC physically crossed to the outside of the doorway plane before closing
        const outDirX = doorEntry.x - waitTarget.x;
        const outDirZ = doorEntry.z - waitTarget.z;
        const outLen = Math.hypot(outDirX, outDirZ) || 1;
        const relX = npc.position.x - doorEntry.x;
        const relZ = npc.position.z - doorEntry.z;
        const pastDoorwayPlane = (relX * outDirX + relZ * outDirZ) / outLen >= -0.22;
        const physicallyOutside =
          (arrivedAtEntry && pastDoorwayPlane) || bb.sleepStageStuckTimer > 7.5;

        npc.setBehaviorState('walking');
        if (physicallyOutside) {
          if (!arrivedAtEntry || !pastDoorwayPlane) {
            npc.placeAt(doorEntry.x, doorEntry.z);
          }
          if (doorId) {
            ctx.requestDoorClose?.(doorId, npc.id);
          }
          delete bb.memory.exitSubStage;
          bb.sleepStage = 'outdoor';
          bb.sleepStageStuckTimer = 0;
          bb.stuckTimer = 0;
          npc.resetStuckMonitor();
        }
        return true;
      }
    }

    return false;
  }
}

export abstract class NPCBase {
  public readonly id: string;
  public readonly name: string;
  public readonly role: NpcRole;
  public readonly title: string;
  public readonly interactionRadius: number;
  public readonly chunkKey: string | null;

  public readonly homeId?: string;
  public readonly homeDoorId?: string;
  public readonly bedId?: string;
  public readonly workplaceId?: string;
  public readonly homeEntryPos?: NpcPoint2D;
  public readonly homeThresholdPos?: NpcPoint2D;
  public readonly bedPos?: NpcBedTarget;
  public readonly workplacePos?: NpcPoint2D;

  public readonly position = new THREE.Vector3();
  public readonly velocity = new THREE.Vector3();
  public readonly rig: NpcRig;
  public readonly blackboard: NpcBlackboard;

  protected readonly config: NpcConfig;
  protected readonly rand: () => number;
  protected aiModule: NpcAIModule;

  public readonly maxHealth: number;
  public hp: number;
  public isDead = false;
  public isSpawnValid = true;

  private yaw = 0;
  private readonly walkSpeed: number;
  private readonly radius = 0.42;
  private behaviorState: NpcBehaviorState = 'idle';
  private talking = false;
  private alertTimer = 0;
  private alertSourceX = 0;
  private alertSourceZ = 0;
  private networkRemoteControlled = false;
  private remoteTargetPos: THREE.Vector3 | null = null;
  private remoteTargetYaw = 0;
  private remoteTargetState: NpcBehaviorState = 'idle';
  private escortTargetPos: { x: number; z: number } | null = null;
  public pendingDt = 0;

  private stuckOriginX = 0;
  private stuckOriginZ = 0;
  private stuckWindowTimer = 0;
  private stuckRecoveryStage = 0;
  private detourSign = 1;
  private indoorOriginX = 0;
  private indoorOriginZ = 0;
  private indoorWindowTimer = 0;
  private indoorDetourStage = 0;

  constructor(config: NpcConfig, assets: NpcSharedAssets) {
    this.config = config;
    this.id = config.id;
    this.name = config.name;
    this.role = config.role;
    this.title = config.title;
    this.chunkKey = config.chunkKey ?? null;
    this.homeId = config.homeId;
    this.homeDoorId = config.homeDoorId ?? (config.homeId ? `${config.homeId}-door` : undefined);
    this.bedId = config.bedId;
    this.workplaceId = config.workplaceId;
    this.homeEntryPos = config.homeEntryPos;
    this.homeThresholdPos = config.homeThresholdPos;
    this.bedPos = config.bedPos;
    this.workplacePos = config.workplacePos;

    this.walkSpeed = config.walkSpeed ?? 2.35;
    this.interactionRadius = config.interactionRadius ?? 3.2;
    this.maxHealth = config.role === 'guard' ? 140 : 100;
    this.hp = this.maxHealth;
    this.rand = seededRandom(config.seed ?? this.hashString(config.id));

    const validSpawn = isValidNPCSpawnLocation(config.spawn.x, config.spawn.z, 0.55)
      ? { x: config.spawn.x, y: groundHeightAt(config.spawn.x, config.spawn.z), z: config.spawn.z }
      : findNearestValidLand(config.spawn.x, config.spawn.z, 3.0, 0.34, 80);
    this.position.set(validSpawn.x, validSpawn.y, validSpawn.z);
    this.stuckOriginX = validSpawn.x;
    this.stuckOriginZ = validSpawn.z;
    this.rig = new NpcRig(
      config.name,
      config.role,
      assets,
      this.rand() * Math.PI * 2,
    );
    this.rig.root.position.copy(this.position);

    const initialSlot = this.getRoutineForPeriod('morning');
    this.blackboard = {
      currentPeriod: 'morning',
      activeSlot: initialSlot,
      waypointIndex: 0,
      targetPoint: null,
      waitTimer: 0.6 + this.rand() * 1.8,
      stuckTimer: 0,
      lastDistToTarget: Infinity,
      sleepStage: 'outdoor',
      sleepStageStuckTimer: 0,
      memory: {},
    };

    this.aiModule = new BasicRoutineAI();
    this.aiModule.onAttach?.(this);
  }

  public getHomeDoorId(): string | undefined {
    return this.homeDoorId ?? (this.homeId ? `${this.homeId}-door` : undefined);
  }

  public hasAssignedHome(): boolean {
    return Boolean(this.homeEntryPos && this.bedPos);
  }

  public resetStuckMonitor(): void {
    this.stuckOriginX = this.position.x;
    this.stuckOriginZ = this.position.z;
    this.stuckWindowTimer = 0;
    this.stuckRecoveryStage = 0;
  }

  public validateSpawnPlacement(
    queryCollidersNear: (x: number, z: number) => WorldCollider[],
  ): boolean {
    // Do not disturb NPCs actively sleeping/walking inside their valid house
    if (
      this.blackboard.sleepStage === 'sleeping' ||
      this.blackboard.sleepStage === 'going_to_bed'
    ) {
      this.isSpawnValid = true;
      return true;
    }

    const nearby = queryCollidersNear(this.position.x, this.position.z);
    const blocked = isPointBlockedByColliders(
      this.position.x,
      this.position.z,
      this.radius,
      nearby,
      { y: this.position.y },
    );
    const onValidLand = isValidNPCSpawnLocation(this.position.x, this.position.z, 0.35);

    if (!blocked && onValidLand) {
      this.isSpawnValid = true;
      return true;
    }

    const safe = findSafeClearColliderPoint(
      this.position.x,
      this.position.z,
      this.radius + 0.15,
      queryCollidersNear,
      0.55,
      0.36,
      24,
    );
    this.placeAt(safe.x, safe.z);
    this.resetStuckMonitor();
    const recheck = queryCollidersNear(safe.x, safe.z);
    this.isSpawnValid = !isPointBlockedByColliders(safe.x, safe.z, this.radius, recheck, { y: safe.y });
    return this.isSpawnValid;
  }

  public wakeToMorningOutdoor(): void {
    this.blackboard.currentPeriod = 'morning';
    this.blackboard.activeSlot = this.getRoutineForPeriod('morning');
    this.blackboard.sleepStage = 'outdoor';
    this.blackboard.sleepStageStuckTimer = 0;
    this.blackboard.targetPoint = null;
    this.blackboard.stuckTimer = 0;
    this.behaviorState = 'idle';
    const spawnAnchor = this.homeEntryPos ?? this.config.spawn;
    this.placeAt(spawnAnchor.x, spawnAnchor.z);
    this.resetStuckMonitor();
  }

  public exportLogicalState(): PersistedNpcLogicalState {
    return {
      id: this.id,
      x: Math.round(this.position.x * 100) / 100,
      z: Math.round(this.position.z * 100) / 100,
      yaw: Math.round(this.yaw * 1000) / 1000,
      hp: Math.round(this.hp),
      maxHealth: this.maxHealth,
      isDead: this.isDead,
      dialogueState: this.getSyncDialogueState(),
      questState: this.getSyncQuestState(),
      lastPeriod: this.blackboard.currentPeriod,
      sleepStage: this.blackboard.sleepStage,
    };
  }

  public restoreLogicalStateAndSyncSchedule(
    currentPeriod: NpcRoutinePeriod,
    saved?: Partial<PersistedNpcLogicalState>,
    queryCollidersNear?: (x: number, z: number) => WorldCollider[],
  ): void {
    if (saved && (typeof saved.hp === 'number' || typeof saved.isDead === 'boolean')) {
      this.applyAuthoritativeHealth(
        saved.hp ?? this.maxHealth,
        saved.maxHealth ?? this.maxHealth,
        Boolean(saved.isDead),
      );
    }

    const bb = this.blackboard;
    bb.currentPeriod = currentPeriod;
    bb.activeSlot = this.getRoutineForPeriod(currentPeriod);
    bb.waypointIndex = 0;
    bb.targetPoint = null;
    bb.stuckTimer = 0;
    bb.sleepStageStuckTimer = 0;
    this.talking = false;

    if (this.isDead) {
      if (saved && typeof saved.x === 'number' && typeof saved.z === 'number') {
        this.placeAt(saved.x, saved.z);
      }
      if (saved && typeof saved.yaw === 'number') {
        this.yaw = saved.yaw;
      }
      this.rig.root.position.copy(this.position);
      this.rig.root.rotation.y = this.yaw;
      this.rig.updateAnimation(0, 'idle', 0);
      this.resetStuckMonitor();
      return;
    }

    const savedStage = saved?.sleepStage ?? 'outdoor';
    const savedPeriod = saved?.lastPeriod;
    const hasSavedPos =
      saved !== undefined &&
      typeof saved.x === 'number' &&
      Number.isFinite(saved.x) &&
      typeof saved.z === 'number' &&
      Number.isFinite(saved.z);

    if (currentPeriod === 'night' && this.hasAssignedHome() && this.bedPos) {
      const shouldSleepAtBed =
        !saved ||
        savedPeriod !== 'night' ||
        savedStage === 'sleeping' ||
        savedStage === 'going_to_bed' ||
        savedStage === 'entering_door';
      if (shouldSleepAtBed) {
        this.position.set(this.bedPos.x, this.bedPos.y, this.bedPos.z);
        this.stopMoving();
        this.yaw = this.bedPos.yaw ?? 0;
        bb.sleepStage = 'sleeping';
        this.behaviorState = 'sleeping';
        this.isSpawnValid = true;
        this.rig.root.position.copy(this.position);
        this.rig.root.rotation.y = this.yaw;
        this.rig.updateAnimation(0, 'sleeping', 0);
        this.resetStuckMonitor();
        return;
      }
      if (hasSavedPos) {
        this.placeAt(saved.x!, saved.z!);
        if (typeof saved.yaw === 'number') this.yaw = saved.yaw;
        bb.sleepStage = savedStage === 'exiting_door' ? 'going_to_door' : savedStage;
        this.behaviorState = 'idle';
      }
    } else if (hasSavedPos && savedPeriod === currentPeriod && savedStage === 'outdoor') {
      this.placeAt(saved.x!, saved.z!);
      if (typeof saved.yaw === 'number') this.yaw = saved.yaw;
      bb.sleepStage = 'outdoor';
      this.behaviorState = 'idle';
    } else {
      const anchor =
        savedPeriod === 'night' && savedStage !== 'outdoor' && this.homeEntryPos
          ? this.homeEntryPos
          : (bb.activeSlot.anchor ?? this.config.spawn);
      this.placeAt(anchor.x, anchor.z);
      if (bb.activeSlot.facingYaw !== undefined) {
        this.yaw = bb.activeSlot.facingYaw;
      } else if (hasSavedPos && typeof saved.yaw === 'number' && !savedPeriod) {
        this.yaw = saved.yaw;
      }
      bb.sleepStage = 'outdoor';
      this.behaviorState = 'idle';
    }

    if (queryCollidersNear) {
      this.validateSpawnPlacement(queryCollidersNear);
    }
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.yaw;
    this.rig.updateAnimation(0, this.behaviorState, 0);
    this.resetStuckMonitor();
  }

  public placeAt(x: number, z: number): void {
    const y = groundHeightAt(x, z);
    this.position.set(x, y, z);
    this.stopMoving();
    this.rig.root.position.copy(this.position);
  }

  public resetIndoorStuckMonitor(): void {
    this.indoorOriginX = this.position.x;
    this.indoorOriginZ = this.position.z;
    this.indoorWindowTimer = 0;
    this.indoorDetourStage = 0;
  }

  public navigateIndoors(
    targetX: number,
    targetY: number,
    targetZ: number,
    dt: number,
    arrivalThreshold = 0.5,
    queryCollidersNear?: (x: number, z: number) => WorldCollider[],
    homeDoorOpen = false,
  ): boolean {
    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= arrivalThreshold) {
      this.stopMoving();
      this.resetIndoorStuckMonitor();
      return true;
    }

    // Track indoor displacement stalls so villagers detour around cottage furniture/wall corners
    this.indoorWindowTimer += dt;
    if (this.indoorWindowTimer >= 1.1) {
      const moved = Math.hypot(
        this.position.x - this.indoorOriginX,
        this.position.z - this.indoorOriginZ,
      );
      if (moved < 0.2) {
        this.indoorDetourStage = Math.min(3, this.indoorDetourStage + 1);
        this.detourSign = -this.detourSign;
      } else {
        this.indoorDetourStage = 0;
      }
      this.indoorOriginX = this.position.x;
      this.indoorOriginZ = this.position.z;
      this.indoorWindowTimer = 0;
    }

    let dirX = dx / dist;
    let dirZ = dz / dist;
    if (this.indoorDetourStage > 0) {
      const ang = this.detourSign * (this.indoorDetourStage >= 2 ? Math.PI * 0.58 : Math.PI * 0.38);
      const cA = Math.cos(ang);
      const sA = Math.sin(ang);
      const rx = dirX * cA - dirZ * sA;
      const rz = dirX * sA + dirZ * cA;
      dirX = rx;
      dirZ = rz;
    }

    if (queryCollidersNear) {
      const nearby = queryCollidersNear(this.position.x, this.position.z);
      const doorwayMidX = this.homeEntryPos && this.homeThresholdPos
        ? (this.homeEntryPos.x + this.homeThresholdPos.x) * 0.5
        : undefined;
      const doorwayMidZ = this.homeEntryPos && this.homeThresholdPos
        ? (this.homeEntryPos.z + this.homeThresholdPos.z) * 0.5
        : undefined;
      for (let i = 0; i < nearby.length; i++) {
        const c = nearby[i];
        if (c.kind !== 'box' || c.walkableTop || c.tag === 'roof' || c.tag === 'floor') continue;
        // Skip the active house's doorway collider ONLY when that door is actually OPEN
        if (
          homeDoorOpen &&
          c.tag === 'door' &&
          doorwayMidX !== undefined &&
          doorwayMidZ !== undefined
        ) {
          if (Math.hypot(c.x - doorwayMidX, c.z - doorwayMidZ) < 1.35) continue;
        }
        const ox = this.position.x - c.x;
        const oz = this.position.z - c.z;
        const cos = Math.cos(c.yaw);
        const sin = Math.sin(c.yaw);
        const lx = ox * cos - oz * sin;
        const lz = ox * sin + oz * cos;
        const pad = this.radius + 0.35;
        if (Math.abs(lx) < c.halfW + pad && Math.abs(lz) < c.halfD + pad) {
          const penX = c.halfW + pad - Math.abs(lx);
          const penZ = c.halfD + pad - Math.abs(lz);
          let pushLX = 0;
          let pushLZ = 0;
          if (penX < penZ) {
            pushLX = (lx >= 0 ? 1 : -1) * (penX / pad);
          } else {
            pushLZ = (lz >= 0 ? 1 : -1) * (penZ / pad);
          }
          dirX += (pushLX * cos + pushLZ * sin) * 1.1;
          dirZ += (-pushLX * sin + pushLZ * cos) * 1.1;
        }
      }
      const nLen = Math.hypot(dirX, dirZ) || 1;
      dirX /= nLen;
      dirZ /= nLen;
    }

    const step = Math.min(dist, this.walkSpeed * dt);
    const nx = this.position.x + dirX * step;
    const nz = this.position.z + dirZ * step;
    const ny = THREE.MathUtils.damp(this.position.y, targetY, 8, dt);
    this.velocity.set(dirX * this.walkSpeed, 0, dirZ * this.walkSpeed);
    this.position.set(nx, ny, nz);
    if (queryCollidersNear) {
      const cols = queryCollidersNear(this.position.x, this.position.z);
      const midX = this.homeEntryPos && this.homeThresholdPos
        ? (this.homeEntryPos.x + this.homeThresholdPos.x) * 0.5
        : undefined;
      const midZ = this.homeEntryPos && this.homeThresholdPos
        ? (this.homeEntryPos.z + this.homeThresholdPos.z) * 0.5
        : undefined;
      this.resolveHardColliders(
        cols,
        homeDoorOpen && midX !== undefined && midZ !== undefined
          ? { x: midX, z: midZ, radius: 1.35 }
          : undefined,
      );
    }
    this.rotateTowardYaw(Math.atan2(dirX, dirZ), dt);
    return false;
  }

  public setAIModule(module: NpcAIModule): void {
    this.aiModule = module;
    this.aiModule.onAttach?.(this);
  }

  public nextRandom(): number {
    return this.rand();
  }

  public getBehaviorState(): NpcBehaviorState {
    return this.behaviorState;
  }

  public setBehaviorState(state: NpcBehaviorState): void {
    this.behaviorState = state;
  }

  public isTalking(): boolean {
    return this.talking;
  }

  public getRoutineForPeriod(period: NpcRoutinePeriod): NpcRoutineSlot {
    return (
      this.config.schedule.find((s) => s.period === period) ??
      this.config.schedule[0]
    );
  }

  public beginDialogue(playerPos: THREE.Vector3): NpcDialogueSession {
    this.talking = true;
    this.stopMoving();
    this.behaviorState = 'talking';
    this.faceToward(playerPos.x, playerPos.z, 1);
    return this.buildDialogueSession(this.blackboard.currentPeriod);
  }

  public endDialogue(): void {
    this.talking = false;
    this.behaviorState = 'idle';
    this.blackboard.waitTimer = 1.0;
  }

  public getHitRadius(): number {
    return this.radius;
  }

  public getHitHeight(): number {
    return 1.78;
  }

  public getYaw(): number {
    return this.yaw;
  }

  public getWalkSpeed(): number {
    return this.walkSpeed;
  }

  public setEscortTarget(target: { x: number; z: number } | null): void {
    this.escortTargetPos = target ? { x: target.x, z: target.z } : null;
  }

  public getEscortTarget(): { x: number; z: number } | null {
    return this.escortTargetPos;
  }

  public isEscorting(): boolean {
    return this.escortTargetPos !== null;
  }

  public setNetworkRemoteControlled(remote: boolean): void {
    this.networkRemoteControlled = remote;
    if (!remote) {
      this.remoteTargetPos = null;
    }
  }

  public getSyncDialogueState(): 'idle' | 'talking' {
    return this.talking ? 'talking' : 'idle';
  }

  public getSyncQuestState(): string {
    return this.behaviorState;
  }

  public takeDamage(
    amount: number,
    attackerX?: number,
    attackerZ?: number,
  ): { killed: boolean; hp: number; maxHp: number } {
    if (this.isDead) {
      return { killed: false, hp: 0, maxHp: this.maxHealth };
    }
    this.hp = Math.max(0, this.hp - Math.max(0, amount));
    const killed = this.hp <= 0;
    if (killed) {
      this.applyDeathState();
    } else if (attackerX !== undefined && attackerZ !== undefined) {
      this.reactToArrowHit(attackerX, attackerZ);
    }
    return { killed, hp: this.hp, maxHp: this.maxHealth };
  }

  public applyAuthoritativeHealth(
    hp: number,
    maxHp: number,
    dead: boolean,
    attackerX?: number,
    attackerZ?: number,
  ): boolean {
    const clampedMax = Math.max(1, maxHp || this.maxHealth);
    this.hp = Math.max(0, Math.min(clampedMax, hp));
    const wasDead = this.isDead;
    if (dead || this.hp <= 0) {
      this.hp = 0;
      this.applyDeathState();
      return !wasDead;
    }
    if (wasDead) {
      this.isDead = false;
      this.rig.setDead(false);
    }
    if (attackerX !== undefined && attackerZ !== undefined) {
      this.reactToArrowHit(attackerX, attackerZ);
    }
    return false;
  }

  private applyDeathState(): void {
    this.isDead = true;
    this.talking = false;
    this.alertTimer = 0;
    this.stopMoving();
    this.behaviorState = 'idle';
    this.rig.setDead(true);
  }

  public applyRemoteSync(delta: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    state: string;
    hp?: number;
    maxHp?: number;
    isDead?: boolean;
    dialogueState?: 'idle' | 'talking';
    dialoguePlayerId?: string;
    questState?: string;
    schedulePeriod?: string;
  }): void {
    if (!this.remoteTargetPos) {
      this.remoteTargetPos = new THREE.Vector3(delta.x, delta.y, delta.z);
    } else {
      this.remoteTargetPos.set(delta.x, delta.y, delta.z);
    }
    if (this.position.distanceToSquared(this.remoteTargetPos) > 100) {
      this.position.copy(this.remoteTargetPos);
      this.yaw = delta.yaw;
    }
    this.remoteTargetYaw = delta.yaw;
    if (delta.dialogueState === 'talking') {
      this.talking = true;
    } else if (delta.dialogueState === 'idle') {
      this.talking = false;
    }
    if (
      delta.schedulePeriod === 'morning' ||
      delta.schedulePeriod === 'midday' ||
      delta.schedulePeriod === 'noon' ||
      delta.schedulePeriod === 'evening' ||
      delta.schedulePeriod === 'night'
    ) {
      const normalizedPeriod =
        delta.schedulePeriod === 'noon' ? 'midday' : delta.schedulePeriod;
      this.blackboard.currentPeriod = normalizedPeriod;
      this.blackboard.activeSlot = this.getRoutineForPeriod(normalizedPeriod);
    }
    const st = delta.state;
    if (
      st === 'idle' ||
      st === 'walking' ||
      st === 'wandering' ||
      st === 'working' ||
      st === 'talking' ||
      st === 'sleeping'
    ) {
      this.remoteTargetState = st;
    } else {
      this.remoteTargetState = delta.dialogueState === 'talking' ? 'talking' : 'idle';
    }
    if (typeof delta.hp === 'number' || typeof delta.isDead === 'boolean') {
      this.applyAuthoritativeHealth(
        delta.hp ?? this.hp,
        delta.maxHp ?? this.maxHealth,
        Boolean(delta.isDead),
      );
    }
  }

  public applyPersistedSnapshot(snap: WorldEntitySnapshot): void {
    const y = Number.isFinite(snap.y) ? snap.y : groundHeightAt(snap.x, snap.z);
    this.position.set(snap.x, y, snap.z);
    this.yaw = Number.isFinite(snap.yaw) ? snap.yaw : this.yaw;
    this.stopMoving();
    this.remoteTargetPos = this.position.clone();
    this.remoteTargetYaw = this.yaw;
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.yaw;

    if (snap.dialogueState === 'talking') {
      this.talking = true;
    } else if (snap.dialogueState === 'idle') {
      this.talking = false;
    }
    if (
      snap.schedulePeriod === 'morning' ||
      snap.schedulePeriod === 'midday' ||
      snap.schedulePeriod === 'noon' ||
      snap.schedulePeriod === 'evening' ||
      snap.schedulePeriod === 'night'
    ) {
      const normalizedPeriod =
        snap.schedulePeriod === 'noon' ? 'midday' : snap.schedulePeriod;
      this.blackboard.currentPeriod = normalizedPeriod;
      this.blackboard.activeSlot = this.getRoutineForPeriod(normalizedPeriod);
    }

    const st = snap.state;
    if (
      st === 'idle' ||
      st === 'walking' ||
      st === 'wandering' ||
      st === 'working' ||
      st === 'talking' ||
      st === 'sleeping'
    ) {
      this.behaviorState = st;
      this.remoteTargetState = st;
    }

    this.applyAuthoritativeHealth(
      snap.hp,
      snap.maxHp || this.maxHealth,
      snap.isDead,
    );
  }

  public isSleeping(): boolean {
    return this.blackboard.sleepStage === 'sleeping';
  }

  public reactToArrowHit(sourceX: number, sourceZ: number): void {
    if (this.isDead || this.isSleeping()) return;
    this.alertTimer = 2.6;
    this.alertSourceX = sourceX;
    this.alertSourceZ = sourceZ;
    this.stopMoving();
    if (!this.talking) {
      this.behaviorState = 'idle';
    }
  }

  public updateAlertReaction(dt: number): boolean {
    if (this.alertTimer <= 0) return false;
    this.alertTimer = Math.max(0, this.alertTimer - dt);
    this.stopMoving();
    this.behaviorState = 'idle';
    this.faceToward(this.alertSourceX, this.alertSourceZ, dt);
    return true;
  }

  public getLocalizedName(lang: Language = 'en'): string {
    if (lang === 'ar') {
      return AR_NPC_META[this.id]?.name ?? this.config.nameAr ?? this.name;
    }
    return this.name;
  }

  public setLanguage(lang: Language): void {
    const localizedName = this.getLocalizedName(lang);
    const roleLabel =
      lang === 'ar' ? ROLE_LABELS.ar[this.role] : ROLE_LABELS.en[this.role] ?? this.role.toUpperCase();
    this.rig.updateNameplate(localizedName, roleLabel);
  }

  public getDialogueProfile(lang: Language = 'en'): DialogueNpcProfile {
    const period = this.blackboard.currentPeriod;
    const slot = this.getRoutineForPeriod(period);
    const arMeta = lang === 'ar' ? AR_NPC_META[this.id] : undefined;
    const persona = getNpcPersona(this.id, this.role, lang);
    const isAr = lang === 'ar';

    const resolvedName = arMeta?.name ?? (isAr ? (this.config.nameAr ?? this.name) : this.name);
    const resolvedTitle =
      arMeta?.title ?? (isAr ? (this.config.titleAr ?? ROLE_LABELS.ar[this.role]) : this.title);
    const resolvedLocation = isAr
      ? (this.config.locationAr ?? persona.location)
      : (this.config.location ?? persona.location);
    const resolvedPersonality = isAr
      ? (this.config.personalityAr ?? persona.personality)
      : (this.config.personality ?? persona.personality);
    const resolvedPrompts = isAr
      ? (this.config.suggestedPromptsAr ?? persona.suggestedPrompts)
      : (this.config.suggestedPrompts ?? persona.suggestedPrompts);

    const defaultArRoutineByPeriod: Record<NpcRoutinePeriod, string> = {
      morning: `يعمل في ${resolvedLocation}`,
      midday: `ينشط في ${resolvedLocation}`,
      evening: `يستريح قرب ${resolvedLocation}`,
      night: 'يستريح في منزله',
    };
    const resolvedRoutineLabel = isAr
      ? (arMeta?.routineLabels[period] ??
          this.config.routineLabelsAr?.[period] ??
          defaultArRoutineByPeriod[period])
      : slot.activityLabel;

    const resolvedGreeting = isAr
      ? (this.config.greetingsAr?.[period] ??
          this.config.greetingsAr?.morning ??
          `مرحبًا أيها المسافر! أنا ${resolvedName}، ${resolvedTitle} في ${resolvedLocation}.`)
      : (this.config.greetings[period] ?? this.config.greetings.morning);

    const resolvedChoices = isAr
      ? (this.config.choicesAr && this.config.choicesAr.length > 0
          ? this.config.choicesAr
          : [
              {
                id: 'about',
                label: 'أخبرني عن عملك هنا.',
                reply: `بصفتي ${resolvedTitle}، أعتني بعملي يوميًا في ${resolvedLocation}.`,
                nextState: 'continue' as const,
              },
              {
                id: 'bye',
                label: 'شكرًا لك، وداعًا.',
                reply: 'رافقتك السلامة في رحلتك أيها المغامر.',
                nextState: 'close' as const,
              },
            ])
      : this.config.choices;

    return {
      npcId: this.id,
      name: resolvedName,
      role: this.role,
      title: resolvedTitle,
      location: resolvedLocation,
      personality: resolvedPersonality,
      suggestedPrompts: resolvedPrompts,
      routineLabel: resolvedRoutineLabel,
      routinePeriod: period,
      fallbackGreeting: resolvedGreeting,
      fallbackChoices: resolvedChoices,
    };
  }

  public buildDialogueSession(period: NpcRoutinePeriod): NpcDialogueSession {
    const slot = this.getRoutineForPeriod(period);
    return {
      npcId: this.id,
      name: this.name,
      role: this.role,
      title: this.title,
      routineLabel: slot.activityLabel,
      routinePeriod: period,
      currentLine: this.config.greetings[period] ?? this.config.greetings.morning,
      choices: this.config.choices,
    };
  }

  public update(ctx: NpcTickContext): void {
    if (this.isDead) {
      this.stopMoving();
      this.rig.root.position.copy(this.position);
      this.rig.root.rotation.y = this.yaw;
      this.rig.updateAnimation(ctx.dt, 'idle', 0);
      return;
    }

    if (this.networkRemoteControlled) {
      if (this.remoteTargetPos) {
        const prevX = this.position.x;
        const prevZ = this.position.z;
        const lambda = 12;
        this.position.x = THREE.MathUtils.damp(this.position.x, this.remoteTargetPos.x, lambda, ctx.dt);
        this.position.y = THREE.MathUtils.damp(this.position.y, this.remoteTargetPos.y, lambda, ctx.dt);
        this.position.z = THREE.MathUtils.damp(this.position.z, this.remoteTargetPos.z, lambda, ctx.dt);
        const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
        const speed = ctx.dt > 0.0001 ? moved / ctx.dt : 0;
        this.velocity.set((this.position.x - prevX) / Math.max(ctx.dt, 0.001), 0, (this.position.z - prevZ) / Math.max(ctx.dt, 0.001));
        this.rotateTowardYaw(this.remoteTargetYaw, ctx.dt);
        this.behaviorState = this.remoteTargetState;
        this.rig.root.position.copy(this.position);
        this.rig.root.rotation.y = this.yaw;
        this.rig.updateAnimation(ctx.dt, this.behaviorState, speed);
      } else {
        this.rig.root.position.copy(this.position);
        this.rig.root.rotation.y = this.yaw;
        this.rig.updateAnimation(ctx.dt, this.behaviorState, 0);
      }
      return;
    }

    this.aiModule.decide(this, ctx);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.yaw;
    this.rig.updateAnimation(ctx.dt, this.behaviorState, speed);
  }

  public setVisibility(visible: boolean, showNameplate: boolean): void {
    if (this.rig.root.visible !== visible) {
      this.rig.root.visible = visible;
    }
    const wantNameplate = visible && showNameplate && !this.isDead;
    if (this.rig.nameplateSprite && this.rig.nameplateSprite.visible !== wantNameplate) {
      this.rig.nameplateSprite.visible = wantNameplate;
    }
  }

  public distanceTo2D(x: number, z: number): number {
    return Math.hypot(x - this.position.x, z - this.position.z);
  }

  public stopMoving(): void {
    this.velocity.x = 0;
    this.velocity.z = 0;
  }

  public faceToward(targetX: number, targetZ: number, dt: number): void {
    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    if (dx * dx + dz * dz < 0.0004) return;
    const targetYaw = Math.atan2(dx, dz);
    this.rotateTowardYaw(targetYaw, dt);
  }

  public rotateTowardYaw(targetYaw: number, dt: number): void {
    const diff = Math.atan2(
      Math.sin(targetYaw - this.yaw),
      Math.cos(targetYaw - this.yaw),
    );
    this.yaw += diff * (1 - Math.exp(-9.5 * Math.min(dt, 0.25)));
  }

  public navigateToward(
    targetX: number,
    targetZ: number,
    ctx: NpcTickContext,
    arrivalThreshold = 0.85,
    speedOverride?: number,
  ): boolean {
    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= arrivalThreshold) {
      this.stopMoving();
      this.blackboard.stuckTimer = 0;
      this.resetStuckMonitor();
      return true;
    }

    // Displacement-window stuck monitor
    this.stuckWindowTimer += ctx.dt;
    if (this.stuckWindowTimer >= 1.35) {
      const netMoved = Math.hypot(
        this.position.x - this.stuckOriginX,
        this.position.z - this.stuckOriginZ,
      );
      if (netMoved < 0.28) {
        this.stuckRecoveryStage += 1;
        this.blackboard.stuckTimer += this.stuckWindowTimer;
        this.handleStuckRecovery(ctx);
      } else {
        this.stuckRecoveryStage = 0;
        this.blackboard.stuckTimer = 0;
      }
      this.stuckOriginX = this.position.x;
      this.stuckOriginZ = this.position.z;
      this.stuckWindowTimer = 0;
    }

    if (dist >= this.blackboard.lastDistToTarget - 0.015) {
      this.blackboard.stuckTimer += ctx.dt * 0.5;
    } else {
      this.blackboard.stuckTimer = Math.max(0, this.blackboard.stuckTimer - ctx.dt * 2);
    }
    this.blackboard.lastDistToTarget = dist;

    let dirX = dx / dist;
    let dirZ = dz / dist;

    // Apply lateral detour steering during stuck stages 1-3 so NPC routes around house corners/trees
    if (this.stuckRecoveryStage >= 1 && this.stuckRecoveryStage <= 3) {
      const detourAngle =
        this.detourSign *
        (this.stuckRecoveryStage === 1 ? Math.PI * 0.44 : Math.PI * 0.68);
      const cA = Math.cos(detourAngle);
      const sA = Math.sin(detourAngle);
      const rx = dirX * cA - dirZ * sA;
      const rz = dirX * sA + dirZ * cA;
      dirX = rx;
      dirZ = rz;
    }

    const nearby = ctx.queryCollidersNear(this.position.x, this.position.z);
    const homeDoorId = this.getHomeDoorId();
    const homeDoorOpen =
      homeDoorId && ctx.getDoorState
        ? ctx.getDoorState(homeDoorId) === 'OPEN' || ctx.getDoorState(homeDoorId) === 'OPENING'
        : false;
    const doorMid =
      this.homeEntryPos && this.homeThresholdPos
        ? {
            x: (this.homeEntryPos.x + this.homeThresholdPos.x) * 0.5,
            z: (this.homeEntryPos.z + this.homeThresholdPos.z) * 0.5,
            radius: 1.4,
          }
        : undefined;
    const doorMidRef =
      this.blackboard.sleepStage === 'going_to_door' && homeDoorOpen && doorMid
        ? doorMid
        : undefined;

    for (let i = 0; i < nearby.length; i++) {
      const c = nearby[i];
      if (c.kind === 'cylinder') {
        const ox = this.position.x - c.x;
        const oz = this.position.z - c.z;
        const od = Math.hypot(ox, oz);
        const avoidR = c.radius + this.radius + 0.75;
        if (od < avoidR && od > 0.001) {
          const push = (avoidR - od) / avoidR;
          const nx = ox / od;
          const nz = oz / od;
          dirX += (nx - nz * 0.6) * push * 2.1;
          dirZ += (nz + nx * 0.6) * push * 2.1;
        }
      } else if (c.kind === 'box') {
        if (c.walkableTop || c.tag === 'roof' || c.tag === 'floor') continue;
        // Skip ONLY the target open door collider itself, never skip house wall colliders!
        if (
          c.tag === 'door' &&
          doorMidRef &&
          Math.hypot(c.x - doorMidRef.x, c.z - doorMidRef.z) <= doorMidRef.radius
        ) {
          continue;
        }
        const ox = this.position.x - c.x;
        const oz = this.position.z - c.z;
        const cos = Math.cos(c.yaw);
        const sin = Math.sin(c.yaw);
        const lx = ox * cos - oz * sin;
        const lz = ox * sin + oz * cos;
        const pad = this.radius + 0.55;
        if (Math.abs(lx) < c.halfW + pad && Math.abs(lz) < c.halfD + pad) {
          const penX = c.halfW + pad - Math.abs(lx);
          const penZ = c.halfD + pad - Math.abs(lz);
          let pushLX = 0;
          let pushLZ = 0;
          if (penX < penZ) {
            pushLX = (lx >= 0 ? 1 : -1) * (penX / pad);
          } else {
            pushLZ = (lz >= 0 ? 1 : -1) * (penZ / pad);
          }
          dirX += (pushLX * cos + pushLZ * sin) * 1.4;
          dirZ += (-pushLX * sin + pushLZ * cos) * 1.4;
        }
      }
    }

    for (let i = 0; i < ctx.otherNpcPositions.length; i++) {
      const other = ctx.otherNpcPositions[i];
      if (other.id === this.id) continue;
      const ox = this.position.x - other.x;
      const oz = this.position.z - other.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.35 && od > 0.001) {
        const push = (1.35 - od) / 1.35;
        dirX += (ox / od) * push * 1.4;
        dirZ += (oz / od) * push * 1.4;
      }
    }

    const px = this.position.x - ctx.playerPos.x;
    const pz = this.position.z - ctx.playerPos.z;
    const pDist = Math.hypot(px, pz);
    if (pDist < 1.3 && pDist > 0.001) {
      const push = (1.3 - pDist) / 1.3;
      dirX += (px / pDist) * push * 1.6;
      dirZ += (pz / pDist) * push * 1.6;
    }

    const dLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dLen;
    dirZ /= dLen;

    const moveSpeed = speedOverride ?? this.walkSpeed;
    const nextX = this.position.x + dirX * moveSpeed * ctx.dt;
    const nextZ = this.position.z + dirZ * moveSpeed * ctx.dt;
    const nextY = groundHeightAt(nextX, nextZ);
    const nextSlope = groundSlopeAt(nextX, nextZ, nextY);
    const bridgeY = sampleWalkableBridgeHeight(nextX, nextZ, this.position.y, nearby);
    const onBridge = bridgeY !== null;

    if (
      onBridge ||
      (!isWater(nextX, nextZ, nextY) &&
        isLand(nextX, nextZ, 0.45, nextY) &&
        nextSlope <= 0.4)
    ) {
      this.velocity.x = dirX * moveSpeed;
      this.velocity.z = dirZ * moveSpeed;
      this.position.set(nextX, onBridge ? bridgeY : nextY, nextZ);
      if (this.resolveHardColliders(nearby, doorMidRef)) {
        const postBridgeY = sampleWalkableBridgeHeight(
          this.position.x,
          this.position.z,
          this.position.y,
          nearby,
        );
        this.position.y =
          postBridgeY !== null
            ? postBridgeY
            : groundHeightAt(this.position.x, this.position.z);
      }
      this.rotateTowardYaw(Math.atan2(dirX, dirZ), ctx.dt);
    } else {
      this.blackboard.stuckTimer += ctx.dt * 2;
      this.stopMoving();
    }

    return false;
  }

  private handleStuckRecovery(ctx: NpcTickContext): void {
    const bb = this.blackboard;
    if (this.stuckRecoveryStage === 1) {
      // Stage 1: Recalculate detour direction & alternate lateral turn
      this.detourSign = this.detourSign >= 0 ? -1 : 1;
      return;
    }

    if (this.stuckRecoveryStage === 2) {
      // Stage 2: Flip alternate route & invalidate stale wander waypoint
      this.detourSign = -this.detourSign;
      if (bb.sleepStage === 'outdoor') {
        bb.targetPoint = null;
      }
      return;
    }

    if (this.stuckRecoveryStage === 3) {
      // Stage 3: Ensure any assigned home door nearby is opened so doorways never block passage
      const doorId = this.getHomeDoorId();
      if (doorId && this.homeEntryPos && this.distanceTo2D(this.homeEntryPos.x, this.homeEntryPos.z) < 4.5) {
        ctx.requestDoorOpen?.(doorId, this.id);
      }
      return;
    }

    if (this.stuckRecoveryStage >= 4) {
      // Stage 4: Safe exterior fallback relocation (never delete the NPC!)
      const doorId = this.getHomeDoorId();
      if (bb.sleepStage === 'exiting_door' && this.homeEntryPos) {
        if (doorId) {
          ctx.requestDoorOpen?.(doorId, this.id);
        }
        this.placeAt(this.homeEntryPos.x, this.homeEntryPos.z);
        if (doorId) {
          ctx.requestDoorClose?.(doorId, this.id);
        }
        delete bb.memory.exitSubStage;
        bb.sleepStage = 'outdoor';
      } else if (bb.sleepStage === 'going_to_door' && this.homeEntryPos) {
        this.placeAt(this.homeEntryPos.x, this.homeEntryPos.z);
        if (doorId) {
          ctx.requestDoorOpen?.(doorId, this.id);
        }
      } else {
        const anchor = bb.activeSlot?.anchor ?? this.config.spawn;
        const safe = findSafeClearColliderPoint(
          anchor.x,
          anchor.z,
          this.radius + 0.15,
          ctx.queryCollidersNear,
          0.55,
          0.36,
          18,
        );
        this.placeAt(safe.x, safe.z);
      }
      bb.targetPoint = null;
      bb.stuckTimer = 0;
      bb.sleepStageStuckTimer = 0;
      this.resetStuckMonitor();
    }
  }

  public pickSafePointNear(
    anchorX: number,
    anchorZ: number,
    radius: number,
    queryCollidersNear?: (x: number, z: number) => WorldCollider[],
  ): NpcPoint2D {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = this.rand() * Math.PI * 2;
      const dist = (0.25 + this.rand() * 0.75) * radius;
      const wx = anchorX + Math.cos(ang) * dist;
      const wz = anchorZ + Math.sin(ang) * dist;
      if (!isValidNPCSpawnLocation(wx, wz, 0.55)) continue;
      if (queryCollidersNear) {
        const cols = queryCollidersNear(wx, wz);
        if (isPointBlockedByColliders(wx, wz, this.radius + 0.1, cols)) continue;
      }
      return { x: wx, z: wz };
    }
    if (queryCollidersNear) {
      const safe = findSafeClearColliderPoint(
        anchorX,
        anchorZ,
        this.radius + 0.1,
        queryCollidersNear,
        0.55,
        0.34,
        24,
      );
      return { x: safe.x, z: safe.z };
    }
    if (isValidNPCSpawnLocation(anchorX, anchorZ, 0.45)) {
      return { x: anchorX, z: anchorZ };
    }
    const safe = findNearestValidLand(anchorX, anchorZ, 3.0, 0.34, 60);
    return { x: safe.x, z: safe.z };
  }

  private resolveHardColliders(
    colliders: WorldCollider[],
    ignoreDoorNear?: { x: number; z: number; radius: number },
  ): boolean {
    let pushed = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.kind === 'cylinder') {
        if (this.position.y >= c.maxY - 0.08 || this.position.y + 1.8 <= c.minY + 0.05) continue;
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const minSep = c.radius + this.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq < minSep * minSep && distSq > 0.00001) {
          const d = Math.sqrt(distSq);
          const push = minSep - d;
          this.position.x += (dx / d) * push;
          this.position.z += (dz / d) * push;
          pushed = true;
        }
      } else if (c.kind === 'box') {
        if (c.walkableTop || c.tag === 'roof' || c.tag === 'floor') continue;
        if (
          c.tag === 'door' &&
          ignoreDoorNear &&
          Math.hypot(c.x - ignoreDoorNear.x, c.z - ignoreDoorNear.z) <= ignoreDoorNear.radius
        ) {
          continue;
        }
        if (this.position.y >= c.maxY - 0.08 || this.position.y + 1.8 <= c.minY + 0.05) continue;
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const cos = Math.cos(c.yaw);
        const sin = Math.sin(c.yaw);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const extX = c.halfW + this.radius;
        const extZ = c.halfD + this.radius;
        if (Math.abs(lx) < extX && Math.abs(lz) < extZ) {
          const penX = extX - Math.abs(lx);
          const penZ = extZ - Math.abs(lz);
          let pushLX = 0;
          let pushLZ = 0;
          if (penX < penZ) {
            pushLX = (lx >= 0 ? 1 : -1) * penX;
          } else {
            pushLZ = (lz >= 0 ? 1 : -1) * penZ;
          }
          this.position.x += pushLX * cos + pushLZ * sin;
          this.position.z += -pushLX * sin + pushLZ * cos;
          pushed = true;
        }
      }
    }
    return pushed;
  }

  private hashString(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  public dispose(): void {
    this.rig.dispose();
  }
}
