import { PLAYABLE_RADIUS, seededRandom } from '../math/noise';
import type { DialogueChoiceNode, DialogueNode, DialogueTree } from '../dialogue/dialogueTypes';
import {
  clearProceduralDialogues,
  registerProceduralDialogueTree,
} from '../dialogue/dialogueRegistry';
import { getLocalizedVillageName } from '../i18n/translations';
import type { NPCBase } from '../npc/NPCBase';
import {
  getVillageNpcRoster,
  type VillageNpcDescriptor,
} from '../npc/NPCManager';
import type { NpcRole } from '../types';
import type { VillageSiteRecord } from '../world/VillageManager';
import {
  findNearestValidLand,
  findNearestValidResourceLocation,
  findValidQuestTargetPoint,
  getHydrologyClearance,
  isLand,
  isWater,
  validateQuestTargetLocation,
} from '../world/WorldPlacementValidator';
import { groundSlopeAt } from '../math/noise';
import { clearProceduralQuests, registerProceduralQuest } from './questRegistry';
import type { QuestDefinition, QuestObjectiveDef } from './questTypes';

export interface ProceduralQuestGenResult {
  questCount: number;
  dialogueTreeCount: number;
}

interface BilingualItemRef {
  id: string;
  en: string;
  ar: string;
}

const ARCHETYPE_ITEMS: Record<string, BilingualItemRef[]> = {
  plains: [
    { id: 'wheat', en: 'Golden Wheat', ar: 'قمح ذهبي' },
    { id: 'fiber', en: 'Wild Fiber', ar: 'ألياف برية' },
    { id: 'flower', en: 'Meadow Wildflower', ar: 'زهرة مرج' },
    { id: 'stone', en: 'Fieldstone', ar: 'حجر الحقول' },
  ],
  valley: [
    { id: 'wood', en: 'Timber Logs', ar: 'أخشاب الوادي' },
    { id: 'clay', en: 'River Clay', ar: 'طين النهر' },
    { id: 'iron-ore', en: 'Iron Ore', ar: 'خام الحديد' },
    { id: 'meadow-herb', en: 'Meadow Herb', ar: 'عشبة المرج' },
  ],
  forest: [
    { id: 'wood', en: 'Timber Logs', ar: 'أخشاب الغابة' },
    { id: 'mushroom', en: 'Forest Mushrooms', ar: 'فطر الغابة' },
    { id: 'berries', en: 'Wild Berries', ar: 'توت بري' },
    { id: 'fiber', en: 'Wild Fiber', ar: 'ألياف برية' },
  ],
  mountain: [
    { id: 'stone', en: 'Granite Stone', ar: 'حجر الجرانيت' },
    { id: 'iron-ore', en: 'Iron Ore', ar: 'خام الحديد' },
    { id: 'coal', en: 'Coal Lump', ar: 'قطع الفحم' },
    { id: 'gold-ore', en: 'Gold Ore', ar: 'خام الذهب' },
  ],
  desert: [
    { id: 'sand', en: 'Golden Sand', ar: 'رمال ذهبية' },
    { id: 'cactus', en: 'Desert Cactus', ar: 'صبّار صحراوي' },
    { id: 'desert-plant', en: 'Sunbloom Sage', ar: 'نبات شمس الصحراء' },
    { id: 'stone', en: 'Sandstone', ar: 'حجر رملي' },
  ],
  oasis: [
    { id: 'wheat', en: 'Golden Wheat', ar: 'قمح ذهبي' },
    { id: 'desert-plant', en: 'Sunbloom Sage', ar: 'نبات شمس الصحراء' },
    { id: 'cactus', en: 'Desert Cactus', ar: 'صبّار صحراوي' },
    { id: 'clay', en: 'River Clay', ar: 'طين النهر' },
  ],
  river: [
    { id: 'clay', en: 'River Clay', ar: 'طين النهر' },
    { id: 'wood', en: 'Alder Timber', ar: 'أخشاب النهر' },
    { id: 'wheat', en: 'Golden Wheat', ar: 'قمح ذهبي' },
    { id: 'fiber', en: 'Bankside Reeds', ar: 'ألياف الضفاف' },
  ],
  coastal: [
    { id: 'shell', en: 'Coastal Seashells', ar: 'أصداف ساحلية' },
    { id: 'driftwood', en: 'Sea Driftwood', ar: 'خشب طافٍ' },
    { id: 'sand', en: 'Beach Sand', ar: 'رمال الشاطئ' },
    { id: 'clay', en: 'Estuary Clay', ar: 'طين المصب' },
  ],
};

interface CraftQuestRecipeRef {
  itemId: string;
  en: string;
  ar: string;
}

const CRAFT_TARGETS: CraftQuestRecipeRef[] = [
  { itemId: 'arrow', en: 'Hunting Arrows', ar: 'سهام صيد' },
  { itemId: 'torch', en: 'Camp Torches', ar: 'مشاعل مخيم' },
  { itemId: 'hearth-loaf', en: 'Sunstone Hearth Loaf', ar: 'رغيف الموقد' },
  { itemId: 'apothecary-tonic', en: 'Apothecary Tonic', ar: 'جرعة شفاء' },
];

