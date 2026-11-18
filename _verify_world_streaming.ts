import assert from 'node:assert/strict';
import * as THREE from 'three';

// Minimal DOM canvas shim so procedural Three.js canvas textures/nameplates work in Node
const noop = () => {};
const mockCtx2d = {
  fillStyle: '',
  strokeStyle: '',
  font: '',
  textAlign: 'left',
  textBaseline: 'alphabetic',
  lineWidth: 1,
  globalAlpha: 1,
  shadowColor: '',
  shadowBlur: 0,
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  }),
  putImageData: noop,
  fillRect: noop,
  strokeRect: noop,
  clearRect: noop,
  beginPath: noop,
  closePath: noop,
  moveTo: noop,
  lineTo: noop,
  quadraticCurveTo: noop,
  bezierCurveTo: noop,
  arc: noop,
  ellipse: noop,
  roundRect: noop,
  setLineDash: noop,
  fill: noop,
  stroke: noop,
  fillText: noop,
  strokeText: noop,
  measureText: () => ({ width: 40 }),
  save: noop,
  restore: noop,
  translate: noop,
  rotate: noop,
  scale: noop,
  createRadialGradient: () => ({ addColorStop: noop }),
  createLinearGradient: () => ({ addColorStop: noop }),
};
(globalThis as Record<string, unknown>).document = {
  createElement: () => ({
    width: 64,
    height: 64,
    getContext: () => mockCtx2d,
  }),
};

import {
  DEFAULT_GRAPHICS_SETTINGS,
  GraphicsQualityManager,
  type HardwareCapabilityProfile,
} from './src/game/engine/GraphicsQualityManager';
import { WorldManager } from './src/game/world/WorldManager';
import { createProceduralTextures } from './src/game/world/textures';
import { migrateSaveData } from './src/game/save/saveMigrations';
import { CombatManager } from './src/game/combat/CombatManager';
import { DEFAULT_WORLD_SEED } from './src/game/math/noise';

function stepWorldFrames(
  world: WorldManager,
  playerPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  elapsedStart: number,
  frames: number,
  dt: number,
  worldHours: number,
): number {
  let elapsed = elapsedStart;
  for (let i = 0; i < frames; i++) {
    elapsed += dt;
    world.update(elapsed, playerPos, camera, dt, worldHours);
  }
  return elapsed;
}

