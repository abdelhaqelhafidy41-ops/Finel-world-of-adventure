import * as THREE from 'three';
import { Weapon, type WeaponAttackContext } from './Weapon';

export type AxeVariantId = 'stone-club' | 'woodland-axe' | 'battle-axe';

const AXE_VARIANTS: Record<
  AxeVariantId,
  {
    name: string;
    nameAr: string;
    damage: number;
    critChance: number;
    cooldown: number;
    range: number;
    knockback: number;
    staminaCost: number;
    twinBlade: boolean;
    isClub?: boolean;
    ironColor: number;
    edgeColor: number;
  }
> = {
  'stone-club': {
    name: 'Reinforced Stone Club',
    nameAr: 'هراوة حجرية مقواة',
    damage: 22,
    critChance: 0.12,
    cooldown: 0.62,
    range: 2.65,
    knockback: 7.4,
    staminaCost: 7,
    twinBlade: false,
    isClub: true,
    ironColor: 0x7d848a,
    edgeColor: 0x9aa2a8,
  },
  'woodland-axe': {
    name: 'Woodland Battleaxe',
    nameAr: 'فأس الغابة القتالي',
    damage: 42,
    critChance: 0.15,
    cooldown: 0.72,
    range: 2.95,
    knockback: 8.8,
    staminaCost: 10,
    twinBlade: false,
    ironColor: 0x8e99a4,
    edgeColor: 0xd5dfe8,
  },
  'battle-axe': {
    name: 'Heavy Battle Axe',
    nameAr: 'فأس حرب ثقيل',
    damage: 52,
    critChance: 0.18,
    cooldown: 0.78,
    range: 3.1,
    knockback: 10.2,
    staminaCost: 12,
    twinBlade: true,
    ironColor: 0x5c6672,
    edgeColor: 0xe6eff6,
  },
};

/**
 * Heavy-hitting melee Axe / Club weapon supporting stone-club, woodland-axe, and battle-axe tiers.
 */
export class AxeWeapon extends Weapon {
  private readonly variant: (typeof AXE_VARIANTS)[AxeVariantId];

  constructor(variantId: AxeVariantId = 'woodland-axe') {
    const v = AXE_VARIANTS[variantId];
    super({
      id: variantId,
      itemId: variantId,
      name: v.name,
      nameAr: v.nameAr,
      kind: 'axe',
      damage: v.damage,
      critChance: v.critChance,
      critMultiplier: 1.75,
      cooldown: v.cooldown,
      hitDelay: 0.14,
      swingDuration: 0.38,
      range: v.range,
      arcAngleRad: Math.PI * 0.88,
      knockback: v.knockback,
      staminaCost: v.staminaCost,
      attackAnim: 'heavy_chop',
      damageType: 'blunt',
      isRanged: false,
    });
    this.variant = v;
  }

  protected buildViewMesh(): THREE.Group {
    const group = new THREE.Group();
    const v = this.variant;

    const haftMat = new THREE.MeshStandardMaterial({
      color: 0x6b472b,
      roughness: 0.78,
      metalness: 0.04,
    });
    const haftGeo = new THREE.CylinderGeometry(0.028, 0.032, 0.92, 8);
    haftGeo.rotateX(Math.PI * 0.5);
    const haft = new THREE.Mesh(haftGeo, haftMat);
    haft.position.set(0, 0, 0.34);
    haft.castShadow = true;

    if (v.isClub) {
      const stoneMat = new THREE.MeshStandardMaterial({
        color: v.ironColor,
        roughness: 0.88,
        metalness: 0.05,
      });
      const wrapMat = new THREE.MeshStandardMaterial({
        color: 0x4f3520,
        roughness: 0.75,
        metalness: 0.04,
      });
      const headGeo = new THREE.DodecahedronGeometry(0.115, 0);
      headGeo.scale(0.88, 0.92, 1.35);
      const wrapGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.1, 8);
      wrapGeo.rotateX(Math.PI * 0.5);

      const head = new THREE.Mesh(headGeo, stoneMat);
      head.position.set(0, 0, 0.76);
      head.castShadow = true;

      const wrap = new THREE.Mesh(wrapGeo, wrapMat);
      wrap.position.set(0, 0, 0.64);

      group.add(haft, wrap, head);
      this.disposables.push(haftMat, haftGeo, stoneMat, wrapMat, headGeo, wrapGeo);
      return group;
    }

    const ironMat = new THREE.MeshStandardMaterial({
      color: v.ironColor,
      roughness: 0.34,
      metalness: 0.82,
    });
    const edgeMat = new THREE.MeshStandardMaterial({
      color: v.edgeColor,
      roughness: 0.2,
      metalness: 0.9,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xc9963e,
      roughness: 0.32,
      metalness: 0.8,
    });

    const ringGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.06, 8);
    ringGeo.rotateX(Math.PI * 0.5);
    const collarGeo = new THREE.BoxGeometry(0.08, 0.09, 0.12);
    const bladeBodyGeo = new THREE.BoxGeometry(0.035, 0.26, 0.2);
    const bladeEdgeGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.025, 10, 1, false, -0.7, 1.4);
    bladeEdgeGeo.rotateZ(Math.PI * 0.5);

    const pommel = new THREE.Mesh(ringGeo, brassMat);
    pommel.position.set(0, 0, -0.09);

    const collar = new THREE.Mesh(collarGeo, brassMat);
    collar.position.set(0, 0, 0.72);

    const head = new THREE.Mesh(bladeBodyGeo, ironMat);
    head.position.set(0, -0.06, 0.72);
    head.castShadow = true;

    const edge = new THREE.Mesh(bladeEdgeGeo, edgeMat);
    edge.position.set(0, -0.1, 0.72);
    edge.rotation.x = Math.PI * 0.5;
    edge.castShadow = true;

    group.add(haft, pommel, collar, head, edge);

    if (v.twinBlade) {
      const backHead = new THREE.Mesh(bladeBodyGeo, ironMat);
      backHead.position.set(0, 0.09, 0.72);
      backHead.castShadow = true;
      const backEdge = new THREE.Mesh(bladeEdgeGeo, edgeMat);
      backEdge.position.set(0, 0.13, 0.72);
      backEdge.rotation.x = -Math.PI * 0.5;
      backEdge.castShadow = true;
      group.add(backHead, backEdge);
    }

    this.disposables.push(
      haftMat,
      ironMat,
      edgeMat,
      brassMat,
      haftGeo,
      ringGeo,
      collarGeo,
      bladeBodyGeo,
      bladeEdgeGeo,
    );
    return group;
  }

  public executeHit(ctx: WeaponAttackContext): void {
    this.applyMeleeArcHit(ctx);
  }
}
