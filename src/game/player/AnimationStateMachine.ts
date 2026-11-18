import * as THREE from 'three';
import type { PlayerMovementState } from '../types';
import type { WeaponAttackAnimType } from '../combat/weapons/Weapon';

export interface PlayerRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  contactShadow: THREE.Mesh;
}

export interface PlayerAnimationContext {
  dt: number;
  state: PlayerMovementState;
  horizontalSpeed: number;
  maxRunSpeed: number;
  verticalVel: number;
  grounded: boolean;
  inWater: boolean;
  groundElevationUnderPlayer: number;
}

export type GatherAnimKind = 'chop' | 'mine' | 'dig' | 'harvest' | 'craft';

export interface AnimationInternalState {
  walkPhase: number;
  idlePhase: number;
  squashY: number;
  attackTimer: number;
  interactTimer: number;
  gatherTimer: number;
  gatherDuration: number;
  gatherKind: GatherAnimKind;
}

export type AttackAnimationHandler = (
  progress: number,
  rig: PlayerRig,
  dt: number,
) => void;

export interface AnimationStateHandler {
  onEnter?: (rig: PlayerRig, anim: AnimationInternalState, prev: PlayerMovementState) => void;
  update: (
    ctx: PlayerAnimationContext,
    rig: PlayerRig,
    anim: AnimationInternalState,
  ) => void;
}

/**
 * Modular animation state machine for the third-person explorer rig.
 * New locomotion or action animations can be added by registering handlers
 * via `registerState(state, handler)` without altering controller logic.
 */
export class AnimationStateMachine {
  private readonly handlers = new Map<PlayerMovementState, AnimationStateHandler>();
  private readonly attackHandlers = new Map<WeaponAttackAnimType, AttackAnimationHandler>();
  private currentState: PlayerMovementState = 'idle';

  public readonly internal: AnimationInternalState = {
    walkPhase: 0,
    idlePhase: 0,
    squashY: 1,
    attackTimer: 0,
    interactTimer: 0,
    gatherTimer: 0,
    gatherDuration: 0.45,
    gatherKind: 'harvest',
  };

  private attackDuration = 0.28;
  private activeAttackType: WeaponAttackAnimType = 'melee_slash';
  private bowChargeActive = false;
  private bowChargeProgress = 0;
  private bowAimPitch = 0;
  private bowEquipped = false;
  private secondPersonActive = false;
  private firstPersonActive = false;

  constructor() {
    this.registerBuiltInHandlers();
    this.registerBuiltInAttackAnimations();
  }

  public setBowChargeState(active: boolean, progress: number, aimPitch = 0): void {
    this.bowChargeActive = active;
    this.bowChargeProgress = Math.max(0, Math.min(1, progress));
    this.bowAimPitch = THREE.MathUtils.clamp(aimPitch, -0.85, 0.85);
  }

  public setBowEquipped(equipped: boolean): void {
    this.bowEquipped = equipped;
  }

  public setSecondPersonMode(enabled: boolean): void {
    this.secondPersonActive = enabled;
  }

  public setFirstPersonMode(enabled: boolean): void {
    this.firstPersonActive = enabled;
  }

  public isBowChargeActive(): boolean {
    return this.bowChargeActive;
  }

  private isUpperBodyLockedByBow(): boolean {
    return (
      this.bowChargeActive ||
      (this.internal.attackTimer > 0 && this.activeAttackType === 'bow_shot')
    );
  }

  public getState(): PlayerMovementState {
    return this.currentState;
  }

  public registerState(
    state: PlayerMovementState,
    handler: AnimationStateHandler,
  ): void {
    this.handlers.set(state, handler);
  }

  public registerAttackAnimation(
    type: WeaponAttackAnimType,
    handler: AttackAnimationHandler,
  ): void {
    this.attackHandlers.set(type, handler);
  }

  public triggerLandSquash(strength: number): void {
    this.internal.squashY = Math.max(0.74, 1 - strength * 0.16);
  }

  public triggerAttack(
    duration = 0.28,
    animType: WeaponAttackAnimType = 'melee_slash',
  ): boolean {
    if (this.internal.attackTimer > 0.08) return false;
    this.attackDuration = Math.max(0.16, duration);
    this.activeAttackType = animType;
    this.internal.attackTimer = this.attackDuration;
    return true;
  }

  public triggerInteractGesture(): void {
    this.internal.interactTimer = 0.26;
  }