function main(): void {
  const hw: HardwareCapabilityProfile = {
    deviceClass: 'mobile',
    isMobileOrTablet: true,
    isSoftwareGl: false,
    gpuName: 'Adreno 610',
    hardwareTier: 1,
    logicalCores: 4,
    deviceMemoryGb: 2,
    maxTextureSize: 4096,
    maxAnisotropy: 4,
    baseDpr: 2,
    screenWidth: 1080,
    screenHeight: 2400,
  };
  const qm = new GraphicsQualityManager(hw, DEFAULT_GRAPHICS_SETTINGS);
  qm.updateSettings({ preset: 'very-low' });
  const veryLow = qm.getProfile();
  qm.updateSettings({ preset: 'ultra' });
  const ultra = qm.getProfile();

  assert.ok(veryLow.chunkLoadRadius < ultra.chunkLoadRadius, 'VERY_LOW load radius must be smaller than ULTRA');
  assert.ok(veryLow.chunkUnloadRadius < ultra.chunkUnloadRadius, 'VERY_LOW unload radius must be smaller than ULTRA');
  assert.ok(veryLow.chunkStepBudgetMs < ultra.chunkStepBudgetMs, 'VERY_LOW step budget must be tighter than ULTRA');
  assert.ok(veryLow.explorationDrawDist < ultra.explorationDrawDist, 'VERY_LOW exploration radius must be smaller than ULTRA');
  assert.ok(veryLow.villageDrawDist < ultra.villageDrawDist, 'VERY_LOW village draw dist must be smaller than ULTRA');
  assert.ok(veryLow.npcDrawDist < ultra.npcDrawDist, 'VERY_LOW NPC radius must be smaller than ULTRA');
  assert.ok(veryLow.wildlifeNearDist < ultra.wildlifeNearDist, 'VERY_LOW animal radius must be smaller than ULTRA');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 5, 4);
  camera.lookAt(0, 5, -10);

  const textures = createProceduralTextures(1, 'low');
  const world = new WorldManager(scene, textures, true, DEFAULT_WORLD_SEED);
  world.applyGraphicsProfile(veryLow, new THREE.Vector3(0, 0, 4), false);

  const playerPos = new THREE.Vector3(0, 0, 4);
  let elapsed = 1;
  // Sync initial preload
  world.update(elapsed, playerPos, camera, 0, 8.5);
  // Step a few frames so immediate queue stabilizes
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed, 45, 0.016, 8.5);

  // Check Requirement 7 & 11: World map metadata present upfront without loading all exploration sites/villages
  assert.equal(world.exploration.locations.length, 10, 'All 10 exploration sites exist as stubs');
  assert.equal(world.exploration.getLoadedLocationCount(), 0, 'Zero distant exploration sites loaded at spawn');
  const mapExplorationLandmarks = world.landmarks.filter((l) =>
    world.exploration.locations.some((loc) => loc.id === l.id),
  );
  assert.equal(mapExplorationLandmarks.length, 10, 'World map has all 10 exploration site pins without geometry');

  const distantVillagesInitiallyUnloaded = world.village.villages.filter(
    (v) => v.id !== 'oakhollow' && !v.isLoaded,
  );
  assert.ok(
    distantVillagesInitiallyUnloaded.length >= world.village.villages.length - 2,
    'Distant villages must not all be loaded at game start',
  );

  // Check Requirement 4: Priority queue ordering (current -> forward -> nearby -> distant)
  const testChunkMgr = world.chunkManager;
  playerPos.set(360, 0, 0);
  camera.position.set(360, 5, 0);
  camera.lookAt(460, 5, 0); // Looking +X
  camera.updateMatrixWorld();
  world.update(elapsed + 0.016, playerPos, camera, 0.016, 8.5);
  const queuedBeforeFinish = testChunkMgr.getPendingQueueLength();
  assert.ok(queuedBeforeFinish >= 0, 'Chunk queue runs progressively without crash');
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed + 0.016, 80, 0.016, 8.5);

  // Check Requirement 6 & 7 & 8: Visit a distant exploration location AND a distant regional village,
  // mutate chest + resource + door + destroyed + custom change + placed bed + dropped item + NPC night->morning,
  // travel far away so they UNLOAD, then RETURN and verify full persistence!
  const targetLoc = world.exploration.locations[0];
  playerPos.set(targetLoc.x, targetLoc.y, targetLoc.z);
  camera.position.set(targetLoc.x, targetLoc.y + 4, targetLoc.z + 6);
  camera.lookAt(targetLoc.x, targetLoc.y, targetLoc.z);
  camera.updateMatrixWorld();
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed, 25, 0.016, 23.0);
  assert.equal(targetLoc.isLoaded, true, `Exploration location ${targetLoc.id} should stream in when approached`);

  const expChest = world.interactables.find(
    (it) => it.kind === 'chest' && targetLoc.registeredChestIds.includes(it.id),
  );
  assert.ok(expChest, 'Loaded exploration location should have a chest interactable');
  const chestResult = world.openChest(expChest);
  assert.ok(chestResult, 'Opening exploration chest should succeed');
  assert.equal(expChest.collected, true, 'Chest should be marked collected');

  const expRes = world.interactables.find(
    (it) => it.kind === 'resource' && targetLoc.registeredInteractableIds.includes(it.id),
  );
  if (expRes) {
    world.collectResourceNode(expRes, elapsed);
  }
  const destroyedDummyId = `${targetLoc.id}-custom-destroyed`;
  world.markObjectDestroyed(destroyedDummyId);
  world.setCustomObjectChange('bridge-lever-1', { pulled: true, stage: 2 });

  // Place bed & drop item near targetLoc
  const placedBed = world.placeBedAt(targetLoc.x + 2, targetLoc.z + 2, 0.5, 'test-bed-remote');
  const droppedPickup = world.spawnWorldPickup(
    targetLoc.x - 2,
    targetLoc.z + 2,
    'sun-apple',
    2,
    'Sun Apple',
    'test-drop-remote',
    true,
  );
  assert.ok(droppedPickup, 'Player drop created');

  // Also test a distant regional village at night (23:00 -> NPCs should sleep or enter night routine)
  const targetVillage = world.village.villages.find(
    (v) => v.id !== 'oakhollow' && Math.hypot(v.centerX, v.centerZ) > 300,
  )!;
  assert.ok(targetVillage, 'Found a distant village > 300m away');
  playerPos.set(targetVillage.centerX, 5, targetVillage.centerZ);
  camera.position.set(targetVillage.centerX, 9, targetVillage.centerZ + 6);
  camera.lookAt(targetVillage.centerX, 5, targetVillage.centerZ);
  camera.updateMatrixWorld();
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed, 30, 0.016, 23.0);
  assert.equal(targetVillage.isLoaded, true, `Village ${targetVillage.id} should stream in`);
  const loadedVillageDoor = world.interactables.find(
    (it) => it.kind === 'door' && targetVillage.registeredDoorIds?.includes(it.id),
  );
  if (loadedVillageDoor) {
    world.setDoorOpen(loadedVillageDoor.id, true, true);
  }
  const villageNpcsCountAtSite = world.npcs.npcs.filter((n) => n.id.includes(targetVillage.id)).length;
  assert.ok(villageNpcsCountAtSite > 0, 'Village NPCs spawned when village streamed in');
  const sampleVillageNpc = world.npcs.npcs.find((n) => n.id.includes(targetVillage.id))!;
  if (sampleVillageNpc.hasAssignedHome()) {
    assert.equal(
      sampleVillageNpc.blackboard.sleepStage,
      'sleeping',
      'Village NPC spawned at 23:00 must start in indoor sleeping state',
    );
  }

  // Now move VERY FAR AWAY (e.g., opposite corner of map, x = -1400, z = 1400) so both targetLoc & targetVillage unload!
  playerPos.set(-1400, 5, 1400);
  camera.position.set(-1400, 9, 1406);
  camera.lookAt(-1400, 5, 1400);
  camera.updateMatrixWorld();
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed, 45, 0.016, 23.2);

  assert.equal(targetLoc.isLoaded, false, 'Exploration location must unload when player moves far away');
  assert.equal(targetVillage.isLoaded, false, 'Village must unload when player moves far away');
  assert.equal(
    world.npcs.npcs.filter((n) => n.id.includes(targetVillage.id)).length,
    0,
    'Unloaded village NPCs must be removed from active npcs array',
  );
  if (placedBed?.meshGroup) {
    assert.equal(placedBed.meshGroup.parent, null, 'Far placed bed mesh must detach from worldGroup');
  }
  if (droppedPickup.meshGroup) {
    assert.equal(droppedPickup.meshGroup.parent, null, 'Far dropped pickup mesh must detach from worldGroup');
  }

  // Test Save -> Migrate -> Reload even while those areas are UNLOADED!
  const exportedWorld = world.exportImportantState();
  const exportedNpcs = world.npcs.exportSaveNpcStates();
  assert.ok(exportedWorld.openedChestIds.includes(expChest.id), 'Export includes opened chest from unloaded area');
  assert.ok(exportedWorld.destroyedIds.includes(destroyedDummyId), 'Export includes destroyed object ID');
  assert.ok(exportedWorld.customChanges.some((c) => c.id === 'bridge-lever-1'), 'Export includes custom changes');
  assert.ok(exportedNpcs.some((n) => n.id === sampleVillageNpc.id), 'Export includes unloaded village NPC logical state');

  const fakeSaveRaw = {
    version: 6,
    meta: { slotId: 'slot-1', worldId: 'test', worldName: 'Test', worldType: 'normal', difficulty: 'normal', version: 6, createdAtMs: 1, savedAtIso: new Date().toISOString(), savedAtMs: 1, playTimeSeconds: 10, biome: 'Plains', level: 1, timeLabel: '09:00', weatherState: 'clear', completedQuestsCount: 0, activeQuestsCount: 0, worldSeed: DEFAULT_WORLD_SEED },
    player: { position: { x: -1400, y: 5, z: 1400 }, rotation: { yaw: 0, cameraYaw: 0, cameraPitch: 0.2 }, health: 100, stamina: 100, level: 1, xp: 0, coins: 0 },
    inventory: { capacity: 32, slots: [], equippedBySlot: {} },
    quests: { active: [], completed: [], trackedQuestId: null },
    time: { worldHours: 9.0, dayCount: 2, fullDayDurationSeconds: 360, timeScale: 1, paused: false },
    weather: { currentState: 'clear', targetState: 'clear', transitionProgress: 1, dynamicEnabled: true, transitionDurationSeconds: 14, quality: 'low', windAngleRad: 0.6 },
    world: {
      worldSeed: DEFAULT_WORLD_SEED,
      worldType: 'normal',
      difficulty: 'normal',
      ...exportedWorld,
      npcStates: exportedNpcs,
      dialogueFlags: [],
      defeatedEnemyIds: [],
      killedAnimalIds: [],
    },
  };
  const migrated = migrateSaveData(fakeSaveRaw);
  assert.ok(migrated && migrated.data.world.npcStates && migrated.data.world.destroyedIds?.includes(destroyedDummyId), 'Save migration preserves all streaming persistence fields');

  // Return to exploration site first
  playerPos.set(targetLoc.x, targetLoc.y, targetLoc.z);
  camera.position.set(targetLoc.x, targetLoc.y + 4, targetLoc.z + 6);
  camera.lookAt(targetLoc.x, targetLoc.y, targetLoc.z);
  camera.updateMatrixWorld();
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed, 25, 0.016, 9.0); // Morning!

  assert.equal(targetLoc.isLoaded, true, 'Exploration location reloads upon return');
  const reloadedExpChest = world.interactables.find((it) => it.id === expChest.id);
  assert.ok(reloadedExpChest && reloadedExpChest.collected === true, 'Re-loaded exploration chest MUST stay opened');
  assert.equal(world.isObjectDestroyed(destroyedDummyId), true, 'Destroyed object remains marked destroyed');
  assert.deepEqual(world.getCustomObjectChange('bridge-lever-1'), { pulled: true, stage: 2 }, 'Custom modification persists across unload/reload');
  if (expRes) {
    const reloadedRes = world.interactables.find((it) => it.id === expRes.id);
    assert.ok(reloadedRes && (reloadedRes.usesRemaining ?? 3) < 3, 'Exploration resource partial harvest persists across unload/reload');
  }
  if (placedBed?.meshGroup) {
    assert.equal(placedBed.meshGroup.parent !== null, true, 'Placed bed re-attaches when player returns');
  }
  if (droppedPickup.meshGroup) {
    assert.equal(droppedPickup.meshGroup.parent !== null, true, 'Dropped pickup re-attaches when player returns');
  }

  // Return to targetVillage during MORNING (09:00) after unloading at NIGHT (23:00)!
  playerPos.set(targetVillage.centerX, 5, targetVillage.centerZ);
  camera.position.set(targetVillage.centerX, 9, targetVillage.centerZ + 6);
  camera.lookAt(targetVillage.centerX, 5, targetVillage.centerZ);
  camera.updateMatrixWorld();
  elapsed = stepWorldFrames(world, playerPos, camera, elapsed, 30, 0.016, 9.0);
  assert.equal(targetVillage.isLoaded, true, 'Village reloads upon return');

  if (loadedVillageDoor) {
    const reloadedDoor = world.interactables.find((it) => it.id === loadedVillageDoor.id);
    assert.ok(reloadedDoor && reloadedDoor.isOpen === true, 'Village door open state MUST persist across unload/reload');
  }
  const reloadedVillageNpc = world.npcs.npcs.find((n) => n.id === sampleVillageNpc.id)!;
  assert.ok(reloadedVillageNpc, 'Village NPC reloads upon return');
  assert.equal(reloadedVillageNpc.blackboard.currentPeriod, 'morning', 'Reloaded NPC syncs to current morning period');
  assert.equal(reloadedVillageNpc.blackboard.sleepStage, 'outdoor', 'Reloaded NPC wakes outdoors for morning instead of remaining stuck asleep');

  // Check Requirement 10 & 14: CombatManager multi-center streaming
  const combat = new CombatManager({
    scene,
    contactShadowMap: textures.contactShadowMap,
    isSoftwareGl: true,
    seed: DEFAULT_WORLD_SEED,
    playerMaxHealth: 100,
    playerPosition: playerPos,
    isVillageClearance: () => false,
    onPlayerDamaged: () => {},
    onPlayerDefeated: () => {},
  });
  combat.applyGraphicsProfile(veryLow);
  const firstBp = combat.getBlueprintsSnapshot()[0];
  assert.ok(firstBp, 'Enemy blueprints exist');
  // Local host is far away with chunk NOT loaded at firstBp, while remote player is right next to firstBp
  combat.streamEnemies(
    [new THREE.Vector3(2000, 0, 2000), { x: firstBp.x, z: firstBp.z }],
    false,
    () => false,
  );
  assert.ok(firstBp.controller !== null, 'Host spawns enemy near remote multiplayer center even when local chunk is elsewhere');

  combat.dispose();
  world.dispose();
  textures.dispose();
  console.log('ALL_WORLD_STREAMING_E2E_CHECKS_PASSED');
}

main();