interface EnemyQuestRef {
  enemyType: string;
  en: string;
  ar: string;
}

const ARCHETYPE_ENEMIES: Record<string, EnemyQuestRef> = {
  plains: { enemyType: 'bandit_scout', en: 'Bandit Scouts', ar: 'كشّافي اللصوص' },
  valley: { enemyType: 'thorn_stalker', en: 'Thorn Stalkers', ar: 'متعقّبي الأشواك' },
  forest: { enemyType: 'thorn_stalker', en: 'Thorn Stalkers', ar: 'متعقّبي الأشواك' },
  mountain: { enemyType: 'stone_sentinel', en: 'Stone Sentinels', ar: 'حراس الحجر' },
  desert: { enemyType: 'bandit_scout', en: 'Desert Raiders', ar: 'غزاة الصحراء' },
  oasis: { enemyType: 'bandit_scout', en: 'Caravan Raiders', ar: 'قطاع القوافل' },
  river: { enemyType: 'bandit_scout', en: 'Riverbank Marauders', ar: 'لصوص الضفاف' },
  coastal: { enemyType: 'thorn_stalker', en: 'Coast Lurkers', ar: 'متعقّبي الساحل' },
};

const UNIVERSAL_FALLBACK_ITEMS: BilingualItemRef[] = [
  { id: 'wood', en: 'Timber Logs', ar: 'أخشاب' },
  { id: 'stone', en: 'Fieldstone', ar: 'حجر' },
  { id: 'fiber', en: 'Wild Fiber', ar: 'ألياف برية' },
];

function resolveValidatedResourceItem(
  village: VillageSiteRecord,
  preferred: BilingualItemRef,
  pool: readonly BilingualItemRef[],
): BilingualItemRef {
  const candidates = [preferred, ...pool, ...UNIVERSAL_FALLBACK_ITEMS];
  for (const item of candidates) {
    const loc = findNearestValidResourceLocation(
      village.centerX,
      village.centerZ,
      item.id,
      145,
      { enforceBiomeAffinity: true },
    );
    if (loc) return item;
  }
  return UNIVERSAL_FALLBACK_ITEMS[0];
}

function pickReachPointNearVillage(
  village: VillageSiteRecord,
  rand: () => number,
): { x: number; z: number } {
  const minDist = Math.max(36, village.clearanceRadius + 8);
  const checkVillageClearance = (x: number, z: number) =>
    Math.hypot(x - village.centerX, z - village.centerZ) < Math.max(28, village.clearanceRadius + 4);

  for (let i = 0; i < 24; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = minDist + rand() * 58;
    const cx = Math.max(-PLAYABLE_RADIUS + 40, Math.min(PLAYABLE_RADIUS - 40, village.centerX + Math.cos(ang) * dist));
    const cz = Math.max(-PLAYABLE_RADIUS + 40, Math.min(PLAYABLE_RADIUS - 40, village.centerZ + Math.sin(ang) * dist));
    if (
      !checkVillageClearance(cx, cz) &&
      !isWater(cx, cz) &&
      isLand(cx, cz, 0.65) &&
      getHydrologyClearance(cx, cz) >= 2.5 &&
      groundSlopeAt(cx, cz) <= 0.30
    ) {
      return { x: Math.round(cx), z: Math.round(cz) };
    }
  }
  const safe = findValidQuestTargetPoint(village.centerX, village.centerZ, {
    minRadius: minDist,
    maxRadius: 150,
    outsideVillage: true,
    isVillageClearance: checkVillageClearance,
  });
  return { x: Math.round(safe.x), z: Math.round(safe.z) };
}