  public triggerGatherAnimation(
    kind: GatherAnimKind,
    duration = kind === 'chop' || kind === 'mine' ? 0.48 : 0.34,
  ): void {
    this.internal.gatherKind = kind;
    this.internal.gatherDuration = Math.max(0.24, duration);
    this.internal.gatherTimer = this.internal.gatherDuration;
  }

  public update(ctx: PlayerAnimationContext, rig: PlayerRig): void {
    const { dt, state } = ctx;
    this.internal.idlePhase += dt * 2.2;

    if (this.internal.attackTimer > 0) {
      this.internal.attackTimer = Math.max(0, this.internal.attackTimer - dt);
    }
    if (this.internal.interactTimer > 0) {
      this.internal.interactTimer = Math.max(0, this.internal.interactTimer - dt);
    }
    if (this.internal.gatherTimer > 0) {
      this.internal.gatherTimer = Math.max(0, this.internal.gatherTimer - dt);
    }

    // Recover landing squash/stretch smoothly
    this.internal.squashY = THREE.MathUtils.damp(this.internal.squashY, 1, 14, dt);
    const stretchXZ = 1 / Math.sqrt(this.internal.squashY);
    rig.bodyPivot.scale.set(stretchXZ, this.internal.squashY, stretchXZ);

    // State transition hook
    if (state !== this.currentState) {
      const prev = this.currentState;
      this.currentState = state;
      this.handlers.get(state)?.onEnter?.(rig, this.internal, prev);
    }

    // Execute modular state handler
    const handler = this.handlers.get(state) ?? this.handlers.get('idle');
    handler?.update(ctx, rig, this.internal);

    // Action Overlays (modular attack animations / bow draw pose / interact reach) cleanly layered on top of locomotion
    if (this.internal.attackTimer > 0) {
      const progress = 1 - this.internal.attackTimer / this.attackDuration;
      const atkHandler =
        this.attackHandlers.get(this.activeAttackType) ??
        this.attackHandlers.get('melee_slash');
      atkHandler?.(progress, rig, dt);
    } else if (this.bowChargeActive) {
      const pull = THREE.MathUtils.lerp(0.12, 1.0, this.bowChargeProgress);
      const pitchOffset = -this.bowAimPitch;
      // Subtle natural shoulder protraction (bow arm) & retraction (drawing arm) so both hands
      // meet the bowstring cleanly in front of the chest without intersecting the torso
      rig.rightArmPivot.position.x = THREE.MathUtils.damp(rig.rightArmPivot.position.x, 0.28, 16, dt);
      rig.rightArmPivot.position.z = THREE.MathUtils.damp(rig.rightArmPivot.position.z, 0.08, 16, dt);
      rig.leftArmPivot.position.x = THREE.MathUtils.damp(rig.leftArmPivot.position.x, -0.26, 16, dt);
      rig.leftArmPivot.position.z = THREE.MathUtils.damp(
        rig.leftArmPivot.position.z,
        THREE.MathUtils.lerp(0.06, -0.07, pull),
        16,
        dt,
      );
      // Bow-holding arm extended steadily forward & slightly inward along aim line
      rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(
        rig.rightArmPivot.rotation.x,
        -Math.PI * 0.5 + pitchOffset,
        16,
        dt,
      );
      rig.rightArmPivot.rotation.y = THREE.MathUtils.damp(
        rig.rightArmPivot.rotation.y,
        0,
        16,
        dt,
      );
      rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(
        rig.rightArmPivot.rotation.z,
        -0.36,
        16,
        dt,
      );
      // Drawing arm reaches across to the bowstring nock and draws smoothly backward with charge
      rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(
        rig.leftArmPivot.rotation.x,
        -1.52 + 0.05 * pull + pitchOffset * 0.9,
        16,
        dt,
      );
      rig.leftArmPivot.rotation.y = THREE.MathUtils.damp(
        rig.leftArmPivot.rotation.y,
        0,
        16,
        dt,
      );
      rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(
        rig.leftArmPivot.rotation.z,
        THREE.MathUtils.lerp(0.88, 0.68, pull),
        16,
        dt,
      );
      // Archer torso stance: bow shoulder slightly forward, head sighting straight along target
      rig.bodyPivot.rotation.y = THREE.MathUtils.damp(
        rig.bodyPivot.rotation.y,
        -0.32,
        14,
        dt,
      );
      rig.headGroup.rotation.y = THREE.MathUtils.damp(
        rig.headGroup.rotation.y,
        0.32,
        14,
        dt,
      );
      rig.headGroup.rotation.x = THREE.MathUtils.damp(
        rig.headGroup.rotation.x,
        pitchOffset * 0.45,
        14,
        dt,
      );
    } else if (this.internal.gatherTimer > 0) {
      const t = 1 - this.internal.gatherTimer / Math.max(0.1, this.internal.gatherDuration);
      const kind = this.internal.gatherKind;
      if (kind === 'chop') {
        const swing = t < 0.38 ? t / 0.38 : Math.sin(((t - 0.38) / 0.62) * Math.PI);
        const side = t < 0.38 ? -0.45 * swing : 0.72 * swing;
        rig.rightArmPivot.rotation.x = -1.65 * swing;
        rig.rightArmPivot.rotation.z = side;
        rig.leftArmPivot.rotation.x = -0.95 * swing;
        rig.bodyPivot.rotation.y = side * 0.48;
      } else if (kind === 'mine') {
        if (t < 0.35) {
          const up = t / 0.35;
          rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(0, -2.4, up);
          rig.leftArmPivot.rotation.x = THREE.MathUtils.lerp(0, -1.7, up);
          rig.bodyPivot.rotation.x = THREE.MathUtils.lerp(0, -0.15, up);
        } else {
          const strike = Math.sin(((t - 0.35) / 0.65) * Math.PI * 0.7);
          rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(-2.4, 0.55, strike);
          rig.leftArmPivot.rotation.x = THREE.MathUtils.lerp(-1.7, 0.28, strike);
          rig.bodyPivot.rotation.x = THREE.MathUtils.lerp(-0.15, 0.22, strike);
        }
      } else if (kind === 'dig') {
        const scoop = Math.sin(t * Math.PI);
        rig.rightArmPivot.rotation.x = -1.25 * scoop;
        rig.leftArmPivot.rotation.x = -1.1 * scoop;
        rig.bodyPivot.rotation.x = 0.26 * scoop;
      } else if (kind === 'craft') {
        const tap = Math.abs(Math.sin(t * Math.PI * 2));
        rig.rightArmPivot.rotation.x = -0.75 - tap * 0.55;
        rig.leftArmPivot.rotation.x = -0.75 - tap * 0.25;
        rig.bodyPivot.rotation.x = 0.14;
      } else {
        const pick = Math.sin(t * Math.PI);
        rig.rightArmPivot.rotation.x = -1.05 * pick;
        rig.leftArmPivot.rotation.x = -0.55 * pick;
        rig.bodyPivot.rotation.x = 0.2 * pick;
      }
    } else if (this.internal.interactTimer > 0) {
      const t = 1 - this.internal.interactTimer / 0.26;
      const reachArc = Math.sin(t * Math.PI);
      rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(
        rig.rightArmPivot.rotation.x,
        -0.95 * reachArc,
        0.75,
      );
      rig.bodyPivot.rotation.x = THREE.MathUtils.lerp(
        rig.bodyPivot.rotation.x,
        0.14 * reachArc,
        0.5,
      );
      rig.bodyPivot.rotation.y = THREE.MathUtils.damp(rig.bodyPivot.rotation.y, 0, 12, dt);
    } else {
      rig.bodyPivot.rotation.y = THREE.MathUtils.damp(rig.bodyPivot.rotation.y, 0, 14, dt);
      rig.headGroup.rotation.y = THREE.MathUtils.damp(rig.headGroup.rotation.y, 0, 14, dt);
      rig.leftArmPivot.rotation.y = THREE.MathUtils.damp(rig.leftArmPivot.rotation.y, 0, 14, dt);
      rig.rightArmPivot.rotation.y = THREE.MathUtils.damp(rig.rightArmPivot.rotation.y, 0, 14, dt);
      if (!this.firstPersonActive) {
        rig.leftArmPivot.position.x = THREE.MathUtils.damp(rig.leftArmPivot.position.x, -0.32, 14, dt);
        rig.leftArmPivot.position.z = THREE.MathUtils.damp(rig.leftArmPivot.position.z, 0, 14, dt);
        rig.rightArmPivot.position.x = THREE.MathUtils.damp(rig.rightArmPivot.position.x, 0.32, 14, dt);
        rig.rightArmPivot.position.z = THREE.MathUtils.damp(rig.rightArmPivot.position.z, 0, 14, dt);
        if (Math.abs(rig.leftArmPivot.position.x + 0.32) < 0.0005) rig.leftArmPivot.position.x = -0.32;
        if (Math.abs(rig.leftArmPivot.position.z) < 0.0005) rig.leftArmPivot.position.z = 0;
        if (Math.abs(rig.rightArmPivot.position.x - 0.32) < 0.0005) rig.rightArmPivot.position.x = 0.32;
        if (Math.abs(rig.rightArmPivot.position.z) < 0.0005) rig.rightArmPivot.position.z = 0;
      }
    }

    // Ground the contact shadow directly onto the surface beneath the character
    const heightAboveGround = Math.max(
      0,
      rig.root.position.y - ctx.groundElevationUnderPlayer,
    );
    rig.contactShadow.position.y = -heightAboveGround + 0.04;
    const shadowScale = THREE.MathUtils.clamp(1 - heightAboveGround * 0.08, 0.42, 1);
    rig.contactShadow.scale.setScalar(shadowScale);
    (rig.contactShadow.material as THREE.MeshBasicMaterial).opacity =
      0.46 * THREE.MathUtils.clamp(1 - heightAboveGround * 0.16, 0.08, 1);
  }

