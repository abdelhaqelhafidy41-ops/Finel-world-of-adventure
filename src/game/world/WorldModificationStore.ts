/**
 * Persistent World Modification Store
 *
 * Stores world mutations (opened chests, door open/closed states, collected items,
 * destroyed objects, depleted resource nodes, and custom object changes) independently
 * of visual chunks and streamed villages.
 *
 * When a chunk or village unloads, its render objects are disposed from memory while
 * its modifications remain here. When the chunk or village streams back in later,
 * these modifications are re-applied deterministically.
 */

export interface DepletedNodeRecord {
  regenAtElapsed: number;
  remainingSec: number;
}

export interface SerializedWorldModifications {
  openedChestIds: string[];
  doorStates: Array<{ id: string; isOpen: boolean }>;
  collectedIds: string[];
  destroyedIds: string[];
  depletedNodes: Array<{ id: string; remainingSec: number }>;
  customChanges?: Array<{ id: string; data: Record<string, unknown> }>;
}

export class WorldModificationStore {
  private readonly openedChests = new Set<string>();
  private readonly doorStates = new Map<string, boolean>();
  private readonly collectedIds = new Set<string>();
  private readonly destroyedIds = new Set<string>();
  private readonly depletedNodes = new Map<string, DepletedNodeRecord>();
  private readonly customChanges = new Map<string, Record<string, unknown>>();

  // --- Chests ---
  public markChestOpened(chestId: string): void {
    this.openedChests.add(chestId);
  }

  public isChestOpened(chestId: string): boolean {
    return this.openedChests.has(chestId);
  }

  public getOpenedChestIds(): string[] {
    return Array.from(this.openedChests);
  }

  // --- Doors ---
  public setDoorOpen(doorId: string, isOpen: boolean): void {
    this.doorStates.set(doorId, isOpen);
  }

  public getDoorOpen(doorId: string): boolean | undefined {
    return this.doorStates.get(doorId);
  }

  public getAllDoorStates(): Array<{ id: string; isOpen: boolean }> {
    const out: Array<{ id: string; isOpen: boolean }> = [];
    this.doorStates.forEach((isOpen, id) => {
      out.push({ id, isOpen });
    });
    return out;
  }

  public replaceDoorStates(entries: ReadonlyArray<{ id: string; isOpen: boolean }>): void {
    this.doorStates.clear();
    for (let i = 0; i < entries.length; i++) {
      this.doorStates.set(entries[i].id, Boolean(entries[i].isOpen));
    }
  }

  // --- Collected interactables ---
  public markCollected(id: string): void {
    this.collectedIds.add(id);
  }

  public isCollected(id: string): boolean {
    return this.collectedIds.has(id);
  }

  public getCollectedIds(): string[] {
    return Array.from(this.collectedIds);
  }

  // --- Destroyed objects ---
  public markDestroyed(id: string): void {
    this.destroyedIds.add(id);
  }

  public isDestroyed(id: string): boolean {
    return this.destroyedIds.has(id);
  }

  public getDestroyedIds(): string[] {
    return Array.from(this.destroyedIds);
  }

  // --- Depleted resource nodes ---
  public setDepletedNode(
    id: string,
    regenAtElapsed: number,
    remainingSec: number,
  ): void {
    this.depletedNodes.set(id, { regenAtElapsed, remainingSec });
  }

  public getDepletedNode(id: string): DepletedNodeRecord | undefined {
    return this.depletedNodes.get(id);
  }

  public deleteDepletedNode(id: string): void {
    this.depletedNodes.delete(id);
  }

  public getDepletedNodeEntries(): Array<[string, DepletedNodeRecord]> {
    return Array.from(this.depletedNodes.entries());
  }

  // --- Custom object modifications ---
  public setCustomChange(id: string, data: Record<string, unknown>): void {
    this.customChanges.set(id, { ...data });
  }

  public getCustomChange(id: string): Record<string, unknown> | undefined {
    return this.customChanges.get(id);
  }

  public clear(): void {
    this.openedChests.clear();
    this.doorStates.clear();
    this.collectedIds.clear();
    this.destroyedIds.clear();
    this.depletedNodes.clear();
    this.customChanges.clear();
  }

  public serialize(currentElapsed: number): SerializedWorldModifications {
    const depleted: Array<{ id: string; remainingSec: number }> = [];
    this.depletedNodes.forEach((rec, id) => {
      const rem = Math.max(0, Math.round(rec.regenAtElapsed - currentElapsed));
      if (rem > 0) {
        depleted.push({ id, remainingSec: rem });
      }
    });

    const custom: Array<{ id: string; data: Record<string, unknown> }> = [];
    this.customChanges.forEach((data, id) => {
      custom.push({ id, data: { ...data } });
    });

    return {
      openedChestIds: this.getOpenedChestIds(),
      doorStates: this.getAllDoorStates(),
      collectedIds: this.getCollectedIds(),
      destroyedIds: this.getDestroyedIds(),
      depletedNodes: depleted,
      ...(custom.length > 0 ? { customChanges: custom } : {}),
    };
  }

  public restore(
    state: Partial<SerializedWorldModifications>,
    currentElapsed: number,
  ): void {
    this.clear();
    for (const cid of state.openedChestIds ?? []) {
      this.openedChests.add(cid);
    }
    for (const d of state.doorStates ?? []) {
      this.doorStates.set(d.id, Boolean(d.isOpen));
    }
    for (const id of state.collectedIds ?? []) {
      this.collectedIds.add(id);
    }
    for (const id of state.destroyedIds ?? []) {
      this.destroyedIds.add(id);
    }
    for (const dn of state.depletedNodes ?? []) {
      if (dn.remainingSec > 0) {
        this.depletedNodes.set(dn.id, {
          regenAtElapsed: currentElapsed + dn.remainingSec,
          remainingSec: dn.remainingSec,
        });
      }
    }
    for (const cc of state.customChanges ?? []) {
      this.customChanges.set(cc.id, { ...cc.data });
    }
  }
}
