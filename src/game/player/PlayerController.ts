import * as THREE from 'three';
import type {
  PlayerMovementState,
  UnifiedPlayerInput,
  WorldCollider,
} from '../types';
import {
  PLAYABLE_RADIUS,
  WATER_LEVEL,
  groundHeightAt,
} from '../math/noise';
import type { PlayerCharacter } from '../entities/PlayerCharacter';
import type { ThirdPersonCamera } from './ThirdPersonCamera';
import type { WeaponAttackAnimType } from '../combat/weapons/Weapon';
import type { DifficultyLevel, WorldType } from '../save/saveTypes';
import {
  getBaseMaxStaminaForMode,
  isInfiniteStaminaMode,
} from './staminaConfig';

export type SwimmingState =
  | 'normal'
  | 'shallow_water'
  | 'swimming'
  | 'leaving_water';

export interface PlayerControllerConfig {
  radius: number;
  height: number;
  walkSpeed: number;
  runSpeed: number;
  waterWalkSpeed: number;
  waterRunSpeed: number;
  groundAcceleration: number;
  /** Lower values increase coasting/drag duration when releasing movement keys */
  groundDeceleration: number;
  airAcceleration: number;
  airDrag: number;
  waterDrag: number;
  rotationSpeed: number;
  jumpImpulse: number;
  gravity: number;
  coyoteTime: number;
  jumpBufferTime: number;
  maxHealth: number;
  maxStamina: number;
  sprintDrainPerSec: number;
  staminaRegenPerSec: number;
  staminaRegenDelay: number;
  sprintResumeThreshold: number;
  jumpStaminaCost: number;
}

export const DEFAULT_PLAYER_CONFIG: PlayerControllerConfig = {
  radius: 0.45,
  height: 1.85,
  walkSpeed: 6.2,
  runSpeed: 10.8,
  waterWalkSpeed: 4.8,
  waterRunSpeed: 7.4,
  groundAcceleration: 11.5,
  // Increased drag duration (lower damping rate = longer smooth deceleration glide)
  groundDeceleration: 4.2,
  airAcceleration: 5.5,
  airDrag: 1.35,
  waterDrag: 2.6,
  rotationSpeed: 12.5,
  jumpImpulse: 9.9,
  gravity: 24.5,
  coyoteTime: 0.13,
  jumpBufferTime: 0.13,
  maxHealth: 100,
  maxStamina: 100,
  sprintDrainPerSec: 21,
  staminaRegenPerSec: 18,
  staminaRegenDelay: 0.65,
  sprintResumeThreshold: 15,
  jumpStaminaCost: 6,
};

export interface PlayerControllerCallbacks {
  queryCollidersNear: (x: number, z: number) => WorldCollider[];
  canAttack?: () => boolean;
  isRangedWeaponEquipped?: () => boolean;
  isBowAiming?: () => boolean;
  getAttackAnimation?: () => { type: WeaponAttackAnimType; duration: number };
  onJump?: (pos: THREE.Vector3) => void;
  onLand?: (pos: THREE.Vector3, strength: number, inWater: boolean) => void;
  onFootstep?: (
    mode: 'walking' | 'running' | 'sprinting' | 'crouching',
    inWater?: boolean,
  ) => void;
  onAttack?: (pos: THREE.Vector3, yaw: number) => void;
  onInteractRequested?: () => void;
  onSprintCancelled?: () => void;
}

// Zero-GC pre-allocated math vectors & scratch structs
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _desiredVel = new THREE.Vector3();
const _gradScratch = { gx: 0, gz: 0, mag: 0 };

// Terrain & walkable structure collision constants
const MAX_WALKABLE_SLOPE_TAN = 1.12; // ~48.2 degrees (grassy hills & riverbanks pass; cliffs block)
const MAX_TERRAIN_STEP_UP = 0.52;
const MAX_WALKABLE_BOX_STEP_UP = 0.65;
const TERRAIN_SUBSTEP_DIST = 0.22;
const COLLIDER_SKIN_EPS = 0.004;
const OBJECT_COLLISION_ITERATIONS = 3;

// Swimming depth & buoyancy constants
const SHALLOW_WATER_DEPTH = 0.14;
const SWIM_ENTER_WATER_DEPTH = 1.16;
const SWIM_ENTER_SUBMERGED = 1.06;
const SWIM_EXIT_WATER_DEPTH = 0.96;
const SURFACE_SWIM_FEET_Y = WATER_LEVEL - 1.22;
const MAX_SWIM_FEET_Y = WATER_LEVEL - 1.1;
const SWIM_WALK_SPEED = 4.1;
const SWIM_FAST_SPEED = 5.4;

/**
 * Modular third-person character controller handling movement acceleration/deceleration,
 * smooth rotation, sprint & stamina, jumping, gravity, ground/falling detection,
 * object & terrain collisions, and locomotion state transitions.
 */
export class PlayerController {
  public readonly config: PlayerControllerConfig;
  private readonly baseConfig: PlayerControllerConfig;
  public readonly position = new THREE.Vector3(0, 0, 0);
  public readonly velocity = new THREE.Vector3(0, 0, 0);

  private readonly character: PlayerCharacter;
  private readonly cameraRig: ThirdPersonCamera;
  private readonly callbacks: PlayerControllerCallbacks;

  private yaw = Math.PI;
  private grounded = true;
  private inWater = false;
  private swimmingState: SwimmingState = 'normal';
  private leavingWaterTimer = 0;
  private swimUpBoostTimer = 0;
  private onSteepSlope = false;
  private sprinting = false;
  private sprintExhausted = false;
  private movementState: PlayerMovementState = 'idle';

  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private fallStartY = 0;
  private isFalling = false;
  private lastStepSign = 1;

  private health: number;
  private stamina: number;
  private staminaRegenDelayTimer = 0;
  private healthRegenDelayTimer = 0;
  private difficulty: DifficultyLevel = 'normal';
  private worldType: WorldType = 'normal';
  private lastEquipmentBonuses = {
    maxHealthBonus: 0,
    maxStaminaBonus: 0,
    speedBonus: 0,
  };

  constructor(
    character: PlayerCharacter,
    cameraRig: ThirdPersonCamera,
    callbacks: PlayerControllerCallbacks,
    config: Partial<PlayerControllerConfig> = {},
  ) {
    this.character = character;
    this.cameraRig = cameraRig;
    this.callbacks = callbacks;
    this.baseConfig = { ...DEFAULT_PLAYER_CONFIG, ...config };
    this.baseConfig.maxStamina = getBaseMaxStaminaForMode(this.worldType);
    this.config = { ...this.baseConfig };
    this.health = this.config.maxHealth;
    this.stamina = this.config.maxStamina;
  }

