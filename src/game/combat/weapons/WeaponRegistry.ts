import * as THREE from 'three';
import {
  buildGroupFromWoa3dModel,
  resolveExternalWoa3dModel,
} from '../../mods/Woa3dModelBuilder';
import { AxeWeapon } from './AxeWeapon';
import { BowWeapon } from './BowWeapon';
import { KnifeWeapon } from './KnifeWeapon';
import { SpearWeapon } from './SpearWeapon';
import { SwordWeapon } from './SwordWeapon';
import { Weapon, type WeaponAttackContext, type WeaponStats } from './Weapon';

/**
 * Runtime weapon wrapper created from data-driven mod weapon definitions.
 */
export class ModDataWeapon extends Weapon {
  constructor(stats: WeaponStats) {
    super(stats);
  }

  protected buildViewMesh(): THREE.Group {
    const model = resolveExternalWoa3dModel(this.stats.modelPath);
    if (model) {
      const built = buildGroupFromWoa3dModel(model, { categoryHint: 'weapons' });
      this.disposables.push(...built.disposables);
      return built.group;
    }

    const group = new THREE.Group();
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x5c3c28,
      roughness: 0.7,
      metalness: 0.08,
    });
    const accentColor =
      this.stats.kind === 'axe'
        ? 0xb87444
        : this.stats.kind === 'spear'
          ? 0x7aa2d4
          : this.stats.kind === 'bow' || this.stats.kind === 'crossbow'
            ? 0x8b6238
            : 0xc8d6e5;
    const headMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.28,
      metalness: this.stats.isRanged ? 0.15 : 0.8,
    });

    const gripGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.2, 7);
    gripGeo.rotateX(Math.PI * 0.5);
    const guardGeo = new THREE.BoxGeometry(0.18, 0.036, 0.04);
    const bladeLen = this.stats.kind === 'spear' ? 0.92 : 0.68;
    const bladeGeo = new THREE.BoxGeometry(0.056, 0.022, bladeLen);

    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.set(0, 0, 0.02);

    const guard = new THREE.Mesh(guardGeo, headMat);
    guard.position.set(0, 0, 0.12);

    const blade = new THREE.Mesh(bladeGeo, headMat);
    blade.position.set(0, 0, 0.14 + bladeLen * 0.5);
    blade.castShadow = true;

    group.add(grip, guard, blade);
    this.disposables.push(gripMat, headMat, gripGeo, guardGeo, bladeGeo);
    return group;
  }

  public executeHit(ctx: WeaponAttackContext): void {
    this.applyMeleeArcHit(ctx);
  }
}

/**
 * Modular registry mapping item/weapon IDs to Weapon instances.
 * New weapons can be registered without modifying PlayerController or UI code.
 * Core weapons always take precedence over external mod weapons.
 */
export class WeaponRegistry {
  private static externalWeaponProvider:
    | ((id: string) => WeaponStats | undefined)
    | null = null;

  private readonly factories = new Map<string, () => Weapon>();
  private readonly instances = new Map<string, Weapon>();

  constructor() {
    this.register('ranger-sword', () => new SwordWeapon('ranger-sword'));
    this.register('wooden-sword', () => new SwordWeapon('wooden-sword'));
    this.register('copper-sword', () => new SwordWeapon('copper-sword'));
    this.register('iron-sword', () => new SwordWeapon('iron-sword'));
    this.register('silver-sword', () => new SwordWeapon('silver-sword'));
    this.register('steel-sword', () => new SwordWeapon('steel-sword'));
    this.register('stone-club', () => new AxeWeapon('stone-club'));
    this.register('woodland-axe', () => new AxeWeapon('woodland-axe'));
    this.register('battle-axe', () => new AxeWeapon('battle-axe'));
    this.register('hunter-bow', () => new BowWeapon('hunter-bow'));
    this.register('crossbow', () => new BowWeapon('crossbow'));
    this.register('spear', () => new SpearWeapon('spear'));
    this.register('bronze-spear', () => new SpearWeapon('bronze-spear'));
    this.register('hunter-knife', () => new KnifeWeapon());
  }

  public static setExternalWeaponProvider(
    provider: ((id: string) => WeaponStats | undefined) | null,
  ): void {
    WeaponRegistry.externalWeaponProvider = provider;
  }

  public register(id: string, factory: () => Weapon): void {
    this.factories.set(id, factory);
  }

  public getOrCreate(id: string): Weapon | null {
    const existing = this.instances.get(id);
    if (existing) return existing;

    // Core factories always win over external mod definitions
    const factory = this.factories.get(id);
    if (factory) {
      const created = factory();
      this.instances.set(id, created);
      return created;
    }

    const modStats = WeaponRegistry.externalWeaponProvider?.(id);
    if (modStats) {
      const created = new ModDataWeapon(modStats);
      this.instances.set(id, created);
      return created;
    }

    return null;
  }

  public getInstantiatedWeapons(): Weapon[] {
    return Array.from(this.instances.values());
  }

  public disposeAll(): void {
    for (const w of this.instances.values()) {
      w.dispose();
    }
    this.instances.clear();
  }
}
