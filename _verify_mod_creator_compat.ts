import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CURRENT_GAME_VERSION,
  MOD_API_VERSION,
  MOD_CONTENT_SCHEMA_VERSION,
  SUPPORTED_MOD_SCHEMA_VERSIONS,
  type ModStateConfig,
  type ModAssetIndexEntry,
} from './src/game/mods/modTypes';
import {
  compareSemver,
  parseSemver,
  satisfiesSemverRange,
} from './src/game/mods/modSemver';
import {
  extractWoamodEntryBytes,
  parseWoamodZipDirectory,
  validateWoamodArchiveBytes,
} from './src/game/mods/WoamodPackageValidator';
import { validateDiscoveredMods } from './src/game/mods/ModValidator';
import { ModContentRegistry } from './src/game/mods/ModContentRegistry';
import { ModAssetResolver } from './src/game/mods/ModAssetResolver';
import { DefaultModContentStore } from './src/game/mods/handlers/defaultModHandlers';
import { verifyMultiplayerModCompatibility } from './shared/multiplayerProtocol';
import type { RawDiscoveredModEntry, RawModAssetFile, RawModContentFile } from './src/utils/platformExit';

// ---------- Minimal Store-method ZIP builder for .woamod verification ----------
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  const entries = Object.entries(files);
  for (const [rawPath, content] of entries) {
    const nameBytes = encoder.encode(rawPath.replace(/\\/g, '/'));
    const dataBytes = typeof content === 'string' ? encoder.encode(content) : content;
    const sum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(localHeader.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0, true);
    ldv.setUint16(8, 0, true); // Store
    ldv.setUint16(10, 0, true);
    ldv.setUint16(12, 0, true);
    ldv.setUint32(14, sum, true);
    ldv.setUint32(18, dataBytes.length, true);
    ldv.setUint32(22, dataBytes.length, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(centralHeader.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, sum, true);
    cdv.setUint32(20, dataBytes.length, true);
    cdv.setUint32(24, dataBytes.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  let cdSize = 0;
  for (const cp of centralParts) cdSize += cp.length;

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const totalLen = offset + cdSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const p of localParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  for (const p of centralParts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  out.set(eocd, cursor);
  return out;
}

const CONTENT_FOLDERS = new Set([
  'items',
  'weapons',
  'armor',
  'tools',
  'consumables',
  'resources',
  'recipes',
  'characters',
  'animals',
  'creatures',
  'monsters',
  'npcs',
  'buildings',
  'decorations',
  'quests',
  'loot_tables',
  'localization',
]);

async function rawEntryFromWoamodBytes(
  sourceId: string,
  bytes: Uint8Array,
): Promise<RawDiscoveredModEntry> {
  const { entries } = parseWoamodZipDirectory(bytes);
  const decoder = new TextDecoder('utf-8');
  const folderSet = new Set<string>();
  const contentFiles: RawModContentFile[] = [];
  const assetFiles: RawModAssetFile[] = [];
  let manifestRaw: string | null = null;

  for (const entry of entries) {
    if (entry.isDir) continue;
    const rel = entry.name;
    const parts = rel.split('/');
    const top = parts[0].toLowerCase();
    const extIdx = rel.lastIndexOf('.');
    const ext = extIdx >= 0 ? rel.slice(extIdx).toLowerCase() : '';

    if (parts.length > 1) {
      folderSet.add(top);
    }
    if (top === 'assets' && parts.length > 1) {
      folderSet.add(parts[1].toLowerCase());
    }

    if (rel === 'mod.json') {
      manifestRaw = decoder.decode(await extractWoamodEntryBytes(bytes, entry));
      continue;
    }

    if (CONTENT_FOLDERS.has(top) && ext === '.json') {
      contentFiles.push({
        category: top,
        relativePath: rel,
        rawText: decoder.decode(await extractWoamodEntryBytes(bytes, entry)),
      });
    } else {
      const category = top === 'assets' && parts[1] ? parts[1].toLowerCase() : top;
      const asset: RawModAssetFile = {
        category,
        relativePath: rel,
        sizeBytes: entry.uncompressedSize,
      };
      if (ext === '.woa3d') {
        asset.rawText = decoder.decode(await extractWoamodEntryBytes(bytes, entry));
      }
      assetFiles.push(asset);
    }
  }

  return {
    sourceId,
    sourceType: 'archive',
    installKind: 'woamod',
    packageFileName: sourceId,
    sourcePath: `Mods/${sourceId}`,
    modifiedAtMs: Date.now(),
    manifestRaw,
    manifestError: manifestRaw ? null : 'MISSING_MOD_JSON',
    presentFolders: Array.from(folderSet),
    contentFiles,
    assetFiles,
    executableFiles: [],
    archiveCorrupt: false,
  };
}

function defaultStateConfig(): ModStateConfig {
  return {
    version: 1,
    enabledByModId: {},
    priorityByModId: {},
  };
}

async function run(): Promise<void> {
  // 1. Authoritative version constants & package.json separation
  const pkgJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
  ) as { version: string };
  assert.equal(pkgJson.version, '1.0.0', 'package.json app version remains 1.0.0');
  assert.equal(CURRENT_GAME_VERSION, '1.1.25', 'CURRENT_GAME_VERSION must be 1.1.25');
  assert.equal(MOD_CONTENT_SCHEMA_VERSION, 2, 'MOD_CONTENT_SCHEMA_VERSION must be 2');
  assert.deepEqual([...SUPPORTED_MOD_SCHEMA_VERSIONS], [1, 2], 'Supported schema versions must be [1, 2]');

  const v1125 = parseSemver('1.1.25');
  const v1124 = parseSemver('1.1.24');
  assert(v1125 && v1124);
  assert(compareSemver(v1125, v1124) > 0, '1.1.25 > 1.1.24');
  assert.equal(satisfiesSemverRange('1.1.25', '>=1.1.24'), true);
  assert.equal(satisfiesSemverRange('1.1.25', '1.1.25'), true);
  assert.equal(satisfiesSemverRange('1.1.25', '1.1.24'), false);

  // 2. Skyreach Relics Mod Creator v2 package + .woa3d models (Weapon & Decoration)
  const skyreachArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'skyreach.relics',
      name: 'Skyreach Relics',
      version: '1.2.0',
      author: 'Mod Creator',
      description: 'Skyreach weapons and expedition decorations verified in Mod Creator.',
      supportedGameVersion: '1.1.25',
      minGameVersion: '1.1.24',
      modApiVersion: MOD_API_VERSION,
      schemaVersion: 2,
      modTypes: ['Weapon', 'Decoration', 'Item'],
      categories: ['weapons', 'decorations', 'items', 'models'],
      dependencies: [],
    }),
    'items/relic_shards.json': JSON.stringify({
      items: [
        {
          id: 'skyreach_shard',
          name: 'Skyreach Shard',
          nameAr: 'شظية سكاي ريتش',
          category: 'material',
          icon: 'crystal',
          stackable: true,
          maxStack: 50,
        },
      ],
    }),
    'weapons/relic_weapons.json': JSON.stringify({
      weapons: [
        {
          id: 'relic_broadsword',
          name: 'Skyreach Relic Broadsword',
          nameAr: 'سيف سكاي ريتش الأثري',
          weaponKind: 'sword',
          damage: 42,
          cooldown: 0.4,
          range: 3.1,
          icon: 'sword',
          modelPath: 'assets/models/relic_broadsword.woa3d',
        },
      ],
    }),
    'decorations/skyreach_decor.json': JSON.stringify({
      decorations: [
        {
          id: 'skyreach_waystone',
          nameEn: 'Skyreach Waystone',
          nameAr: 'حجر طريق سكاي ريتش',
          category: 'decor',
          material: 'stone',
          sizeX: 1.5,
          sizeZ: 1.5,
          height: 2.8,
          cost: [{ itemId: 'stone', count: 6 }],
          modelPath: 'assets/models/skyreach_waystone.woa3d',
        },
      ],
    }),
    'assets/models/relic_broadsword.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'relic_broadsword_model',
      name: 'Relic Broadsword 3D',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Weapon',
      meshes: [{ name: 'blade', vertices: [[0, 0, 0], [0, 1.4, 0], [0.1, 1.4, 0]] }],
    }),
    'assets/models/skyreach_waystone.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'skyreach_waystone_model',
      name: 'Skyreach Waystone 3D',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Decoration',
      meshes: [{ name: 'pillar', vertices: [[0, 0, 0], [0, 2.8, 0], [1, 2.8, 1]] }],
    }),
    'assets/models/expedition_crate.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'expedition_crate_model',
      name: 'Expedition Crate 3D',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Decoration',
      meshes: [{ name: 'crate', vertices: [[0, 0, 0], [1, 1, 1]] }],
    }),
  });

  const skyPkgVal = await validateWoamodArchiveBytes(skyreachArchive, 'skyreach_relics.woamod');
  assert.equal(skyPkgVal.ok, true, `Skyreach package validation failed: ${skyPkgVal.message}`);
  assert.equal(skyPkgVal.manifest?.schemaVersion, 2);

  // 3. New schema v2 test mod targeting >=1.1.24 / 1.1.25
  const freshV2Archive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'creator.v2_test_pack',
      name: 'Creator V2 Test Pack',
      version: '1.0.0',
      author: 'QA',
      description: 'Fresh schema v2 test mod package.',
      supportedGameVersion: '>=1.1.24',
      minGameVersion: '1.1.24',
      schemaVersion: 2,
      modTypes: ['Weapon', 'Decoration'],
      categories: ['weapons', 'decorations', 'models'],
    }),
    'weapons/sunblade.json': JSON.stringify({
      weapons: [
        {
          id: 'sunblade',
          name: 'Sunblade',
          weaponKind: 'sword',
          damage: 30,
          model: 'assets/models/sunblade.woa3d',
        },
      ],
    }),
    'assets/models/sunblade.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'sunblade_model',
      name: 'Sunblade 3D',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Weapon',
    }),
  });
  const freshPkgVal = await validateWoamodArchiveBytes(freshV2Archive, 'creator_v2_test_pack.woamod');
  assert.equal(freshPkgVal.ok, true, `Fresh schema v2 package validation failed: ${freshPkgVal.message}`);
  assert.equal(freshPkgVal.manifest?.schemaVersion, 2);

  // 4. Schema v1 backward compatibility (explicit schemaVersion: 1 & omitted schemaVersion)
  const v1ExplicitArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'legacy.v1_explicit',
      name: 'Legacy V1 Explicit',
      version: '1.0.0',
      author: 'LegacyAuthor',
      description: 'Explicit schema v1 mod.',
      supportedGameVersion: '>=1.1.24',
      schemaVersion: 1,
      categories: ['items'],
    }),
    'items/herb.json': JSON.stringify({
      items: [{ id: 'moon_herb', name: 'Moon Herb', category: 'material', icon: 'herb' }],
    }),
  });
  const v1OmittedArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'legacy.v1_omitted',
      name: 'Legacy V1 Omitted',
      version: '1.0.0',
      author: 'LegacyAuthor',
      description: 'Omitted schemaVersion defaults to v1.',
      supportedGameVersion: '1.1.25',
      categories: ['items'],
    }),
    'items/stone.json': JSON.stringify({
      items: [{ id: 'runestone', name: 'Runestone', category: 'material', icon: 'stone' }],
    }),
  });
  const v1ExpVal = await validateWoamodArchiveBytes(v1ExplicitArchive, 'legacy_v1_exp.woamod');
  const v1OmitVal = await validateWoamodArchiveBytes(v1OmittedArchive, 'legacy_v1_omit.woamod');
  assert.equal(v1ExpVal.ok, true);
  assert.equal(v1ExpVal.manifest?.schemaVersion, 1);
  assert.equal(v1OmitVal.ok, true);
  assert.equal(v1OmitVal.manifest?.schemaVersion, 1);

  // 5. Full discovery + validator + ModContentRegistry + DefaultModContentStore + ModAssetResolver
  const rawSky = await rawEntryFromWoamodBytes('skyreach_relics.woamod', skyreachArchive);
  const rawV2 = await rawEntryFromWoamodBytes('creator_v2_test_pack.woamod', freshV2Archive);
  const rawV1 = await rawEntryFromWoamodBytes('legacy_v1_exp.woamod', v1ExplicitArchive);
  const rawV1Omit = await rawEntryFromWoamodBytes('legacy_v1_omit.woamod', v1OmittedArchive);

  const cfg = defaultStateConfig();
  for (const id of ['skyreach.relics', 'creator.v2_test_pack', 'legacy.v1_explicit', 'legacy.v1_omitted']) {
    cfg.enabledByModId[id] = true;
    cfg.priorityByModId[id] = 0;
  }

  const discovery = validateDiscoveredMods([rawSky, rawV2, rawV1, rawV1Omit], cfg, CURRENT_GAME_VERSION);
  assert.equal(discovery.records.length, 4);
  for (const mod of discovery.records) {
    assert.equal(mod.status, 'ready', `Expected ${mod.manifest.modId} ready, got ${mod.status}: ${JSON.stringify(mod.diagnostics)}`);
    assert.equal(mod.gameCompatible, true);
    assert.equal(mod.incompatibleAssets.length, 0, `Unexpected incompatible assets for ${mod.manifest.modId}: ${JSON.stringify(mod.incompatibleAssets)}`);
  }

  const skyRec = discovery.records.find((m) => m.manifest.modId === 'skyreach.relics')!;
  const v2Rec = discovery.records.find((m) => m.manifest.modId === 'creator.v2_test_pack')!;
  assert.equal(skyRec.manifest.schemaVersion, 2);
  assert.equal(v2Rec.manifest.schemaVersion, 2);
  assert.equal(
    skyRec.assets.filter((a) => a.relativePath.endsWith('.woa3d')).length,
    3,
    'All 3 .woa3d assets must register cleanly in Skyreach Relics',
  );
  assert.equal(skyRec.assets[0]?.woa3dMetadata?.type, '3d-model');

  const contentStore = new DefaultModContentStore();
  const registry = new ModContentRegistry();
  const assetResolver = new ModAssetResolver();
  for (const handler of contentStore.createHandlers()) {
    registry.registerHandler(handler);
  }

  for (const mod of discovery.records) {
    const assets: ModAssetIndexEntry[] = mod.assets;
    assetResolver.setModAssets(mod.manifest.modId, mod.sourceId, assets);
    const loadRes = registry.loadMod({
      modId: mod.manifest.modId,
      sourceId: mod.sourceId,
      manifest: mod.manifest,
      files: mod.parsedContentFiles,
      assets,
    });
    assert.equal(loadRes.ok, true, `Failed loading ${mod.manifest.modId}: ${JSON.stringify(loadRes.diagnostics)}`);
  }

  // Verify registered weapons, decorations, items, and .woa3d models
  const skySword = contentStore.getModWeaponStats('skyreach.relics:relic_broadsword');
  assert(skySword, 'Skyreach Relic Broadsword registered');
  assert.equal(skySword.modelPath, 'skyreach.relics://assets/models/relic_broadsword.woa3d');

  const skyWaystone = contentStore.getRegistry('decorations').get('skyreach.relics:skyreach_waystone');
  assert(skyWaystone, 'Skyreach Waystone decoration registered');
  assert.equal(skyWaystone.modelPath, 'skyreach.relics://assets/models/skyreach_waystone.woa3d');

  const registeredModels = contentStore.getAllModModels();
  assert.equal(registeredModels.length, 4, '3 Skyreach + 1 Test V2 .woa3d models registered');
  assert(contentStore.getModModel('skyreach.relics://assets/models/expedition_crate.woa3d'));
  assert.equal(assetResolver.getWoa3dAssets('skyreach.relics').length, 3);
  assert.equal(
    assetResolver.findWoa3dMetadata('skyreach.relics://assets/models/relic_broadsword.woa3d')?.modCategory,
    'Weapon',
  );
  assert.equal(
    assetResolver.findWoa3dMetadata('skyreach.relics://assets/models/skyreach_waystone.woa3d')?.modCategory,
    'Decoration',
  );

  // Verify shared multiplayer protocol accepts schema v2 + game version 1.1.25
  const mpReport = verifyMultiplayerModCompatibility(
    {
      schemaVersion: 2,
      modApiVersion: MOD_API_VERSION,
      savedAtGameVersion: CURRENT_GAME_VERSION,
      mods: [
        {
          modId: 'skyreach.relics',
          name: 'Skyreach Relics',
          version: '1.2.0',
          supportedGameVersion: '>=1.1.24',
          schemaVersion: 2,
          modApiVersion: MOD_API_VERSION,
          multiplayerCompatibility: 'required',
          dependencies: [],
        },
      ],
    },
    {
      schemaVersion: 2,
      modApiVersion: MOD_API_VERSION,
      savedAtGameVersion: CURRENT_GAME_VERSION,
      mods: [
        {
          modId: 'skyreach.relics',
          name: 'Skyreach Relics',
          version: '1.2.0',
          supportedGameVersion: '>=1.1.24',
          schemaVersion: 2,
          modApiVersion: MOD_API_VERSION,
          multiplayerCompatibility: 'required',
          dependencies: [],
        },
      ],
    },
    CURRENT_GAME_VERSION,
  );
  assert.equal(mpReport.compatible, true, `MP check failed: ${JSON.stringify(mpReport)}`);

  // 6. Failure & diagnostic verification
  // 6a. Future game version shows current version 1.1.25 (never 1.0.0)
  const futureGameArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'future.mod',
      name: 'Future Mod',
      version: '1.0.0',
      author: 'Future',
      description: 'Targets 1.2.0',
      supportedGameVersion: '1.2.0',
      schemaVersion: 2,
      categories: ['items'],
    }),
    'items/future.json': JSON.stringify({ items: [{ id: 'f1', name: 'F1', icon: 'stone' }] }),
  });
  const futureVal = await validateWoamodArchiveBytes(futureGameArchive, 'future.woamod');
  assert.equal(futureVal.ok, false);
  assert.equal(futureVal.errorCode, 'UNSUPPORTED_GAME_VERSION');
  assert(
    futureVal.message?.includes('current version is 1.1.25'),
    `Expected "current version is 1.1.25", got "${futureVal.message}"`,
  );
  assert(!futureVal.message?.includes('1.0.0'));

  // 6b. Unsupported schemaVersion 99 mentions supported v1, v2
  const badSchemaArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'future.schema',
      name: 'Future Schema',
      version: '1.0.0',
      author: 'QA',
      description: 'Schema v99',
      supportedGameVersion: '1.1.25',
      schemaVersion: 99,
      categories: ['items'],
    }),
    'items/x.json': JSON.stringify({ items: [{ id: 'x1', name: 'X1', icon: 'stone' }] }),
  });
  const badSchemaVal = await validateWoamodArchiveBytes(badSchemaArchive, 'bad_schema.woamod');
  assert.equal(badSchemaVal.ok, false);
  assert.equal(badSchemaVal.errorCode, 'UNSUPPORTED_MOD_SCHEMA_VERSION');
  assert(
    badSchemaVal.message?.includes('v1, v2'),
    `Expected supported schema list in message, got "${badSchemaVal.message}"`,
  );

  // 6c. Mismatched .woa3d modCategory fails both package validator and runtime validator
  const mismatchArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'bad.woa3d_cat',
      name: 'Mismatch .woa3d',
      version: '1.0.0',
      author: 'QA',
      description: 'Weapon pointing to Decoration .woa3d',
      supportedGameVersion: '1.1.25',
      schemaVersion: 2,
      categories: ['weapons', 'models'],
    }),
    'weapons/axe.json': JSON.stringify({
      weapons: [
        {
          id: 'bad_axe',
          name: 'Bad Axe',
          weaponKind: 'axe',
          damage: 20,
          modelPath: 'assets/models/chair.woa3d',
        },
      ],
    }),
    'assets/models/chair.woa3d': JSON.stringify({
      schemaVersion: 2,
      id: 'chair',
      name: 'Chair',
      type: '3d-model',
      category: '3d-model',
      modCategory: 'Decoration',
    }),
  });
  const mismatchVal = await validateWoamodArchiveBytes(mismatchArchive, 'mismatch.woamod');
  assert.equal(mismatchVal.ok, false);
  assert.equal(mismatchVal.errorCode, 'WOA3D_CATEGORY_MISMATCH');

  const rawMismatch = await rawEntryFromWoamodBytes('mismatch.woamod', mismatchArchive);
  const mismatchCfg = defaultStateConfig();
  mismatchCfg.enabledByModId['bad.woa3d_cat'] = true;
  mismatchCfg.priorityByModId['bad.woa3d_cat'] = 0;
  const mismatchDiscovery = validateDiscoveredMods([rawMismatch], mismatchCfg, CURRENT_GAME_VERSION);
  assert.equal(mismatchDiscovery.records[0].incompatibleAssets.length, 1);
  assert.equal(mismatchDiscovery.records[0].incompatibleAssets[0].reason, 'wrong_category');

  // 6d. Corrupt .woa3d JSON syntax rejected cleanly
  const corruptWoa3dArchive = buildZipArchive({
    'mod.json': JSON.stringify({
      modId: 'bad.woa3d_json',
      name: 'Corrupt .woa3d',
      version: '1.0.0',
      author: 'QA',
      description: 'Corrupt woa3d JSON',
      supportedGameVersion: '1.1.25',
      schemaVersion: 2,
      categories: ['models'],
    }),
    'assets/models/broken.woa3d': '{not valid json',
  });
  const corruptWoaVal = await validateWoamodArchiveBytes(corruptWoa3dArchive, 'corrupt_woa3d.woamod');
  assert.equal(corruptWoaVal.ok, false);
  assert.equal(corruptWoaVal.errorCode, 'CORRUPT_WOA3D_JSON');

  console.log('ALL MOD CREATOR COMPATIBILITY CHECKS PASSED:', {
    currentGameVersion: CURRENT_GAME_VERSION,
    packageJsonVersion: pkgJson.version,
    supportedSchemaVersions: [...SUPPORTED_MOD_SCHEMA_VERSIONS],
    skyreachRelicsStatus: skyRec.status,
    skyreachRelicsSchemaVersion: skyRec.manifest.schemaVersion,
    skyreachWoa3dModels: skyRec.assets.filter((a) => a.relativePath.endsWith('.woa3d')).length,
    freshV2Status: v2Rec.status,
    freshV2SchemaVersion: v2Rec.manifest.schemaVersion,
    registeredModelCount: registeredModels.length,
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
