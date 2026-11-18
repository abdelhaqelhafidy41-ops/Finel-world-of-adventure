import type {
  SideQuestDef,
  SideQuestNpcDef,
  SideQuestNpcDirectoryEntry,
} from './sideQuestTypes';

/**
 * Specialized optional Side Quest NPCs integrated cleanly into NPCManager.
 * They never replace existing Oakhollow or regional villagers.
 */
export const SIDE_QUEST_NPCS: SideQuestNpcDef[] = [
  {
    npcId: 'npc-sq-captain-hal',
    nameEn: 'Captain Hal',
    nameAr: 'القائد هال',
    role: 'guard',
    titleEn: 'Outpost Marshal',
    titleAr: 'قائد الحرس الحدودي',
    personalityEn:
      'Alert, duty-bound captain who patrols Oakhollow East Gate and coordinates roadside rescues and bandit bounties.',
    personalityAr:
      'قائد حازم ومخلص يتفقد البوابة الشرقية لأوكهولو وينسق عمليات الإنقاذ وملاحقة قطاع الطرق.',
    locationEn: 'Oakhollow East Gate',
    locationAr: 'البوابة الشرقية لأوكهولو',
    anchor: { kind: 'village', villageId: 'oakhollow', offsetX: 19, offsetZ: 3 },
    greetingsEn: {
      morning: 'Morning, adventurer. Keep your eyes on the eastern trade road.',
      midday: 'Another caravan ran late today—stay sharp beyond the gates.',
      evening: 'Lanterns go up at dusk. Bandits prefer the shadows between trees.',
      night: 'Watch your step after dark, traveler. Reports keep pouring in.',
    },
    greetingsAr: {
      morning: 'صباح الخير أيها المغامر. راقب طريق التجارة الشرقي جيدًا.',
      midday: 'تأخرت قافلة أخرى اليوم — كن حذرًا خارج البوابات.',
      evening: 'تُضاء الفوانيس عند الغسق. قطاع الطرق يفضلون ظلال الأشجار.',
      night: 'احترس في الظلام أيها المسافر، البلاغات لا تتوقف.',
    },
    questIds: ['sq-missing-merchant', 'sq-bandit-bounty'],
  },
  {
    npcId: 'npc-sq-tariq',
    nameEn: 'Tariq the Caravaner',
    nameAr: 'طارق القافلي',
    role: 'traveling_merchant',
    titleEn: 'Seasoned Trader',
    titleAr: 'تاجر قوافل متمرس',
    personalityEn:
      'Resourceful merchant rescued from roadside bandits. Knows every hidden ledger and trade warehouse across the valley.',
    personalityAr:
      'تاجر داهية تم إنقاذه من قطاع الطرق، يعرف خبايا الدفاتر التجارية والمستودعات المخفية في الوادي.',
    locationEn: 'Oakhollow Market Arch',
    locationAr: 'ساحة تجار أوكهولو',
    anchor: { kind: 'village', villageId: 'oakhollow', offsetX: 12, offsetZ: -6 },
    greetingsEn: {
      morning: 'Thanks to you I still walk these roads with both boots on!',
      midday: 'Trade binds Oakhollow to Grandcross—though secrets travel the same trail.',
      evening: 'Balancing ledgers by lantern light is safer than dodging bandits.',
      night: 'Even at midnight, a clever merchant keeps one eye on his crates.',
    },
    greetingsAr: {
      morning: 'بفضلك ما زلت أمشي في هذه الطرق سالمًا معافى!',
      midday: 'التجارة تربط أوكهولو بغراند كروس، لكن الأسرار تسلك الدرب نفسه.',
      evening: 'مراجعة السجلات على ضوء الفانوس أكثر أمانًا من مواجهة قطاع الطرق.',
      night: 'حتى عند منتصف الليل، يراقب التاجر الفطن بضائعه بعين يقظة.',
    },
    questIds: ['sq-merchant-secret', 'sq-hidden-warehouse', 'sq-old-debt'],
    unlockWhenQuestCompleted: 'sq-missing-merchant',
  },
  {
    npcId: 'npc-sq-nadia',
    nameEn: 'Nadia the Cartographer',
    nameAr: 'نادية الرسّامة',
    role: 'villager',
    titleEn: 'Highland Surveyor',
    titleAr: 'رسّامة خرائط المرتفعات',
    personalityEn:
      'Curious field cartographer who charts high watchtowers, glowing beacons, and mountain caverns.',
    personalityAr:
      'مستكشفة ورسّامة خرائط شغوفة ترسم أبراج المراقبة والكهوف الجبلية والمنارات الليلية.',
    locationEn: 'Ridge Watchtower Approach',
    locationAr: 'سفح برج مراقبة التلال',
    anchor: { kind: 'location', locationId: 'loc-ridge-watchtower', offsetX: -12, offsetZ: 10 },
    greetingsEn: {
      morning: 'Clear air on the ridge makes every cairn and cave stand out.',
      midday: 'My ink dries fast up here! Care to help survey the northern crags?',
      evening: 'When dusk falls, a lit watchtower can guide travelers miles away.',
      night: 'Look up—the northern ridge beacons shine brightest after sunset.',
    },
    greetingsAr: {
      morning: 'الهواء الصافي فوق التلال يكشف كل معلم وكهف بوضوح.',
      midday: 'حبر خرائطي يجف سريعًا هنا! هل تود المساعدة في مسح القمم الشمالية؟',
      evening: 'عند حلول المساء، يرشد برج المراقبة المضاء المسافرين من أميال.',
      night: 'انظر للأعلى — منارات التلال تلمع بأبهى صورها بعد الغروب.',
    },
    questIds: ['sq-starlight-beacon', 'sq-echoes-in-cavern'],
  },
];

/**
 * Metadata directory for both specialized side-quest NPCs and existing village NPCs
 * who offer optional side quests.
 */
export const SIDE_QUEST_NPC_DIRECTORY: Record<string, SideQuestNpcDirectoryEntry> = {
  'npc-sq-captain-hal': {
    npcId: 'npc-sq-captain-hal',
    nameEn: 'Captain Hal',
    nameAr: 'القائد هال',
    roleEn: 'Outpost Marshal',
    roleAr: 'قائد الحرس الحدودي',
    locationEn: 'Oakhollow East Gate',
    locationAr: 'البوابة الشرقية لأوكهولو',
    personalityEn: 'Duty-bound guard captain',
    personalityAr: 'قائد حرس يقظ ومخلص',
  },
  'npc-sq-tariq': {
    npcId: 'npc-sq-tariq',
    nameEn: 'Tariq the Caravaner',
    nameAr: 'طارق القافلي',
    roleEn: 'Seasoned Trader',
    roleAr: 'تاجر قوافل متمرس',
    locationEn: 'Oakhollow Market Arch',
    locationAr: 'ساحة تجار أوكهولو',
    personalityEn: 'Shrewd caravan merchant',
    personalityAr: 'تاجر قوافل ذكي',
  },
  'npc-sq-nadia': {
    npcId: 'npc-sq-nadia',
    nameEn: 'Nadia the Cartographer',
    nameAr: 'نادية الرسّامة',
    roleEn: 'Highland Surveyor',
    roleAr: 'رسّامة خرائط المرتفعات',
    locationEn: 'Ridge Watchtower',
    locationAr: 'برج مراقبة التلال',
    personalityEn: 'Fearless mountain surveyor',
    personalityAr: 'رسّامة خرائط جريئة',
  },
  'npc-garrick': {
    npcId: 'npc-garrick',
    nameEn: 'Garrick',
    nameAr: 'غاريك',
    roleEn: 'Oakhollow Gate Guard',
    roleAr: 'حارس بوابة أوكهولو',
    locationEn: 'Oakhollow North Gate',
    locationAr: 'بوابة أوكهولو الشمالية',
    personalityEn: 'Vigilant village defender',
    personalityAr: 'حارس متيقظ يدافع عن القرية',
  },
  'npc-bram': {
    npcId: 'npc-bram',
    nameEn: 'Bram',
    nameAr: 'برام',
    roleEn: 'Sunstone Baker',
    roleAr: 'خبّاز حجر الشمس',
    locationEn: 'Oakhollow Bakery',
    locationAr: 'مخبز أوكهولو',
    personalityEn: 'Generous village baker',
    personalityAr: 'خباز كريم في القرية',
  },
  'npc-lyra': {
    npcId: 'npc-lyra',
    nameEn: 'Lyra',
    nameAr: 'ليرا',
    roleEn: 'Village Herbalist',
    roleAr: 'عشّابة القرية',
    locationEn: 'Oakhollow Apothecary',
    locationAr: 'عطارة أوكهولو',
    personalityEn: 'Gentle botanical healer',
    personalityAr: 'معالجة لطيفة بالأعشاب',
  },
  'npc-toby': {
    npcId: 'npc-toby',
    nameEn: 'Toby',
    nameAr: 'توبي',
    roleEn: 'Oakhollow Farmer',
    roleAr: 'مزارع أوكهولو',
    locationEn: 'Oakhollow Farmstead',
    locationAr: 'مزرعة أوكهولو',
    personalityEn: 'Hardworking grain farmer',
    personalityAr: 'مزارع مجتهد وطيب القلب',
  },
  'npc-doran': {
    npcId: 'npc-doran',
    nameEn: 'Doran',
    nameAr: 'دوران',
    roleEn: 'Master Blacksmith',
    roleAr: 'الحدّاد الخبير',
    locationEn: 'Oakhollow Forge',
    locationAr: 'حدادة أوكهولو',
    personalityEn: 'Gruff craftsman',
    personalityAr: 'حداد ماهر وصريح',
  },
  'npc-pinehaven-healer-2': {
    npcId: 'npc-pinehaven-healer-2',
    nameEn: 'Pinehaven Healer',
    nameAr: 'معالجة باينهافن',
    roleEn: 'Village Healer',
    roleAr: 'معالجة القرية',
    locationEn: 'Pinehaven Infirmary',
    locationAr: 'عيادة باينهافن',
    personalityEn: 'Dedicated woodland medic',
    personalityAr: 'معالجة متفانية في الغابة',
  },
  'npc-grandcross-merchant-0': {
    npcId: 'npc-grandcross-merchant-0',
    nameEn: 'Grandcross Trade Master',
    nameAr: 'كبير تجار غراند كروس',
    roleEn: 'Market Guildmaster',
    roleAr: 'كبير نقابة التجار',
    locationEn: 'Grandcross Bazaar',
    locationAr: 'سوق غراند كروس',
    personalityEn: 'Strict but fair guild merchant',
    personalityAr: 'تاجر منصف وحريص على العهود',
  },
};