  public setGameplayModifiers(
    difficulty: DifficultyLevel,
    worldType: WorldType,
  ): void {
    this.difficulty = difficulty;
    this.worldType = worldType;
    const modeMaxStamina = getBaseMaxStaminaForMode(worldType);
    this.baseConfig.maxStamina = modeMaxStamina;

    if (isInfiniteStaminaMode(worldType)) {
      this.config.maxStamina = Infinity;
      this.health = this.config.maxHealth;
      this.stamina = Infinity;
      this.sprintExhausted = false;
      this.staminaRegenDelayTimer = 0;
    } else {
      this.config.maxStamina =
        modeMaxStamina + this.lastEquipmentBonuses.maxStaminaBonus;
      if (!Number.isFinite(this.stamina)) {
        this.stamina = this.config.maxStamina;
      } else {
        this.stamina = Math.max(0, Math.min(this.config.maxStamina, this.stamina));
      }
    }
  }

  public getIncomingDamageMultiplier(): number {
    if (this.worldType === 'creative') return 0;
    const diffMult =
      this.difficulty === 'easy'
        ? 0.65
        : this.difficulty === 'hard'
          ? 1.45
          : 1.0;
    const worldMult = this.worldType === 'survival' ? 1.2 : 1.0;
    return diffMult * worldMult;
  }

  public getStaminaDrainMultiplier(): number {
    if (this.worldType === 'creative') return 0;
    const diffMult =
      this.difficulty === 'easy'
        ? 0.75
        : this.difficulty === 'hard'
          ? 1.2
          : 1.0;
    const worldMult = this.worldType === 'survival' ? 1.2 : 1.0;
    return diffMult * worldMult;
  }

  public reset(x = 0, z = 4): void {
    const startY = groundHeightAt(x, z);
    const startWaterDepth = Math.max(0, WATER_LEVEL - startY);
    const startSwimming = startWaterDepth >= SWIM_ENTER_WATER_DEPTH;
    const spawnY = startSwimming ? SURFACE_SWIM_FEET_Y : startY;
    this.position.set(x, spawnY, z);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.PI;
    this.grounded = !startSwimming;
    this.inWater = startWaterDepth >= SHALLOW_WATER_DEPTH;
    this.swimmingState = startSwimming
      ? 'swimming'
      : startWaterDepth >= SHALLOW_WATER_DEPTH
        ? 'shallow_water'
        : 'normal';
    this.leavingWaterTimer = 0;
    this.swimUpBoostTimer = 0;
    this.onSteepSlope = false;
    this.sprinting = false;
    this.sprintExhausted = false;
    this.movementState = startSwimming ? 'swimming' : 'idle';
    this.coyoteTimer = this.grounded ? this.config.coyoteTime : 0;
    this.jumpBufferTimer = 0;
    this.fallStartY = spawnY;
    this.isFalling = false;

    this.health = this.config.maxHealth;
    this.stamina = isInfiniteStaminaMode(this.worldType)
      ? Infinity
      : this.config.maxStamina;
    this.staminaRegenDelayTimer = 0;
    this.healthRegenDelayTimer = 0;

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
    this.cameraRig.reset(this.position, 0, 0.26);
    this.callbacks.onSprintCancelled?.();
  }

  public getYaw(): number {
    return this.yaw;
  }

  public getCameraRotation(): { cameraYaw: number; cameraPitch: number } {
    return {
      cameraYaw: this.cameraRig.getYaw(),
      cameraPitch: this.cameraRig.getPitch(),
    };
  }