  private registerBuiltInHandlers(): void {
    // 1. IDLE STATE: subtle breathing & relaxed stance (rock-steady arms in second-person view)
    this.registerState('idle', {
      update: ({ dt }, rig, anim) => {
        const upperLocked = this.isUpperBodyLockedByBow();
        const steadyHands = this.secondPersonActive || this.firstPersonActive;
        const breath = steadyHands || upperLocked ? 0 : Math.sin(anim.idlePhase) * 0.016;
        const leftArmTargetX = steadyHands ? 0 : Math.sin(anim.idlePhase * 0.7) * 0.045;
        const rightArmTargetX = this.bowEquipped
          ? -0.18
          : steadyHands
            ? 0
            : -Math.sin(anim.idlePhase * 0.7) * 0.045;

        rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, 0, 12, dt);
        rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, 0, 12, dt);
        if (!upperLocked) {
          rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(
            rig.leftArmPivot.rotation.x,
            leftArmTargetX,
            12,
            dt,
          );
          rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(
            rig.rightArmPivot.rotation.x,
            rightArmTargetX,
            12,
            dt,
          );
          rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, 0.06, 12, dt);
          rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, -0.06, 12, dt);
          if (steadyHands) {
            if (Math.abs(rig.leftArmPivot.rotation.x - leftArmTargetX) < 0.0005) {
              rig.leftArmPivot.rotation.x = leftArmTargetX;
            }
            if (Math.abs(rig.rightArmPivot.rotation.x - rightArmTargetX) < 0.0005) {
              rig.rightArmPivot.rotation.x = rightArmTargetX;
            }
            if (Math.abs(rig.leftArmPivot.rotation.z - 0.06) < 0.0005) {
              rig.leftArmPivot.rotation.z = 0.06;
            }
            if (Math.abs(rig.rightArmPivot.rotation.z + 0.06) < 0.0005) {
              rig.rightArmPivot.rotation.z = -0.06;
            }
          }
          rig.headGroup.rotation.x = THREE.MathUtils.damp(rig.headGroup.rotation.x, 0, 10, dt);
        }
        rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, breath, 12, dt);
        if (steadyHands && Math.abs(rig.bodyPivot.position.y) < 0.0005) {
          rig.bodyPivot.position.y = 0;
        }
        rig.bodyPivot.rotation.x = THREE.MathUtils.damp(rig.bodyPivot.rotation.x, 0, 10, dt);
      },
    });

    // 2. WALKING STATE: steady natural stride & mild forward posture
    this.registerState('walking', {
      update: ({ dt, horizontalSpeed, inWater }, rig, anim) => {
        const upperLocked = this.isUpperBodyLockedByBow();
        const speedRatio = THREE.MathUtils.clamp(horizontalSpeed / 6.2, 0.12, 1.15);
        const freq = inWater ? 6.8 : 8.5;
        anim.walkPhase += dt * freq * speedRatio;

        const swing = Math.sin(anim.walkPhase) * 0.6 * Math.min(speedRatio, 1);
        const bounce =
          Math.abs(Math.cos(anim.walkPhase)) *
          (upperLocked ? 0.02 : 0.05) *
          Math.min(speedRatio, 1);

        rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, swing, 16, dt);
        rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, -swing, 16, dt);
        if (!upperLocked) {
          rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, -swing * 0.78, 16, dt);
          rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(
            rig.rightArmPivot.rotation.x,
            this.bowEquipped ? -0.18 + swing * 0.25 : swing * 0.78,
            16,
            dt,
          );
          rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, 0.09, 12, dt);
          rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, -0.09, 12, dt);
          rig.headGroup.rotation.x = -rig.bodyPivot.rotation.x * 0.5;
        }

        rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, bounce, 14, dt);
        rig.bodyPivot.rotation.x = THREE.MathUtils.damp(
          rig.bodyPivot.rotation.x,
          upperLocked ? 0.03 : 0.075,
          10,
          dt,
        );
      },
    });

    // 3. RUNNING STATE: athletic forward lean, wider stride & faster cadence
    this.registerState('running', {
      update: ({ dt, horizontalSpeed, maxRunSpeed }, rig, anim) => {
        const upperLocked = this.isUpperBodyLockedByBow();
        const speedRatio = THREE.MathUtils.clamp(
          horizontalSpeed / Math.max(1, maxRunSpeed * 0.75),
          0.55,
          1.3,
        );
        anim.walkPhase += dt * 11.8 * speedRatio;

        const swing = Math.sin(anim.walkPhase) * 0.9 * Math.min(speedRatio, 1.08);
        const bounce =
          Math.abs(Math.cos(anim.walkPhase)) *
          (upperLocked ? 0.03 : 0.075) *
          Math.min(speedRatio, 1.05);

        rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, swing, 18, dt);
        rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, -swing, 18, dt);
        if (!upperLocked) {
          rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, -swing * 0.92, 18, dt);
          rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(
            rig.rightArmPivot.rotation.x,
            this.bowEquipped ? -0.22 + swing * 0.32 : swing * 0.92,
            18,
            dt,
          );
          rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, 0.14, 12, dt);
          rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, -0.14, 12, dt);
          rig.headGroup.rotation.x = -rig.bodyPivot.rotation.x * 0.55;
        }

        rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, bounce, 16, dt);
        rig.bodyPivot.rotation.x = THREE.MathUtils.damp(
          rig.bodyPivot.rotation.x,
          upperLocked ? 0.06 : 0.18,
          10,
          dt,
        );
      },
    });

    // 4. JUMPING STATE: upward launch pose (knee lift & upward reach)
    this.registerState('jumping', {
      onEnter: (rig) => {
        rig.bodyPivot.position.y = 0.02;
      },
      update: ({ dt, verticalVel }, rig) => {
        const riseTilt = THREE.MathUtils.clamp(-verticalVel * 0.02, -0.22, 0.08);
        rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, 0.54, 12, dt);
        rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, -0.32, 12, dt);
        rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, -0.78, 12, dt);
        rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(rig.rightArmPivot.rotation.x, -0.45, 12, dt);
        rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, 0.28, 10, dt);
        rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, -0.28, 10, dt);
        rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, 0, 10, dt);
        rig.bodyPivot.rotation.x = THREE.MathUtils.damp(rig.bodyPivot.rotation.x, riseTilt, 10, dt);
        rig.headGroup.rotation.x = THREE.MathUtils.damp(rig.headGroup.rotation.x, -0.08, 10, dt);
      },
    });

    // 5. FALLING STATE: distinct descent pose (bracing legs & outstretched arms)
    this.registerState('falling', {
      update: ({ dt, verticalVel }, rig, anim) => {
        const fallRatio = THREE.MathUtils.clamp(-verticalVel / 18, 0, 1);
        const flutter = Math.sin(anim.idlePhase * 3.8) * 0.08 * fallRatio;
        rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, 0.24 + flutter, 10, dt);
        rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, -0.18 - flutter, 10, dt);
        rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, -0.35, 10, dt);
        rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(rig.rightArmPivot.rotation.x, -0.35, 10, dt);
        rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, 0.48 + fallRatio * 0.32 + flutter, 10, dt);
        rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, -0.48 - fallRatio * 0.32 - flutter, 10, dt);
        rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, 0, 10, dt);
        rig.bodyPivot.rotation.x = THREE.MathUtils.damp(rig.bodyPivot.rotation.x, 0.12 * fallRatio, 8, dt);
        rig.headGroup.rotation.x = THREE.MathUtils.damp(rig.headGroup.rotation.x, 0.12, 8, dt);
      },
    });

    // 6. SWIMMING STATE: natural treading water when stationary, horizontal swim stroke when moving
    this.registerState('swimming', {
      update: ({ dt, horizontalSpeed, verticalVel }, rig, anim) => {
        const upperLocked = this.isUpperBodyLockedByBow();
        const moveRatio = THREE.MathUtils.clamp(horizontalSpeed / 4.2, 0, 1.15);
        const strokeFreq = THREE.MathUtils.lerp(3.2, 7.2, Math.min(1, moveRatio));
        anim.walkPhase += dt * strokeFreq;

        const strokeSin = Math.sin(anim.walkPhase);
        const strokeCos = Math.cos(anim.walkPhase);
        const kickSin = Math.sin(anim.walkPhase * 1.45);

        // Smooth body pitch: upright while treading water, leaned forward while swimming
        const verticalTilt = THREE.MathUtils.clamp(-verticalVel * 0.08, -0.25, 0.25);
        const targetBodyPitch =
          THREE.MathUtils.lerp(0.14, 0.68, Math.min(1, moveRatio)) + verticalTilt;
        const targetBob = Math.sin(anim.idlePhase * 1.1) * 0.035;

        // Flutter kick legs
        const legAmp = THREE.MathUtils.lerp(0.24, 0.52, Math.min(1, moveRatio));
        const legBias = THREE.MathUtils.lerp(0.12, 0.28, Math.min(1, moveRatio));
        rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(
          rig.leftLegPivot.rotation.x,
          legBias + kickSin * legAmp,
          12,
          dt,
        );
        rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(
          rig.rightLegPivot.rotation.x,
          legBias - kickSin * legAmp,
          12,
          dt,
        );

        if (!upperLocked) {
          // Alternating breaststroke / freestyle arm sweep
          const leftArmX = THREE.MathUtils.lerp(
            -0.55 + strokeSin * 0.28,
            -1.35 + strokeSin * 0.78,
            Math.min(1, moveRatio),
          );
          const rightArmX = THREE.MathUtils.lerp(
            -0.55 - strokeSin * 0.28,
            -1.35 - strokeSin * 0.78,
            Math.min(1, moveRatio),
          );
          const armSpread = THREE.MathUtils.lerp(
            0.46 + strokeCos * 0.16,
            0.34 + Math.max(0, strokeCos) * 0.42,
            Math.min(1, moveRatio),
          );

          rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(
            rig.leftArmPivot.rotation.x,
            leftArmX,
            12,
            dt,
          );
          rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(
            rig.rightArmPivot.rotation.x,
            rightArmX,
            12,
            dt,
          );
          rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(
            rig.leftArmPivot.rotation.z,
            armSpread,
            12,
            dt,
          );
          rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(
            rig.rightArmPivot.rotation.z,
            -armSpread,
            12,
            dt,
          );
          // Keep head lifted to look forward along the water surface
          rig.headGroup.rotation.x = THREE.MathUtils.damp(
            rig.headGroup.rotation.x,
            -targetBodyPitch * 0.72,
            10,
            dt,
          );
        }

        rig.bodyPivot.position.y = THREE.MathUtils.damp(
          rig.bodyPivot.position.y,
          targetBob,
          10,
          dt,
        );
        rig.bodyPivot.rotation.x = THREE.MathUtils.damp(
          rig.bodyPivot.rotation.x,
          targetBodyPitch,
          8,
          dt,
        );
      },
    });
  }

  private registerBuiltInAttackAnimations(): void {
    // Sword horizontal/diagonal slash
    this.registerAttackAnimation('melee_slash', (t, rig) => {
      const swingArc = Math.sin(t * Math.PI);
      rig.rightArmPivot.rotation.x = -1.75 * swingArc;
      rig.rightArmPivot.rotation.z = -0.35 * swingArc;
      rig.leftArmPivot.rotation.x = 0.45 * swingArc;
      rig.bodyPivot.rotation.y = -0.46 * swingArc;
    });

    // Axe heavy overhead windup & downward chop
    this.registerAttackAnimation('heavy_chop', (t, rig) => {
      if (t < 0.36) {
        const up = t / 0.36;
        rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(0, -2.55, up);
        rig.leftArmPivot.rotation.x = THREE.MathUtils.lerp(0, -1.65, up);
        rig.bodyPivot.rotation.x = THREE.MathUtils.lerp(0, -0.18, up);
        rig.bodyPivot.rotation.y = THREE.MathUtils.lerp(0, -0.22, up);
      } else {
        const chop = (t - 0.36) / 0.64;
        const slam = Math.sin(chop * Math.PI * 0.65);
        rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(-2.55, 0.72, slam);
        rig.leftArmPivot.rotation.x = THREE.MathUtils.lerp(-1.65, 0.35, slam);
        rig.bodyPivot.rotation.x = THREE.MathUtils.lerp(-0.18, 0.24, slam);
        rig.bodyPivot.rotation.y = THREE.MathUtils.lerp(-0.22, 0.32, slam);
      }
    });

    // Bow release & smooth follow-through (starts from aimed pose, lowers smoothly without snapping)
    this.registerAttackAnimation('bow_shot', (t, rig, dt) => {
      const releaseEase = t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.8);
      const recoil = Math.sin(Math.min(1, t / 0.28) * Math.PI) * 0.05;
      const targetRightX = THREE.MathUtils.lerp(-0.18, -Math.PI * 0.5 - recoil, releaseEase);
      const targetRightZ = THREE.MathUtils.lerp(-0.06, -0.36, releaseEase);
      const targetLeftX = THREE.MathUtils.lerp(0, -1.32, releaseEase);
      const targetLeftZ = THREE.MathUtils.lerp(0.06, 0.42, releaseEase);
      const targetBodyY = -0.32 * releaseEase;

      rig.rightArmPivot.position.x = THREE.MathUtils.damp(
        rig.rightArmPivot.position.x,
        THREE.MathUtils.lerp(0.32, 0.28, releaseEase),
        14,
        dt,
      );
      rig.rightArmPivot.position.z = THREE.MathUtils.damp(
        rig.rightArmPivot.position.z,
        THREE.MathUtils.lerp(0, 0.08, releaseEase),
        14,
        dt,
      );
      rig.leftArmPivot.position.x = THREE.MathUtils.damp(
        rig.leftArmPivot.position.x,
        THREE.MathUtils.lerp(-0.32, -0.26, releaseEase),
        14,
        dt,
      );
      rig.leftArmPivot.position.z = THREE.MathUtils.damp(
        rig.leftArmPivot.position.z,
        THREE.MathUtils.lerp(0, -0.07, releaseEase),
        14,
        dt,
      );

      rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(rig.rightArmPivot.rotation.x, targetRightX, 18, dt);
      rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, targetRightZ, 16, dt);
      rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, targetLeftX, 16, dt);
      rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, targetLeftZ, 16, dt);
      rig.bodyPivot.rotation.y = THREE.MathUtils.damp(rig.bodyPivot.rotation.y, targetBodyY, 14, dt);
      rig.headGroup.rotation.y = THREE.MathUtils.damp(rig.headGroup.rotation.y, -targetBodyY, 14, dt);
    });

    // Spear forward lunge thrust
    this.registerAttackAnimation('spear_thrust', (t, rig) => {
      const thrust = Math.sin(t * Math.PI);
      rig.rightArmPivot.rotation.x = -1.35 * thrust;
      rig.rightArmPivot.rotation.z = -0.1 * thrust;
      rig.leftArmPivot.rotation.x = -0.8 * thrust;
      rig.bodyPivot.rotation.x = 0.16 * thrust;
      rig.bodyPivot.rotation.y = 0.22 * thrust;
    });

    // Hunter Knife rapid diagonal snap
    this.registerAttackAnimation('knife_slash', (t, rig) => {
      const snap = Math.sin(t * Math.PI);
      rig.rightArmPivot.rotation.x = -1.65 * snap;
      rig.rightArmPivot.rotation.z = -0.5 * snap;
      rig.leftArmPivot.rotation.x = 0.3 * snap;
      rig.bodyPivot.rotation.y = -0.58 * snap;
    });

    // Unarmed quick jab
    this.registerAttackAnimation('unarmed_punch', (t, rig) => {
      const jab = Math.sin(t * Math.PI);
      rig.rightArmPivot.rotation.x = -1.45 * jab;
      rig.leftArmPivot.rotation.x = 0.35 * jab;
      rig.bodyPivot.rotation.y = -0.32 * jab;
    });
  }
}