const ROLE_PREFERRED_ITEMS: Partial<Record<NpcRole, BilingualItemRef[]>> = {
  farmer: [
    { id: 'wheat', en: 'Golden Wheat', ar: 'قمح ذهبي' },
    { id: 'fiber', en: 'Wild Fiber', ar: 'ألياف برية' },
    { id: 'berries', en: 'Wild Berries', ar: 'توت بري' },
    { id: 'wood', en: 'Fence Timber', ar: 'أخشاب للسياج' },
  ],
  blacksmith: [
    { id: 'iron-ore', en: 'Iron Ore', ar: 'خام الحديد' },
    { id: 'coal', en: 'Forge Coal', ar: 'فحم الحداد' },
    { id: 'stone', en: 'Forge Stone', ar: 'حجر صلب' },
    { id: 'wood', en: 'Hardwood Logs', ar: 'أخشاب للفرن' },
  ],
  miner: [
    { id: 'iron-ore', en: 'Iron Ore', ar: 'خام الحديد' },
    { id: 'coal', en: 'Coal Lump', ar: 'قطع الفحم' },
    { id: 'stone', en: 'Granite Stone', ar: 'حجر الجرانيت' },
    { id: 'gold-ore', en: 'Gold Ore', ar: 'خام الذهب' },
  ],
  woodcutter: [
    { id: 'wood', en: 'Timber Logs', ar: 'أخشاب الغابة' },
    { id: 'fiber', en: 'Binding Fiber', ar: 'ألياف ربط' },
  ],
  carpenter: [
    { id: 'wood', en: 'Building Timber', ar: 'أخشاب البناء' },
    { id: 'stone', en: 'Foundation Stone', ar: 'حجر الأساس' },
    { id: 'clay', en: 'Mortar Clay', ar: 'طين البناء' },
  ],
  healer: [
    { id: 'meadow-herb', en: 'Meadow Herbs', ar: 'أعشاب شفاء' },
    { id: 'flower', en: 'Wildflowers', ar: 'أزهار برية' },
    { id: 'mushroom', en: 'Forest Mushrooms', ar: 'فطر بري' },
    { id: 'desert-plant', en: 'Sunbloom Sage', ar: 'نبات شمس الصحراء' },
  ],
  fisherman: [
    { id: 'shell', en: 'Coastal Seashells', ar: 'أصداف ساحلية' },
    { id: 'driftwood', en: 'Sea Driftwood', ar: 'خشب طافٍ' },
    { id: 'clay', en: 'Riverbank Clay', ar: 'طين الضفاف' },
    { id: 'fiber', en: 'Netting Fiber', ar: 'ألياف للشباك' },
  ],
  innkeeper: [
    { id: 'wheat', en: 'Hearth Wheat', ar: 'قمح الموقد' },
    { id: 'berries', en: 'Wild Berries', ar: 'توت بري' },
    { id: 'mushroom', en: 'Cooking Mushrooms', ar: 'فطر للطهي' },
    { id: 'wood', en: 'Firewood Logs', ar: 'حطب الموقد' },
  ],
  hunter: [
    { id: 'wood', en: 'Bow Timber', ar: 'أخشاب للأقواس' },
    { id: 'fiber', en: 'Bowstring Fiber', ar: 'ألياف للأوتار' },
    { id: 'berries', en: 'Trail Berries', ar: 'توت بري' },
  ],
};

type VillageQuestMechanic = 'collect' | 'kill' | 'hunt' | 'deliver' | 'scout' | 'craft';

function pickMechanicForRole(
  role: NpcRole,
  slotIdx: number,
  rand: () => number,
): VillageQuestMechanic {
  const roll = rand();
  switch (role) {
    case 'elder':
      return slotIdx === 0
        ? (roll < 0.55 ? 'scout' : 'kill')
        : (roll < 0.5 ? 'kill' : 'deliver');
    case 'guard':
      return slotIdx % 2 === 0 ? 'kill' : (roll < 0.65 ? 'kill' : 'scout');
    case 'hunter':
      return roll < 0.6 ? 'hunt' : (roll < 0.85 ? 'collect' : 'scout');
    case 'farmer':
      return roll < 0.5 ? 'collect' : (roll < 0.78 ? 'deliver' : 'kill');
    case 'blacksmith':
      return roll < 0.55 ? 'collect' : (roll < 0.8 ? 'kill' : 'craft');
    case 'merchant':
    case 'traveling_merchant':
      return roll < 0.5 ? 'deliver' : (roll < 0.82 ? 'collect' : 'kill');
    case 'carpenter':
    case 'woodcutter':
    case 'miner':
      return roll < 0.65 ? 'collect' : (roll < 0.85 ? 'craft' : 'deliver');
    case 'healer':
    case 'innkeeper':
      return roll < 0.55 ? 'collect' : (roll < 0.85 ? 'craft' : 'deliver');
    case 'fisherman':
      return roll < 0.6 ? 'collect' : (roll < 0.85 ? 'scout' : 'deliver');
    default:
      return roll < 0.45 ? 'collect' : (roll < 0.75 ? 'deliver' : 'scout');
  }
}

function resolveVillageArchetypeKey(village: VillageSiteRecord): string {
  if (village.archetype && village.archetype in ARCHETYPE_ITEMS) {
    return village.archetype;
  }
  if (village.kind === 'farming' || village.kind === 'trading') return 'plains';
  if (village.kind in ARCHETYPE_ITEMS) return village.kind;
  return 'plains';
}