  public setPoseAndVitals(state: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    cameraYaw: number;
    cameraPitch: number;
    health: number;
    stamina: number;
  }): void {
    const safeTerrainY = groundHeightAt(state.x, state.z);
    const y = Number.isFinite(state.y)
      ? Math.max(safeTerrainY, state.y)
      : safeTerrainY;

    this.position.set(state.x, y, state.z);
    this.resolveWorldBounds();
    this.velocity.set(0, 0, 0);
    this.yaw = Number.isFinite(state.yaw) ? state.yaw : Math.PI;
    this.grounded = Math.abs(this.position.y - safeTerrainY) < 0.25;
    const loadedWaterDepth = Math.max(0, WATER_LEVEL - safeTerrainY);
    const loadedSubmerged = Math.max(0, WATER_LEVEL - this.position.y);
    const startSwimming =
      loadedWaterDepth >= SWIM_ENTER_WATER_DEPTH &&
      loadedSubmerged >= SWIM_ENTER_SUBMERGED;
    if (startSwimming) {
      this.grounded = false;
    }
    this.inWater =
      startSwimming || loadedSubmerged >= SHALLOW_WATER_DEPTH;
    this.swimmingState = startSwimming
      ? 'swimming'
      : this.inWater
        ? 'shallow_water'
        : 'normal';
    this.leavingWaterTimer = 0;
    this.swimUpBoostTimer = 0;
    this.onSteepSlope = false;
    this.sprinting = false;
    this.sprintExhausted = false;
    this.movementState = startSwimming ? 'swimming' : 'idle';
    this.coyoteTimer = this.grounded ? this.config.coyoteTime : 0;
    this.jumpBufferTimer = 0;
    this.fallStartY = this.position.y;
    this.isFalling = false;
    this.staminaRegenDelayTimer = 0;
    this.healthRegenDelayTimer = 0;

    this.health = Math.max(1, Math.min(this.config.maxHealth, state.health));
    if (isInfiniteStaminaMode(this.worldType)) {
      this.stamina = Infinity;
      this.sprintExhausted = false;
    } else {
      const targetStamina = Number.isFinite(state.stamina)
        ? state.stamina
        : this.config.maxStamina;
      this.stamina = Math.max(0, Math.min(this.config.maxStamina, targetStamina));
    }

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
    this.cameraRig.setYawPitch(
      this.position,
      state.cameraYaw,
      state.cameraPitch,
    );
  }

  public getHealth(): number {
    return Math.round(this.health);
  }

  public getMaxHealth(): number {
    return this.config.maxHealth;
  }

  public getStamina(): number {
    if (isInfiniteStaminaMode(this.worldType) || !Number.isFinite(this.stamina)) {
      return Infinity;
    }
    return Math.round(this.stamina);
  }

  public getMaxStamina(): number {
    return this.config.maxStamina;
  }

  public isGrounded(): boolean {
    return this.grounded;
  }

  public isInWater(): boolean {
    return this.inWater;
  }

  public getSwimmingState(): SwimmingState {
    return this.swimmingState;
  }

  public isSwimming(): boolean {
    return this.swimmingState === 'swimming';
  }

  public isSprinting(): boolean {
    return this.sprinting;
  }

  public getMovementState(): PlayerMovementState {
    return this.movementState;
  }

  public getHorizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  public heal(amount: number): void {
    this.health = Math.min(this.config.maxHealth, this.health + amount);
  }

  public syncAuthoritativeHealth(health: number): void {
    this.health = Math.max(0, Math.min(this.config.maxHealth, health));
  }

  public applyAuthoritativePositionCorrection(
    x: number,
    y: number,
    z: number,
    snapThreshold = 5,
  ): void {
    const safeTerrainY = groundHeightAt(x, z);
    const targetY = Number.isFinite(y) ? Math.max(safeTerrainY, y) : safeTerrainY;
    const dist = Math.hypot(x - this.position.x, z - this.position.z);
    if (dist > snapThreshold) {
      this.position.set(x, targetY, z);
      this.velocity.set(0, 0, 0);
    } else {
      this.position.x = THREE.MathUtils.lerp(this.position.x, x, 0.65);
      this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, 0.65);
      this.position.z = THREE.MathUtils.lerp(this.position.z, z, 0.65);
      this.velocity.multiplyScalar(0.35);
    }
    this.resolveWorldBounds();
    this.character.root.position.copy(this.position);
  }

  public applyCombatDamage(
    amount: number,
    knockbackX = 0,
    knockbackZ = 0,
    shakeStrength = 0.18,
  ): void {
    const scaledAmount = amount * this.getIncomingDamageMultiplier();
    if (scaledAmount <= 0) return;
    this.health = Math.max(0, this.health - scaledAmount);
    if (this.health <= 0) {
      this.sprinting = false;
      this.callbacks.onSprintCancelled?.();
    }
    this.healthRegenDelayTimer = 4.0;
    this.velocity.x += knockbackX;
    this.velocity.z += knockbackZ;
    if (shakeStrength > 0) {
      this.cameraRig.triggerShake(shakeStrength);
    }
  }

  public restoreStamina(amount: number): void {
    if (isInfiniteStaminaMode(this.worldType)) {
      this.stamina = Infinity;
      this.sprintExhausted = false;
      return;
    }
    this.stamina = Math.min(this.config.maxStamina, this.stamina + amount);
    this.sprintExhausted = false;
  }

  public hasStaminaFor(cost: number): boolean {
    if (
      isInfiniteStaminaMode(this.worldType) ||
      !Number.isFinite(this.stamina) ||
      cost <= 0
    ) {
      return true;
    }
    const scaled = cost * this.getStaminaDrainMultiplier();
    return this.stamina >= Math.min(scaled, this.config.maxStamina) && this.stamina >= 1;
  }

  public consumeStamina(cost: number, regenDelay = 0.5): boolean {
    if (isInfiniteStaminaMode(this.worldType)) {
      this.stamina = Infinity;
      this.sprintExhausted = false;
      this.staminaRegenDelayTimer = 0;
      return true;
    }
    if (cost <= 0) return true;
    const scaled = cost * this.getStaminaDrainMultiplier();
    if (scaled <= 0) return true;
    if (this.stamina < 1) return false;
    this.stamina = Math.max(0, this.stamina - scaled);
    this.staminaRegenDelayTimer = Math.max(this.staminaRegenDelayTimer, regenDelay);
    return true;
  }

  public applyEquipmentBonuses(bonuses: {
    maxHealthBonus: number;
    maxStaminaBonus: number;
    speedBonus: number;
  }): void {
    this.lastEquipmentBonuses = { ...bonuses };
    this.config.maxHealth = this.baseConfig.maxHealth + bonuses.maxHealthBonus;
    this.config.walkSpeed = this.baseConfig.walkSpeed + bonuses.speedBonus;
    this.config.runSpeed = this.baseConfig.runSpeed + bonuses.speedBonus;
    this.health = Math.min(this.config.maxHealth, this.health);

    if (isInfiniteStaminaMode(this.worldType)) {
      this.config.maxStamina = Infinity;
      this.stamina = Infinity;
      this.sprintExhausted = false;
    } else {
      this.config.maxStamina =
        this.baseConfig.maxStamina + bonuses.maxStaminaBonus;
      if (!Number.isFinite(this.stamina)) {
        this.stamina = this.config.maxStamina;
      } else {
        this.stamina = Math.min(this.config.maxStamina, this.stamina);
      }
    }
  }

  public updateIdleOnly(dt: number): void {
    const groundY = groundHeightAt(this.position.x, this.position.z);
    this.movementState =
      this.swimmingState === 'swimming'
        ? 'swimming'
        : this.grounded
          ? 'idle'
          : this.velocity.y < -1.2
            ? 'falling'
            : 'jumping';
    this.character.updateAnimation(
      dt,
      0,
      this.grounded,
      this.velocity.y,
      this.movementState,
      groundY,
      this.inWater,
      this.config.runSpeed,
    );
  }

  public update(dt: number, input: UnifiedPlayerInput): void {
    // 1. Apply look deltas to third-person camera
    this.cameraRig.addLookInput(input.lookX, input.lookY);

    // 2. Attack & Interaction triggers (ranged bow uses hold-to-charge in GameEngine)
    const isRanged = this.callbacks.isRangedWeaponEquipped?.() ?? false;
    const attackAllowed = this.callbacks.canAttack ? this.callbacks.canAttack() : true;
    const animSpec = this.callbacks.getAttackAnimation?.();
    if (
      !isRanged &&
      input.attack &&
      attackAllowed &&
      this.character.triggerAttack(animSpec?.duration ?? 0.28, animSpec?.type ?? 'melee_slash')
    ) {
      this.callbacks.onAttack?.(this.position, this.yaw);
    }

    // 3. Jump buffering & coyote window
    if (input.jump) {
      this.jumpBufferTimer = this.config.jumpBufferTime;
    } else if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    if (this.grounded) {
      this.coyoteTimer = this.config.coyoteTime;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // 4. Camera-relative desired movement vector (supports keyboard & analog stick)
    const camYaw = this.cameraRig.getYaw();
    _forward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    _right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));

    _moveDir
      .set(0, 0, 0)
      .addScaledVector(_forward, input.moveY)
      .addScaledVector(_right, input.moveX);

    const analogStrength = Math.min(1, _moveDir.length());
    const hasMoveInput = analogStrength > 0.01;
    if (hasMoveInput) {
      _moveDir.normalize();
    }

    // 5. Water depth detection & Swimming state transitions (evaluated before sprint so swimming cancels sprint)
    const isAimingBow = this.callbacks.isBowAiming?.() ?? false;
    const preTerrainY = groundHeightAt(this.position.x, this.position.z);
    const preSolidSupportY = Math.max(preTerrainY, this.getRockTopSupportY());
    const preWaterDepth = Math.max(0, WATER_LEVEL - preSolidSupportY);
    const preSubmerged = Math.max(0, WATER_LEVEL - this.position.y);

    if (this.leavingWaterTimer > 0) {
      this.leavingWaterTimer = Math.max(0, this.leavingWaterTimer - dt);
    }
    if (this.swimUpBoostTimer > 0) {
      this.swimUpBoostTimer = Math.max(0, this.swimUpBoostTimer - dt);
    }

    if (this.swimmingState === 'swimming') {
      // Leave swimming smoothly when reaching shallow water / shore
      if (
        preWaterDepth < SWIM_EXIT_WATER_DEPTH &&
        preSolidSupportY >= this.position.y - 0.55
      ) {
        this.swimmingState = 'leaving_water';
        this.leavingWaterTimer = 0.32;
        this.swimUpBoostTimer = 0;
      }
    } else if (
      preWaterDepth >= SWIM_ENTER_WATER_DEPTH &&
      preSubmerged >= SWIM_ENTER_SUBMERGED
    ) {
      // Enter swimming only when actually deep enough (waist/chest deep)
      const wasAirborne = !this.grounded;
      this.swimmingState = 'swimming';
      this.leavingWaterTimer = 0;
      this.grounded = false;
      this.isFalling = false;
      this.coyoteTimer = 0;
      // Sprint automatically turns OFF when entering swimming
      this.sprinting = false;
      this.callbacks.onSprintCancelled?.();
      if (wasAirborne && this.velocity.y < -4.5) {
        this.callbacks.onLand?.(this.position, 0.45, true);
      }
      // Dampen downward plunge smoothly so diving into water feels natural
      if (this.velocity.y < 0) {
        this.velocity.y *= 0.32;
      }
    } else if (this.swimmingState === 'leaving_water') {
      if (this.leavingWaterTimer <= 0 || this.grounded) {
        this.swimmingState =
          preWaterDepth >= SHALLOW_WATER_DEPTH && preSubmerged >= SHALLOW_WATER_DEPTH
            ? 'shallow_water'
            : 'normal';
      }
    } else if (
      preWaterDepth >= SHALLOW_WATER_DEPTH &&
      preSubmerged >= SHALLOW_WATER_DEPTH
    ) {
      this.swimmingState = 'shallow_water';
    } else {
      this.swimmingState = 'normal';
    }

    const isSwimmingNow = this.swimmingState === 'swimming';
    this.inWater =
      isSwimmingNow ||
      this.swimmingState === 'shallow_water' ||
      (this.swimmingState === 'leaving_water' && preSubmerged >= SHALLOW_WATER_DEPTH);

    // 6. Stamina & Sprint state management (infinite in creative mode, disabled while swimming)
    const isCreativeStamina = isInfiniteStaminaMode(this.worldType);
    let isSprinting = false;

    if (isSwimmingNow) {
      this.sprinting = false;
      if (input.sprint) {
        this.callbacks.onSprintCancelled?.();
      }
      if (!isCreativeStamina) {
        if (this.staminaRegenDelayTimer > 0) {
          this.staminaRegenDelayTimer = Math.max(
            0,
            this.staminaRegenDelayTimer - dt,
          );
        } else {
          this.stamina = Math.min(
            this.config.maxStamina,
            this.stamina + this.config.staminaRegenPerSec * dt,
          );
        }
      }
    } else if (isCreativeStamina) {
      this.stamina = Infinity;
      this.sprintExhausted = false;
      this.staminaRegenDelayTimer = 0;
      isSprinting = input.sprint && hasMoveInput;
      this.sprinting = isSprinting;
    } else {
      if (this.stamina <= 0.5) {
        if (!this.sprintExhausted) {
          this.sprintExhausted = true;
          this.callbacks.onSprintCancelled?.();
        }
      } else if (
        this.sprintExhausted &&
        this.stamina >= this.config.sprintResumeThreshold
      ) {
        this.sprintExhausted = false;
      }

      const canSprint = !this.sprintExhausted && this.stamina > 0.5;
      isSprinting = input.sprint && hasMoveInput && canSprint;
      this.sprinting = isSprinting;

      if (isSprinting) {
        const drainRate =
          this.config.sprintDrainPerSec * this.getStaminaDrainMultiplier();
        if (drainRate > 0) {
          this.stamina = Math.max(0, this.stamina - drainRate * dt);
          this.staminaRegenDelayTimer = this.config.staminaRegenDelay;
          if (this.stamina <= 0.5) {
            this.sprintExhausted = true;
            this.sprinting = false;
            isSprinting = false;
            this.callbacks.onSprintCancelled?.();
          }
        }
      } else {
        if (this.staminaRegenDelayTimer > 0) {
          this.staminaRegenDelayTimer = Math.max(
            0,
            this.staminaRegenDelayTimer - dt,
          );
        } else {
          this.stamina = Math.min(
            this.config.maxStamina,
            this.stamina + this.config.staminaRegenPerSec * dt,
          );
        }
      }
    }

    const walkSpd = isSwimmingNow
      ? SWIM_WALK_SPEED
      : this.inWater
        ? this.config.waterWalkSpeed
        : this.config.walkSpeed;
    const runSpd = isSwimmingNow
      ? SWIM_WALK_SPEED
      : this.inWater
        ? this.config.waterRunSpeed
        : this.config.runSpeed;
    const aimSpeedFactor = isAimingBow ? 0.68 : 1.0;
    const targetSpeed =
      (isSprinting && !isAimingBow ? runSpd : walkSpd * aimSpeedFactor) *
      analogStrength;

    const isFirstPerson = this.cameraRig.getPerspective() === 'first-person';

    if (hasMoveInput) {
      _desiredVel.copy(_moveDir).multiplyScalar(targetSpeed);
      const accel = isSwimmingNow
        ? 5.5
        : this.grounded
          ? this.config.groundAcceleration
          : this.config.airAcceleration;
      this.velocity.x = THREE.MathUtils.damp(
        this.velocity.x,
        _desiredVel.x,
        accel,
        dt,
      );
      this.velocity.z = THREE.MathUtils.damp(
        this.velocity.z,
        _desiredVel.z,
        accel,
        dt,
      );

      if (!isAimingBow && !isFirstPerson) {
        // Smoothly turn character model toward movement direction
        const targetYaw = Math.atan2(_moveDir.x, _moveDir.z);
        const angleDiff = Math.atan2(
          Math.sin(targetYaw - this.yaw),
          Math.cos(targetYaw - this.yaw),
        );
        const rotRate = isSwimmingNow
          ? this.config.rotationSpeed * 0.68
          : this.config.rotationSpeed;
        this.yaw += angleDiff * (1 - Math.exp(-rotRate * dt));
      }
    } else {
      const drag = isSwimmingNow
        ? 3.4
        : this.inWater
          ? this.config.waterDrag
          : this.grounded
            ? this.config.groundDeceleration
            : this.config.airDrag;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, drag, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, drag, dt);

      if (Math.hypot(this.velocity.x, this.velocity.z) < 0.04) {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    if (isAimingBow || isFirstPerson) {
      // Smoothly align character toward camera forward direction (-sin(camYaw), -cos(camYaw))
      const aimYaw = camYaw + Math.PI;
      const aimDiff = Math.atan2(
        Math.sin(aimYaw - this.yaw),
        Math.cos(aimYaw - this.yaw),
      );
      this.yaw += aimDiff * (1 - Math.exp(-(isFirstPerson ? 24 : 16) * dt));
    }

    // 7. Jump / Vertical Swimming Velocity
    if (isSwimmingNow) {
      if (input.jump) {
        this.swimUpBoostTimer = 0.34;
        this.jumpBufferTimer = 0;
      }

      const camPitch = this.cameraRig.getPitch();
      let desiredSwimVy = 0;
      if (this.swimUpBoostTimer > 0) {
        desiredSwimVy = 3.1;
      } else if (hasMoveInput && input.moveY > 0.15 && camPitch > 0.44) {
        // Looking downward while swimming forward dives smoothly underwater
        const diveFactor = THREE.MathUtils.clamp((camPitch - 0.44) / 0.56, 0, 1);
        desiredSwimVy = -2.9 * diveFactor * analogStrength;
      } else if (hasMoveInput && input.moveY > 0.15 && camPitch < 0.04) {
        // Looking upward while swimming forward ascends smoothly toward surface
        const riseFactor = THREE.MathUtils.clamp((0.04 - camPitch) / 0.28, 0, 1);
        desiredSwimVy = 2.6 * riseFactor * analogStrength;
      } else if (this.position.y > WATER_LEVEL - 1.6) {
        // Gentle surface alignment buoyancy near the water surface
        const surfaceError = SURFACE_SWIM_FEET_Y - this.position.y;
        desiredSwimVy = THREE.MathUtils.clamp(surfaceError * 3.8, -1.8, 1.8);
      } else {
        // Very gentle neutral-positive buoyancy while deep underwater
        desiredSwimVy = 0.18;
      }

      this.velocity.y = THREE.MathUtils.damp(this.velocity.y, desiredSwimVy, 6.5, dt);
      this.grounded = false;
      this.isFalling = false;
    } else {
      // Standard grounded jump (blocked on unwalkably steep slopes so player cannot climb cliffs)
      if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0 && !this.onSteepSlope) {
        this.velocity.y = this.config.jumpImpulse;
        this.grounded = false;
        this.isFalling = false;
        this.fallStartY = this.position.y;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        if (!isCreativeStamina) {
          this.stamina = Math.max(0, this.stamina - this.config.jumpStaminaCost);
          this.staminaRegenDelayTimer = Math.max(this.staminaRegenDelayTimer, 0.45);
        }
        this.callbacks.onJump?.(this.position);
      }

      // Gravity
      this.velocity.y -= this.config.gravity * dt;
    }

    // 8. Sub-stepped Horizontal Integration with Terrain Wall & Steep-Slope Collision
    const moveDx = this.velocity.x * dt;
    const moveDz = this.velocity.z * dt;
    this.moveHorizontalWithTerrainCollision(moveDx, moveDz, isSwimmingNow);
    this.resolveObjectCollisions();
    this.resolveWorldBounds();
    // Ensure object collision or knockback never pushes the player inside a cliff wall
    this.pushOutOfTerrainPenetration(isSwimmingNow);

    // Vertical integration
    this.position.y += this.velocity.y * dt;

    // 9. Ground detection, swimming bounds, steep-slope sliding & landing impact
    const terrainY = groundHeightAt(this.position.x, this.position.z);
    const solidSupportY = Math.max(terrainY, this.getRockTopSupportY());
    const postWaterDepth = Math.max(0, WATER_LEVEL - solidSupportY);
    this.sampleTerrainGradient(this.position.x, this.position.z, _gradScratch);
    const slopeTan = _gradScratch.mag;

    if (isSwimmingNow) {
      // Keep underwater character strictly above seabed & at or below water surface (no flight)
      const minSwimY = solidSupportY + 0.06;
      if (this.position.y < minSwimY) {
        this.position.y = minSwimY;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
      if (this.position.y > MAX_SWIM_FEET_Y) {
        this.position.y = MAX_SWIM_FEET_Y;
        if (this.velocity.y > 0) this.velocity.y = 0;
      }

      // Smoothly transition to leaving_water when swimming onto a walkable shore
      if (
        postWaterDepth < SWIM_EXIT_WATER_DEPTH &&
        solidSupportY >= this.position.y - 0.55 &&
        slopeTan <= MAX_WALKABLE_SLOPE_TAN
      ) {
        this.swimmingState = 'leaving_water';
        this.leavingWaterTimer = 0.32;
        this.position.y = THREE.MathUtils.damp(this.position.y, solidSupportY, 14, dt);
        if (Math.abs(this.position.y - solidSupportY) < 0.08) {
          this.position.y = solidSupportY;
          this.grounded = true;
          this.velocity.y = 0;
        }
      }
      this.onSteepSlope = false;
    } else {
      const supportDelta = solidSupportY - this.position.y;
      const maxStepDownSnap = this.grounded ? 0.28 : 0.04;
      const canSnapToSupport =
        this.position.y <= solidSupportY + maxStepDownSnap &&
        this.velocity.y <= 0 &&
        supportDelta <= MAX_WALKABLE_BOX_STEP_UP + 0.05;

      if (canSnapToSupport) {
        const isShallowWater = postWaterDepth >= SHALLOW_WATER_DEPTH;
        if (!this.grounded) {
          const impactVel = Math.abs(this.velocity.y);
          if (impactVel > 4.5 && !isShallowWater) {
            const strength = THREE.MathUtils.clamp((impactVel - 4) / 10, 0.35, 1.4);
            this.character.triggerLandSquash(strength);
            this.cameraRig.triggerShake(strength * 0.14);
            this.callbacks.onLand?.(this.position, strength, false);
          } else if (isShallowWater && impactVel > 4.5) {
            this.callbacks.onLand?.(this.position, 0.4, true);
          }

          if (impactVel > 16.5 && !isShallowWater) {
            const dmg = Math.round((impactVel - 16.5) * 4.2);
            this.health = Math.max(10, this.health - dmg);
            this.healthRegenDelayTimer = 3.0;
          }
        }

        if (this.swimmingState === 'leaving_water') {
          // Smoothly ease onto land instead of sudden vertical snap
          this.position.y = THREE.MathUtils.damp(this.position.y, solidSupportY, 16, dt);
          if (Math.abs(this.position.y - solidSupportY) < 0.03) {
            this.position.y = solidSupportY;
          }
        } else {
          this.position.y = solidSupportY;
        }
        this.velocity.y = 0;
        this.grounded = true;
        this.isFalling = false;
        this.fallStartY = solidSupportY;

        // Steep slope detection & natural downhill sliding (never climb or snap upward)
        const standingOnSteepTerrain =
          solidSupportY === terrainY && slopeTan > MAX_WALKABLE_SLOPE_TAN;
        this.onSteepSlope = standingOnSteepTerrain;
        if (standingOnSteepTerrain && _gradScratch.mag > 0.001) {
          const invLen = 1 / _gradScratch.mag;
          const downX = -_gradScratch.gx * invLen;
          const downZ = -_gradScratch.gz * invLen;
          const slideSpeed = THREE.MathUtils.clamp(
            (slopeTan - MAX_WALKABLE_SLOPE_TAN) * 9.5 + 2.4,
            2.4,
            8.5,
          );
          const slideDx = downX * slideSpeed * dt;
          const slideDz = downZ * slideSpeed * dt;
          const nextX = this.position.x + slideDx;
          const nextZ = this.position.z + slideDz;
          const nextY = groundHeightAt(nextX, nextZ);
          if (nextY <= this.position.y + 0.08) {
            this.position.x = nextX;
            this.position.z = nextZ;
            this.position.y = Math.max(nextY, this.position.y - 8.5 * dt);
          }
          // Strip any residual uphill velocity while sliding
          const uphillVel =
            this.velocity.x * (-downX) + this.velocity.z * (-downZ);
          if (uphillVel > 0) {
            this.velocity.x += downX * uphillVel;
            this.velocity.z += downZ * uphillVel;
          }
          this.coyoteTimer = 0;
        }
      } else if (supportDelta > MAX_WALKABLE_BOX_STEP_UP + 0.05) {
        // Safety net: never teleport vertically up onto a cliff top; push outward downhill
        this.pushOutOfTerrainPenetration(false);
        this.onSteepSlope = true;
      } else if (this.position.y > solidSupportY + 0.15) {
        if (this.grounded) {
          this.fallStartY = this.position.y;
        }
        this.grounded = false;
        this.onSteepSlope = false;
        if (this.position.y > this.fallStartY && this.velocity.y > 0) {
          this.fallStartY = this.position.y;
        }
        this.isFalling = this.velocity.y < -1.2;
      } else {
        this.onSteepSlope = false;
      }
    }

    // Passive health regeneration after delay
    if (this.health < this.config.maxHealth) {
      if (this.healthRegenDelayTimer > 0) {
        this.healthRegenDelayTimer = Math.max(0, this.healthRegenDelayTimer - dt);
      } else {
        this.health = Math.min(this.config.maxHealth, this.health + 4 * dt);
      }
    }

    // 10. Determine explicit locomotion state (Idle, Walking, Running, Jumping, Falling, Swimming)
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.swimmingState === 'swimming') {
      this.movementState = 'swimming';
    } else if (!this.grounded) {
      this.movementState =
        this.isFalling || this.velocity.y < -1.2 ? 'falling' : 'jumping';
    } else if (isSprinting && horizontalSpeed > walkSpd * 0.7) {
      this.movementState = 'running';
    } else if (horizontalSpeed > 0.32) {
      this.movementState = 'walking';
    } else {
      this.movementState = 'idle';
    }

    // 11. Interaction trigger hook
    if (input.interact) {
      this.callbacks.onInteractRequested?.();
    }

    // 12. Sync 3D Character rig, modular animation state machine, footsteps & camera
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;

    this.character.updateAnimation(
      dt,
      horizontalSpeed,
      this.grounded,
      this.velocity.y,
      this.movementState,
      terrainY,
      this.inWater,
      this.config.runSpeed,
    );

    if (
      this.grounded &&
      this.swimmingState !== 'swimming' &&
      (this.movementState === 'walking' || this.movementState === 'running') &&
      horizontalSpeed > 1.35
    ) {
      const stepSign = Math.sign(this.character.getStepCycleValue()) || 1;
      if (stepSign !== this.lastStepSign) {
        this.lastStepSign = stepSign;
        const stepMode =
          this.movementState === 'running'
            ? this.sprinting
              ? 'sprinting'
              : 'running'
            : 'walking';
        this.callbacks.onFootstep?.(stepMode, this.inWater);
      }
    }

    this.cameraRig.updateFollow(
      dt,
      this.position,
      this.movementState === 'running' && horizontalSpeed > 5.0 && !isAimingBow,
      isAimingBow,
    );
  }

  /**
   * Computes uphill terrain gradient (dh/dx, dh/dz) and slope tangent magnitude
   * into a pre-allocated scratch object (zero allocations).
   */
  private sampleTerrainGradient(
    x: number,
    z: number,
    out: { gx: number; gz: number; mag: number },
  ): void {
    const eps = 0.45;
    const invTwoEps = 1 / (2 * eps);
    const gx = (groundHeightAt(x + eps, z) - groundHeightAt(x - eps, z)) * invTwoEps;
    const gz = (groundHeightAt(x, z + eps) - groundHeightAt(x, z - eps)) * invTwoEps;
    out.gx = gx;
    out.gz = gz;
    out.mag = Math.hypot(gx, gz);
  }

  /**
   * Checks whether moving horizontally from (fromX, fromZ) to (candX, candZ)
   * would penetrate a cliff/mountain wall or climb an unwalkably steep slope.
   */
  private isTerrainMoveBlocked(
    fromX: number,
    fromZ: number,
    candX: number,
    candZ: number,
    currentY: number,
    isSwimming: boolean,
  ): boolean {
    const stepX = candX - fromX;
    const stepZ = candZ - fromZ;
    const stepDist = Math.hypot(stepX, stepZ);
    if (stepDist < 0.0001) return false;

    const dirX = stepX / stepDist;
    const dirZ = stepZ / stepDist;
    const probeR = this.config.radius * 0.92;

    // Sample candidate center + 3 leading cylinder-edge probes (front, front-left, front-right)
    const centerH = groundHeightAt(candX, candZ);
    const frontH = groundHeightAt(candX + dirX * probeR, candZ + dirZ * probeR);
    // ±42° rotated leading probes (cos=0.743, sin=0.669)
    const lx = dirX * 0.743 - dirZ * 0.669;
    const lz = dirX * 0.669 + dirZ * 0.743;
    const rx = dirX * 0.743 + dirZ * 0.669;
    const rz = -dirX * 0.669 + dirZ * 0.743;
    const leftH = groundHeightAt(candX + lx * probeR, candZ + lz * probeR);
    const rightH = groundHeightAt(candX + rx * probeR, candZ + rz * probeR);

    const maxLeadH = Math.max(centerH, frontH, leftH, rightH);

    // 0. If standing on or stepping onto a walkable bridge/floor/porch deck, steep terrain
    //    underneath (such as a carved riverbank or foundation slope) must never block traversal.
    const candDeckY = this.getRockTopSupportYAt(candX, candZ, currentY);
    const frontDeckY = this.getRockTopSupportYAt(
      candX + dirX * probeR,
      candZ + dirZ * probeR,
      currentY,
    );
    const fromDeckY = this.getRockTopSupportYAt(fromX, fromZ, currentY);
    const backDeckY = this.getRockTopSupportYAt(
      fromX - dirX * 0.75,
      fromZ - dirZ * 0.75,
      currentY,
    );
    const bestDeckY = Math.max(candDeckY, frontDeckY);
    const recentDeckY = Math.max(fromDeckY, backDeckY);
    const onOrEnteringDeck =
      (bestDeckY >= currentY - 0.75 &&
        bestDeckY <= currentY + MAX_WALKABLE_BOX_STEP_UP) ||
      (recentDeckY >= currentY - 0.55 &&
        centerH <= currentY + MAX_TERRAIN_STEP_UP &&
        maxLeadH <= currentY + MAX_TERRAIN_STEP_UP + 0.14);

    if (onOrEnteringDeck && maxLeadH <= currentY + MAX_TERRAIN_STEP_UP + 0.14) {
      return false;
    }

    // 1. Direct terrain wall / cliff penetration check (grounded, jumping, falling, or swimming)
    const maxAllowedH = isSwimming
      ? currentY + 0.42
      : this.grounded
        ? currentY + MAX_TERRAIN_STEP_UP
        : currentY + 0.32;
    if (maxLeadH > maxAllowedH) {
      // Allow stepping onto walkable rock/building/bridge tops if a collider supports this height
      if (bestDeckY < maxLeadH - 0.15) {
        return true;
      }
    }

    // 2. Steep slope climbing check when moving uphill (ignore tiny micro-bumps <= 0.14m)
    const prevGroundH = groundHeightAt(fromX, fromZ);
    const riseCenter = centerH - prevGroundH;
    const riseFront = frontH - groundHeightAt(fromX + dirX * probeR, fromZ + dirZ * probeR);
    const maxRisePerMeter = Math.max(riseCenter, riseFront) / stepDist;

    if (maxRisePerMeter > MAX_WALKABLE_SLOPE_TAN && maxLeadH > currentY + 0.14) {
      return true;
    }

    this.sampleTerrainGradient(candX, candZ, _gradScratch);
    if (_gradScratch.mag > MAX_WALKABLE_SLOPE_TAN) {
      const uphillDot = dirX * _gradScratch.gx + dirZ * _gradScratch.gz;
      if (uphillDot > 0.1 && maxLeadH > currentY + 0.12) {
        return true;
      }
    }

    return false;
  }

  /**
   * Moves the player horizontally in small substeps, colliding cleanly with steep slopes
   * and mountain walls and sliding naturally along contours instead of penetrating.
   */
  private moveHorizontalWithTerrainCollision(
    totalDx: number,
    totalDz: number,
    isSwimming: boolean,
  ): void {
    const totalDist = Math.hypot(totalDx, totalDz);
    if (totalDist < 0.00001) return;

    const steps = Math.min(8, Math.max(1, Math.ceil(totalDist / TERRAIN_SUBSTEP_DIST)));
    const subDx = totalDx / steps;
    const subDz = totalDz / steps;

    for (let i = 0; i < steps; i++) {
      const prevX = this.position.x;
      const prevZ = this.position.z;
      const candX = prevX + subDx;
      const candZ = prevZ + subDz;

      if (
        !this.isTerrainMoveBlocked(
          prevX,
          prevZ,
          candX,
          candZ,
          this.position.y,
          isSwimming,
        )
      ) {
        this.position.x = candX;
        this.position.z = candZ;
        continue;
      }

      // Blocked by steep slope / cliff: compute downhill normal and project into contour slide
      this.sampleTerrainGradient(candX, candZ, _gradScratch);
      if (_gradScratch.mag < 0.001) {
        this.sampleTerrainGradient(prevX, prevZ, _gradScratch);
      }

      if (_gradScratch.mag > 0.001) {
        const invMag = 1 / _gradScratch.mag;
        const nx = -_gradScratch.gx * invMag; // downhill outward normal X
        const nz = -_gradScratch.gz * invMag; // downhill outward normal Z

        // Remove inward/uphill velocity component so player doesn't press into wall
        const inwardVel = this.velocity.x * (-nx) + this.velocity.z * (-nz);
        if (inwardVel > 0) {
          this.velocity.x += nx * inwardVel;
          this.velocity.z += nz * inwardVel;
        }

        // Slide along tangent of mountain face
        const inwardStep = subDx * (-nx) + subDz * (-nz);
        const slideDx = inwardStep > 0 ? subDx + nx * inwardStep : subDx;
        const slideDz = inwardStep > 0 ? subDz + nz * inwardStep : subDz;
        const slideX = prevX + slideDx;
        const slideZ = prevZ + slideDz;

        if (
          Math.hypot(slideDx, slideDz) > 0.0005 &&
          !this.isTerrainMoveBlocked(
            prevX,
            prevZ,
            slideX,
            slideZ,
            this.position.y,
            isSwimming,
          )
        ) {
          this.position.x = slideX;
          this.position.z = slideZ;
          continue;
        }
      }

      // Axis-separated fallback slide to avoid sticking on diagonal terrain corners
      if (
        Math.abs(subDx) > 0.0005 &&
        !this.isTerrainMoveBlocked(
          prevX,
          prevZ,
          prevX + subDx,
          prevZ,
          this.position.y,
          isSwimming,
        )
      ) {
        this.position.x = prevX + subDx;
        this.velocity.z = 0;
        continue;
      }
      if (
        Math.abs(subDz) > 0.0005 &&
        !this.isTerrainMoveBlocked(
          prevX,
          prevZ,
          prevX,
          prevZ + subDz,
          this.position.y,
          isSwimming,
        )
      ) {
        this.position.z = prevZ + subDz;
        this.velocity.x = 0;
        continue;
      }

      // Corner / narrow valley: stop cleanly without penetrating terrain
      this.velocity.x = 0;
      this.velocity.z = 0;
      break;
    }
  }

  /**
   * Safety net: if knockback or an object collider pushes the player horizontally
   * into terrain taller than step-up height, push them outward downhill instead
   * of teleporting vertically to the mountain top.
   */
  private pushOutOfTerrainPenetration(isSwimming: boolean): void {
    const maxAllowed = isSwimming
      ? this.position.y + 0.45
      : this.position.y + MAX_TERRAIN_STEP_UP + 0.12;
    const deckY = this.getRockTopSupportY();
    for (let iter = 0; iter < 6; iter++) {
      const h = groundHeightAt(this.position.x, this.position.z);
      if (h <= maxAllowed) return;
      // Do not push player sideways when standing on a walkable bridge/floor/foundation
      if (deckY >= this.position.y - 0.65 && deckY >= h - 0.25) return;
      this.sampleTerrainGradient(this.position.x, this.position.z, _gradScratch);
      if (_gradScratch.mag < 0.001) return;
      const invMag = 1 / _gradScratch.mag;
      this.position.x += (-_gradScratch.gx * invMag) * 0.2;
      this.position.z += (-_gradScratch.gz * invMag) * 0.2;
    }
  }

  private getRockTopSupportYAt(x: number, z: number, currentY: number): number {
    let highest = -Infinity;
    const nearbyColliders = this.callbacks.queryCollidersNear(x, z);
    for (let i = 0; i < nearbyColliders.length; i++) {
      const c = nearbyColliders[i];
      if (c.kind === 'sphere') {
        const dx = x - c.x;
        const dz = z - c.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < c.radius * c.radius) {
          const topY = c.y + Math.sqrt(Math.max(0, c.radius * c.radius - distSq));
          if (currentY >= topY - 0.55 && topY > highest) {
            highest = topY;
          }
        }
      } else if (c.kind === 'box' && c.walkableTop) {
        const dx = x - c.x;
        const dz = z - c.z;
        const cos = Math.cos(c.yaw);
        const sin = Math.sin(c.yaw);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const pad = 0.16;
        if (Math.abs(lx) <= c.halfW + pad && Math.abs(lz) <= c.halfD + pad) {
          let topY = c.maxY;
          if (
            c.slopeStartY !== undefined &&
            c.slopeEndY !== undefined &&
            c.halfD > 0.001
          ) {
            const t = Math.max(0, Math.min(1, (lz + c.halfD) / (2 * c.halfD)));
            topY = c.slopeStartY + (c.slopeEndY - c.slopeStartY) * t;
          }
          if (currentY >= topY - MAX_WALKABLE_BOX_STEP_UP && topY > highest) {
            highest = topY;
          }
        }
      }
    }
    return highest;
  }

  private getRockTopSupportY(): number {
    return this.getRockTopSupportYAt(
      this.position.x,
      this.position.z,
      this.position.y,
    );
  }

  private stripInwardVelocity(nx: number, nz: number): void {
    const inward = this.velocity.x * (-nx) + this.velocity.z * (-nz);
    if (inward > 0) {
      this.velocity.x += nx * inward;
      this.velocity.z += nz * inward;
    }
  }

  private resolveObjectCollisions(): void {
    const radius = this.config.radius;
    const radiusSq = radius * radius;

    for (let iter = 0; iter < OBJECT_COLLISION_ITERATIONS; iter++) {
      let hadCollision = false;
      const nearbyColliders = this.callbacks.queryCollidersNear(
        this.position.x,
        this.position.z,
      );

      for (let i = 0; i < nearbyColliders.length; i++) {
        const c = nearbyColliders[i];
        if (c.kind === 'cylinder') {
          if (
            this.position.y >= c.maxY - 0.08 ||
            this.position.y + this.config.height <= c.minY + 0.05
          ) {
            continue;
          }
          const dx = this.position.x - c.x;
          const dz = this.position.z - c.z;
          const minSep = c.radius + radius;
          const distSq = dx * dx + dz * dz;
          if (distSq < minSep * minSep && distSq > 0.00001) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const nz = dz / dist;
            const push = minSep - dist + COLLIDER_SKIN_EPS;
            this.position.x += nx * push;
            this.position.z += nz * push;
            this.stripInwardVelocity(nx, nz);
            hadCollision = true;
          }
        } else if (c.kind === 'box') {
          const dx = this.position.x - c.x;
          const dz = this.position.z - c.z;
          const cos = Math.cos(c.yaw);
          const sin = Math.sin(c.yaw);
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;

          // Quick bounding rejection
          if (
            Math.abs(lx) >= c.halfW + radius ||
            Math.abs(lz) >= c.halfD + radius
          ) {
            continue;
          }

          // Overhead roof / ceiling collider: block upward jump into ceiling without pushing horizontally
          if (c.tag === 'roof') {
            const headY = this.position.y + this.config.height;
            if (this.position.y < c.minY && headY > c.minY && headY < c.maxY + 0.3) {
              this.position.y = Math.max(0, c.minY - this.config.height);
              if (this.velocity.y > 0) this.velocity.y = 0;
              continue;
            }
          }

          // True 2D Circle/Capsule-vs-OBB contact point (smoothly slides around corners & door jambs)
          const closestX = Math.max(-c.halfW, Math.min(c.halfW, lx));
          const closestZ = Math.max(-c.halfD, Math.min(c.halfD, lz));

          // For sloped walkable decks (e.g., arched bridges), evaluate the actual surface height
          // at the contact point rather than the far high end (c.maxY)
          let effectiveTopY = c.maxY;
          if (
            c.slopeStartY !== undefined &&
            c.slopeEndY !== undefined &&
            c.halfD > 1e-4
          ) {
            const t = Math.max(0, Math.min(1, (closestZ + c.halfD) / (2 * c.halfD)));
            effectiveTopY = c.slopeStartY + (c.slopeEndY - c.slopeStartY) * t;
          }

          // Walkable floors, bridges, porches, foundations & stairs never block horizontally
          // when within walkable step-up height
          if (c.walkableTop && this.position.y >= effectiveTopY - MAX_WALKABLE_BOX_STEP_UP) {
            continue;
          }

          if (
            this.position.y >= effectiveTopY - 0.1 ||
            this.position.y + this.config.height <= c.minY + 0.05
          ) {
            continue;
          }

          const offX = lx - closestX;
          const offZ = lz - closestZ;
          const distSq = offX * offX + offZ * offZ;

          let pushLocalX = 0;
          let pushLocalZ = 0;
          if (distSq >= radiusSq) {
            continue;
          }

          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            const push = radius - dist + COLLIDER_SKIN_EPS;
            pushLocalX = (offX / dist) * push;
            pushLocalZ = (offZ / dist) * push;
          } else {
            // Player center is inside the box: push out along nearest face
            const penX = c.halfW - Math.abs(lx) + radius + COLLIDER_SKIN_EPS;
            const penZ = c.halfD - Math.abs(lz) + radius + COLLIDER_SKIN_EPS;
            if (penX < penZ) {
              pushLocalX = (lx >= 0 ? 1 : -1) * penX;
            } else {
              pushLocalZ = (lz >= 0 ? 1 : -1) * penZ;
            }
          }

          const pushWorldX = pushLocalX * cos + pushLocalZ * sin;
          const pushWorldZ = -pushLocalX * sin + pushLocalZ * cos;
          this.position.x += pushWorldX;
          this.position.z += pushWorldZ;

          const pushLen = Math.hypot(pushWorldX, pushWorldZ);
          if (pushLen > 1e-6) {
            this.stripInwardVelocity(pushWorldX / pushLen, pushWorldZ / pushLen);
          }
          hadCollision = true;
        } else {
          const dx = this.position.x - c.x;
          const dz = this.position.z - c.z;
          const horizDistSq = dx * dx + dz * dz;
          const minSep = c.radius + radius * 0.85;
          if (horizDistSq < minSep * minSep && horizDistSq > 0.00001) {
            const topSurface =
              c.y +
              Math.sqrt(
                Math.max(0, c.radius * c.radius - Math.min(horizDistSq, c.radius * c.radius)),
              );
            if (
              this.position.y < topSurface - 0.52 &&
              this.position.y + this.config.height > c.y - c.radius
            ) {
              const dist = Math.sqrt(horizDistSq);
              const nx = dx / dist;
              const nz = dz / dist;
              const push = minSep - dist + COLLIDER_SKIN_EPS;
              this.position.x += nx * push;
              this.position.z += nz * push;
              this.stripInwardVelocity(nx, nz);
              hadCollision = true;
            }
          }
        }
      }

      if (!hadCollision) break;
    }
  }

  private resolveWorldBounds(): void {
    const dist = Math.hypot(this.position.x, this.position.z);
    if (dist > PLAYABLE_RADIUS) {
      const ratio = PLAYABLE_RADIUS / dist;
      this.position.x *= ratio;
      this.position.z *= ratio;
    }
  }
}