/**
 * Complete data-driven Side Quest catalog across all 6 categories:
 * rescue, delivery, hunting, gathering, exploration, village.
 */
export const SIDE_QUESTS: SideQuestDef[] = [
  // =========================================================================
  // CHAIN 1 (4-Part Story Chain): "The Missing Merchant" -> Secret -> Warehouse -> Old Debt
  // =========================================================================
  {
    sideQuestId: 'sq-missing-merchant',
    title: 'The Missing Merchant',
    titleAr: 'التاجر المفقود',
    description:
      'Captain Hal worries a supply caravan vanished near the Forest Camp. Speak with Gate Guard Garrick, inspect the eastern road ambush, recover the stolen supply crate, defeat the bandits, rescue Merchant Tariq, and escort him back to Captain Hal.',
    descriptionAr:
      'يشعر القائد هال بالقلق بعد اختفاء قافلة إمدادات قرب معسكر الغابة. تحدّث مع الحارس غاريك، تفقّد موقع الكمين على الطريق، استعد صندوق البضائع المسروق، اهزم قطاع الطرق، أنقذ التاجر طارق ورافقه عائدًا إلى القائد هال.',
    category: 'rescue',
    giverNpcId: 'npc-sq-captain-hal',
    turnInNpcId: 'npc-sq-captain-hal',
    location: 'Oakhollow East Gate & Forest Camp',
    locationAr: 'البوابة الشرقية ومعسكر الغابة',
    chainId: 'merchant-chain',
    chainOrder: 1,
    chainTitleEn: "The Caravaner's Mystery (Part 1/4)",
    chainTitleAr: 'لغز القافلة (الجزء 1/4)',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: true,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-mm-talk-guard',
        type: 'talk_to_npc',
        descriptionEn: 'Speak with Gate Guard Garrick at Oakhollow North Gate',
        descriptionAr: 'تحدّث مع الحارس غاريك عند بوابة أوكهولو الشمالية',
        requiredCount: 1,
        npcId: 'npc-garrick',
        markerRole: 'npc',
      },
      {
        id: 'sq-mm-reach-ambush',
        type: 'reach_location',
        descriptionEn: 'Travel to the Forest Camp ambush clearing',
        descriptionAr: 'توجّه إلى موقع الكمين قرب معسكر الغابة',
        requiredCount: 1,
        locationId: 'loc-forest-camp',
        radius: 26,
        markerRole: 'investigation',
      },
      {
        id: 'sq-mm-find-crate',
        type: 'find_item',
        descriptionEn: "Find the merchant's stolen supply crate",
        descriptionAr: 'اعثر على صندوق بضائع التاجر المسروق',
        requiredCount: 1,
        itemId: 'stolen-merchant-crate',
        consumeOnComplete: true,
        markerRole: 'investigation',
        localSpawn: {
          id: 'sq-crate-missing-merchant',
          kind: 'pickup',
          labelEn: "Merchant's Supply Crate",
          labelAr: 'صندوق بضائع التاجر',
          itemId: 'stolen-merchant-crate',
          count: 1,
          anchor: { kind: 'location', locationId: 'loc-forest-camp', offsetX: 8, offsetZ: -6 },
        },
      },
      {
        id: 'sq-mm-defeat-bandits',
        type: 'defeat_bandit',
        descriptionEn: 'Defeat the bandits guarding the ambush camp (2)',
        descriptionAr: 'اهزم قطاع الطرق الذين يحرسون موقع الكمين (2)',
        requiredCount: 2,
        enemyType: 'bandit_scout',
        locationId: 'loc-forest-camp',
        markerRole: 'enemy',
      },
      {
        id: 'sq-mm-rescue-merchant',
        type: 'rescue_npc',
        descriptionEn: 'Free Tariq the trapped merchant at the camp',
        descriptionAr: 'حرّر التاجر المحتجز طارق في المعسكر',
        requiredCount: 1,
        npcId: 'sq-captive-tariq',
        locationId: 'loc-forest-camp',
        markerRole: 'npc',
        localSpawn: {
          id: 'sq-captive-tariq',
          kind: 'rescue_npc',
          labelEn: 'Tariq (Captive Merchant)',
          labelAr: 'طارق (التاجر المحتجز)',
          anchor: { kind: 'location', locationId: 'loc-forest-camp', offsetX: -7, offsetZ: 9 },
        },
      },
      {
        id: 'sq-mm-escort-return',
        type: 'escort_npc',
        descriptionEn: 'Escort Tariq safely back to Captain Hal at Oakhollow East Gate',
        descriptionAr: 'رافق طارق بأمان عائدًا إلى القائد هال عند بوابة أوكهولو الشرقية',
        requiredCount: 1,
        escortNpcId: 'npc-sq-tariq',
        escortTargetAnchor: { kind: 'npc', npcId: 'npc-sq-captain-hal' },
        npcId: 'npc-sq-captain-hal',
        radius: 18,
        markerRole: 'escort',
      },
    ],
    requiredObjectives: [
      'sq-mm-talk-guard',
      'sq-mm-reach-ambush',
      'sq-mm-find-crate',
      'sq-mm-defeat-bandits',
      'sq-mm-rescue-merchant',
      'sq-mm-escort-return',
    ],
    rewards: {
      xp: 140,
      coins: 85,
      reputation: 25,
      items: [{ id: 'hearth-loaf', count: 2 }],
      summaryEn: '140 XP, 85 Coins, +25 Reputation & 2 Hearth Loaves',
      summaryAr: '140 خبرة، 85 عملة، +25 سمعة، و2 رغيف حجر الشمس',
      unlockFlag: 'sq:merchant_rescued',
    },
    dialogue: {
      introEn: [
        'One of our supply merchants vanished on the forest road before dawn. My patrol cannot leave the gate.',
        'Check in with Garrick first to confirm where the cart was last seen, then recover the supplies and bring Tariq home.',
      ],
      introAr: [
        'اختفى أحد تجار القوافل على طريق الغابة قبل الفجر، ولا تستطيع دوريتي ترك البوابة.',
        'اسأل الحارس غاريك أولًا عن آخر موقع شوهدت فيه العربة، ثم استعد البضائع وأعد طارق سالمًا.',
      ],
      acceptReplyEn: 'Thank you! Start with Garrick near the north gate—time matters.',
      acceptReplyAr: 'شكرًا لك! ابدأ بسؤال غاريك عند البوابة الشمالية — الوقت ثمين.',
      declineReplyEn: 'Understood. Come back if you change your mind before dusk.',
      declineReplyAr: 'أتفهم ذلك. عد إليّ إذا قررت المساعدة قبل المساء.',
      progressEn: [
        'Make sure you grab his stolen supply crate, clear those bandits out, and walk Tariq back safely.',
      ],
      progressAr: [
        'تأكد من استعادة صندوق بضائعه المسروق وتطهير المكان من اللصوص ومرافقته إلى البوابة.',
      ],
      turnInEn: [
        'Tariq made it back in one piece, and his crate is intact! Oakhollow owes you a round tonight.',
        'He says he has something confidential to discuss once he catches his breath at the Market Arch.',
      ],
      turnInAr: [
        'عاد طارق سالمًا وصندوق بضائعه سليم! مدينة أوكهولو مدينة لك بالفضل الليلة.',
        'يقول إن لديه أمرًا سريًا يريد مناقشته معك حالما يلتقط أنفاسه في ساحة التجار.',
      ],
      followUpEn: 'Good work on the forest road—Tariq has settled near the market stalls.',
      followUpAr: 'عمل بطولي على طريق الغابة — استقر طارق الآن قرب ساحة التجار.',
    },
  },
  {
    sideQuestId: 'sq-merchant-secret',
    title: "The Merchant's Secret",
    titleAr: 'سر التاجر',
    description:
      'Tariq confides that his convoy carried a sealed trade ledger naming crooked smuggler contacts. Question Baker Bram about suspicious night deliveries, gather iron & coal to force the rusted strongbox lock, and return the sealed ledger to Tariq.',
    descriptionAr:
      'يبوح لك طارق بأن قافلته كانت تحمل سجلًا تجاريًا مختومًا يكشف المتواطئين مع اللصوص. استفسر من الخباز برام، واجمع الحديد والفحم لفتح الصندوق الحديدي، ثم سلّم السجل المختوم لطارق.',
    category: 'village',
    giverNpcId: 'npc-sq-tariq',
    turnInNpcId: 'npc-sq-tariq',
    location: 'Oakhollow Market & Bakery',
    locationAr: 'ساحة أوكهولو والمخبز',
    chainId: 'merchant-chain',
    chainOrder: 2,
    chainTitleEn: "The Caravaner's Mystery (Part 2/4)",
    chainTitleAr: 'لغز القافلة (الجزء 2/4)',
    prerequisites: ['sq-missing-merchant'],
    requiredLevel: 1,
    state: 'LOCKED',
    sequential: true,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-ms-talk-bram',
        type: 'talk_to_npc',
        descriptionEn: 'Question Baker Bram about late-night wagon sightings',
        descriptionAr: 'استفسر من الخباز برام عن العربات المشبوهة ليلاً',
        requiredCount: 1,
        npcId: 'npc-bram',
        markerRole: 'npc',
      },
      {
        id: 'sq-ms-gather-materials',
        type: 'collect_resource',
        descriptionEn: 'Collect Iron Ore (2) to forge a lockpick prybar',
        descriptionAr: 'اجمع خام الحديد (2) لصنع عتلة فتح الصندوق',
        requiredCount: 2,
        itemId: 'iron-ore',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
      {
        id: 'sq-ms-find-ledger',
        type: 'find_item',
        descriptionEn: 'Recover the Sealed Trade Ledger near Hunter Camp',
        descriptionAr: 'استعد سجل التجارة المختوم قرب معسكر الصيادين',
        requiredCount: 1,
        itemId: 'sealed-trade-ledger',
        consumeOnComplete: false,
        markerRole: 'investigation',
        localSpawn: {
          id: 'sq-ledger-secret',
          kind: 'pickup',
          labelEn: 'Sealed Trade Ledger',
          labelAr: 'سجل التجارة المختوم',
          itemId: 'sealed-trade-ledger',
          count: 1,
          anchor: { kind: 'location', locationId: 'loc-hunter-camp', offsetX: 6, offsetZ: 5 },
        },
      },
    ],
    requiredObjectives: ['sq-ms-talk-bram', 'sq-ms-gather-materials', 'sq-ms-find-ledger'],
    rewards: {
      xp: 125,
      coins: 75,
      reputation: 20,
      items: [{ id: 'apothecary-tonic', count: 1 }],
      summaryEn: '125 XP, 75 Coins, +20 Reputation & Apothecary Tonic',
      summaryAr: '125 خبرة، 75 عملة، +20 سمعة، وإكسير الحيوية',
    },
    dialogue: {
      introEn: [
        'Between us, those bandits were not random highwaymen—someone inside the valley tipped them off!',
        'Ask Bram what wagons passed his ovens last night, grab two Iron Ore to pry the cache open, and fetch my sealed trade ledger.',
      ],
      introAr: [
        'بيننا فقط، أولئك اللصوص لم يهاجموني صدفة — هناك من يخبرهم بمواعيد القوافل!',
        'اسأل برام عن العربات التي مرت قرب المخبز ليلاً، وأحضر قطعتين من خام الحديد لاستعادة السجل التجاري المختوم.',
      ],
      acceptReplyEn: 'Keep it quiet! Start with Bram—he hears every wheel before sunrise.',
      acceptReplyAr: 'احتفظ بالأمر سرًا! ابدأ بسؤال برام عند المخبز.',
      declineReplyEn: 'Take your time, friend. The ledger can wait a little longer.',
      declineReplyAr: 'خذ وقتك يا صديقي، لكن السجل يزداد خطورة كل يوم.',
      progressEn: [
        'Any luck talking with Bram or tracking down the sealed trade ledger near Hunter Camp?',
      ],
      progressAr: [
        'هل تحدثت مع برام أو عثرت على السجل المختوم قرب معسكر الصيادين؟',
      ],
      turnInEn: [
        'Look at these inked tallies... They have been stashing stolen Oakhollow cargo at an abandoned cabin in the woods!',
      ],
      turnInAr: [
        'انظر إلى هذه الأختام بالحبر الأسود... إنهم يخبئون البضائع المسروقة في كوخ مهجور داخل الغابة!',
      ],
      followUpEn: 'Every ink mark in this ledger points straight toward their forest hideout.',
      followUpAr: 'كل علامة في هذا السجل تشير بوضوح إلى مستودعهم الخفي في الغابة.',
    },
  },
  {
    sideQuestId: 'sq-hidden-warehouse',
    title: 'The Hidden Warehouse',
    titleAr: 'المستودع الخفي',
    description:
      'Using clues from the sealed ledger, storm the smugglers’ stash near the Abandoned Cabin, defeat 3 bandit lookouts, and deliver the seized manifest to Captain Hal.',
    descriptionAr:
      'استنادًا إلى أدلة السجل المختوم، داهم مخبأ المهربين قرب الكوخ المهجور، واهزم 3 من حراس قطاع الطرق، وأبلغ القائد هال بالنتائج.',
    category: 'exploration',
    giverNpcId: 'npc-sq-tariq',
    turnInNpcId: 'npc-sq-captain-hal',
    location: 'Abandoned Cabin',
    locationAr: 'الكوخ المهجور',
    chainId: 'merchant-chain',
    chainOrder: 3,
    chainTitleEn: "The Caravaner's Mystery (Part 3/4)",
    chainTitleAr: 'لغز القافلة (الجزء 3/4)',
    prerequisites: ['sq-merchant-secret'],
    requiredLevel: 2,
    state: 'LOCKED',
    sequential: true,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-hw-explore-cabin',
        type: 'explore_location',
        descriptionEn: 'Scout the Abandoned Cabin hideout',
        descriptionAr: 'استكشف الكوخ المهجور في الغابة',
        requiredCount: 1,
        locationId: 'loc-abandoned-cabin',
        radius: 26,
        markerRole: 'location',
      },
      {
        id: 'sq-hw-clear-bandits',
        type: 'defeat_bandit',
        descriptionEn: 'Defeat the smuggler guards at the cabin (3)',
        descriptionAr: 'اهزم حراس المهربين عند الكوخ (3)',
        requiredCount: 3,
        enemyType: 'bandit_scout',
        locationId: 'loc-abandoned-cabin',
        markerRole: 'enemy',
      },
      {
        id: 'sq-hw-reach-hal',
        type: 'talk_to_npc',
        descriptionEn: 'Report the smuggler warehouse to Captain Hal',
        descriptionAr: 'قدّم التقرير للقائد هال عند البوابة الشرقية',
        requiredCount: 1,
        npcId: 'npc-sq-captain-hal',
        markerRole: 'npc',
      },
    ],
    requiredObjectives: ['sq-hw-explore-cabin', 'sq-hw-clear-bandits', 'sq-hw-reach-hal'],
    rewards: {
      xp: 165,
      coins: 110,
      reputation: 30,
      items: [{ id: 'steel-sword', count: 1 }],
      summaryEn: '165 XP, 110 Coins, +30 Reputation & Steel Sword',
      summaryAr: '165 خبرة، 110 عملات، +30 سمعة، وسيف فولاذي',
    },
    dialogue: {
      introEn: [
        'The ledger names the Abandoned Cabin west-north of Oakhollow as their secret depot.',
        'Clear out their guards and take the seized proof directly to Captain Hal.',
      ],
      introAr: [
        'يشير السجل إلى الكوخ المهجور بوصفه المستودع السري للمهربين.',
        'اقضِ على الحراس هناك وقدّم الدليل مباشرة إلى القائد هال.',
      ],
      acceptReplyEn: 'Watch the treeline—three armed lookouts usually camp outside.',
      acceptReplyAr: 'راقب حافة الأشجار جيدًا — عادة ما يحرس المكان ثلاثة مسلحين.',
      declineReplyEn: 'Sharpen your blade first if you need to—they will be heavily armed.',
      declineReplyAr: 'اشحذ سلاحك أولًا إن أردت، فالمكان محروس جيدًا.',
      progressEn: [
        'Sweep the Abandoned Cabin perimeter and bring word straight to Captain Hal.',
      ],
      progressAr: [
        'طهّر محيط الكوخ المهجور وأبلغ القائد هال فور انتهائك.',
      ],
      turnInEn: [
        'Three smugglers down and an entire illicit depot shut tight! My guards are securing the crates now.',
        'This finely balanced Steel Sword belongs in your scabbard.',
      ],
      turnInAr: [
        'تم القضاء على المهربين وإغلاق وكرهم بالكامل! يتولى حراسي تأمين الصناديق الآن.',
        'هذا السيف الفولاذي المتين يليق بمقاتل مثلك.',
      ],
      followUpEn: 'With that warehouse cleared, caravan routes across the valley are breathing easy again.',
      followUpAr: 'بعد إغلاق ذلك المستودع، عادت طرق القوافل في الوادي إلى أمانها.',
    },
  },
  {
    sideQuestId: 'sq-old-debt',
    title: 'An Old Debt',
    titleAr: 'دَين قديم',
    description:
      'Now that the smugglers are routed, Tariq asks you to deliver the Sealed Trade Ledger personally to the Grandcross Trade Master to settle an old guild debt.',
    descriptionAr:
      'بعد هزيمة المهربين، يطلب منك طارق توصيل السجل التجاري المختوم شخصيًا إلى كبير تجار غراند كروس لتسوية دين نقابي قديم.',
    category: 'delivery',
    giverNpcId: 'npc-sq-tariq',
    turnInNpcId: 'npc-grandcross-merchant-0',
    location: 'Grandcross Bazaar',
    locationAr: 'سوق غراند كروس',
    chainId: 'merchant-chain',
    chainOrder: 4,
    chainTitleEn: "The Caravaner's Mystery (Finale 4/4)",
    chainTitleAr: 'لغز القافلة (الختام 4/4)',
    prerequisites: ['sq-hidden-warehouse'],
    requiredLevel: 2,
    state: 'LOCKED',
    sequential: true,
    repeatable: false,
    expirationHours: null,
    availability: {
      requiredVillages: ['grandcross'],
    },
    objectives: [
      {
        id: 'sq-od-deliver-ledger',
        type: 'deliver_item',
        descriptionEn: 'Deliver the Sealed Trade Ledger to Grandcross Trade Master',
        descriptionAr: 'سلّم سجل التجارة المختوم إلى كبير تجار غراند كروس',
        requiredCount: 1,
        itemId: 'sealed-trade-ledger',
        npcId: 'npc-grandcross-merchant-0',
        consumeOnComplete: true,
        markerRole: 'npc',
      },
    ],
    requiredObjectives: ['sq-od-deliver-ledger'],
    rewards: {
      xp: 200,
      coins: 150,
      reputation: 40,
      items: [{ id: 'frontier-badge-cloak', count: 1 }],
      summaryEn: "200 XP, 150 Coins, +40 Reputation & Wayfarer's Mantle",
      summaryAr: '200 خبرة، 150 عملة، +40 سمعة، وعباءة الرحالة المطرزة',
    },
    dialogue: {
      introEn: [
        'Grandcross owes me three caravans worth of ink and trust. Since you discovered Grandcross on your travels, take this ledger to the Trade Master.',
      ],
      introAr: [
        'لي في غراند كروس حقّ قديم وثقة تجارية معلقة. وبما أنك وصلت إلى غراند كروس، خذ هذا السجل إلى كبير التجار هناك.',
      ],
      acceptReplyEn: 'Safe roads to Grandcross, my friend! They will honor our seal.',
      acceptReplyAr: 'طريقًا آمنًا إلى غراند كروس يا صديقي! سيحترمون ختمنا حتمًا.',
      declineReplyEn: 'Whenever you ride north toward Grandcross, stop by.',
      declineReplyAr: 'متى ما شددت الرحال نحو غراند كروس مرّ عليّ.',
      progressEn: [
        'Hand the Sealed Trade Ledger directly to the Trade Master at Grandcross Bazaar.',
      ],
      progressAr: [
        'سلّم سجل التجارة المختوم مباشرة لكبير التجار في سوق غراند كروس.',
      ],
      turnInEn: [
        'Tariq’s missing ledger! By the guild charter, this clears every dispute on the frontier.',
        'Wear this Wayfarer’s Embroidered Mantle with honor across every road in the valley.',
      ],
      turnInAr: [
        'هذا سجل طارق المفقود! بموجب ميثاق التجار، تنتهي كل الخلافات على الطريق التجاري.',
        'ارتدِ عباءة الرحالة المطرزة هذه بفخر في جميع أرجاء الوادي.',
      ],
      followUpEn: 'Our trade guild will remember your name whenever caravans roll south.',
      followUpAr: 'ستتذكر نقابة التجار اسمك بالخير كلما انطلقت القوافل جنوبًا.',
    },
  },

  // =========================================================================
  // TIMED DELIVERY SIDE QUEST
  // =========================================================================
  {
    sideQuestId: 'sq-bakery-rush',
    title: 'Hot Loaves for Pinehaven',
    titleAr: 'أرغفة ساخنة إلى باينهافن',
    description:
      'Bram baked a fresh batch of Sunstone Hearth Loaves for the injured woodcutters at Pinehaven. Carry 2 loaves to the Pinehaven Healer within 24 in-game hours before they grow cold!',
    descriptionAr:
      'خبز برام دفعة طازجة من أرغفة حجر الشمس لإطعام المصابين في باينهافن. أوصل رغيفين إلى معالجة باينهافن خلال 24 ساعة قبل أن تبرد!',
    category: 'delivery',
    giverNpcId: 'npc-bram',
    turnInNpcId: 'npc-pinehaven-healer-2',
    location: 'Oakhollow Bakery → Pinehaven',
    locationAr: 'مخبز أوكهولو ← باينهافن',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: true,
    repeatable: false,
    expirationHours: 24,
    objectives: [
      {
        id: 'sq-br-prepare-loaves',
        type: 'collect_resource',
        descriptionEn: 'Obtain or craft 2 Sunstone Hearth Loaves',
        descriptionAr: 'أحضر أو اصنع 2 رغيف فرن حجر الشمس',
        requiredCount: 2,
        itemId: 'hearth-loaf',
        markerRole: 'investigation',
      },
      {
        id: 'sq-br-deliver-pinehaven',
        type: 'deliver_item',
        descriptionEn: 'Deliver 2 loaves to the Pinehaven Healer before timer expires',
        descriptionAr: 'سلّم الرغيفين إلى معالجة باينهافن قبل نفاد الوقت',
        requiredCount: 2,
        itemId: 'hearth-loaf',
        npcId: 'npc-pinehaven-healer-2',
        consumeOnComplete: true,
        markerRole: 'npc',
      },
    ],
    requiredObjectives: ['sq-br-prepare-loaves', 'sq-br-deliver-pinehaven'],
    rewards: {
      xp: 95,
      coins: 55,
      reputation: 15,
      items: [{ id: 'sun-apple', count: 3 }],
      summaryEn: '95 XP, 55 Coins, +15 Reputation & 3 Valley Sun Apples',
      summaryAr: '95 خبرة، 55 عملة، +15 سمعة، و3 تفاحات شمس الوادي',
    },
    dialogue: {
      introEn: [
        'Pinehaven asked for warm Hearth Loaves for their clinic. Can you deliver two loaves before they cool down within the day?',
      ],
      introAr: [
        'طلبت عيادة باينهافن أرغفة دافئة للمرضى. هل تستطيع إيصال رغيفين قبل أن يبردا خلال 24 ساعة؟',
      ],
      acceptReplyEn: 'Hurry along the pine trail—24 in-game hours on the clock!',
      acceptReplyAr: 'أسرع عبر درب الصنوبر — أمامك 24 ساعة داخل اللعبة!',
      declineReplyEn: 'No worries, maybe next baking batch.',
      declineReplyAr: 'لا بأس، ربما مع الدفعة القادمة من الفرن.',
      progressEn: [
        'Pinehaven lies north-west through the timberline—the clinic healer is waiting!',
      ],
      progressAr: [
        'تقع باينهافن نحو الشمال الغربي في غابة الصنوبر — المعالجة بانتظارك!',
      ],
      turnInEn: [
        'Still warm from Bram’s hearth! Our patients will recover twice as fast tonight.',
      ],
      turnInAr: [
        'ما زالت دافئة من فرن برام! سيتعافى مرضانا بسرعة أكبر الليلة.',
      ],
      followUpEn: 'Thank you for keeping Oakhollow and Pinehaven connected.',
      followUpAr: 'شكرًا لك على مدّ يد العون بين أوكهولو وباينهافن.',
    },
  },

  // =========================================================================
  // TIME-OF-DAY GATHERING SIDE QUEST (Evening / Night Only Offer)
  // =========================================================================
  {
    sideQuestId: 'sq-herbalist-moonlight',
    title: 'Moonlit Remedies',
    titleAr: 'أعشاب ضوء القمر',
    description:
      'In the quiet of evening and night, Lyra distills dew-soaked meadow herbs and forest mushrooms into potent Moonlit Tonics.',
    descriptionAr:
      'في هدوء المساء والليل، تقطّر ليرا أعشاب المروج الندية وفطر الغابة لصنع ترياق ضوء القمر.',
    category: 'gathering',
    giverNpcId: 'npc-lyra',
    turnInNpcId: 'npc-lyra',
    location: 'Oakhollow Apothecary',
    locationAr: 'عطارة أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'LOCKED',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    availability: {
      timeWindow: 'night',
    },
    objectives: [
      {
        id: 'sq-hm-herbs',
        type: 'collect_resource',
        descriptionEn: 'Gather Meadow Herbs (3)',
        descriptionAr: 'اجمع أعشاب المروج (3)',
        requiredCount: 3,
        itemId: 'meadow-herb',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
      {
        id: 'sq-hm-mushrooms',
        type: 'collect_resource',
        descriptionEn: 'Gather Forest Mushrooms (2)',
        descriptionAr: 'اجمع فطر الغابة (2)',
        requiredCount: 2,
        itemId: 'mushroom',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-hm-herbs', 'sq-hm-mushrooms'],
    rewards: {
      xp: 110,
      coins: 50,
      reputation: 15,
      items: [{ id: 'nightshade-vial', count: 2 }],
      summaryEn: '110 XP, 50 Coins, +15 Reputation & 2 Moonlit Tonics',
      summaryAr: '110 خبرة، 50 عملة، +15 سمعة، و2 ترياق ضوء القمر',
    },
    dialogue: {
      introEn: [
        'Midnight dew brings out the strongest essence in Meadow Herbs and Forest Mushrooms. Bring me 3 herbs and 2 mushrooms!',
      ],
      introAr: [
        'ندى الليل يُخرج أقوى خلاصة من أعشاب المروج وفطر الغابة. أحضر لي 3 أعشاب و2 فطر!',
      ],
      acceptReplyEn: 'Wonderful—look near clearings and tree roots while the moon is up.',
      acceptReplyAr: 'رائع — ابحث قرب الفسحات وجذور الأشجار تحت ضوء القمر.',
      declineReplyEn: 'Come back another night if you feel like foraging.',
      declineReplyAr: 'عد إليّ في ليلة أخرى إذا رغبت في الجمع.',
      progressEn: [
        'Just 3 Meadow Herbs and 2 Mushrooms, and my alembic will do the rest.',
      ],
      progressAr: [
        'فقط 3 أعشاب مروج و2 فطر، وسيتكفل الإنبيق بالباقي.',
      ],
      turnInEn: [
        'Pure silver-green distillate! Take two Moonlit Tonics for dark trails ahead.',
      ],
      turnInAr: [
        'خلاصة فضية نقية! خذ زجاجتين من ترياق ضوء القمر لرحلاتك الليلية.',
      ],
      followUpEn: 'The night air holds wonders for those who look closely.',
      followUpAr: 'يحمل هواء الليل كنوزًا لمن يتأمله بعناية.',
    },
  },

  // =========================================================================
  // REPEATABLE VILLAGE / GATHERING SIDE QUEST
  // =========================================================================
  {
    sideQuestId: 'sq-barn-timber-repair',
    title: 'Mending the Mill Fence',
    titleAr: 'إصلاح سياج المزرعة',
    description:
      'Help Farmer Toby keep Oakhollow’s wheat plots safe by gathering timber and stone to repair the outer fence.',
    descriptionAr:
      'ساعد المزارع توبي في حماية حقول القمح عبر جمع الخشب والحجارة لإصلاح السياج الخارجي.',
    category: 'village',
    giverNpcId: 'npc-toby',
    turnInNpcId: 'npc-toby',
    location: 'Oakhollow Farmstead',
    locationAr: 'مزرعة أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: true,
    cooldownSeconds: 240,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-bt-wood',
        type: 'collect_resource',
        descriptionEn: 'Collect Wood (5)',
        descriptionAr: 'اجمع الخشب (5)',
        requiredCount: 5,
        itemId: 'wood',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
      {
        id: 'sq-bt-stone',
        type: 'collect_resource',
        descriptionEn: 'Collect Stone (3)',
        descriptionAr: 'اجمع الحجر (3)',
        requiredCount: 3,
        itemId: 'stone',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-bt-wood', 'sq-bt-stone'],
    rewards: {
      xp: 70,
      coins: 40,
      reputation: 10,
      items: [{ id: 'wheat', count: 4 }],
      summaryEn: '70 XP, 40 Coins, +10 Reputation & 4 Golden Wheat (Repeatable)',
      summaryAr: '70 خبرة، 40 عملة، +10 سمعة، و4 قمح ذهبي (قابلة للتكرار)',
    },
    dialogue: {
      introEn: [
        'Stray wolves knocked down two more fence posts last night! Can you spare 5 Wood and 3 Stone?',
      ],
      introAr: [
        'حطمت الذئاب جزءًا من السياج الليلة الماضية! هل يمكنك جمع 5 خشب و3 حجر لإصلاحه؟',
      ],
      acceptReplyEn: 'Bless you! Stack the timber right by the mill whenever you have it.',
      acceptReplyAr: 'بارك الله فيك! أحضر الأخشاب والحجارة متى جهزت.',
      declineReplyEn: 'Understandable—plenty of other chores around the valley.',
      declineReplyAr: 'لا بأس، أعلم أن لديك الكثير من المهام في الوادي.',
      progressEn: [
        'Still need 5 Wood and 3 Stone to brace these fence rails.',
      ],
      progressAr: [
        'ما زلت أحتاج إلى 5 خشب و3 حجر لتثبيت أعمدة السياج.',
      ],
      turnInEn: [
        'Solid as oak! Here is your coin plus fresh Golden Wheat from the bin.',
      ],
      turnInAr: [
        'متين كجذع البلوط! تفضل أتعابك مع حزم القمح الذهبي الطازج.',
      ],
      followUpEn: 'That fence will hold back half a pack of wolves now!',
      followUpAr: 'سيصمد هذا السياج أمام قطيع كامل الآن!',
    },
  },

  // =========================================================================
  // LEVEL-GATED GATHERING / CRAFTING ORDER
  // =========================================================================
  {
    sideQuestId: 'sq-iron-forge-order',
    title: 'Furnace Stockpile',
    titleAr: 'مخزون الكور الحديدي',
    description:
      'Blacksmith Doran needs high-grade Iron Ore and Coal from rocky veins to keep Oakhollow’s guards outfitted.',
    descriptionAr:
      'يحتاج الحدّاد دوران إلى خام الحديد والفحم من العروق الصخرية لتزويد حراس أوكهولو بالعدة.',
    category: 'gathering',
    giverNpcId: 'npc-doran',
    turnInNpcId: 'npc-doran',
    location: 'Oakhollow Forge',
    locationAr: 'حدادة أوكهولو',
    prerequisites: [],
    requiredLevel: 2,
    state: 'LOCKED',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-if-ore',
        type: 'collect_resource',
        descriptionEn: 'Gather Iron Ore (4)',
        descriptionAr: 'اجمع خام الحديد (4)',
        requiredCount: 4,
        itemId: 'iron-ore',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
      {
        id: 'sq-if-coal',
        type: 'collect_resource',
        descriptionEn: 'Gather Coal (3)',
        descriptionAr: 'اجمع الفحم (3)',
        requiredCount: 3,
        itemId: 'coal',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-if-ore', 'sq-if-coal'],
    rewards: {
      xp: 120,
      coins: 70,
      reputation: 15,
      items: [{ id: 'iron-sword', count: 1 }],
      summaryEn: '120 XP, 70 Coins, +15 Reputation & Iron Sword',
      summaryAr: '120 خبرة، 70 عملة، +15 سمعة، وسيف حديدي',
    },
    dialogue: {
      introEn: [
        'You have grown seasoned enough to chip rocky seams safely. Bring 4 Iron Ore and 3 Coal and I will forge you an Iron Sword.',
      ],
      introAr: [
        'أصبحت الآن خبيرًا بما يكفي للتنقيب في الصخور. أحضر 4 خام حديد و3 فحم وسأصنع لك سيفًا حديديًا.',
      ],
      acceptReplyEn: 'Check the foothills north and east for gleaming iron seams.',
      acceptReplyAr: 'ابحث في السفوح الصخرية شمالاً وشرقًا عن عروق الحديد والفحم.',
      declineReplyEn: 'My anvil stays hot whenever you want real steel.',
      declineReplyAr: 'سنداني مشتعل دائمًا متى رغبت في الحدادة.',
      progressEn: [
        'Four Iron Ore and three Coal—no shortcuts at the forge.',
      ],
      progressAr: [
        'أربع قطع خام حديد وثلاث من الفحم — الجودة تتطلب الصبر.',
      ],
      turnInEn: [
        'Fine ore! Ring the anvil—this Iron Sword is balanced to a hair.',
      ],
      turnInAr: [
        'خام ممتاز! خذ هذا السيف الحديدي المتوازن بإتقان.',
      ],
      followUpEn: 'Keep that blade oiled and nothing in the hills will slow you down.',
      followUpAr: 'حافظ على لمعان هذا النصل ولن يقف في طريقك شيء.',
    },
  },

  // =========================================================================
  // REPEATABLE HUNTING SIDE QUESTS (Wildlife + Bandits)
  // =========================================================================
  {
    sideQuestId: 'sq-wolves-at-pasture',
    title: 'Wolves Near the Orchard',
    titleAr: 'ذئاب عند البستان',
    description:
      'Drive back wild wolves prowling outside Oakhollow’s pastures so livestock and farmers remain safe.',
    descriptionAr:
      'أبعد الذئاب البرية التي تحوم قرب مزارع أوكهولو لحماية المواشي والمزارعين.',
    category: 'hunting',
    giverNpcId: 'npc-garrick',
    turnInNpcId: 'npc-garrick',
    location: 'Oakhollow Outskirts',
    locationAr: 'ضواحي أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: true,
    cooldownSeconds: 240,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-wp-hunt-wolves',
        type: 'defeat_enemy',
        descriptionEn: 'Defeat prowling Wolves (3)',
        descriptionAr: 'اصطد أو ابعد الذئاب المتجولة (3)',
        requiredCount: 3,
        enemyType: 'animal:wolf',
        anchor: { kind: 'village', villageId: 'oakhollow', offsetX: -48, offsetZ: 36 },
        markerRole: 'enemy',
      },
    ],
    requiredObjectives: ['sq-wp-hunt-wolves'],
    rewards: {
      xp: 90,
      coins: 55,
      reputation: 15,
      items: [{ id: 'cooked-meat', count: 2 }],
      summaryEn: '90 XP, 55 Coins, +15 Reputation & 2 Cooked Meat (Repeatable)',
      summaryAr: '90 خبرة، 55 عملة، +15 سمعة، و2 لحم مطهو (قابلة للتكرار)',
    },
    dialogue: {
      introEn: [
        'Hungry packs have crept closer to the western pasture. Thin their numbers by three wolves and we will pay a bounty.',
      ],
      introAr: [
        'اقتربت الذئاب الجائعة من المراعي الغربية. اقضِ على ثلاثة منها ولك مكافأة من الحامية.',
      ],
      acceptReplyEn: 'Stay alert—wolves circle before they lunge.',
      acceptReplyAr: 'ابقَ يقظًا — فالذئاب تطوّق فريستها قبل الانقضاض.',
      declineReplyEn: 'I will keep watch from the gate in the meantime.',
      declineReplyAr: 'سأواصل المراقبة من البوابة في غضون ذلك.',
      progressEn: [
        'Check the pine fringe west of Oakhollow for wolves.',
      ],
      progressAr: [
        'تفقد أطراف الغابة غرب أوكهولو للعثور على الذئاب.',
      ],
      turnInEn: [
        'Pastures are calm again! Take your coin and hot rations.',
      ],
      turnInAr: [
        'عادت المراعي هادئة بفضلك! تفضل مكافأتك وطعامًا ساخنًا.',
      ],
      followUpEn: 'Check back later if another pack wanders down from the ridge.',
      followUpAr: 'تفقّد البوابة لاحقًا إن ظهرت ذئاب جديدة من المرتفعات.',
    },
  },
  {
    sideQuestId: 'sq-bandit-bounty',
    title: 'Frontier Bandit Bounty',
    titleAr: 'مكافأة قطاع الطرق',
    description:
      'Captain Hal posts a standing bounty for clearing roaming Bandit Scouts from the valley roads.',
    descriptionAr:
      'يعلن القائد هال عن مكافأة دائمة لتطهير طرق الوادي من كشّافة قطاع الطرق.',
    category: 'hunting',
    giverNpcId: 'npc-sq-captain-hal',
    turnInNpcId: 'npc-sq-captain-hal',
    location: 'Valley Trade Roads',
    locationAr: 'طرق التجارة في الوادي',
    prerequisites: [],
    requiredLevel: 2,
    state: 'LOCKED',
    sequential: false,
    repeatable: true,
    cooldownSeconds: 300,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-bb-kill-bandits',
        type: 'defeat_bandit',
        descriptionEn: 'Defeat Frontier Bandits (4)',
        descriptionAr: 'اهزم قطاع الطرق على الطرق (4)',
        requiredCount: 4,
        enemyType: 'bandit_scout',
        locationId: 'loc-forest-camp',
        markerRole: 'enemy',
      },
    ],
    requiredObjectives: ['sq-bb-kill-bandits'],
    rewards: {
      xp: 135,
      coins: 95,
      reputation: 25,
      items: [{ id: 'arrow', count: 14 }],
      summaryEn: '135 XP, 95 Coins, +25 Reputation & 14 Arrows (Repeatable)',
      summaryAr: '135 خبرة، 95 عملة، +25 سمعة، و14 سهمًا (قابلة للتكرار)',
    },
    dialogue: {
      introEn: [
        'We have a standing garrison bounty: clear four Bandit Scouts off the roads and collect crisp silver plus fresh arrows.',
      ],
      introAr: [
        'لدينا مكافأة مفتوحة من الحامية: اقضِ على أربعة من قطاع الطرق واحصل على عملات ذهبية وسهام إضافية.',
      ],
      acceptReplyEn: 'Bounty contract stamped. Watch your flanks around camps!',
      acceptReplyAr: 'تم توثيق العقد! انتبه لمحيطك عند الاقتراب من مخيماتهم.',
      declineReplyEn: 'The board stays open whenever you want extra work.',
      declineReplyAr: 'تبقى المكافأة متاحة متى أردت قبول التحدي.',
      progressEn: [
        'Clear out four bandit scouts anywhere along the forest camps and trails.',
      ],
      progressAr: [
        'اهزم أربعة من قطاع الطرق على طول طرق الغابة ومخيماتهم.',
      ],
      turnInEn: [
        'Confirmed by our scouts—four raiders neutralized! Here is your garrison payout.',
      ],
      turnInAr: [
        'تم تأكيد القضاء على اللصوص الأربعة! تفضل مكافأة الحامية.',
      ],
      followUpEn: 'The valley roads breathe easier whenever you patrol.',
      followUpAr: 'تستعيد طرق الوادي أمانها في كل مرة تخرج فيها للدورية.',
    },
  },

  // =========================================================================
  // EXPLORATION CHAIN (Ridge Watchtower -> Echoing Cave)
  // =========================================================================
  {
    sideQuestId: 'sq-starlight-beacon',
    title: 'Lanterns on the Ridge',
    titleAr: 'فوانيس التل الشمالي',
    description:
      'Cartographer Nadia is surveying the northern Ridge Watchtower. Explore the watchtower crest and bring 2 Torches so night travelers can spot the highland pass.',
    descriptionAr:
      'تعمل الرسّامة نادية على مسح برج مراقبة التلال الشمالي. استكشف قمة البرج وأحضر مشعلين لتوجيه المسافرين ليلاً.',
    category: 'exploration',
    giverNpcId: 'npc-sq-nadia',
    turnInNpcId: 'npc-sq-nadia',
    location: 'Ridge Watchtower',
    locationAr: 'برج مراقبة التلال',
    chainId: 'survey-chain',
    chainOrder: 1,
    chainTitleEn: 'Highland Survey (Part 1/2)',
    chainTitleAr: 'مسح المرتفعات (الجزء 1/2)',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-sb-explore-tower',
        type: 'explore_location',
        descriptionEn: 'Explore the Ridge Watchtower overlook',
        descriptionAr: 'استكشف قمة برج مراقبة التلال',
        requiredCount: 1,
        locationId: 'loc-ridge-watchtower',
        radius: 26,
        markerRole: 'location',
      },
      {
        id: 'sq-sb-bring-torches',
        type: 'collect_resource',
        descriptionEn: 'Craft or collect 2 Torches for the beacon',
        descriptionAr: 'اصنع أو أحضر 2 مشعل لإضاءة المنارة',
        requiredCount: 2,
        itemId: 'torch',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-sb-explore-tower', 'sq-sb-bring-torches'],
    rewards: {
      xp: 120,
      coins: 65,
      reputation: 20,
      items: [{ id: 'trail-boots', count: 1 }],
      summaryEn: "120 XP, 65 Coins, +20 Reputation & Scout's Trail Boots",
      summaryAr: '120 خبرة، 65 عملة، +20 سمعة، وحذاء الكشاف الجلدي',
    },
    dialogue: {
      introEn: [
        'I am mapping the old Ridge Watchtower! Inspect the tower overlook and bring 2 Torches to relight its signal basket.',
      ],
      introAr: [
        'أقوم برسم خرائط برج مراقبة التلال! استكشف موقع البرج وأحضر مشعلين لإعادة إضاءة إشارته.',
      ],
      acceptReplyEn: 'Marvelous! You can craft torches with Wood and Coal anytime.',
      acceptReplyAr: 'رائع! يمكنك صناعة المشاعل من الخشب والفحم في أي وقت.',
      declineReplyEn: 'Stop by again if the mountain breeze calls to you.',
      declineReplyAr: 'تفضل بزيارتي مجددًا متى استهوتك نسائم الجبال.',
      progressEn: [
        'Just survey the watchtower rim and bring two sturdy Torches.',
      ],
      progressAr: [
        'استكشف حافة برج المراقبة وأحضر مشعلين متوهجين.',
      ],
      turnInEn: [
        'That beacon flame can be spotted all the way from Oakhollow Square! Take these spare Trail Boots.',
      ],
      turnInAr: [
        'يمكن رؤية شعلة هذا البرج من ساحة أوكهولو! خذ حذاء الكشاف هذا لمساعدتك في الترحال.',
      ],
      followUpEn: 'Now I have my sights set on a echoing cavern deeper in the ridge...',
      followUpAr: 'الآن أضع عيني على كهف غامض يتردد فيه الصدى في عمق الجبل...',
    },
  },
  {
    sideQuestId: 'sq-echoes-in-cavern',
    title: 'Echoes in the Cavern',
    titleAr: 'أصداء في الكهف',
    description:
      'Nadia detected crystal tremors inside the Echoing Cave. Explore the cavern mouth, defeat 3 Stone Sentinels or Ancient Monsters, and bring back 2 Sunstone Crystals.',
    descriptionAr:
      'رصدت نادية اهتزازات بلورية داخل الكهف المدوّي. استكشف مدخل الكهف، واهزم 3 من حراس الحجر، وأحضر بلورتين من حجر الشمس.',
    category: 'exploration',
    giverNpcId: 'npc-sq-nadia',
    turnInNpcId: 'npc-sq-nadia',
    location: 'Echoing Cave',
    locationAr: 'الكهف المدوّي',
    chainId: 'survey-chain',
    chainOrder: 2,
    chainTitleEn: 'Highland Survey (Part 2/2)',
    chainTitleAr: 'مسح المرتفعات (الجزء 2/2)',
    prerequisites: ['sq-starlight-beacon'],
    requiredLevel: 2,
    state: 'LOCKED',
    sequential: true,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-ec-explore-cave',
        type: 'explore_location',
        descriptionEn: 'Explore the Echoing Cave entrance',
        descriptionAr: 'استكشف مدخل الكهف المدوّي',
        requiredCount: 1,
        locationId: 'loc-echoing-cave',
        radius: 26,
        markerRole: 'location',
      },
      {
        id: 'sq-ec-defeat-sentinels',
        type: 'defeat_enemy',
        descriptionEn: 'Defeat Stone Sentinels guarding the cave (3)',
        descriptionAr: 'اهزم حراس الحجر حول الكهف (3)',
        requiredCount: 3,
        enemyType: 'stone_sentinel',
        locationId: 'loc-echoing-cave',
        markerRole: 'enemy',
      },
      {
        id: 'sq-ec-collect-crystals',
        type: 'collect_resource',
        descriptionEn: 'Bring Sunstone Crystals (2)',
        descriptionAr: 'أحضر بلورات حجر الشمس (2)',
        requiredCount: 2,
        itemId: 'rare-mineral',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-ec-explore-cave', 'sq-ec-defeat-sentinels', 'sq-ec-collect-crystals'],
    rewards: {
      xp: 185,
      coins: 120,
      reputation: 35,
      items: [{ id: 'crossbow', count: 1 }],
      summaryEn: '185 XP, 120 Coins, +35 Reputation & Steel Crossbow',
      summaryAr: '185 خبرة، 120 عملة، +35 سمعة، وقوس نشاب فولاذي',
    },
    dialogue: {
      introEn: [
        'Strange resonant humming echoes from the cavern below! Map the Echoing Cave, clear three Stone Sentinels, and sample 2 Sunstone Crystals.',
      ],
      introAr: [
        'أصوات رنين غريبة تتردد من الكهف الجبلي! استكشف الكهف المدوّي واهزم 3 من حراس الحجر وأحضر بلورتين من حجر الشمس.',
      ],
      acceptReplyEn: 'Bring sturdy gear—Stone Sentinels hit like boulders.',
      acceptReplyAr: 'احمل عتادًا متينًا — ضربات حراس الحجر ساحقة.',
      declineReplyEn: 'Wait until you are well-stocked before braving the cavern.',
      declineReplyAr: 'تجهّز جيدًا أولاً قبل خوض غمار الكهف.',
      progressEn: [
        'Echoing Cave lies among the rocky ridges—watch out for stone constructs.',
      ],
      progressAr: [
        'يقع الكهف المدوّي وسط القمم الصخرية — احذر من الحراس الحجريين.',
      ],
      turnInEn: [
        'Luminous samples! These crystals finish my entire northern geological chart. This Steel Crossbow is yours!',
      ],
      turnInAr: [
        'عينات متوهجة مذهلة! تكمل هذه البلورات خريطتي الجيولوجية للمرتفعات. قوس النشاب الفولاذي هذا هدية لك!',
      ],
      followUpEn: 'Every crag on my map now bears a note thanking your expedition.',
      followUpAr: 'كل قمة في خريطتي باتت تحمل ملاحظة تشيد بمساعدتك.',
    },
  },

  // =========================================================================
  // RESCUE & PROTECT MEDIC SUPPLY QUEST
  // =========================================================================
  {
    sideQuestId: 'sq-rescue-herbal-scout',
    title: 'Stranded Apprentice',
    titleAr: 'المتدربة العالقة',
    description:
      'Lyra’s apprentice Mira went searching for wild blooms near Hunter Camp and got cornered by Thorn Stalkers. Drive off the beasts, free Mira, and report back to Lyra.',
    descriptionAr:
      'ذهبت تلميذة ليرا لجمع الأزهار البرية قرب معسكر الصيادين وحاصرتها الوحوش الشوكية. اهزم المهاجمين وحرّر ميرا وعد لإبلاغ ليرا.',
    category: 'rescue',
    giverNpcId: 'npc-lyra',
    turnInNpcId: 'npc-lyra',
    location: 'Hunter Camp Woods',
    locationAr: 'غابة معسكر الصيادين',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: true,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-rhs-defeat-stalkers',
        type: 'defeat_enemy',
        descriptionEn: 'Drive off Thorn Stalkers at Hunter Camp (2)',
        descriptionAr: 'اهزم الوحوش الشوكية عند معسكر الصيادين (2)',
        requiredCount: 2,
        enemyType: 'thorn_stalker',
        locationId: 'loc-hunter-camp',
        markerRole: 'enemy',
      },
      {
        id: 'sq-rhs-free-mira',
        type: 'rescue_npc',
        descriptionEn: 'Rescue Apprentice Mira at Hunter Camp',
        descriptionAr: 'أنقذ المتدربة ميرا عند معسكر الصيادين',
        requiredCount: 1,
        npcId: 'sq-captive-mira',
        locationId: 'loc-hunter-camp',
        markerRole: 'npc',
        localSpawn: {
          id: 'sq-captive-mira',
          kind: 'rescue_npc',
          labelEn: 'Mira (Herbalist Apprentice)',
          labelAr: 'ميرا (متدربة العشّابة)',
          anchor: { kind: 'location', locationId: 'loc-hunter-camp', offsetX: -8, offsetZ: -5 },
        },
      },
    ],
    requiredObjectives: ['sq-rhs-defeat-stalkers', 'sq-rhs-free-mira'],
    rewards: {
      xp: 115,
      coins: 60,
      reputation: 20,
      items: [
        { id: 'apothecary-tonic', count: 2 },
        { id: 'meadow-herb', count: 3 },
      ],
      summaryEn: '115 XP, 60 Coins, +20 Reputation & 2 Tonics',
      summaryAr: '115 خبرة، 60 عملة، +20 سمعة، و2 إكسير حيوية',
    },
    dialogue: {
      introEn: [
        'My young apprentice Mira has not returned from Hunter Camp! Thorn Stalkers have been spotted there—please clear them out and bring her to safety.',
      ],
      introAr: [
        'لم تعد تلميذتي ميرا من معسكر الصيادين! رُصدت وحوش شوكية هناك — أرجوك اهزمها وأنقذ ميرا!',
      ],
      acceptReplyEn: 'Thank goodness! Follow the trail southwest toward Hunter Camp.',
      acceptReplyAr: 'شكرًا لنجدتك! اتبع الدرب جنوب غرب نحو معسكر الصيادين.',
      declineReplyEn: 'Please reconsider soon—she is only carrying a foraging basket.',
      declineReplyAr: 'أعد النظر سريعًا — فهي لا تحمل سوى سلة أعشاب.',
      progressEn: [
        'Defeat those Thorn Stalkers at Hunter Camp and help Mira out of the thicket.',
      ],
      progressAr: [
        'اقضِ على الوحوش الشوكية في معسكر الصيادين وأخرج ميرا بأمان.',
      ],
      turnInEn: [
        'Mira returned safely without a single scratch! Please accept these fresh Vitality Tonics.',
      ],
      turnInAr: [
        'عادت ميرا سالمة دون أي خدش! تفضّل هذه القوارير من إكسير الحيوية تقديرًا لك.',
      ],
      followUpEn: 'Mira now stays close to the village planters—and speaks often of your courage.',
      followUpAr: 'تلتزم ميرا الآن بأحواض القرية وتذكر شجاعتك بكل امتنان.',
    },
  },

  // =========================================================================
  // BUILDING & HOMESTEAD EXPANSION SIDE QUESTS
  // =========================================================================
  {
    sideQuestId: 'sq-oakhollow-homestead',
    title: 'Pioneer Homestead',
    titleAr: 'مستوطنة الرائد',
    description:
      'Farmer Toby encourages you to establish a proper homestead outside Oakhollow’s core walls: place a Wooden Foundation and raise a Small Farm Plot nearby.',
    descriptionAr:
      'يشجعك المزارع توبي على تأسيس مزرعة خاصة خارج أسوار أوكهولو: ابنِ أساسًا خشبيًا وأقم حوض زراعة صغير بالقرب منه.',
    category: 'village',
    giverNpcId: 'npc-toby',
    turnInNpcId: 'npc-toby',
    location: 'Oakhollow Outskirts',
    locationAr: 'أطراف أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-oh-foundation',
        type: 'build_structure',
        descriptionEn: 'Construct a Wooden Foundation (Build Mode [B])',
        descriptionAr: 'ابنِ أساسًا خشبيًا (وضع البناء [B])',
        requiredCount: 1,
        buildingId: 'wood-foundation',
        markerRole: 'location',
      },
      {
        id: 'sq-oh-farm',
        type: 'build_structure',
        descriptionEn: 'Construct a Small Farm Plot',
        descriptionAr: 'ابنِ حوض زراعة صغير',
        requiredCount: 1,
        buildingId: 'small-farm-plot',
        markerRole: 'location',
      },
    ],
    requiredObjectives: ['sq-oh-foundation', 'sq-oh-farm'],
    rewards: {
      xp: 125,
      coins: 75,
      reputation: 20,
      items: [
        { id: 'planks', count: 8 },
        { id: 'wheat', count: 5 },
      ],
      summaryEn: '125 XP, 75 Coins, +20 Reputation, 8 Planks & 5 Wheat',
      summaryAr: '125 خبرة، 75 عملة، +20 سمعة، 8 ألواح خشب و5 قمح',
    },
    dialogue: {
      introEn: [
        'Oakhollow’s square is cozy, yet the open valley beyond the roads begs for fresh homesteads! Press [B] to open Build Mode—set down a Wooden Foundation and plant a Small Farm Plot out in the meadow.',
      ],
      introAr: [
        'ساحة أوكهولو دافئة، لكن السهول المفتوحة خارج الطرق تنتظر مستوطنات جديدة! افتح وضع البناء [B] وضع أساسًا خشبيًا وحوض زراعة صغير في المرج.',
      ],
      acceptReplyEn: 'Remember: build outside village roads and stone cottages so wagons can pass!',
      acceptReplyAr: 'تذكّر: ابنِ بعيدًا عن طرق القرية ومنازلها حتى تمر العربات بأمان!',
      declineReplyEn: 'Whenever you feel like raising timber on the hillside, let me know.',
      declineReplyAr: 'متى ما رغبت في البناء على التلال القريبة، أخبرني.',
      progressEn: [
        'Open Build Mode [B] outside the village core and place 1 Wooden Foundation plus 1 Small Farm Plot.',
      ],
      progressAr: [
        'افتح وضع البناء [B] خارج مركز القرية وضع أساسًا خشبيًا وحوض زراعة صغير.',
      ],
      turnInEn: [
        'Look at that fresh plot soaking up the valley sun! Take these extra Planks and seed Wheat to expand further.',
      ],
      turnInAr: [
        'يا له من موقع رائع تحت شمس الوادي! تفضل هذه الألواح وحبوب القمح لتوسيع مزرعتك.',
      ],
      followUpEn: 'Soon enough you will have a proper cabin and granary standing proud!',
      followUpAr: 'قريبًا سترتفع لك كوخة ومخزن حبوب تفتخر به في الوادي!',
    },
  },
  {
    sideQuestId: 'sq-frontier-workshop',
    title: 'Field Workshop & Vault',
    titleAr: 'ورشة الميدان والخزنة',
    description:
      'Blacksmith Doran advises any wandering builder to establish a field Workbench and a Storage Chest for expedition supplies.',
    descriptionAr:
      'ينصح الحدّاد دوران كل بنّاء متجول بتجهيز طاولة عمل ميدانية وصندوق تخزين لحفظ غنائم الرحلات.',
    category: 'village',
    giverNpcId: 'npc-doran',
    turnInNpcId: 'npc-doran',
    location: 'Oakhollow Outskirts',
    locationAr: 'أطراف أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-fw-workbench',
        type: 'build_structure',
        descriptionEn: 'Construct a Builder Workbench (Build Mode [B])',
        descriptionAr: 'ابنِ طاولة عمل ميدانية (وضع البناء [B])',
        requiredCount: 1,
        buildingId: 'build-workbench',
        markerRole: 'location',
      },
      {
        id: 'sq-fw-chest',
        type: 'build_structure',
        descriptionEn: 'Construct a Storage Chest',
        descriptionAr: 'ابنِ صندوق تخزين',
        requiredCount: 1,
        buildingId: 'wooden-chest',
        markerRole: 'location',
      },
    ],
    requiredObjectives: ['sq-fw-workbench', 'sq-fw-chest'],
    rewards: {
      xp: 140,
      coins: 85,
      reputation: 25,
      items: [
        { id: 'iron-ingot', count: 4 },
        { id: 'stone-brick', count: 6 },
      ],
      summaryEn: '140 XP, 85 Coins, +25 Reputation, 4 Iron Ingots & 6 Stone Bricks',
      summaryAr: '140 خبرة، 85 عملة، +25 سمعة، 4 سبائك حديد و6 طوب حجري',
    },
    dialogue: {
      introEn: [
        'A builder without a camp workbench and sturdy chest is always lugging heavy stone in his pack! Raise a Workbench and Storage Chest out in your camp.',
      ],
      introAr: [
        'البنّاء بلا طاولة عمل وصندوق متين سيرهق حقيبته بالحجارة! ابنِ طاولة عمل وصندوق تخزين في معسكرك.',
      ],
      acceptReplyEn: 'Set them beside your foundation—you can craft and stash loot right on site.',
      acceptReplyAr: 'ضعهما قرب أساسك لتتمكن من التصنيع وتخزين الموارد في الموقع.',
      declineReplyEn: 'My forge is always here if you prefer hauling ore back to town.',
      declineReplyAr: 'حدادتي مفتوحة دائمًا إن فضّلت حمل الخامات إلى القرية.',
      progressEn: [
        'Use Build Mode [B] to construct a Workbench and a Storage Chest.',
      ],
      progressAr: [
        'استخدم وضع البناء [B] لبناء طاولة عمل وصندوق تخزين.',
      ],
      turnInEn: [
        'Smart craft! Take these Iron Ingots and cut Stone Bricks to reinforce your stronghold.',
      ],
      turnInAr: [
        'عمل متقن! خذ سبائك الحديد والطوب الحجري لتقوية حصنك.',
      ],
      followUpEn: 'From timber shacks to stone keeps—you have the makings of a true master builder.',
      followUpAr: 'من الأكواخ الخشبية إلى القلاع الحجرية — أصبحت بحق بنّاءً محترفًا.',
    },
  },
  // =========================================================================
  // FARMING, LIVESTOCK & VILLAGE DEVELOPMENT OPTIONAL SIDE QUESTS
  // =========================================================================
  {
    sideQuestId: 'sq-oakhollow-seeds',
    title: 'First Harvest of the Valley',
    titleAr: 'أول حصاد في الوادي',
    description:
      'Farmer Toby encourages you to cultivate Crisp Carrots on your own farm plot. Plant carrot seeds, water the bed, and bring 3 Crisp Carrots to Toby.',
    descriptionAr:
      'يشجعك المزارع توبي على زراعة الجزر الطازج في حوضك الزراعي الخاص. ازرع بذور الجزر واسقِها ثم أحضر 3 حبات جزر إلى توبي.',
    category: 'village',
    giverNpcId: 'npc-toby',
    turnInNpcId: 'npc-toby',
    location: 'Oakhollow Farmstead',
    locationAr: 'مزرعة أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-os-carrots',
        type: 'collect_resource',
        descriptionEn: 'Harvest or gather 3 Crisp Carrots',
        descriptionAr: 'احصد أو اجمع 3 حبات جزر طازج',
        requiredCount: 3,
        itemId: 'carrot',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-os-carrots'],
    rewards: {
      xp: 95,
      coins: 50,
      reputation: 20,
      items: [
        { id: 'watering-can', count: 1 },
        { id: 'corn-seeds', count: 3 },
      ],
      summaryEn: '95 XP, 50 Coins, +20 Reputation, Watering Can & 3 Corn Seeds',
      summaryAr: '95 خبرة، 50 عملة، +20 سمعة، مرشة ماء و3 بذور ذرة',
    },
    dialogue: {
      introEn: [
        'Nothing beats the taste of your own valley-grown crop! Build a Small Farm Plot, till the soil, plant Carrot Seeds (check market stalls or wild flowers), and bring me 3 Crisp Carrots.',
      ],
      introAr: [
        'لا شيء يضاهي طعم محصول زرعته بيديك! ابنِ حوضًا زراعيًا صغيرًا، جهّز التربة، ازرع بذور الجزر وأحضر لي 3 حبات جزر طازج.',
      ],
      acceptReplyEn: 'Watering keeps sprouts happy—or wait for rain or place a Water Trough nearby!',
      acceptReplyAr: 'الري يسرّع النمو — كما أن المطر وحوض الماء يساعدان على إبقاء التربة رطبة!',
      declineReplyEn: 'No rush—my seed pouch stays ready whenever you want to try farming.',
      declineReplyAr: 'لا استعجال — البذور جاهزة متى ما أردت تجربة الزراعة.',
      progressEn: [
        'Bring 3 Crisp Carrots from your homestead plot or valley trade when they are ripe.',
      ],
      progressAr: [
        'أحضر 3 حبات جزر طازج عند نضج محصولك.',
      ],
      turnInEn: [
        'Crisp, sweet, and earthy! Take this Copper Watering Can and Sweet Corn Kernels for your next planting.',
      ],
      turnInAr: [
        'جزر طازج ولذيذ! خذ هذه المرشة النحاسية وبذور الذرة الحلوة لموسمك القادم.',
      ],
      followUpEn: 'Your green thumb is turning this valley into a true breadbasket.',
      followUpAr: 'أصبحت مزارعًا ماهرًا يعتمد عليه أهل الوادي.',
    },
  },
  {
    sideQuestId: 'sq-farm-livestock',
    title: 'Pasture & Dairy Hands',
    titleAr: 'خيرات الحظيرة والمراعي',
    description:
      'Baker Bram needs fresh Farm Eggs and Milk for festival loaves and artisan cheese. Tend village or homestead hens and cows and deliver 2 Eggs and 1 Fresh Milk.',
    descriptionAr:
      'يحتاج الخباز برام إلى البيض الطازج والحليب لصنع المخبوزات والجبن. تفقّد الدجاج والأبقار في القرية أو حظيرتك وأحضر بيضتين وحليبًا طازجًا.',
    category: 'village',
    giverNpcId: 'npc-bram',
    turnInNpcId: 'npc-bram',
    location: 'Oakhollow Bakery & Pastures',
    locationAr: 'مخبز ومراعي أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-fl-eggs',
        type: 'collect_resource',
        descriptionEn: 'Collect 2 Fresh Farm Eggs',
        descriptionAr: 'اجمع 2 بيض مزرعة طازج',
        requiredCount: 2,
        itemId: 'egg',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
      {
        id: 'sq-fl-milk',
        type: 'collect_resource',
        descriptionEn: 'Collect 1 Fresh Milk',
        descriptionAr: 'اجمع 1 حليب طازج',
        requiredCount: 1,
        itemId: 'milk',
        consumeOnComplete: true,
        markerRole: 'investigation',
      },
    ],
    requiredObjectives: ['sq-fl-eggs', 'sq-fl-milk'],
    rewards: {
      xp: 115,
      coins: 65,
      reputation: 25,
      items: [
        { id: 'animal-feed', count: 4 },
        { id: 'cheese', count: 2 },
      ],
      summaryEn: '115 XP, 65 Coins, +25 Reputation, 4 Animal Feed & 2 Artisan Cheese',
      summaryAr: '115 خبرة، 65 عملة، +25 سمعة، 4 علف حيوانات و2 جبن معتّق',
    },
    dialogue: {
      introEn: [
        'Hens and dairy cattle thrive near our farmstead—and if you raise your own Chicken Coop or Livestock Pen, you can tend them anytime! Bring me 2 Eggs and 1 Fresh Milk for the morning bake.',
      ],
      introAr: [
        'الدجاج والأبقار ترعى قرب مزرعتنا، ويمكنك أيضًا بناء قن دجاج أو حظيرة خاصة بك! أحضر لي بيضتين وحليبًا طازجًا لخبز الصباح.',
      ],
      acceptReplyEn: 'Feed animals grain or wheat to keep them producing fast and happy.',
      acceptReplyAr: 'إطعام الحيوانات بالحبوب أو القمح يسرّع إنتاجها ويجعلها أكثر سعادة.',
      declineReplyEn: 'The bakery ovens stay warm if you stop by later.',
      declineReplyAr: 'أفران المخبز مفتوحة متى ما رغبت بالمساعدة.',
      progressEn: [
        'Just 2 Farm Eggs and 1 Fresh Milk whenever you check the pens.',
      ],
      progressAr: [
        'أحضر فقط بيضتين وحليبًا طازجًا من الحظيرة.',
      ],
      turnInEn: [
        'Creamy milk and golden yolks! Here are your coins, Animal Feed, and two wheels of Artisan Cheese.',
      ],
      turnInAr: [
        'حليب نقي وبيض ذهبي! تفضل أتعابك مع علف للحيوانات وقطعتين من الجبن المعتّق.',
      ],
      followUpEn: 'With cheese and warm bread on the table, Oakhollow shines.',
      followUpAr: 'بوجود الجبن والخبز الساخن، تنعم أوكهولو بالخير والبركة.',
    },
  },
  {
    sideQuestId: 'sq-village-revival',
    title: 'Prosperous Homestead & Village',
    titleAr: 'ازدهار القرية والمزرعة',
    description:
      'Construct a Harvest Granary Shed or Livestock Pen to anchor your agricultural output, and inspect any Village Board to aid local repairs and development.',
    descriptionAr:
      'ابنِ مخزن حصاد أو حظيرة ماشية لتعزيز إنتاجك الزراعي، وتفقّد لوحة تطوير القرية للمساهمة في الترميم والمشاريع.',
    category: 'village',
    giverNpcId: 'npc-maren',
    turnInNpcId: 'npc-maren',
    location: 'Oakhollow Market Square',
    locationAr: 'سوق أوكهولو',
    prerequisites: [],
    requiredLevel: 1,
    state: 'AVAILABLE',
    sequential: false,
    repeatable: false,
    expirationHours: null,
    objectives: [
      {
        id: 'sq-vr-granary',
        type: 'build_structure',
        descriptionEn: 'Construct a Harvest Granary Shed (Build Mode [B])',
        descriptionAr: 'ابنِ مخزن الحصاد والبذور (وضع البناء [B])',
        requiredCount: 1,
        buildingId: 'farm-silo-shed',
        markerRole: 'location',
      },
    ],
    requiredObjectives: ['sq-vr-granary'],
    rewards: {
      xp: 145,
      coins: 95,
      reputation: 35,
      items: [
        { id: 'tomato-seeds', count: 3 },
        { id: 'potato-seeds', count: 3 },
      ],
      summaryEn: '145 XP, 95 Coins, +35 Reputation, Tomato & Potato Seeds',
      summaryAr: '145 خبرة، 95 عملة، +35 سمعة، وبذور الطماطم والبطاطس',
    },
    dialogue: {
      introEn: [
        'As farmers harvest more grain and build granaries, villages flourish and unlock new merchant goods! Build a Harvest Granary Shed and check the Village Notice Board near any market square.',
      ],
      introAr: [
        'كلما زاد الحصاد وبُنيت مخازن الحبوب، ازدهرت القرى وتوفرت سلع جديدة في السوق! ابنِ مخزن حصاد وتفقّد لوحة القرية قرب الساحة.',
      ],
      acceptReplyEn: 'Talk to me or any village merchant anytime to trade crops for coin!',
      acceptReplyAr: 'تحدّث معي أو مع أي تاجر لبيع محاصيلك مقابل العملات!',
      declineReplyEn: 'Trade waits whenever your granaries are ready.',
      declineReplyAr: 'التجارة في انتظارك متى ما أصبحت مستعدًا.',
      progressEn: [
        'Open Build Mode [B] → Farming and place a Harvest Granary Shed.',
      ],
      progressAr: [
        'افتح وضع البناء [B] ← الزراعة وابنِ مخزن الحصاد والبذور.',
      ],
      turnInEn: [
        'What a fine granary! Merchants across the valley already talk of your rising reputation.',
      ],
      turnInAr: [
        'مخزن رائع! لقد بدأ التجار في أنحاء الوادي يتحدثون عن سمعتك الطيبة.',
      ],
      followUpEn: 'Bring your surplus crops and cheese anytime for fair coin.',
      followUpAr: 'أحضر فائض محاصيلك والجبن في أي وقت لتحصل على أفضل الأسعار.',
    },
  },
];