function buildNpcQuestDialogueTrees(
  npc: VillageNpcDescriptor,
  villageNameEn: string,
  villageNameAr: string,
  givenQuests: QuestDefinition[],
  turnInQuests: QuestDefinition[],
): { en: DialogueTree; ar: DialogueTree } {
  const enNodes: Record<string, DialogueNode> = {};
  const arNodes: Record<string, DialogueNode> = {};
  const enEntryRules: DialogueTree['entryRules'] = [];
  const arEntryRules: DialogueTree['entryRules'] = [];

  const enGreetChoices: DialogueChoiceNode[] = [];
  const arGreetChoices: DialogueChoiceNode[] = [];

  const allTurnIns = new Map<string, QuestDefinition>();
  for (const q of turnInQuests) allTurnIns.set(q.id, q);
  for (const q of givenQuests) {
    if (!q.turnInNpcId || q.turnInNpcId === npc.id) {
      allTurnIns.set(q.id, q);
    }
  }

  for (const q of allTurnIns.values()) {
    const readyId = `ready_${q.id}`;
    const completeDoneId = `completed_${q.id}`;

    enEntryRules.push({
      condition: { questId: q.id, questStatusIn: ['ready'] },
      nodeId: readyId,
    });
    arEntryRules.push({
      condition: { questId: q.id, questStatusIn: ['ready'] },
      nodeId: readyId,
    });

    enNodes[readyId] = {
      id: readyId,
      questId: q.id,
      lines: [
        `You finished "${q.title}"! ${villageNameEn} owes you real gratitude.`,
      ],
      choices: [
        {
          id: `turnin-${q.id}`,
          label: `Complete: ${q.title}`,
          nextNodeId: completeDoneId,
          questTag: 'complete',
          effects: [{ type: 'completeQuest', questId: q.id }],
        },
        {
          id: `notyet-${q.id}`,
          label: 'Hold on a moment.',
          nextNodeId: null,
        },
      ],
    };
    arNodes[readyId] = {
      id: readyId,
      questId: q.id,
      lines: [
        `لقد أتممت "${q.titleAr ?? q.title}"! أهالي ${villageNameAr} ممتنون لك كثيراً.`,
      ],
      choices: [
        {
          id: `turnin-${q.id}`,
          label: `إكمال: ${q.titleAr ?? q.title}`,
          nextNodeId: completeDoneId,
          questTag: 'complete',
          effects: [{ type: 'completeQuest', questId: q.id }],
        },
        {
          id: `notyet-${q.id}`,
          label: 'انتظر لحظة.',
          nextNodeId: null,
        },
      ],
    };

    enNodes[completeDoneId] = {
      id: completeDoneId,
      lines: [`Well earned, traveler! Safe roads out of ${villageNameEn}.`],
      nextNodeId: null,
    };
    arNodes[completeDoneId] = {
      id: completeDoneId,
      lines: [`تستحقها عن جدارة أيها المغامر! رحلة آمنة خارج ${villageNameAr}.`],
      nextNodeId: null,
    };
  }

  for (const q of givenQuests) {
    const activeId = `active_${q.id}`;
    const offerId = `offer_${q.id}`;
    const acceptDoneId = `accepted_${q.id}`;

    enGreetChoices.push({
      id: `ask-offer-${q.id}`,
      label: `Task: ${q.title}`,
      nextNodeId: offerId,
      questTag: 'accept',
      condition: { questId: q.id, questStatusIn: ['available'] },
    });
    arGreetChoices.push({
      id: `ask-offer-${q.id}`,
      label: `مهمة: ${q.titleAr ?? q.title}`,
      nextNodeId: offerId,
      questTag: 'accept',
      condition: { questId: q.id, questStatusIn: ['available'] },
    });

    enGreetChoices.push({
      id: `ask-progress-${q.id}`,
      label: `Check progress: ${q.title}`,
      nextNodeId: activeId,
      questTag: 'progress',
      condition: { questId: q.id, questStatusIn: ['active'] },
    });
    arGreetChoices.push({
      id: `ask-progress-${q.id}`,
      label: `متابعة: ${q.titleAr ?? q.title}`,
      nextNodeId: activeId,
      questTag: 'progress',
      condition: { questId: q.id, questStatusIn: ['active'] },
    });

    enNodes[offerId] = {
      id: offerId,
      questId: q.id,
      lines: [q.description, `Reward: ${q.rewardSummary}`],
      choices: [
        {
          id: `accept-${q.id}`,
          label: 'Accept Quest',
          nextNodeId: acceptDoneId,
          questTag: 'accept',
          effects: [{ type: 'startQuest', questId: q.id }],
        },
        {
          id: `decline-${q.id}`,
          label: 'Maybe later.',
          nextNodeId: 'greet',
        },
      ],
    };
    arNodes[offerId] = {
      id: offerId,
      questId: q.id,
      lines: [q.descriptionAr ?? q.description, `المكافأة: ${q.rewardSummaryAr ?? q.rewardSummary}`],
      choices: [
        {
          id: `accept-${q.id}`,
          label: 'قبول المهمة',
          nextNodeId: acceptDoneId,
          questTag: 'accept',
          effects: [{ type: 'startQuest', questId: q.id }],
        },
        {
          id: `decline-${q.id}`,
          label: 'ربما لاحقاً.',
          nextNodeId: 'greet',
        },
      ],
    };

    enNodes[acceptDoneId] = {
      id: acceptDoneId,
      questId: q.id,
      lines: [`Wonderful! Return once you have completed it in ${villageNameEn}.`],
      nextNodeId: null,
    };
    arNodes[acceptDoneId] = {
      id: acceptDoneId,
      questId: q.id,
      lines: [`رائع! بالتوفيق في مهمتك في ${villageNameAr}.`],
      nextNodeId: null,
    };

    enNodes[activeId] = {
      id: activeId,
      questId: q.id,
      lines: [`Still working on "${q.title}"? Check your journal whenever you need directions.`],
      nextNodeId: null,
    };
    arNodes[activeId] = {
      id: activeId,
      questId: q.id,
      lines: [`هل ما زلت تعمل على "${q.titleAr ?? q.title}"؟ يمكنك مراجعة سجل المهام في أي وقت.`],
      nextNodeId: null,
    };
  }

  enGreetChoices.push(
    {
      id: 'about-village',
      label: `Tell me about ${villageNameEn}.`,
      nextNodeId: 'about',
    },
    {
      id: 'bye',
      label: 'Farewell.',
      nextNodeId: null,
    },
  );
  arGreetChoices.push(
    {
      id: 'about-village',
      label: `أخبرني عن ${villageNameAr}.`,
      nextNodeId: 'about',
    },
    {
      id: 'bye',
      label: 'إلى اللقاء.',
      nextNodeId: null,
    },
  );

  enNodes.greet = {
    id: 'greet',
    lines: [`Greetings from ${villageNameEn}! Always good to see an adventurer on dry ground.`],
    choices: enGreetChoices,
  };
  arNodes.greet = {
    id: 'greet',
    lines: [`تحياتي من ${villageNameAr}! يسعدنا دائماً رؤية مغامر في قريتنا.`],
    choices: arGreetChoices,
  };

  enNodes.about = {
    id: 'about',
    lines: [
      `${villageNameEn} gathers local resources, keeps guards on perimeter patrol, and welcomes passing traders.`,
    ],
    choices: [{ id: 'back', label: 'Anything else?', nextNodeId: 'greet' }],
  };
  arNodes.about = {
    id: 'about',
    lines: [
      `تجمع ${villageNameAr} الموارد المحلية وتحافظ على حراسة طرقاتها وترحب بالتجار والمسافرين.`,
    ],
    choices: [{ id: 'back', label: 'هل من شيء آخر؟', nextNodeId: 'greet' }],
  };

  return {
    en: {
      npcId: npc.id,
      defaultStartNodeId: 'greet',
      entryRules: enEntryRules,
      nodes: enNodes,
    },
    ar: {
      npcId: npc.id,
      defaultStartNodeId: 'greet',
      entryRules: arEntryRules,
      nodes: arNodes,
    },
  };
}

