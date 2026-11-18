import * as THREE from 'three';
import { Weapon, type WeaponAttackContext } from './Weapon';

export type SpearVariantId = 'spear' | 'bronze-spear';

const SPEAR_VARIANTS: Record<
  SpearVariantId,
  {
    name: string;
    nameAr: string;
    damage: number;
    critChance: number;
    cooldown: number;
    range: number;
    knockback: number;
    staminaCost: number;
    tipColor: number;
    ferruleColor: number;
  }
> = {
  spear: {
    name: "Hunter's Spear",
    nameAr: 'رمح الصياد',
    damage: 36,
    critChance: 0.22,
    cooldown: 0.54,
    range: 3.85,
    knockback: 6.4,
    staminaCost: 7,
    tipColor: 0xd3dde6,
    ferruleColor: 0xc99a44,
  },
  'bronze-spear': {
    name: 'Copper-Tipped Spear',
    nameAr: 'رمح نحاسي الرأس',
    damage: 30,
    critChance: 0.2,
    cooldown: 0.52,
    range: 3.7,
    knockback: 5.8,
    staminaCost: 6,
    tipColor: 0xd47d4c,
    ferruleColor: 0x9c6638,
  },
};

/**
 * Long-reach piercing Spear weapon built for thrust attacks and game hunting.
 */
export class SpearWeapon extends Weapon {
  private readonly variant: (typeof SPEAR_VARIANTS)[SpearVariantId];

  constructor(variantId: SpearVariantId = 'spear') {
    const v = SPEAR_VARIANTS[variantId];
    super({
      id: variantId,
      itemId: variantId,
      name: v.name,
      nameAr: v.nameAr,
      kind: 'spear',
      damage: v.damage,
      critChance: v.critChance,
      critMultiplier: 1.6,
      cooldown: v.cooldown,
      hitDelay: 0.1,
      swingDuration: 0.32,
      range: v.range,
      arcAngleRad: Math.PI * 0.48,
      knockback: v.knockback,
      staminaCost: v.staminaCost,
      attackAnim: 'spear_thrust',
      damageType: 'pierce',
      isRanged: false,
    });
    this.variant = v;
  }

  protected buildViewMesh(): THREE.Group {
    const group = new THREE.Group();
    const v = this.variant;

    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x795432,
      roughness: 0.78,
      metalness: 0.04,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: v.ferruleColor,
      roughness: 0.34,
      metalness: 0.82,
    });
    const tipMat = new THREE.MeshStandardMaterial({
      color: v.tipColor,
      roughness: 0.22,
      metalness: 0.88,
    });

    const shaftGeo = new THREE.CylinderGeometry(0.022, 0.025, 1.55, 7);
    shaftGeo.rotateX(Math.PI * 0.5);
    const ferruleGeo = new THREE.CylinderGeometry(0.03, 0.028, 0.09, 7);
    ferruleGeo.rotateX(Math.PI * 0.5);
    const headGeo = new THREE.ConeGeometry(0.046, 0.26, 4);
    headGeo.rotateX(Math.PI * 0.5);

    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(0, 0, 0.46);
    shaft.castShadow = true;

    const ferrule = new THREE.Mesh(ferruleGeo, brassMat);
    ferrule.position.set(0, 0, 1.24);

    const head = new THREE.Mesh(headGeo, tipMat);
    head.position.set(0, 0, 1.4);
    head.castShadow = true;

    group.add(shaft, ferrule, head);
    this.disposables.push(
      shaftMat,
      brassMat,
      tipMat,
      shaftGeo,
      ferruleGeo,
      headGeo,
    );
    return group;
  }

  public executeHit(ctx: WeaponAttackContext): void {
    this.applyMeleeArcHit(ctx);
  }
}