/**
 * Generates deterministic, role-appropriate, biome-validated quests + matching bilingual
 * dialogue trees for ALL non-Oakhollow villages (both named regional villages and procedural villages).
 * Uses deterministic village NPC rosters so unloaded/lazy-streamed villages are immediately
 * registered for save/load persistence and ready the moment the player enters any village.
 */
export function generateAndRegisterProceduralQuests(
  worldSeed: number,
  villages: readonly VillageSiteRecord[],
  npcs: readonly NPCBase[],
): ProceduralQuestGenResult {
  clearProceduralQuests();
  clearProceduralDialogues();

  let totalQuests = 0;
  let totalDialogues = 0;

  // Index any already-loaded NPCs by ID so live display names match 1:1
  const loadedNpcById = new Map<string, NPCBase>();
  for (const npc of npcs) {
    loadedNpcById.set(npc.id, npc);
  }

  for (const village of villages) {
    // Preserve Oakhollow's hand-authored quests & dialogues untouched
    if (village.id === 'oakhollow') continue;

    // Build deterministic villager roster for this village (regional OR procedural)
    const rawRoster = getVillageNpcRoster(village);
    const villageNpcs: VillageNpcDescriptor[] = rawRoster.map((desc) => {
      const live = loadedNpcById.get(desc.id);
      if (live) {
        return {
          id: live.id,
          name: live.name,
          nameAr: live.getLocalizedName('ar'),
          role: live.role,
        };
      }
      return desc;
    });
    if (villageNpcs.length === 0) continue;

    const archetype = resolveVillageArchetypeKey(village);
    let villageHash = 0x51a9c21d;
    for (let i = 0; i < village.id.length; i++) {
      villageHash = Math.imul(villageHash ^ village.id.charCodeAt(i), 16777619);
    }
    const rand = seededRandom(
      (worldSeed ^ villageHash ^ Math.round(village.centerX * 73) ^ Math.round(village.centerZ * 37)) >>> 0,
    );

    // Distance-based difficulty tier (Tier 1 near Oakhollow, Tier 2 mid-frontier, Tier 3 far/harsh)
    const distFromOrigin = Math.hypot(village.centerX, village.centerZ);
    const harshBiome = archetype === 'mountain' || archetype === 'desert';
    const difficultyTier =
      distFromOrigin >= 560 || (harshBiome && distFromOrigin >= 320)
        ? 3
        : distFromOrigin >= 260
          ? 2
          : 1;

    // Prioritize distinct village professions (elder, guard, blacksmith, farmer, hunter, merchant, craftsmen)
    const rolePriority = (r: NpcRole): number => {
      switch (r) {
        case 'elder': return 0;
        case 'guard': return 1;
        case 'farmer': return 2;
        case 'blacksmith': return 3;
        case 'hunter': return 4;
        case 'merchant':
        case 'traveling_merchant': return 5;
        case 'carpenter':
        case 'woodcutter':
        case 'miner':
        case 'fisherman':
        case 'healer':
        case 'innkeeper': return 6;
        default: return 7;
      }
    };

    const sortedGivers = [...villageNpcs].sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
    // Prefer spreading quests across distinct professions first before repeating a role
    const distinctRoleGivers: VillageNpcDescriptor[] = [];
    const seenRoles = new Set<NpcRole>();
    for (const n of sortedGivers) {
      if (!seenRoles.has(n.role)) {
        seenRoles.add(n.role);
        distinctRoleGivers.push(n);
      }
    }
    const giverPool = distinctRoleGivers.length >= 3 ? distinctRoleGivers : sortedGivers;

    const targetQuestCount = Math.max(
      3,
      Math.min(
        6,
        village.populationPlan?.questCount ?? Math.min(5, Math.max(4, giverPool.length)),
      ),
    );
    const villageNameAr = getLocalizedVillageName(village.id, village.name, 'ar');

    const itemsPool = ARCHETYPE_ITEMS[archetype] ?? ARCHETYPE_ITEMS.plains;
    const enemyRef = ARCHETYPE_ENEMIES[archetype] ?? ARCHETYPE_ENEMIES.plains;

    const questsByGiver = new Map<string, QuestDefinition[]>();
    const questsByTurnIn = new Map<string, QuestDefinition[]>();
    const touchedNpcIds = new Set<string>();
    const npcById = new Map(villageNpcs.map((n) => [n.id, n]));
    let firstQuestIdInVillage: string | null = null;

    for (let qIdx = 0; qIdx < targetQuestCount; qIdx++) {
      const giver = giverPool[qIdx % giverPool.length];
      const questId = `pquest-${village.id}-${qIdx + 1}`;
      if (qIdx === 0) firstQuestIdInVillage = questId;

      const mechanic = pickMechanicForRole(giver.role, qIdx, rand);

      // Scale rewards smoothly by difficulty tier & quest index
      const xp = 55 + difficultyTier * 28 + Math.floor(rand() * 30) + qIdx * 8;
      const coins = 22 + difficultyTier * 16 + Math.floor(rand() * 20) + qIdx * 4;
      const rewardSummary = `${xp} XP · ${coins} Coins`;
      const rewardSummaryAr = `${xp} خبرة · ${coins} عملة`;

      let title = '';
      let titleAr = '';
      let description = '';
      let descriptionAr = '';
      let turnInNpcId = giver.id;
      const objectives: QuestObjectiveDef[] = [];

      const roleItems = ROLE_PREFERRED_ITEMS[giver.role] ?? [];
      const combinedItemPool = [...roleItems, ...itemsPool];

      if (mechanic === 'collect') {
        const preferred = combinedItemPool[qIdx % combinedItemPool.length];
        const item = resolveValidatedResourceItem(village, preferred, combinedItemPool);
        const qty = 2 + difficultyTier + Math.floor(rand() * 2);

        if (giver.role === 'blacksmith' || giver.role === 'miner') {
          title = `${village.name} Forge Supply: ${item.en}`;
          titleAr = `إمداد حدادة ${villageNameAr}: ${item.ar}`;
          description = `${giver.name} needs ${qty} ${item.en} to keep the ${village.name} forge running and tools repaired.`;
          descriptionAr = `يحتاج ${giver.nameAr} إلى ${qty} من ${item.ar} لتشغيل حدادة ${villageNameAr} وإصلاح الأدوات.`;
        } else if (giver.role === 'farmer') {
          title = `${village.name} Harvest: ${item.en}`;
          titleAr = `محصول ${villageNameAr}: ${item.ar}`;
          description = `${giver.name} asked for ${qty} ${item.en} from around ${village.name} to support the village farms.`;
          descriptionAr = `طلب ${giver.nameAr} جمع ${qty} من ${item.ar} حول ${villageNameAr} لدعم مزارع القرية.`;
        } else if (giver.role === 'healer') {
          title = `Remedies for ${village.name}: ${item.en}`;
          titleAr = `علاج لأهل ${villageNameAr}: ${item.ar}`;
          description = `${giver.name} is preparing salves in ${village.name} and needs ${qty} ${item.en}.`;
          descriptionAr = `يُجهّز ${giver.nameAr} علاجات لأهل ${villageNameAr} ويحتاج إلى ${qty} من ${item.ar}.`;
        } else {
          title = `${village.name} Supplies: ${item.en}`;
          titleAr = `إمدادات ${villageNameAr}: ${item.ar}`;
          description = `${giver.name} needs ${qty} ${item.en} gathered near ${village.name} to restock village stores.`;
          descriptionAr = `يحتاج ${giver.nameAr} إلى جمع ${qty} من ${item.ar} قرب ${villageNameAr} لدعم مخازن القرية.`;
        }

        objectives.push({
          id: `${questId}-collect`,
          type: 'collect_items',
          description: `Gather ${qty} ${item.en}`,
          descriptionAr: `اجمع ${qty} ${item.ar}`,
          itemId: item.id,
          requiredCount: qty,
          consumeOnComplete: true,
        });
      } else if (mechanic === 'kill' || mechanic === 'hunt') {
        const isWildlifeHunt = mechanic === 'hunt';
        const killCount = isWildlifeHunt
          ? 2 + (difficultyTier >= 3 ? 1 : 0)
          : 1 + difficultyTier + Math.floor(rand() * 2);

        const spawnAnchor = findValidQuestTargetPoint(village.centerX, village.centerZ, {
          minRadius: Math.max(42, village.clearanceRadius + 10),
          maxRadius: 145,
          outsideVillage: true,
          isVillageClearance: (tx, tz) =>
            Math.hypot(tx - village.centerX, tz - village.centerZ) < Math.max(28, village.clearanceRadius + 4),
        });
        if (!validateQuestTargetLocation(spawnAnchor.x, spawnAnchor.z, { outsideVillage: true })) {
          const safe = findNearestValidLand(village.centerX + 58, village.centerZ, 4, 0.32, 180);
          spawnAnchor.x = safe.x;
          spawnAnchor.z = safe.z;
        }

        if (isWildlifeHunt) {
          const huntTarget =
            archetype === 'forest' || archetype === 'mountain' || archetype === 'valley'
              ? { enemyType: 'animal:wolf', en: 'Wild Wolves', ar: 'الذئاب البرية' }
              : { enemyType: 'animal:boar', en: 'Wild Boars', ar: 'الخنازير البرية' };
          title = `Hunt Near ${village.name}: ${huntTarget.en}`;
          titleAr = `صيد قرب ${villageNameAr}: ${huntTarget.ar}`;
          description = `${giver.name} tracked ${huntTarget.en} prowling near ${village.name}. Hunt ${killCount} and report back.`;
          descriptionAr = `رصد ${giver.nameAr} ${huntTarget.ar} تتجول قرب ${villageNameAr}. اصطد ${killCount} منها ثم عُد لإبلاغه.`;
          objectives.push({
            id: `${questId}-hunt`,
            type: 'kill_enemies',
            description: `Hunt ${killCount} ${huntTarget.en}`,
            descriptionAr: `اصطد ${killCount} من ${huntTarget.ar}`,
            enemyType: huntTarget.enemyType,
            requiredCount: killCount,
            targetX: Math.round(spawnAnchor.x),
            targetZ: Math.round(spawnAnchor.z),
          });
        } else {
          if (giver.role === 'guard') {
            title = `Clear Roads of ${village.name}`;
            titleAr = `تأمين طرق ${villageNameAr}`;
            description = `${giver.name} spotted ${enemyRef.en} ambushing travelers near ${village.name}. Defeat ${killCount} to secure the road.`;
            descriptionAr = `رصد ${giver.nameAr} ${enemyRef.ar} يهددون المسافرين قرب ${villageNameAr}. اهزم ${killCount} منهم لتأمين الطريق.`;
          } else if (giver.role === 'blacksmith') {
            title = `Recover Stolen Iron near ${village.name}`;
            titleAr = `استعادة معدات ${villageNameAr}`;
            description = `${enemyRef.en} raided a supply cart outside ${village.name}. Defeat ${killCount} of them for ${giver.name}.`;
            descriptionAr = `أغار ${enemyRef.ar} على عربة إمدادات خارج ${villageNameAr}. اهزم ${killCount} منهم لمساعدة ${giver.nameAr}.`;
          } else if (giver.role === 'farmer') {
            title = `Protect ${village.name} Fields`;
            titleAr = `حماية حقول ${villageNameAr}`;
            description = `${enemyRef.en} have been encroaching on the fields of ${village.name}. Drive back ${killCount} of them.`;
            descriptionAr = `اقترب ${enemyRef.ar} من حقول ${villageNameAr}. اطرد ${killCount} منهم لحماية المحاصيل.`;
          } else {
            title = `Defend ${village.name}`;
            titleAr = `حماية ${villageNameAr}`;
            description = `Drive back ${killCount} ${enemyRef.en} threatening the outskirts of ${village.name}, then report back to ${giver.name}.`;
            descriptionAr = `اقضِ على ${killCount} من ${enemyRef.ar} المتربصين قرب أطراف ${villageNameAr} ثم عُد لإبلاغ ${giver.nameAr}.`;
          }
          objectives.push({
            id: `${questId}-kill`,
            type: 'kill_enemies',
            description: `Defeat ${killCount} ${enemyRef.en}`,
            descriptionAr: `اهزم ${killCount} من ${enemyRef.ar}`,
            enemyType: enemyRef.enemyType,
            requiredCount: killCount,
            targetX: Math.round(spawnAnchor.x),
            targetZ: Math.round(spawnAnchor.z),
          });
        }
      } else if (mechanic === 'deliver') {
        const preferred = combinedItemPool[(qIdx + 1) % combinedItemPool.length];
        const item = resolveValidatedResourceItem(village, preferred, combinedItemPool);
        const qty = 2 + (difficultyTier >= 2 ? 1 : 0);
        const recipient =
          sortedGivers.find((n) => n.id !== giver.id && n.role !== 'guard') ??
          sortedGivers.find((n) => n.id !== giver.id) ??
          giver;
        turnInNpcId = recipient.id;
        title = `Delivery for ${village.name}`;
        titleAr = `توصيل إمدادات في ${villageNameAr}`;
        description = `${giver.name} needs ${qty} ${item.en} gathered and delivered safely to ${recipient.name} in ${village.name}.`;
        descriptionAr = `طلب ${giver.nameAr} جمع ${qty} من ${item.ar} وتسليمها إلى ${recipient.nameAr} في ${villageNameAr}.`;
        objectives.push({
          id: `${questId}-deliver`,
          type: 'deliver_items',
          description: `Deliver ${qty} ${item.en} to ${recipient.name}`,
          descriptionAr: `سلّم ${qty} ${item.ar} إلى ${recipient.nameAr}`,
          itemId: item.id,
          requiredCount: qty,
          targetNpcId: recipient.id,
          consumeOnComplete: true,
        });
      } else if (mechanic === 'scout') {
        const targetPt = pickReachPointNearVillage(village, rand);
        const outpostName = `${village.name} Outskirts`;
        const outpostNameAr = `أطراف ${villageNameAr}`;
        if (giver.role === 'elder') {
          title = `Investigate Near ${village.name}`;
          titleAr = `التحقيق قرب ${villageNameAr}`;
          description = `${giver.name} heard reports of strange activity near (${targetPt.x}, ${targetPt.z}) outside ${village.name}. Scout the area and report back.`;
          descriptionAr = `سمع ${giver.nameAr} عن نشاط مريب قرب (${targetPt.x}, ${targetPt.z}) خارج ${villageNameAr}. استطلع المكان ثم عُد لإبلاغه.`;
        } else {
          title = `Patrol ${village.name} Perimeter`;
          titleAr = `دورية محيط ${villageNameAr}`;
          description = `Scout the perimeter trail at (${targetPt.x}, ${targetPt.z}) outside ${village.name} and report back to ${giver.name}.`;
          descriptionAr = `تفقد المسار عند الإحداثيات (${targetPt.x}, ${targetPt.z}) خارج ${villageNameAr} ثم عُد لإبلاغ ${giver.nameAr}.`;
        }
        objectives.push(
          {
            id: `${questId}-reach`,
            type: 'reach_location',
            description: `Investigate ${outpostName}`,
            descriptionAr: `استكشف ${outpostNameAr}`,
            x: targetPt.x,
            z: targetPt.z,
            radius: 18,
            locationName: outpostName,
          },
          {
            id: `${questId}-report`,
            type: 'talk_to_npc',
            description: `Report back to ${giver.name}`,
            descriptionAr: `قدّم تقريرك إلى ${giver.nameAr}`,
            npcId: giver.id,
          },
        );
      } else {
        // Craft essentials suited to role
        const craftRef =
          giver.role === 'healer'
            ? CRAFT_TARGETS[3]
            : giver.role === 'innkeeper'
              ? CRAFT_TARGETS[2]
              : giver.role === 'blacksmith' || giver.role === 'hunter'
                ? CRAFT_TARGETS[0]
                : CRAFT_TARGETS[qIdx % CRAFT_TARGETS.length];
        const qty = 1 + (craftRef.itemId === 'arrow' ? 1 : 0);
        title = `Craft for ${village.name}: ${craftRef.en}`;
        titleAr = `صناعة لـ ${villageNameAr}: ${craftRef.ar}`;
        description = `${giver.name} asked you to craft ${qty} ${craftRef.en} from your crafting menu and report back in ${village.name}.`;
        descriptionAr = `طلب منك ${giver.nameAr} صناعة ${qty} من ${craftRef.ar} عبر قائمة الصناعة ثم العودة إليه في ${villageNameAr}.`;
        objectives.push({
          id: `${questId}-craft`,
          type: 'craft_item',
          description: `Craft ${qty} ${craftRef.en}`,
          descriptionAr: `اصنع ${qty} ${craftRef.ar}`,
          itemId: craftRef.itemId,
          requiredCount: qty,
        });
      }

      // Gate follow-up quests in the village pool behind completing the village's first quest
      // so villages have natural progression rather than flooding every villager at once.
      const prerequisites =
        qIdx >= 3 && firstQuestIdInVillage ? [firstQuestIdInVillage] : undefined;

      const questDef: QuestDefinition = {
        id: questId,
        title,
        titleAr,
        giverNpcId: giver.id,
        turnInNpcId,
        description,
        descriptionAr,
        sequential: true,
        ...(prerequisites ? { prerequisites } : {}),
        objectives,
        reward: {
          xp,
          coins,
          stamina: 25,
        },
        rewardSummary,
        rewardSummaryAr,
      };

      registerProceduralQuest(questDef);
      totalQuests++;

      const giverBucket = questsByGiver.get(giver.id) ?? [];
      giverBucket.push(questDef);
      questsByGiver.set(giver.id, giverBucket);
      touchedNpcIds.add(giver.id);

      const turnInBucket = questsByTurnIn.get(turnInNpcId) ?? [];
      turnInBucket.push(questDef);
      questsByTurnIn.set(turnInNpcId, turnInBucket);
      touchedNpcIds.add(turnInNpcId);
    }

    // Build and register dialogue trees for every quest-giving or turn-in NPC in this village
    for (const npcId of touchedNpcIds) {
      const npc = npcById.get(npcId);
      if (!npc) continue;
      const trees = buildNpcQuestDialogueTrees(
        npc,
        village.name,
        villageNameAr,
        questsByGiver.get(npcId) ?? [],
        questsByTurnIn.get(npcId) ?? [],
      );
      registerProceduralDialogueTree(trees.en, trees.ar);
      totalDialogues++;
    }
  }

  return { questCount: totalQuests, dialogueTreeCount: totalDialogues };
}

