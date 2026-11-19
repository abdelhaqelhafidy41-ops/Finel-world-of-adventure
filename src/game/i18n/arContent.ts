import type { DialogueTree } from '../dialogue/dialogueTypes';
import type { NpcRoutinePeriod } from '../types';

export interface ArNpcMeta {
  name: string;
  title: string;
  routineLabels: Record<NpcRoutinePeriod, string>;
}

export const AR_NPC_META: Record<string, ArNpcMeta> = {
  'npc-rowan': {
    name: 'روان',
    title: 'شيخ ومؤرخ القرية',
    routineLabels: {
      morning: 'يتجول قرب البئر',
      midday: 'يزور لوحة الإعلانات',
      evening: 'يستريح قرب مقعد الساحة',
      night: 'في الكوخ الغربي',
    },
  },
  'npc-clara': {
    name: 'كلارا',
    title: 'خبيرة النباتات وقروية',
    routineLabels: {
      morning: 'تعتني بأحواض الزهور',
      midday: 'تتمشى في الممر الجنوبي',
      evening: 'تتحدث قرب البئر',
      night: 'تستريح في الكوخ الجنوبي',
    },
  },
  'npc-bram': {
    name: 'برام',
    title: 'خباز حجر الشمس',
    routineLabels: {
      morning: 'يفتح مخبز حجر الشمس',
      midday: 'يدير كشك المخبز',
      evening: 'يستجم في الساحة',
      night: 'يغلق المخبز',
    },
  },
  'npc-lyra': {
    name: 'ليرا',
    title: 'تاجرة الأعشاب والإكسير',
    routineLabels: {
      morning: 'ترتّب حزم الأعشاب',
      midday: 'تدير صيدلية الصفصاف',
      evening: 'تتفقد إمدادات البئر',
      night: 'تستريح في الصيدلية',
    },
  },
  'npc-garrick': {
    name: 'غاريك',
    title: 'تاجر العتاد والرحلات',
    routineLabels: {
      morning: 'يتفقد صناديق الإمدادات',
      midday: 'يدير متجر الأدوات والعتاد',
      evening: 'يزور المقعد الجنوبي',
      night: 'يحرس واجهة المتجر',
    },
  },
  'npc-toby': {
    name: 'توبي',
    title: 'مزارع القمح',
    routineLabels: {
      morning: 'يرعى حقول القمح',
      midday: 'يحمّل عربة المزرعة',
      evening: 'يسقي أحواض الخضروات',
      night: 'يستريح في الكوخ الشرقي',
    },
  },
  'npc-maren': {
    name: 'مارين',
    title: 'راعية البستان',
    routineLabels: {
      morning: 'تعتني بالبستان والخضروات',
      midday: 'توصل المحاصيل للساحة',
      evening: 'تتفقد سياج البستان',
      night: 'تستريح في الكوخ الجنوبي الشرقي',
    },
  },
  'npc-alden': {
    name: 'ألدن',
    title: 'حارس البوابة الجنوبية',
    routineLabels: {
      morning: 'يحرس المدخل الجنوبي',
      midday: 'يتفقد الطريق الشرقي الغربي',
      evening: 'يحرس المدخل الجنوبي',
      night: 'حراسة ليلية عند البوابة',
    },
  },
  'npc-sera': {
    name: 'سيرا',
    title: 'حارسة دورية الساحة',
    routineLabels: {
      morning: 'دورية في ساحة القرية',
      midday: 'دورية أمام المتاجر',
      evening: 'دورية في ساحة القرية',
      night: 'دورية ليلية في الساحة',
    },
  },
  'npc-doran': {
    name: 'دوران',
    title: 'حداد قرية أوكهولو',
    routineLabels: {
      morning: 'يشعل مصهر الحدادة',
      midday: 'يطرق الأسلحة والفولاذ',
      evening: 'يعود إلى منزله',
      night: 'يستريح داخل المنزل',
    },
  },
  'npc-finnian': {
    name: 'فينيان',
    title: 'صيّاد الوادي',
    routineLabels: {
      morning: 'يستطلع أطراف الغابة',
      midday: 'يتفقد المصائد والجلود',
      evening: 'يعود إلى القرية',
      night: 'يستريح داخل المنزل',
    },
  },
  'npc-corvin': {
    name: 'كورفين',
    title: 'حطّاب أوكهولو',
    routineLabels: {
      morning: 'يقطع الأخشاب في الغابة',
      midday: 'يرتب جذوع الخشب',
      evening: 'يرتاح عند الشرفة',
      night: 'ينام في منزله',
    },
  },
  'npc-thorne': {
    name: 'الشيخ ثورن',
    title: 'شيخ قرية أوكهولو',
    routineLabels: {
      morning: 'يبارك ساحة القرية',
      midday: 'يرشد المسافرين',
      evening: 'يعود نحو منزله',
      night: 'يستريح داخل المنزل',
    },
  },
};

export interface ArQuestText {
  title: string;
  description: string;
  rewardSummary: string;
  objectives: Record<string, string>;
}

export const AR_QUESTS: Record<string, ArQuestText> = {
  'quest-help-village': {
    title: 'مساعدة القرية',
    description:
      'ساعد قرية أوكهولو بالتحدث إلى شيخ القرية روان، وجمع 5 أعشاب مروج طازجة من الوادي، ثم العودة إلى روان.',
    rewardSummary: '100 خبرة · 50 عملة',
    objectives: {
      'talk-elder': 'تحدّث إلى شيخ القرية (روان)',
      'find-herbs': 'اعثر على 5 أعشاب مروج',
      'return-elder': 'عُد إلى شيخ القرية (روان)',
    },
  },
  'quest-herbalist-tonic': {
    title: 'علاج خبيرة الأعشاب',
    description:
      'اجمع عشبتين من أعشاب المروج من فسحات الغابة وسلّمهما إلى ليرا في صيدلية الصفصاف.',
    rewardSummary: '75 خبرة · 30 عملة · إكسير الحيوية العشبي',
    objectives: {
      'collect-remedy-herbs': 'اجمع 2 عشبة مروج',
      'deliver-remedy-herbs': 'سلّم 2 عشبة مروج إلى ليرا',
    },
  },
  'quest-bakery-delivery': {
    title: 'قمح للفرن',
    description:
      'انقل كيس القمح الطازج من مزرعة توبي إلى برام في مخبز حجر الشمس.',
    rewardSummary: '60 خبرة · 25 عملة · رغيف فرن حجر الشمس',
    objectives: {
      'deliver-wheat': 'سلّم كيس القمح الطازج إلى برام',
    },
  },
  'quest-valley-survey': {
    title: 'سجلات الوادي',
    description:
      'استكشف العالم المفتوح لاكتشاف 3 معالم على الأقل وأبلغ روان بنتائج مسحك.',
    rewardSummary: '90 خبرة · 40 عملة · ختم مؤرخ أوكهولو',
    objectives: {
      'explore-landmarks': 'اكتشف 3 معالم في الوادي',
      'report-survey': 'أبلغ روان بنتائجك',
    },
  },
  'quest-ridge-scouting': {
    title: 'كشّاف التلال الشمالية',
    description:
      'سافر شمالًا لتفقد لافتة ممر المرتفعات عند سفوح الجبال، ثم أبلغ الحارس ألدن.',
    rewardSummary: '85 خبرة · 35 عملة',
    objectives: {
      'reach-highland-pass': 'صل إلى لافتة ممر المرتفعات',
      'report-alden': 'أبلغ الحارس ألدن بحالة الدرب',
    },
  },
  'quest-desert-expedition': {
    title: 'كثبان حجر الشمس',
    description:
      'اتجه شرقًا لاستكشاف صحراء حجر الشمس وعد إلى التاجر غاريك بملاحظات الرحلة.',
    rewardSummary: '80 خبرة · 45 عملة',
    objectives: {
      'explore-desert': 'استكشف منطقة صحراء حجر الشمس',
      'report-garrick': 'عُد إلى التاجر غاريك',
    },
  },
  'quest-build-shelter': {
    title: 'ابنِ مأواك',
    description:
      'اجمع 10 من الخشب من أشجار الغابة و5 من ألياف النباتات، وصنّع سرير التخييم من قائمة التصنيع، ثم عُد إلى الحطّاب كورفين.',
    rewardSummary: '95 خبرة · 40 عملة · رغيف فرن حجر الشمس',
    objectives: {
      'collect-shelter-wood': 'اجمع 10 من الخشب',
      'collect-shelter-fiber': 'اجمع 5 من ألياف النباتات',
      'craft-camp-bed': 'صنّع سرير التخييم',
      'return-corvin': 'تحدّث مع الحطّاب كورفين',
    },
  },
  'quest-first-night': {
    title: 'عبر الليل الهادئ',
    description:
      'ابحث عن سرير في أحد منازل القرية أو معسكرات الاستكشاف أو ضع سرير مخيمك الخاص ونم حتى الفجر، ثم عد إلى الشيخ ثورن.',
    rewardSummary: '100 خبرة · 50 عملة',
    objectives: {
      'sleep-through-night': 'نم في سرير خلال الليل',
      'report-thorne-sleep': 'حيِّ الشيخ ثورن في الصباح',
    },
  },
  'quest-the-village': {
    title: 'المستوطنات السبع',
    description:
      'استكشف العالم الموسّع لاكتشاف 8 معالم أو معسكرات أو قرى إقليمية على الأقل، ثم أبلغ الشيخ ثورن.',
    rewardSummary: '150 خبرة · 90 عملة',
    objectives: {
      'discover-realm-sites': 'اكتشف 8 قرى أو معالم',
      'report-thorne-realm': 'عُد إلى الشيخ ثورن',
    },
  },
  'quest-the-blacksmith': {
    title: 'المطرقة والسندان',
    description:
      'اجمع 4 خام حديد من التلال الصخرية أو المناجم، واصنع سيفًا حديديًا من قائمة التصنيع، ثم اعرض نصلك على الحدّاد دوران.',
    rewardSummary: '125 خبرة · 65 عملة · 4 فحم',
    objectives: {
      'gather-iron-ore': 'اجمع 4 خام حديد',
      'forge-iron-sword': 'اصنع سيفًا حديديًا',
      'report-doran': 'أرِ السيف للحدّاد دوران',
    },
  },
  'quest-the-hunter': {
    title: 'درب الصيّاد',
    description:
      'تتبّع 4 حيوانات برية في المروج والغابات، واجمع 3 قطع لحم نيء، وسلّمها إلى الصيّاد فينيان.',
    rewardSummary: '130 خبرة · 70 عملة · 10 أسهم',
    objectives: {
      'hunt-game': 'اصطد 4 حيوانات في البراري',
      'deliver-meat': 'سلّم 3 لحم نيء إلى فينيان',
    },
  },
  'quest-into-the-wild': {
    title: 'نحو المناجم البرية',
    description:
      'سافر بعيدًا نحو الشمال الشرقي لتفقد منجم حجر الشمس القديم وأبلغ الحارس ألدن بنتائجك.',
    rewardSummary: '160 خبرة · 95 عملة',
    objectives: {
      'reach-sunstone-mine': 'اكتشف منجم حجر الشمس',
      'report-alden-mine': 'أبلغ الحارس ألدن بالنتائج',
    },
  },
  'quest-the-merchant': {
    title: 'أخشاب للقافلة',
    description:
      'يحتاج التاجر غاريك إلى أخشاب متينة لإصلاح عربات القوافل المتجهة شرقًا. سلّمه 8 أخشاب في ساحة أوكهولو.',
    rewardSummary: '110 خبرة · 75 عملة · 2 لحم مشوي شهي',
    objectives: {
      'deliver-caravan-wood': 'سلّم 8 خشب إلى غاريك',
    },
  },
  'quest-coop-ancient-monster': {
    title: 'اهزم الوحش القديم',
    description:
      'تعاون مع مجموعتك للقضاء على 5 من الوحوش القديمة. التقدم مشترك بين أعضاء المجموعة بينما تبقى المكافآت فردية لكل لاعب.',
    rewardSummary: '140 خبرة · 80 عملة · جرعة الحيوية العشبية',
    objectives: {
      'defeat-ancient-monsters': 'اهزم الوحش القديم',
    },
  },
  'quest-coop-ancient-guardian': {
    title: 'أسقط الحارس العتيق',
    description:
      'وحّد صفوفك مع المجموعة لهزيمة زعيم الحارس العتيق. صحة الزعيم مشتركة وتُحسب المكافآت والغنائم لكل لاعب بشكل فردي.',
    rewardSummary: '240 خبرة · 150 عملة · 2 بلورة حجر الشمس',
    objectives: {
      'fell-ancient-guardian': 'اهزم الزعيم الحارس العتيق',
    },
  },
  'quest-coop-sanctuary-watch': {
    title: 'تطهير مغيري اللصوص',
    description:
      'تعاون مع أعضاء المجموعة لصد 4 من كشافة اللصوص حول أطراف أوكهولو.',
    rewardSummary: '115 خبرة · 65 عملة · 12 سهمًا',
    objectives: {
      'clear-bandit-raiders': 'اهزم كشافة اللصوص',
    },
  },
};

export const AR_DIALOGUE_TREES: Record<string, DialogueTree> = {
  'npc-rowan': {
    npcId: 'npc-rowan',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-help-village', questStatusIn: ['ready'] },
        nodeId: 'help_village_ready',
      },
      {
        condition: { questId: 'quest-valley-survey', questStatusIn: ['ready'] },
        nodeId: 'survey_ready',
      },
      {
        condition: { questId: 'quest-help-village', questStatusIn: ['active'] },
        nodeId: 'help_village_greet',
      },
      {
        condition: { questId: 'quest-valley-survey', questStatusIn: ['completed'] },
        nodeId: 'greet_after_survey',
      },
      {
        condition: { periodIn: ['evening', 'night'] },
        nodeId: 'greet_evening',
      },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'طاب يومك أيها المسافر! انظر كم الهواء صافٍ في ساحة أوكهولو.',
          'بصفتي شيخ القرية ومؤرخها، أدوّن كل معلم حجري ولافتة طريق ومغامر يمر عبر هذا الوادي.',
        ],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل هناك مهمة يمكنني القيام بها لمساعدة القرية؟',
            nextNodeId: 'help_village_offer',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-survey-offer',
            label: 'هل تحتاج مساعدة في رسم معالم الوادي؟',
            nextNodeId: 'survey_offer',
            questTag: 'accept',
            condition: { questId: 'quest-valley-survey', questStatusIn: ['available'] },
          },
          {
            id: 'ask-survey-progress',
            label: 'كيف تسير مهمة مسح الوادي؟',
            nextNodeId: 'survey_progress',
            questTag: 'progress',
            condition: { questId: 'quest-valley-survey', questStatusIn: ['active'] },
          },
          {
            id: 'ask-village',
            label: 'أخبرني عن قرية أوكهولو.',
            nextNodeId: 'about_village',
          },
          {
            id: 'ask-explore',
            label: 'أين تنصحني أن أستكشف أولًا؟',
            nextNodeId: 'explore_tips',
          },
          {
            id: 'bye',
            label: 'رحلة آمنة يا روان.',
            nextNodeId: 'farewell',
          },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'لا شيء يضاهي دفء أضواء الفوانيس حول البئر الحجري عند حلول الغسق.',
          'معظم سكان أوكهولو يرتاحون في هذه الساعة، بينما يراقب سيرا وألدن الساحة.',
        ],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل تحتاج القرية إلى أي مساعدة؟',
            nextNodeId: 'help_village_offer',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-survey-offer',
            label: 'هل تحتاج مساعدة في توثيق الوادي؟',
            nextNodeId: 'survey_offer',
            questTag: 'accept',
            condition: { questId: 'quest-valley-survey', questStatusIn: ['available'] },
          },
          {
            id: 'ask-survey-progress',
            label: 'تفقّد تقدمي في مسح الوادي.',
            nextNodeId: 'survey_progress',
            questTag: 'progress',
            condition: { questId: 'quest-valley-survey', questStatusIn: ['active'] },
          },
          {
            id: 'ask-village',
            label: 'أخبرني عن قرية أوكهولو.',
            nextNodeId: 'about_village',
          },
          {
            id: 'bye',
            label: 'مساءً هادئًا يا روان.',
            nextNodeId: 'farewell',
          },
        ],
      },
      greet_after_survey: {
        id: 'greet_after_survey',
        lines: [
          'سعدنا برؤية مؤرخ الوادي عائدًا إلى ساحة أوكهولو!',
          'ملاحظاتك عن المعالم نُسخت بالفعل بدقة في سجل القرية الرسمي.',
        ],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل ما زالت القرية بحاجة إلى جمع الأعشاب؟',
            nextNodeId: 'help_village_offer',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-village',
            label: 'أخبرني المزيد عن تاريخ أوكهولو.',
            nextNodeId: 'about_village',
          },
          {
            id: 'ask-explore',
            label: 'ذكّرني بما يقع خلف الوادي.',
            nextNodeId: 'explore_tips',
          },
          {
            id: 'bye',
            label: 'سأواصل الاستكشاف!',
            nextNodeId: 'farewell',
          },
        ],
      },
      help_village_greet: {
        id: 'help_village_greet',
        questId: 'quest-help-village',
        lines: [
          'أهلًا بك! ذكرت لي كلارا أنها أرسلت مغامرًا قديرًا في طريقي.',
          'مخزن القرية يحتاج إلى 5 أعشاب مروج طازجة من التلال والغابات المحيطة. اجمع 5 حزم وعد إليّ عندما تكون جاهزًا!',
        ],
        choices: [
          {
            id: 'ask-herb-spots',
            label: 'أين أجد 5 أعشاب مروج؟',
            nextNodeId: 'explore_tips',
          },
          {
            id: 'ask-survey-offer',
            label: 'هل لديك مهام أخرى؟',
            nextNodeId: 'survey_offer',
            questTag: 'accept',
            condition: { questId: 'quest-valley-survey', questStatusIn: ['available'] },
          },
          {
            id: 'bye',
            label: 'سأعود حالما أجمع 5 أعشاب.',
            nextNodeId: 'farewell',
          },
        ],
      },
      help_village_offer: {
        id: 'help_village_offer',
        questId: 'quest-help-village',
        lines: [
          'في الحقيقة، نعم! مخزون القرية من الأعشاب العلاجية المجففة قارب على النفاد.',
          'إذا وجدت 5 أعشاب مروج في فسحات الوادي وأحضرتها لي، خصص مجلس القرية مكافأة قدرها 100 خبرة و50 عملة شكرًا لك!',
        ],
        choices: [
          {
            id: 'accept-help-village',
            label: 'سأجمع 5 أعشاب مروج من أجل القرية.',
            nextNodeId: 'help_village_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-help-village' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: مساعدة القرية (اعثر على 5 أعشاب مروج).',
              },
            ],
          },
          {
            id: 'decline-help-village',
            label: 'ربما لاحقًا يا روان.',
            nextNodeId: 'hub',
          },
        ],
      },
      help_village_accepted: {
        id: 'help_village_accepted',
        questId: 'quest-help-village',
        lines: [
          'شكرًا لك! ابحث عن الأزهار الذهبية في السهول وفسحات الغابة.',
          'عُد إليّ فور جمع 5 حزم في حقيبتك.',
        ],
        nextNodeId: null,
      },
      help_village_ready: {
        id: 'help_village_ready',
        questId: 'quest-help-village',
        lines: [
          'أحسنت! خمس حزم عطرة من عشبة المروج — سيمتلئ مخزن القرية من جديد.',
          'هل أنت مستعد لتسليم الأعشاب واستلام مكافأة أوكهولو؟',
        ],
        choices: [
          {
            id: 'complete-help-village',
            label: 'سلّم 5 أعشاب مروج وأكمل «مساعدة القرية».',
            nextNodeId: 'help_village_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-help-village' }],
          },
          {
            id: 'hold-on',
            label: 'انتظر لحظة — لنتحدث عن أمر آخر أولًا.',
            nextNodeId: 'hub',
          },
        ],
      },
      help_village_completed: {
        id: 'help_village_completed',
        questId: 'quest-help-village',
        lines: [
          'تدين لك أوكهولو بامتنان كبير! ستكفي هذه الأعشاب كل أسرة طوال الموسم.',
          'تفضّل 100 خبرة و50 عملة من خزينة القرية!',
        ],
        nextNodeId: null,
      },
      hub: {
        id: 'hub',
        lines: ['هل هناك أي شيء آخر تود السؤال عنه حول الوادي؟'],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل يمكنني مساعدة القرية؟',
            nextNodeId: 'help_village_offer',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-survey-offer',
            label: 'أخبرني عن مسح الوادي.',
            nextNodeId: 'survey_offer',
            questTag: 'accept',
            condition: { questId: 'quest-valley-survey', questStatusIn: ['available'] },
          },
          {
            id: 'ask-village',
            label: 'أخبرني عن قرية أوكهولو.',
            nextNodeId: 'about_village',
          },
          {
            id: 'ask-explore',
            label: 'أين أستكشف بعد ذلك؟',
            nextNodeId: 'explore_tips',
          },
          {
            id: 'bye',
            label: 'هذا كل شيء الآن.',
            nextNodeId: 'farewell',
          },
        ],
      },
      about_village: {
        id: 'about_village',
        lines: [
          'بدأت أوكهولو كمحطة استراحة بجانب هذا البئر العذب. احتاج المسافرون للخبز والدواء والمأوى قبل عبور الجبال.',
          'اليوم يدير برام المخبز، وليرا تحضّر العلاجات العشبية، وتوبي ومارين يرعيان المزرعة الشرقية، وحراسنا يؤمّنون الطرق.',
        ],
        nextNodeId: 'hub',
      },
      explore_tips: {
        id: 'explore_tips',
        lines: [
          'اتبع الطريق الغربي عبر الغابة نحو بحيرة الغابة ومعابر النهر — تنبت أعشاب المروج الذهبية في تلك الفسحات.',
          'اتجه شمالًا لتسلق الجبال الشاهقة، أو سافر شرقًا نحو كثبان الصحراء الذهبية والساحل الجنوبي.',
        ],
        nextNodeId: 'hub',
      },
      survey_offer: {
        id: 'survey_offer',
        questId: 'quest-valley-survey',
        lines: [
          'أقوم بتحديث خريطة الوادي، لكن ركبتيّ لم تعودا تحتملان تسلق القمم الوعرة.',
          'إذا اكتشفت 3 معالم على الأقل — رجمًا حجريًا أو لافتة طريق أو حقل أعشاب أو القرية — عُد إليّ بتقريرك!',
        ],
        choices: [
          {
            id: 'accept-survey',
            label: 'سأرصد 3 معالم في الوادي من أجلك.',
            nextNodeId: 'survey_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-valley-survey' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: سجلات الوادي (اكتشف 3 معالم).',
              },
            ],
          },
          {
            id: 'decline-survey',
            label: 'ربما لاحقًا يا روان.',
            nextNodeId: 'hub',
          },
        ],
      },
      survey_accepted: {
        id: 'survey_accepted',
        questId: 'quest-valley-survey',
        lines: [
          'رائع! افتح خريطة العالم في أي وقت بالمفتاح M لترى المعالم التي كشفتها.',
          'عُد فور تحديد ثلاثة معالم عبر الوادي.',
        ],
        nextNodeId: null,
      },
      survey_progress: {
        id: 'survey_progress',
        questId: 'quest-valley-survey',
        lines: [
          'اقترب من الرجم الحجري أو لافتات الطرق أو معالم القرية لتسجيلها على خريطتك.',
          'بمجرد اكتشاف 3 معالم، عُد إليّ وسأوثّق نتائجك.',
        ],
        nextNodeId: 'hub',
      },
      survey_ready: {
        id: 'survey_ready',
        questId: 'quest-valley-survey',
        lines: [
          'أهلاً بعودتك! يبدو من مذكرتك الميدانية أنك كشفت بالفعل ثلاثة معالم أو أكثر!',
          'هل تسمح لي بنسخ هذه الإحداثيات في سجل أوكهولو الرسمي؟',
        ],
        choices: [
          {
            id: 'complete-survey',
            label: 'شارك إحداثيات المعالم وأكمل المهمة.',
            nextNodeId: 'survey_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-valley-survey' }],
          },
          {
            id: 'not-yet',
            label: 'تمهل — لنتحدث عن شيء آخر أولًا.',
            nextNodeId: 'hub',
          },
        ],
      },
      survey_completed: {
        id: 'survey_completed',
        questId: 'quest-valley-survey',
        lines: [
          'عمل مذهل! سترشد هذه الإحداثيات كل مستكشف يزور أوكهولو من بعدنا.',
          'خُذ ختم مؤرخ أوكهولو هذا، مع 90 خبرة و40 عملة — دمت نشيطًا في رحلاتك!',
        ],
        nextNodeId: null,
      },
      farewell: {
        id: 'farewell',
        lines: ['لتثبت خطاك على كل درب!'],
        nextNodeId: null,
      },
    },
  },

  'npc-clara': {
    npcId: 'npc-clara',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'مرحبًا! أتفقد أحواض الزهور في الساحة بينما الشمس دافئة.',
          'تبقى أوكهولو خضراء طوال العام بفضل جداول الوادي.',
        ],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل يحتاج أحد في أوكهولو إلى يد مساعدة؟',
            nextNodeId: 'help_village_lead',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-herbs',
            label: 'هل من نصائح لإيجاد أعشاب المروج؟',
            nextNodeId: 'herbs_tip',
          },
          {
            id: 'ask-well',
            label: 'ما المميز في بئر القرية؟',
            nextNodeId: 'well_tip',
          },
          { id: 'bye', label: 'شكرًا يا كلارا!', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'هل تشم نسيم البحر المالح القادم من الساحل الجنوبي؟',
          'المساء هو وقتي المفضل للتنزه في الساحة قبل العودة إلى كوخي.',
        ],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل يحتاج أحد في أوكهولو للمساعدة الآن؟',
            nextNodeId: 'help_village_lead',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-herbs',
            label: 'أين تنمو أعشاب المروج؟',
            nextNodeId: 'herbs_tip',
          },
          {
            id: 'ask-well',
            label: 'أخبريني عن البئر الحجري.',
            nextNodeId: 'well_tip',
          },
          { id: 'bye', label: 'أمسية سعيدة!', nextNodeId: 'farewell' },
        ],
      },
      help_village_lead: {
        id: 'help_village_lead',
        questId: 'quest-help-village',
        lines: [
          'نعم! ذكر شيخ القرية روان هناك في الساحة أن مخزن الأعشاب الطبية المجففة قارب على النفاد.',
          'تحدّث مع روان أولًا، ثم اجمع 5 أعشاب مروج وعد إليه — بانتظارك 100 خبرة و50 عملة!',
        ],
        choices: [
          {
            id: 'accept-help-lead',
            label: 'سأساعد القرية — سأتحدث إلى روان حالًا.',
            nextNodeId: 'help_village_started',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-help-village' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: مساعدة القرية (تحدّث مع روان).',
              },
            ],
          },
          {
            id: 'decline-help-lead',
            label: 'ربما لاحقًا يا كلارا.',
            nextNodeId: 'hub',
          },
        ],
      },
      help_village_started: {
        id: 'help_village_started',
        questId: 'quest-help-village',
        lines: [
          'رائع! ابحث عن روان يتجول قرب البئر الحجري أو لوحة الإعلانات في ساحة أوكهولو.',
          'سيخبرك بكل التفاصيل فور أن تقدّم نفسك له.',
        ],
        nextNodeId: null,
      },
      hub: {
        id: 'hub',
        lines: ['هل أردت السؤال عن شيء آخر يخص نباتات الوادي؟'],
        choices: [
          {
            id: 'ask-help-village',
            label: 'هل يحتاج أحد في أوكهولو إلى يد مساعدة؟',
            nextNodeId: 'help_village_lead',
            questTag: 'accept',
            condition: { questId: 'quest-help-village', questStatusIn: ['available'] },
          },
          { id: 'ask-herbs', label: 'أين تنمو أعشاب المروج؟', nextNodeId: 'herbs_tip' },
          { id: 'ask-well', label: 'ماذا يفعل بئر القرية؟', nextNodeId: 'well_tip' },
          { id: 'bye', label: 'هذا يكفي الآن.', nextNodeId: 'farewell' },
        ],
      },
      herbs_tip: {
        id: 'herbs_tip',
        lines: [
          'ابحث عن أزهار ذهبية ساطعة قرب بساتين البلوط وهضاب السهول وفسحات الغابة.',
          'جمع حزمة واحدة يشفيك فورًا ويضيف أعشابًا إضافية إلى حقيبتك!',
        ],
        nextNodeId: 'hub',
      },
      well_tip: {
        id: 'well_tip',
        lines: [
          'يسحب البئر مياه ينابيع صافية من أعماق الجبال الشمالية.',
          'اضغط E بجانب الحافة الحجرية كلما احتجت دفعة سريعة للصحة والتحمّل.',
        ],
        nextNodeId: 'hub',
      },
      farewell: {
        id: 'farewell',
        lines: ['تمنياتي لك بجمع وفير!'],
        nextNodeId: null,
      },
    },
  },

  'npc-lyra': {
    npcId: 'npc-lyra',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['ready'] },
        nodeId: 'tonic_ready',
      },
      {
        condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['completed'] },
        nodeId: 'greet_completed',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'مرحبًا بك في صيدلية الصفصاف! انتبه لخطواتك قرب رفوف التجفيف.',
          'بين الميرمية الجبلية وأعشاب المروج البرية، هناك دائمًا إكسير طازج يغلي على النار.',
        ],
        choices: [
          {
            id: 'ask-tonic-quest',
            label: 'هل تحتاجين أعشابًا من البرية؟',
            nextNodeId: 'tonic_offer',
            questTag: 'accept',
            condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['available'] },
          },
          {
            id: 'check-tonic-progress',
            label: 'بخصوص أعشاب المروج التي طلبتِها...',
            nextNodeId: 'tonic_progress',
            questTag: 'progress',
            condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['active'] },
          },
          {
            id: 'ask-remedies',
            label: 'كيف تعمل الأعشاب العلاجية في حقيبتي؟',
            nextNodeId: 'remedies_info',
          },
          {
            id: 'ask-flora',
            label: 'أين تنمو أعشاب المروج؟',
            nextNodeId: 'flora_regions',
          },
          { id: 'bye', label: 'أراك لاحقًا يا ليرا.', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أرتّب القوارير الزجاجية تحت ضوء الفانوس — أهدأ وقت في صيدلية الصفصاف.',
          'إذا كنت ستخرج بعد الغسق، احرص على إبقاء الأعشاب في حقيبتك.',
        ],
        choices: [
          {
            id: 'ask-tonic-quest',
            label: 'هل تحتاجين أعشابًا لوصفاتك؟',
            nextNodeId: 'tonic_offer',
            questTag: 'accept',
            condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['available'] },
          },
          {
            id: 'check-tonic-progress',
            label: 'بخصوص مهمة علاج خبيرة الأعشاب...',
            nextNodeId: 'tonic_progress',
            questTag: 'progress',
            condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['active'] },
          },
          { id: 'ask-remedies', label: 'كيف تعمل العلاجات؟', nextNodeId: 'remedies_info' },
          { id: 'bye', label: 'تصبحين على خير يا ليرا.', nextNodeId: 'farewell' },
        ],
      },
      greet_completed: {
        id: 'greet_completed',
        lines: [
          'تلك الدفعة من أعشاب المروج نضجت بنقاء تام — لا يزال لدي رف كامل من الإكسيرات يبرد!',
          'احتفظ بإكسير الحيوية العشبي قريبًا عندما تتسلق الجروف الشمالية.',
        ],
        choices: [
          { id: 'ask-remedies', label: 'ذكّريني بطريقة استخدام الأدوية.', nextNodeId: 'remedies_info' },
          { id: 'ask-flora', label: 'أين تنمو النباتات النادرة؟', nextNodeId: 'flora_regions' },
          { id: 'bye', label: 'دمتِ بصحة يا ليرا.', nextNodeId: 'farewell' },
        ],
      },
      hub: {
        id: 'hub',
        lines: ['هل تحتاج أي شيء آخر من صيدلية الصفصاف؟'],
        choices: [
          {
            id: 'ask-tonic-quest',
            label: 'هل ما زلتِ بحاجة لأعشاب المروج؟',
            nextNodeId: 'tonic_offer',
            questTag: 'accept',
            condition: { questId: 'quest-herbalist-tonic', questStatusIn: ['available'] },
          },
          { id: 'ask-remedies', label: 'كيف تعمل الأعشاب العلاجية؟', nextNodeId: 'remedies_info' },
          { id: 'ask-flora', label: 'أين تنمو أعشاب المروج؟', nextNodeId: 'flora_regions' },
          { id: 'bye', label: 'شكرًا يا ليرا.', nextNodeId: 'farewell' },
        ],
      },
      remedies_info: {
        id: 'remedies_info',
        lines: [
          'افتح حقيبتك بالمفتاح I (أو زر الحقيبة على شاشة اللمس) لاستعراض ما جمعته.',
          'اختيار «استخدام» لعشبة مروج أو إكسير الحيوية يستعيد صحتك فورًا في الدرب.',
        ],
        nextNodeId: 'hub',
      },
      flora_regions: {
        id: 'flora_regions',
        lines: [
          'ابحث عن الأزهار الذهبية بجانب بلوط الغابة وفي سهول الوادي المشمسة.',
          'أما شرقًا فتجف الأرض وتحل الصبّاريات محل نباتات الغابة الرطبة.',
        ],
        nextNodeId: 'hub',
      },
      tonic_offer: {
        id: 'tonic_offer',
        questId: 'quest-herbalist-tonic',
        lines: [
          'نعم! نفد مخزوني من أعشاب المروج الذهبية بعد مرور القافلة الأخيرة.',
          'أحضر لي عشبتين في حقيبتك وسأقطّر لك إكسير الحيوية العشبي لرحلاتك.',
        ],
        choices: [
          {
            id: 'accept-tonic',
            label: 'اعتمدي عليّ — سأجمع عشبتي مروج.',
            nextNodeId: 'tonic_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-herbalist-tonic' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: علاج خبيرة الأعشاب (اجمع 2 عشبة مروج).',
              },
            ],
          },
          {
            id: 'decline-tonic',
            label: 'ربما بعد عودتي من الاستكشاف.',
            nextNodeId: 'hub',
          },
        ],
      },
      tonic_accepted: {
        id: 'tonic_accepted',
        questId: 'quest-herbalist-tonic',
        lines: [
          'شكرًا جزيلًا! ابحث عن عناقيد الأعشاب الذهبية في المروج واضغط E لجمعها.',
          'عُد بعشبتين في حقيبتك متى شئت.',
        ],
        nextNodeId: null,
      },
      tonic_progress: {
        id: 'tonic_progress',
        questId: 'quest-herbalist-tonic',
        lines: [
          'أحتاج إلى عشبتين من أعشاب المروج في حقيبتك قبل أن أبدأ التقطير.',
          'تفقّد فسحات الغابة غرب أوكهولو — تنبت هناك بكثرة!',
        ],
        nextNodeId: 'hub',
      },
      tonic_ready: {
        id: 'tonic_ready',
        questId: 'quest-herbalist-tonic',
        lines: [
          'يا للروعة! أستطيع شمّ رائحة أعشاب المروج الطازجة في حقيبتك من هنا.',
          'هل أقطّر لك عشبتين في إكسير الحيوية المركز؟',
        ],
        choices: [
          {
            id: 'complete-tonic',
            label: 'سلّم 2 عشبة مروج وحضّر الإكسير.',
            nextNodeId: 'tonic_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-herbalist-tonic' }],
          },
          {
            id: 'keep-herbs',
            label: 'مهلًا — أريد أن أسأل عن شيء آخر أولًا.',
            nextNodeId: 'hub',
          },
        ],
      },
      tonic_completed: {
        id: 'tonic_completed',
        questId: 'quest-herbalist-tonic',
        lines: [
          'ها هو — نقاء زمردي عميق! رشفة واحدة منه تضمد الجراح وتجدد نشاطك في ثوانٍ.',
          'ستجد إكسير الحيوية العشبي محفوظًا في حقيبتك، بالإضافة إلى 75 خبرة و30 عملة.',
        ],
        nextNodeId: null,
      },
      farewell: {
        id: 'farewell',
        lines: ['اعتنِ بصحتك على دروب الوادي!'],
        nextNodeId: null,
      },
    },
  },

  'npc-toby': {
    npcId: 'npc-toby',
    defaultStartNodeId: 'greet_morning',
    entryRules: [
      {
        condition: { questId: 'quest-bakery-delivery', questStatusIn: ['active', 'ready'] },
        nodeId: 'greet_in_progress',
      },
      {
        condition: { questId: 'quest-bakery-delivery', questStatusIn: ['completed'] },
        nodeId: 'greet_completed',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_morning: {
        id: 'greet_morning',
        lines: [
          'صباح الخير! الندى على سنابل القمح يبشر دائمًا بحصاد وفير.',
          'بين بستان مارين وحقول الحبوب هذه، لا تجوع أوكهولو أبدًا.',
        ],
        choices: [
          {
            id: 'ask-delivery',
            label: 'هل تحتاج مساعدة في حمل القمح إلى القرية؟',
            nextNodeId: 'delivery_offer',
            questTag: 'accept',
            condition: { questId: 'quest-bakery-delivery', questStatusIn: ['available'] },
          },
          { id: 'ask-crops', label: 'كيف تنمو المحاصيل؟', nextNodeId: 'crops_info' },
          { id: 'ask-scarecrow', label: 'هل تبعد الفزاعة الغربان حقًا؟', nextNodeId: 'scarecrow_story' },
          { id: 'bye', label: 'واصل عملك الطيب يا توبي.', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أتفقد أعمدة السياج قبل الغروب — فعمود مفكوك يعني ماعزًا متسللًا إلى القمح!',
          'ما زال هناك الكثير لترتيبه قبل تعليق قبعة القش للراحة.',
        ],
        choices: [
          {
            id: 'ask-delivery',
            label: 'هل تحتاج نقل كيس قمح إلى برام؟',
            nextNodeId: 'delivery_offer',
            questTag: 'accept',
            condition: { questId: 'quest-bakery-delivery', questStatusIn: ['available'] },
          },
          { id: 'ask-crops', label: 'كيف تنمو المحاصيل؟', nextNodeId: 'crops_info' },
          { id: 'bye', label: 'مساءً سعيدًا يا توبي.', nextNodeId: 'farewell' },
        ],
      },
      greet_in_progress: {
        id: 'greet_in_progress',
        questId: 'quest-bakery-delivery',
        lines: [
          'خذ كيس القمح الطازج هذا مباشرة عبر ممر المزرعة إلى برام في مخبز حجر الشمس!',
          'يقع كشكه في الجانب الشمالي الغربي من ساحة أوكهولو — لن تخطئ مظلته الدافئة.',
        ],
        choices: [
          { id: 'ask-crops', label: 'كيف حال بقية المحاصيل؟', nextNodeId: 'crops_info' },
          { id: 'bye', label: 'سأوصل القمح إلى برام.', nextNodeId: 'farewell' },
        ],
      },
      greet_completed: {
        id: 'greet_completed',
        lines: [
          'أرسل برام خبرًا أن شحنة القمح وصلت إلى الأفران في الوقت المثالي!',
          'لا شيء يضاهي خبز الفرن الطازج بعد صباح طويل في الحقول.',
        ],
        choices: [
          { id: 'ask-crops', label: 'كيف تنمو المحاصيل؟', nextNodeId: 'crops_info' },
          { id: 'ask-scarecrow', label: 'كيف حال الفزاعة؟', nextNodeId: 'scarecrow_story' },
          { id: 'bye', label: 'أراك لاحقًا يا توبي.', nextNodeId: 'farewell' },
        ],
      },
      hub: {
        id: 'hub',
        lines: ['هل يدور في بالك سؤال آخر حول المزرعة؟'],
        choices: [
          {
            id: 'ask-delivery',
            label: 'هل تحتاج مساعدة في أخذ الحبوب لبرام؟',
            nextNodeId: 'delivery_offer',
            questTag: 'accept',
            condition: { questId: 'quest-bakery-delivery', questStatusIn: ['available'] },
          },
          { id: 'ask-crops', label: 'كيف تنمو المحاصيل؟', nextNodeId: 'crops_info' },
          { id: 'ask-scarecrow', label: 'أخبرني عن الفزاعة.', nextNodeId: 'scarecrow_story' },
          { id: 'bye', label: 'إلى اللقاء يا توبي.', nextNodeId: 'farewell' },
        ],
      },
      crops_info: {
        id: 'crops_info',
        lines: [
          'تبقى تربة أوكهولو خصبة بفضل المياه الجوفية المتسربة من ينابيع الوادي.',
          'تتحول سنابل القمح للون الذهبي بحلول الظهر، وتنمو الخضروات الورقية قرب الحظيرة بسرعة مضاعفة.',
        ],
        nextNodeId: 'hub',
      },
      scarecrow_story: {
        id: 'scarecrow_story',
        lines: [
          'خاطت مارين ذلك المعطف الصوفي القديم في الخريف الماضي بعدما حاولت ثلاثة غربان جريئة التعشيش في عربة الحبوب.',
          'حتى الآن خدعت كل طائر في الوادي — وأفزعت بضعة مسافرين نعسانين عند الغسق أيضًا!',
        ],
        nextNodeId: 'hub',
      },
      delivery_offer: {
        id: 'delivery_offer',
        questId: 'quest-bakery-delivery',
        lines: [
          'في الواقع، نعم! أفران برام في مخبز حجر الشمس كادت تنفد من الدقيق المطحون.',
          'هل يمكنك حمل كيس القمح الطازج هذا إلى برام في ساحة القرية؟ أظنه سيخبز لك رغيفًا دافئًا بالمقابل!',
        ],
        choices: [
          {
            id: 'accept-delivery',
            label: 'بالتأكيد — سأحضر كيس القمح إلى برام.',
            nextNodeId: 'delivery_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-bakery-delivery' },
              {
                type: 'giveItem',
                item: {
                  id: 'farm-grain',
                  name: 'كيس قمح طازج',
                  description: 'قمح أوكهولو المطحون بالحجر من مزرعة توبي إلى برام في مخبز حجر الشمس.',
                  count: 1,
                  usable: false,
                },
              },
              {
                type: 'notice',
                message: 'تم قبول المهمة: قمح للفرن (سلّم كيس القمح إلى برام).',
              },
            ],
          },
          {
            id: 'decline-delivery',
            label: 'ربما لاحقًا — حقيبتي ممتلئة الآن.',
            nextNodeId: 'hub',
          },
        ],
      },
      delivery_accepted: {
        id: 'delivery_accepted',
        questId: 'quest-bakery-delivery',
        lines: [
          'ممنون لك! وضعت كيس القمح الطازج بأمان في حقيبة المستكشف الخاصة بك.',
          'اتبع الطريق الترابي شمال غرب إلى ساحة أوكهولو وسلّمه مباشرة إلى برام.',
        ],
        nextNodeId: null,
      },
      farewell: {
        id: 'farewell',
        lines: ['شكرًا جزيلًا يا صديقي!'],
        nextNodeId: null,
      },
    },
  },

  'npc-bram': {
    npcId: 'npc-bram',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: {
          questId: 'quest-bakery-delivery',
          questStatusIn: ['active', 'ready'],
          hasItem: { itemId: 'farm-grain', minCount: 1 },
        },
        nodeId: 'grain_delivery_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'أرغفة الفرن الطازجة خرجت للتو من الموقد! تفضل إلى مخبز حجر الشمس.',
          'لا شيء يمدّ المستكشف بالطاقة عبر الممرات الجبلية مثل الخبز الساخن المقرمش.',
        ],
        choices: [
          { id: 'ask-goods', label: 'ماذا تخبز هنا؟', nextNodeId: 'baked_goods' },
          { id: 'ask-grain', label: 'من أين يأتي دقيقك؟', nextNodeId: 'bread_secret' },
          { id: 'bye', label: 'الرائحة شهية يا برام.', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أخمد جمر الفرن للمساء — حان وقت الاستمتاع بنسيم الساحة البارد.',
          'تبدأ الدفعة الأولى في الفرن قبل الفجر!',
        ],
        choices: [
          { id: 'ask-goods', label: 'ماذا تخبز في مخبز حجر الشمس؟', nextNodeId: 'baked_goods' },
          { id: 'ask-grain', label: 'من أين تحصل على الحبوب؟', nextNodeId: 'bread_secret' },
          { id: 'bye', label: 'ليلة هانئة يا برام.', nextNodeId: 'farewell' },
        ],
      },
      hub: {
        id: 'hub',
        lines: ['هل هناك شيء آخر أخبرك به من خلف المنضدة؟'],
        choices: [
          { id: 'ask-goods', label: 'ماذا تخبز هنا؟', nextNodeId: 'baked_goods' },
          { id: 'ask-grain', label: 'من أين يأتي قمحك؟', nextNodeId: 'bread_secret' },
          { id: 'bye', label: 'أراك لاحقًا يا برام.', nextNodeId: 'farewell' },
        ],
      },
      baked_goods: {
        id: 'baked_goods',
        lines: [
          'أرغفة خبز ريفية مستديرة، وكعك شوفان متبّل، ولفائف فرن بالعسل مقرمشة من الخارج.',
          'ألدن وسيرا يمران دائمًا لأخذ قطع دافئة قبل بدء نوبة الحراسة الليلية.',
        ],
        nextNodeId: 'hub',
      },
      bread_secret: {
        id: 'bread_secret',
        lines: [
          'كل كيس حبوب يحصده توبي ومارين هناك عند ممر المزرعة الجنوبي الشرقي.',
          'يُطحن بالحجر طازجًا كل أسبوع — وهذا سر نكهة خبز أوكهولو الفريدة.',
        ],
        nextNodeId: 'hub',
      },
      grain_delivery_ready: {
        id: 'grain_delivery_ready',
        questId: 'quest-bakery-delivery',
        lines: [
          'أها! هل هذا كيس قمح طازج من مزرعة توبي تحمله على كتفك؟',
          'صندوق الدقيق لدي كاد يفرغ تمامًا — وصلت في اللحظة المناسبة!',
        ],
        choices: [
          {
            id: 'deliver-grain',
            label: 'سلّم كيس القمح الطازج.',
            nextNodeId: 'grain_delivered',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-bakery-delivery' }],
          },
          {
            id: 'chat-first',
            label: 'لنتحدث قليلًا قبل تفريغ الحمولة.',
            nextNodeId: 'hub',
          },
        ],
      },
      grain_delivered: {
        id: 'grain_delivered',
        questId: 'quest-bakery-delivery',
        lines: [
          'قمح من الدرجة الأولى، جاف وذهبي! لقد أنقذت مخبوزات الغد.',
          'خُذ رغيف فرن حجر الشمس الدافئ هذا، و60 خبرة و25 عملة في حقيبتك!',
        ],
        nextNodeId: null,
      },
      farewell: {
        id: 'farewell',
        lines: ['عد في أي وقت ترى فيه الفرن مشتعلًا!'],
        nextNodeId: null,
      },
    },
  },

  'npc-garrick': {
    npcId: 'npc-garrick',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-desert-expedition', questStatusIn: ['ready'] },
        nodeId: 'desert_ready',
      },
      {
        condition: { questId: 'quest-the-merchant', questStatusIn: ['ready'] },
        nodeId: 'caravan_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'أتفقد زيت الفوانيس ولفائف الحبال وأحزمة الحقائب في متجر أدوات الوادي.',
          'إذا كنت تخطط لرحلة استكشافية خارج طرق القرية، استعد جيدًا قبل الصعود.',
        ],
        choices: [
          {
            id: 'ask-desert-quest',
            label: 'هل هناك رحلات تحتاج إلى استطلاعها؟',
            nextNodeId: 'desert_offer',
            questTag: 'accept',
            condition: { questId: 'quest-desert-expedition', questStatusIn: ['available'] },
          },
          {
            id: 'ask-desert-progress',
            label: 'بخصوص استكشاف صحراء حجر الشمس...',
            nextNodeId: 'desert_progress',
            questTag: 'progress',
            condition: { questId: 'quest-desert-expedition', questStatusIn: ['active'] },
          },
          {
            id: 'ask-caravan-quest',
            label: 'هل تحتاج عرباتك التجارية إلى إمدادات؟',
            nextNodeId: 'caravan_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-merchant', questStatusIn: ['available'] },
          },
          {
            id: 'ask-caravan-progress',
            label: 'بخصوص تسليم أخشاب القافلة...',
            nextNodeId: 'caravan_progress',
            questTag: 'progress',
            condition: { questId: 'quest-the-merchant', questStatusIn: ['active'] },
          },
          { id: 'ask-gear', label: 'أي نصيحة للرحلات الطويلة؟', nextNodeId: 'travel_advice' },
          { id: 'ask-mountains', label: 'كيف الأوضاع في الجبال الشمالية؟', nextNodeId: 'mountain_advice' },
          { id: 'bye', label: 'نصيحة قيمة يا غاريك.', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أقفل صناديق الإمدادات للمبيت — يوم حافل آخر بتجهيز المستكشفين.',
          'تفضل غدًا بمتجري إذا احتجت أي إرشادات للطريق.',
        ],
        choices: [
          {
            id: 'ask-desert-quest',
            label: 'هل هناك رحلات تحتاج استكشافًا؟',
            nextNodeId: 'desert_offer',
            questTag: 'accept',
            condition: { questId: 'quest-desert-expedition', questStatusIn: ['available'] },
          },
          {
            id: 'ask-desert-progress',
            label: 'بخصوص استكشاف صحراء حجر الشمس...',
            nextNodeId: 'desert_progress',
            questTag: 'progress',
            condition: { questId: 'quest-desert-expedition', questStatusIn: ['active'] },
          },
          { id: 'ask-gear', label: 'أي نصيحة للرحلات الطويلة؟', nextNodeId: 'travel_advice' },
          { id: 'bye', label: 'أراك غدًا يا غاريك.', nextNodeId: 'farewell' },
        ],
      },
      desert_offer: {
        id: 'desert_offer',
        questId: 'quest-desert-expedition',
        lines: [
          'أحتاج تقريرًا حديثًا عن حالة الرمال في صحراء حجر الشمس الشرقية قبل انطلاق عربة الإمداد الأسبوع المقبل.',
          'سِر شرقًا حتى تشير بوصلتك إلى الصحراء، استكشف الكثبان، وعد إليّ مقابل 80 خبرة و45 عملة!',
        ],
        choices: [
          {
            id: 'accept-desert',
            label: 'سأستكشف صحراء حجر الشمس وأرفع لك التقرير.',
            nextNodeId: 'desert_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-desert-expedition' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: كثبان حجر الشمس (استكشف منطقة الصحراء).',
              },
            ],
          },
          { id: 'decline-desert', label: 'ليس الآن يا غاريك.', nextNodeId: 'hub' },
        ],
      },
      desert_accepted: {
        id: 'desert_accepted',
        questId: 'quest-desert-expedition',
        lines: [
          'اتجه شرقًا مباشرة بعد المزرعة حتى تتلاشى السهول الخضراء أمام الكثبان الرملية الذهبية.',
          'وما إن تطأ قدماك صحراء حجر الشمس، عُد إلى كشكي!',
        ],
        nextNodeId: null,
      },
      desert_progress: {
        id: 'desert_progress',
        questId: 'quest-desert-expedition',
        lines: [
          'واصل التقدم شرقًا حتى تصل إلى إقليم صحراء حجر الشمس — ابحث عن الصبّار الشاهق والكثبان الرملية.',
          'عُد إليّ بمجرد استكشاف الرمال.',
        ],
        nextNodeId: 'hub',
      },
      desert_ready: {
        id: 'desert_ready',
        questId: 'quest-desert-expedition',
        lines: [
          'أحذية مغبرة برمال الشمس! هذا يعني أنك وصلت بالفعل إلى كثبان صحراء حجر الشمس.',
          'هل أنت مستعد لتسليم تقرير بعثة الصحراء؟',
        ],
        choices: [
          {
            id: 'complete-desert',
            label: 'سلّم ملاحظات بعثة الصحراء.',
            nextNodeId: 'desert_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-desert-expedition' }],
          },
          { id: 'chat-later', label: 'لنتحدث عن العتاد أولًا.', nextNodeId: 'hub' },
        ],
      },
      desert_completed: {
        id: 'desert_completed',
        questId: 'quest-desert-expedition',
        lines: [
          'رمال متماسكة خلف التلال — هذا بالضبط ما أراد سائقو القافلة سماعه!',
          'تفضّل 80 خبرة و45 عملة مكافأةً على عملك الميداني.',
        ],
        nextNodeId: null,
      },
      hub: {
        id: 'hub',
        lines: ['هل لديك سؤال آخر حول العتاد أو التضاريس؟'],
        choices: [
          {
            id: 'ask-desert-quest',
            label: 'أخبرني عن بعثة الصحراء.',
            nextNodeId: 'desert_offer',
            questTag: 'accept',
            condition: { questId: 'quest-desert-expedition', questStatusIn: ['available'] },
          },
          { id: 'ask-gear', label: 'أي نصائح للحفاظ على التحمّل؟', nextNodeId: 'travel_advice' },
          { id: 'ask-mountains', label: 'ماذا عن القمم الجبلية؟', nextNodeId: 'mountain_advice' },
          { id: 'bye', label: 'شكرًا يا غاريك.', nextNodeId: 'farewell' },
        ],
      },
      travel_advice: {
        id: 'travel_advice',
        lines: [
          'لا تستنزف تحمّلك بالركض صعودًا — خفف الضغط عن Shift قليلًا ليستعيد نفسك قوته.',
          'وتفقّد خريطة العالم باستمرار بالمفتاح M؛ كل لافتة ورجم حجري يرشدك للعودة إلى أوكهولو.',
        ],
        nextNodeId: 'hub',
      },
      mountain_advice: {
        id: 'mountain_advice',
        lines: [
          'تغطي الثلوج أعلى القمم الشمالية، وستختبر المنحدرات الحادة توازنك.',
          'اسلك التلال المتدرجة من السهول بدل التوجه مباشرة نحو الجروف الصخرية الشاهقة.',
        ],
        nextNodeId: 'hub',
      },
      caravan_offer: {
        id: 'caravan_offer',
        questId: 'quest-the-merchant',
        lines: [
          'تضرر محور إحدى عجلات قافلتنا الشرقية على الطريق القادم من غراندكروس.',
          'اجمع 8 من الخشب المتين من أشجار الغابة أو الأغصان المتساقطة وأحضره إليّ — سأمنحك 110 خبرة و75 عملة وقطعتين من اللحم المشوي!',
        ],
        choices: [
          {
            id: 'accept-caravan',
            label: 'سأجمع 8 من الخشب لعربات القافلة.',
            nextNodeId: 'caravan_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-the-merchant' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: أخشاب القافلة (سلّم 8 من الخشب إلى غاريك).',
              },
            ],
          },
          { id: 'decline-caravan', label: 'ربما لاحقًا يا غاريك.', nextNodeId: 'hub' },
        ],
      },
      caravan_accepted: {
        id: 'caravan_accepted',
        questId: 'quest-the-merchant',
        lines: [
          'ممتن لك كثيرًا! اقطع الأشجار الصالحة أو اجمع الأغصان المتساقطة حول الغابة وعُد بـ 8 من الخشب.',
        ],
        nextNodeId: null,
      },
      caravan_progress: {
        id: 'caravan_progress',
        questId: 'quest-the-merchant',
        lines: [
          'ما زلت بحاجة إلى 8 من الخشب لتدعيم محاور القافلة — اقترب من الأشجار أو الجذوع المتساقطة واضغط زر التفاعل.',
        ],
        nextNodeId: 'hub',
      },
      caravan_ready: {
        id: 'caravan_ready',
        questId: 'quest-the-merchant',
        lines: [
          'خشب مستقيم وممتاز في حقيبتك! هل حِزم الخشب الثمانية جاهزة للقافلة؟',
        ],
        choices: [
          {
            id: 'complete-caravan',
            label: 'سلّم 8 من الخشب للقافلة.',
            nextNodeId: 'caravan_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-the-merchant' }],
          },
          { id: 'chat-later', label: 'انتظر، لنتحدث أولًا.', nextNodeId: 'hub' },
        ],
      },
      caravan_completed: {
        id: 'caravan_completed',
        questId: 'quest-the-merchant',
        lines: [
          'هذا سيجعل قافلة غراندكروس تواصل مسيرها بسلاسة!',
          'تفضّل 75 عملة و110 خبرة ووجبتين شهيتين للطريق.',
        ],
        nextNodeId: null,
      },
      farewell: {
        id: 'farewell',
        lines: ['تجوّل بذكاء أيها المغامر!'],
        nextNodeId: null,
      },
    },
  },

  'npc-maren': {
    npcId: 'npc-maren',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'أعتني بصفوف البستان وأحواض الخضروات في هواء الجبل النقي.',
          'يتولى توبي القمح الطويل بينما أحافظ على أشجار التفاح والخضار مزدهرة.',
        ],
        choices: [
          { id: 'ask-orchard', label: 'ماذا ينمو في البستان؟', nextNodeId: 'orchard_info' },
          { id: 'ask-market', label: 'هل تبيعين المحاصيل في الساحة؟', nextNodeId: 'market_routine' },
          { id: 'bye', label: 'أراك لاحقًا يا مارين.', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أقلّم بعض أغصان البستان المنخفضة قبل أن يخيّم الشفق فوق السياج.',
          'سأعود قريبًا إلى الكوخ الجنوبي الشرقي لتناول عشاء دافئ.',
        ],
        choices: [
          { id: 'ask-orchard', label: 'ماذا ينمو في البستان؟', nextNodeId: 'orchard_info' },
          { id: 'bye', label: 'عشاءً هنيئًا يا مارين.', nextNodeId: 'farewell' },
        ],
      },
      hub: {
        id: 'hub',
        lines: ['هل تود معرفة شيء آخر عن البستان؟'],
        choices: [
          { id: 'ask-orchard', label: 'ماذا ينمو في البستان؟', nextNodeId: 'orchard_info' },
          { id: 'ask-market', label: 'متى تنقلين الخضروات للسوق؟', nextNodeId: 'market_routine' },
          { id: 'bye', label: 'شكرًا يا مارين.', nextNodeId: 'farewell' },
        ],
      },
      orchard_info: {
        id: 'orchard_info',
        lines: [
          'تفاح الوادي المقرمش، والجذور الحلوة، والأعشاب القوية تحيط بسياج مزرعتنا.',
          'لا تتردد في التنزه بمحاذات الأسوار الخشبية في أي وقت — فقط انتبه لأحواض التربة!',
        ],
        nextNodeId: 'hub',
      },
      market_routine: {
        id: 'market_routine',
        lines: [
          'حوالى منتصف النهار أنقل السلال الطازجة إلى ساحة أوكهولو ليختار برام وليرا الأفضل.',
          'وبحلول المساء أعود شرقًا لتفقد أقفال السياج.',
        ],
        nextNodeId: 'hub',
      },
      farewell: {
        id: 'farewell',
        lines: ['استمتع بأشعة الشمس أيها المسافر!'],
        nextNodeId: null,
      },
    },
  },

  'npc-alden': {
    npcId: 'npc-alden',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-ridge-scouting', questStatusIn: ['ready'] },
        nodeId: 'scout_ready',
      },
      {
        condition: { questId: 'quest-into-the-wild', questStatusIn: ['ready'] },
        nodeId: 'mine_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_night' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'الوضع آمن تمامًا على طول المدخل الجنوبي أيها المسافر.',
          'تبقى أوكهولو هادئة، ومع ذلك نبقي عينًا ساهرة على الطرق الرئيسية والدروب الشمالية.',
        ],
        choices: [
          {
            id: 'ask-scout-quest',
            label: 'هل تحتاج كشّافًا لتفقد الدروب الشمالية؟',
            nextNodeId: 'scout_offer',
            questTag: 'accept',
            condition: { questId: 'quest-ridge-scouting', questStatusIn: ['available'] },
          },
          {
            id: 'ask-scout-progress',
            label: 'بخصوص تفقد لافتة ممر المرتفعات...',
            nextNodeId: 'scout_progress',
            questTag: 'progress',
            condition: { questId: 'quest-ridge-scouting', questStatusIn: ['active'] },
          },
          {
            id: 'ask-mine-quest',
            label: 'هل رصد المسافرون آثارًا أو مناجم قديمة في الأبعد؟',
            nextNodeId: 'mine_offer',
            questTag: 'accept',
            condition: { questId: 'quest-into-the-wild', questStatusIn: ['available'] },
          },
          {
            id: 'ask-mine-progress',
            label: 'بخصوص رحلة منجم حجر الشمس...',
            nextNodeId: 'mine_progress',
            questTag: 'progress',
            condition: { questId: 'quest-into-the-wild', questStatusIn: ['active'] },
          },
          { id: 'ask-roads', label: 'هل الطرق المحيطة آمنة؟', nextNodeId: 'road_safety' },
          { id: 'ask-watch', label: 'ما المسار الذي تحرسه؟', nextNodeId: 'patrol_route' },
          { id: 'bye', label: 'واصل عملك أيها الحارس.', nextNodeId: 'farewell' },
        ],
      },
      greet_night: {
        id: 'greet_night',
        lines: [
          'الفوانيس تضيء الساحة بنعومة — نوبة حراسة هادئة الليلة.',
          'الزم علامات الطريق إذا سافرت بعد حلول الظلام.',
        ],
        choices: [
          {
            id: 'ask-scout-quest',
            label: 'هل تحتاج من يستطلع ممر المرتفعات؟',
            nextNodeId: 'scout_offer',
            questTag: 'accept',
            condition: { questId: 'quest-ridge-scouting', questStatusIn: ['available'] },
          },
          {
            id: 'ask-scout-progress',
            label: 'بخصوص تفقد لافتة ممر المرتفعات...',
            nextNodeId: 'scout_progress',
            questTag: 'progress',
            condition: { questId: 'quest-ridge-scouting', questStatusIn: ['active'] },
          },
          { id: 'ask-roads', label: 'هل توجد أخطار خارج القرية؟', nextNodeId: 'road_safety' },
          { id: 'bye', label: 'ابقَ يقظًا أيها الحارس.', nextNodeId: 'farewell' },
        ],
      },
      scout_offer: {
        id: 'scout_offer',
        questId: 'quest-ridge-scouting',
        lines: [
          'مع انشغالي وسيرا بحراسة ساحة القرية، لم يصعد أحد لتفقد لافتة ممر المرتفعات شمال أوكهولو منذ أيام.',
          'اتجه شمالًا نحو سفوح الجبال حتى تصل إلى لافتة ممر المرتفعات، ثم أبلغني مقابل 85 خبرة و35 عملة!',
        ],
        choices: [
          {
            id: 'accept-scout',
            label: 'سأستطلع لافتة ممر المرتفعات من أجلك.',
            nextNodeId: 'scout_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-ridge-scouting' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: كشّاف التلال الشمالية (صل للافتة ممر المرتفعات).',
              },
            ],
          },
          { id: 'decline-scout', label: 'ربما لاحقًا أيها الحارس.', nextNodeId: 'hub' },
        ],
      },
      scout_accepted: {
        id: 'scout_accepted',
        questId: 'quest-ridge-scouting',
        lines: [
          'أشكرك جزيلًا! اتبع السهول شمالًا بعد أوكهولو حتى تبدأ التلال الصخرية قرب Z -138.',
          'عُد وأبلغني فور تفقدك للافتة.',
        ],
        nextNodeId: null,
      },
      scout_progress: {
        id: 'scout_progress',
        questId: 'quest-ridge-scouting',
        lines: [
          'تقف لافتة ممر المرتفعات شمال أوكهولو تمامًا حول X 10 وZ -138.',
          'اقترب من بداية الدرب الجبلي وعُد لتؤكد لي خلوّ المسار.',
        ],
        nextNodeId: 'hub',
      },
      scout_ready: {
        id: 'scout_ready',
        questId: 'quest-ridge-scouting',
        lines: [
          'توقيت ممتاز! هل وصلت إلى لافتة ممر المرتفعات؟',
          'هل ما زالت علامات الدرب الجبلي صامدة وسليمة من الانهيارات؟',
        ],
        choices: [
          {
            id: 'complete-scout',
            label: 'أبلغ بأن درب ممر المرتفعات سالك وآمن.',
            nextNodeId: 'scout_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-ridge-scouting' }],
          },
          { id: 'talk-else', label: 'انتظر — لدي سؤال آخر أولًا.', nextNodeId: 'hub' },
        ],
      },
      scout_completed: {
        id: 'scout_completed',
        questId: 'quest-ridge-scouting',
        lines: [
          'هذا يطمئن بالي! يمكن للمسافرين سلوك الممر الشمالي بأمان.',
          'تفضّل 85 خبرة و35 عملة من مخصصات حرس أوكهولو!',
        ],
        nextNodeId: null,
      },
      hub: {
        id: 'hub',
        lines: ['هل تحتاج إرشادًا آخر من نقطة الحراسة؟'],
        choices: [
          {
            id: 'ask-scout-quest',
            label: 'أخبرني عن مهمة استطلاع ممر المرتفعات.',
            nextNodeId: 'scout_offer',
            questTag: 'accept',
            condition: { questId: 'quest-ridge-scouting', questStatusIn: ['available'] },
          },
          { id: 'ask-roads', label: 'هل الطرق آمنة؟', nextNodeId: 'road_safety' },
          { id: 'ask-watch', label: 'ما المسار الذي تحرسه؟', nextNodeId: 'patrol_route' },
          { id: 'bye', label: 'شكرًا يا ألدن.', nextNodeId: 'farewell' },
        ],
      },
      road_safety: {
        id: 'road_safety',
        lines: [
          'أمان تام حول القرية. الخطر الأكبر هنا هو الجروف الحادة شمالًا وتيارات النهر العميقة غربًا.',
          'خذ استراحة عند البئر الحجري إن شعرت بالإرهاق بعد رحلة طويلة.',
        ],
        nextNodeId: 'hub',
      },
      patrol_route: {
        id: 'patrol_route',
        lines: [
          'أمشي على المدخل الجنوبي صباحًا، وأجوب طريق القرية الشرقي الغربي ظهرًا، وأقف ليلًا عند لافتة البوابة.',
          'بينما تغطي سيرا ساحة السوق المركزية فلا يفوتنا شيء.',
        ],
        nextNodeId: 'hub',
      },
      mine_offer: {
        id: 'mine_offer',
        questId: 'quest-into-the-wild',
        lines: [
          'أبلغ عمال المناجم عن عروق حديد غنية وأنفاق قديمة في منجم حجر الشمس بعيدًا نحو الشمال الشرقي قرب (X 840, Z -330).',
          'استطلع مدخل منجم حجر الشمس وعُد لتبلغني مقابل 160 خبرة و95 عملة!',
        ],
        choices: [
          {
            id: 'accept-mine',
            label: 'سأفحص منجم حجر الشمس لصالح الحرس.',
            nextNodeId: 'mine_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-into-the-wild' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: إلى المناجم البرية (اكتشف منجم حجر الشمس).',
              },
            ],
          },
          { id: 'decline-mine', label: 'المكان بعيد عليّ الآن.', nextNodeId: 'hub' },
        ],
      },
      mine_accepted: {
        id: 'mine_accepted',
        questId: 'quest-into-the-wild',
        lines: [
          'راجع خريطتك بحثًا عن التلال الصخرية في الشمال الشرقي، وابحث عن العوارض الخشبية والفوانيس المضيئة أمام منجم حجر الشمس!',
        ],
        nextNodeId: null,
      },
      mine_progress: {
        id: 'mine_progress',
        questId: 'quest-into-the-wild',
        lines: [
          'يقع منجم حجر الشمس شمال شرق أوكهولو قرب (X 840, Z -330). احمل سلاحًا متينًا وعُد لإبلاغي بعد وصولك إليه.',
        ],
        nextNodeId: 'hub',
      },
      mine_ready: {
        id: 'mine_ready',
        questId: 'quest-into-the-wild',
        lines: [
          'لقد وصلت إلى منجم حجر الشمس وعدت سالمًا! هل الأنفاق ما زالت سليمة؟',
        ],
        choices: [
          {
            id: 'complete-mine',
            label: 'أبلغ بتقرير مسح منجم حجر الشمس.',
            nextNodeId: 'mine_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-into-the-wild' }],
          },
          { id: 'talk-else', label: 'انتظر، لنتحدث لحظة.', nextNodeId: 'hub' },
        ],
      },
      mine_completed: {
        id: 'mine_completed',
        questId: 'quest-into-the-wild',
        lines: [
          'عمل استطلاعي رائع! سيسعد حدادونا كثيرًا بسماع أن عروق الحديد مفتوحة من جديد.',
          'تفضّل 160 خبرة و95 عملة من صندوق حرس الحدود.',
        ],
        nextNodeId: null,
      },
      farewell: {
        id: 'farewell',
        lines: ['رحلة آمنة على طرق الوادي!'],
        nextNodeId: null,
      },
    },
  },

  'npc-sera': {
    npcId: 'npc-sera',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'أقوم بجولتي حول ساحة أوكهولو — حركة نشطة وهادئة اليوم!',
          'بين المخبز والصيدلية والبئر، هذه الساحة هي قلب الوادي النابض.',
        ],
        choices: [
          { id: 'ask-square', label: 'ماذا يحدث في الساحة خلال اليوم؟', nextNodeId: 'square_life' },
          { id: 'ask-neighbors', label: 'مع من تنصحينني أن أتحدث هنا؟', nextNodeId: 'neighbor_tips' },
          { id: 'bye', label: 'شكرًا يا سيرا.', nextNodeId: 'farewell' },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أقوم بدورية الغسق تحت مصابيح الشارع — ليلة هادئة تعم أوكهولو.',
          'أخبر ألدن أو أخبرني إن احتجت أي اتجاهات.',
        ],
        choices: [
          { id: 'ask-square', label: 'أخبريني عن الروتين اليومي هنا.', nextNodeId: 'square_life' },
          { id: 'ask-neighbors', label: 'من لديه مهام يمكنني المساعدة بها؟', nextNodeId: 'neighbor_tips' },
          { id: 'bye', label: 'نوبة هادئة يا سيرا.', nextNodeId: 'farewell' },
        ],
      },
      hub: {
        id: 'hub',
        lines: ['هل هناك شيء آخر أشير إليه لك حول الساحة؟'],
        choices: [
          { id: 'ask-square', label: 'ماذا يجري في الساحة؟', nextNodeId: 'square_life' },
          { id: 'ask-neighbors', label: 'من قد يحتاج يد عون؟', nextNodeId: 'neighbor_tips' },
          { id: 'bye', label: 'سِر بأمان يا سيرا.', nextNodeId: 'farewell' },
        ],
      },
      square_life: {
        id: 'square_life',
        lines: [
          'يفتح التجار متاجرهم طوال الصباح وبعد الظهر، ويجلب توبي ومارين المحاصيل الطازجة من المزرعة، ويجتمع القرويون قرب البئر عند الغسق.',
          'ومع حلول الليل يعود الجميع لمنازلهم بينما نراقب أنا وألدن الفوانيس.',
        ],
        nextNodeId: 'hub',
      },
      neighbor_tips: {
        id: 'neighbor_tips',
        lines: [
          'كلارا وروان يجمعان الأعشاب لمساعدة القرية، وليرا تحتاج أعشاب مروج، وتوبي يرسل القمح لبرام، وألدن وغاريك يبحثان عن كشّافين.',
          'اضغط J في أي وقت لتفقد سجل المهام!',
        ],
        nextNodeId: 'hub',
      },
      farewell: {
        id: 'farewell',
        lines: ['سِر بأمان أيها المستكشف.'],
        nextNodeId: null,
      },
    },
  },

  'npc-doran': {
    npcId: 'npc-doran',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-the-blacksmith', questStatusIn: ['ready'] },
        nodeId: 'smith_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'رنين السندان! هل تسمع هذا الصوت؟ الجمر الحامي وخام الحديد والفولاذ المتين هي ما يحمي المغامرين في البرية.',
          'أحضر لي نصولك البالية متى احتجت إلى شحذها، أو جرّب أن تصنع سيفك الحديدي بنفسك!',
        ],
        choices: [
          {
            id: 'ask-smith-quest',
            label: 'هل يمكنك تعليمي كيف أصنع سيفًا حديديًا؟',
            nextNodeId: 'smith_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-blacksmith', questStatusIn: ['available'] },
          },
          {
            id: 'ask-smith-progress',
            label: 'بخصوص مهمة صناعة السيف الحديدي...',
            nextNodeId: 'smith_progress',
            questTag: 'progress',
            condition: { questId: 'quest-the-blacksmith', questStatusIn: ['active'] },
          },
          {
            id: 'repair-weapons',
            label: 'أصلِح جميع أسلحتي المجهّزة وفي الحقيبة (15 عملة).',
            nextNodeId: 'repair_done',
            condition: { minCoins: 15 },
            effects: [{ type: 'repairWeapons', costCoins: 15 }],
          },
          {
            id: 'ask-ores',
            label: 'أين أجد خام الحديد والفحم؟',
            nextNodeId: 'ore_tips',
          },
          {
            id: 'bye',
            label: 'أبقِ الكور مشتعلًا يا دوران.',
            nextNodeId: 'farewell',
          },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أخمِد جمر المصهر لليلة أيها المسافر. عُد في النهار لدروس الحدادة أو إصلاح الأسلحة.',
        ],
        choices: [
          {
            id: 'ask-smith-quest',
            label: 'هل يمكنك تعليمي كيف أصنع سيفًا حديديًا؟',
            nextNodeId: 'smith_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-blacksmith', questStatusIn: ['available'] },
          },
          {
            id: 'repair-weapons',
            label: 'أصلِح جميع أسلحتي (15 عملة).',
            nextNodeId: 'repair_done',
            condition: { minCoins: 15 },
            effects: [{ type: 'repairWeapons', costCoins: 15 }],
          },
          {
            id: 'bye',
            label: 'تصبح على خير يا دوران.',
            nextNodeId: 'farewell',
          },
        ],
      },
      smith_offer: {
        id: 'smith_offer',
        questId: 'quest-the-blacksmith',
        lines: [
          'على كل مغامر حقيقي أن يصنع سلاحه الفولاذي بيديه مرة واحدة على الأقل!',
          'استخرج 4 من خام الحديد من التلال الصخرية أو المناجم، وافتح تبويب التصنيع لصنع سيف حديدي، ثم أرِني نصلك!',
        ],
        choices: [
          {
            id: 'accept-smith',
            label: 'سأستخرج خام الحديد وأصنع سيفًا حديديًا!',
            nextNodeId: 'smith_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-the-blacksmith' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: المطرقة والسندان (اجمع 4 خام حديد واصنع سيفًا حديديًا).',
              },
            ],
          },
          {
            id: 'decline-smith',
            label: 'ليس الآن يا دوران.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      smith_accepted: {
        id: 'smith_accepted',
        questId: 'quest-the-blacksmith',
        lines: [
          'ابحث عن عروق المعدن الداكن قرب التلال الجبلية أو منجم حجر الشمس أو كهوف الكريستال. وتذكر أنك ستحتاج أيضًا إلى 2 من الفحم و2 من الخشب لوصفة السيف الحديدي!',
        ],
        nextNodeId: null,
      },
      smith_progress: {
        id: 'smith_progress',
        questId: 'quest-the-blacksmith',
        lines: [
          'اجمع 4 من خام الحديد (مع 2 فحم و2 خشب)، ثم افتح الحقيبة وانتقل إلى تبويب التصنيع لصنع سيف حديدي.',
        ],
        nextNodeId: 'greet_day',
      },
      smith_ready: {
        id: 'smith_ready',
        questId: 'quest-the-blacksmith',
        lines: [
          'هاه! انظر إلى هذا السيف الحديدي الجديد يلمع في ضوء النار! توازن متقن!',
        ],
        choices: [
          {
            id: 'complete-smith',
            label: 'أرِ دوران سيفك الحديدي الجديد.',
            nextNodeId: 'smith_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-the-blacksmith' }],
          },
          {
            id: 'later-smith',
            label: 'لنتحدث عن الإصلاحات أولًا.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      smith_completed: {
        id: 'smith_completed',
        questId: 'quest-the-blacksmith',
        lines: [
          'صنعة مُتقنة! خُذ 125 خبرة و65 عملة و4 من الفحم لتنتقل بعدها إلى صناعة سيف فولاذي.',
        ],
        nextNodeId: null,
      },
      repair_done: {
        id: 'repair_done',
        lines: [
          'تمريرة سريعة على حجر الشحذ ومسحة زيت على الحدّ — عادت أسلحتك كالجديدة تمامًا!',
        ],
        nextNodeId: 'greet_day',
      },
      ore_tips: {
        id: 'ore_tips',
        lines: [
          'تنتشر عروق خام الحديد والفحم على المنحدرات الجبلية الصخرية وداخل الكهوف مثل منجم حجر الشمس وكهف الكريستال الصدى.',
        ],
        nextNodeId: 'greet_day',
      },
      farewell: {
        id: 'farewell',
        lines: ['لتكن ضربتك صائبة أيها المسافر!'],
        nextNodeId: null,
      },
    },
  },

  'npc-finnian': {
    npcId: 'npc-finnian',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-the-hunter', questStatusIn: ['ready'] },
        nodeId: 'hunter_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'خطوات هادئة بين الأعشاب يا صديقي. تبقى الغزلان والماشية الراعية هادئة ما لم يُفزعها نصل أو سهم.',
          'اصطد بحكمة — اجمع اللحم للموقد، والجلود للدباغة، والريش لصناعة السهام.',
        ],
        choices: [
          {
            id: 'ask-hunter-quest',
            label: 'هل توجد مهام صيد حول أوكهولو؟',
            nextNodeId: 'hunter_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-hunter', questStatusIn: ['available'] },
          },
          {
            id: 'ask-hunter-progress',
            label: 'بخصوص مهمة الصياد الماهر...',
            nextNodeId: 'hunter_progress',
            questTag: 'progress',
            condition: { questId: 'quest-the-hunter', questStatusIn: ['active'] },
          },
          {
            id: 'ask-drops',
            label: 'ما المواد التي تسقطها الحيوانات المختلفة؟',
            nextNodeId: 'drops_guide',
          },
          {
            id: 'bye',
            label: 'صيدًا موفقًا يا فينيان.',
            nextNodeId: 'farewell',
          },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'الشفق يجعل اقتفاء الأثر صعبًا — حان الوقت لتجهيز ما اصطدناه والراحة في الداخل.',
        ],
        choices: [
          {
            id: 'ask-hunter-quest',
            label: 'هل توجد مهام صيد حول أوكهولو؟',
            nextNodeId: 'hunter_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-hunter', questStatusIn: ['available'] },
          },
          {
            id: 'bye',
            label: 'تصبح على خير يا فينيان.',
            nextNodeId: 'farewell',
          },
        ],
      },
      hunter_offer: {
        id: 'hunter_offer',
        questId: 'quest-the-hunter',
        lines: [
          'مخزن القرية بحاجة إلى لحوم طازجة قبل أن تشتد رياح الشتاء.',
          'اصطد 4 حيوانات في البرية، واجمع 3 قطع من اللحم النيئ من غنائمها، وأحضرها إليّ مقابل 130 خبرة و70 عملة و10 سهام!',
        ],
        choices: [
          {
            id: 'accept-hunter',
            label: 'سأصطاد 4 حيوانات وأحضر 3 قطع لحم نيئ.',
            nextNodeId: 'hunter_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-the-hunter' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: درب الصياد (اصطد 4 حيوانات وسلّم 3 لحم نيئ).',
              },
            ],
          },
          {
            id: 'decline-hunter',
            label: 'ليس الآن.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      hunter_accepted: {
        id: 'hunter_accepted',
        questId: 'quest-the-hunter',
        lines: [
          'استخدم قوسًا أو رمحًا أو سيفًا لصيد الغزلان أو الأبقار أو الأغنام أو الدجاج أو الذئاب — وتذكّر التقاط الغنائم المتوهجة بعدها!',
        ],
        nextNodeId: null,
      },
      hunter_progress: {
        id: 'hunter_progress',
        questId: 'quest-the-hunter',
        lines: [
          'اصطد 4 حيوانات برية واجمع 3 قطع لحم نيئ من غنائمها، ثم أحضرها إليّ.',
        ],
        nextNodeId: 'greet_day',
      },
      hunter_ready: {
        id: 'hunter_ready',
        questId: 'quest-the-hunter',
        lines: [
          'تصويب دقيق وأيدٍ ثابتة! هل قطع اللحم النيئ الثلاث جاهزة؟',
        ],
        choices: [
          {
            id: 'complete-hunter',
            label: 'سلّم 3 قطع لحم نيئ إلى فينيان.',
            nextNodeId: 'hunter_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-the-hunter' }],
          },
          {
            id: 'later-hunter',
            label: 'انتظر لحظة.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      hunter_completed: {
        id: 'hunter_completed',
        questId: 'quest-the-hunter',
        lines: [
          'أجود القطع في الوادي! تفضّل 130 خبرة و70 عملة و10 سهام صيد لجعبتك.',
        ],
        nextNodeId: null,
      },
      drops_guide: {
        id: 'drops_guide',
        lines: [
          'تمنح الغزلان اللحم والجلد؛ والأبقار اللحم والجلد المدبوغ؛ والأغنام اللحم والصوف؛ والدجاج اللحم والريش؛ أما الذئاب والدببة فتمنح الفراء.',
        ],
        nextNodeId: 'greet_day',
      },
      farewell: {
        id: 'farewell',
        lines: ['امشِ بخفة فوق الطحالب أيها الصياد.'],
        nextNodeId: null,
      },
    },
  },

  'npc-corvin': {
    npcId: 'npc-corvin',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-build-shelter', questStatusIn: ['ready'] },
        nodeId: 'shelter_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'صباح الخير! لا شيء يضاهي رائحة خشب الصنوبر والبلوط الطازج.',
          'باستخدام 10 من الخشب و5 من ألياف النباتات، يمكن لأي مغامر صنع سرير التخييم المتين للنوم في أي مكان في البرية.',
        ],
        choices: [
          {
            id: 'ask-shelter-quest',
            label: 'أرني كيف أصنع سرير التخييم الخاص بي.',
            nextNodeId: 'shelter_offer',
            questTag: 'accept',
            condition: { questId: 'quest-build-shelter', questStatusIn: ['available'] },
          },
          {
            id: 'ask-shelter-progress',
            label: 'بخصوص صنع سرير التخييم...',
            nextNodeId: 'shelter_progress',
            questTag: 'progress',
            condition: { questId: 'quest-build-shelter', questStatusIn: ['active'] },
          },
          {
            id: 'ask-harvest',
            label: 'ما الأشجار التي يمكنني قطعها للحصول على الخشب؟',
            nextNodeId: 'harvest_tips',
          },
          {
            id: 'bye',
            label: 'واصل قطع الخشب يا كورفين.',
            nextNodeId: 'farewell',
          },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'أرتّب آخر جذوع الخشب قبل حلول الظلام. لا تنسَ صنع سرير أو إيجاد مأوى قبل منتصف الليل!',
        ],
        choices: [
          {
            id: 'ask-shelter-quest',
            label: 'أرني كيف أصنع سرير التخييم الخاص بي.',
            nextNodeId: 'shelter_offer',
            questTag: 'accept',
            condition: { questId: 'quest-build-shelter', questStatusIn: ['available'] },
          },
          {
            id: 'bye',
            label: 'تصبح على خير يا كورفين.',
            nextNodeId: 'farewell',
          },
        ],
      },
      shelter_offer: {
        id: 'shelter_offer',
        questId: 'quest-build-shelter',
        lines: [
          'كل مستكشف يحتاج إلى سرير خاص به! اجمع 10 من الخشب من الأشجار المعلّمة أو الأغصان المتساقطة، و5 من ألياف النباتات من شجيرات القصب.',
          'بعد ذلك افتح الحقيبة وانتقل إلى تبويب التصنيع لصنع سرير التخييم، ثم عُد لتُريني إياه!',
        ],
        choices: [
          {
            id: 'accept-shelter',
            label: 'سأجمع الخشب وألياف النباتات وأصنع سرير التخييم.',
            nextNodeId: 'shelter_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-build-shelter' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: ابنِ مأواك (اجمع الخشب وألياف النباتات واصنع سرير التخييم).',
              },
            ],
          },
          {
            id: 'decline-shelter',
            label: 'لاحقًا يا كورفين.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      shelter_accepted: {
        id: 'shelter_accepted',
        questId: 'quest-build-shelter',
        lines: [
          'ستحتفظ بسرير التخييم بعد صنعه — فقط استخدمه من حقيبتك متى ما حلّ المساء!',
        ],
        nextNodeId: null,
      },
      shelter_progress: {
        id: 'shelter_progress',
        questId: 'quest-build-shelter',
        lines: [
          'اجمع 10 من الخشب و5 من ألياف النباتات، ثم اصنع سرير التخييم من تبويب التصنيع.',
        ],
        nextNodeId: 'greet_day',
      },
      shelter_ready: {
        id: 'shelter_ready',
        questId: 'quest-build-shelter',
        lines: [
          'انظر إلى هذا التماسك المتقن — عشرة ألواح من الخشب وألياف منسوجة كأنك نجار محترف!',
        ],
        choices: [
          {
            id: 'complete-shelter',
            label: 'أنهِ درس صناعة سرير التخييم.',
            nextNodeId: 'shelter_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-build-shelter' }],
          },
        ],
      },
      shelter_completed: {
        id: 'shelter_completed',
        questId: 'quest-build-shelter',
        lines: [
          'أحسنت صنعًا! تفضّل 95 خبرة و40 عملة ورغيف فرن حجر الشمس الدافئ.',
        ],
        nextNodeId: null,
      },
      harvest_tips: {
        id: 'harvest_tips',
        lines: [
          'ابحث عن أشجار الخشب المعلّمة وجذوع البلوط المتساقطة وشجيرات الألياف الخضراء حول فسحات الغابة والدروب. اقترب واضغط زر التفاعل للجمع!',
        ],
        nextNodeId: 'greet_day',
      },
      farewell: {
        id: 'farewell',
        lines: ['لتكن ضربات فأسك متقنة أيها المسافر!'],
        nextNodeId: null,
      },
    },
  },

  'npc-thorne': {
    npcId: 'npc-thorne',
    defaultStartNodeId: 'greet_day',
    entryRules: [
      {
        condition: { questId: 'quest-first-night', questStatusIn: ['ready'] },
        nodeId: 'night_ready',
      },
      {
        condition: { questId: 'quest-the-village', questStatusIn: ['ready'] },
        nodeId: 'settlements_ready',
      },
      { condition: { periodIn: ['evening', 'night'] }, nodeId: 'greet_evening' },
    ],
    nodes: {
      greet_day: {
        id: 'greet_day',
        lines: [
          'باركت السماء خطاك أيها المستكشف الشاب! سبع مستوطنات تضيء الآن أرجاء هذا الوادي العظيم.',
          'من باينهافن في الغابات الغربية إلى غراندكروس في الشرق، كل طريق يدعوك للاكتشاف.',
        ],
        choices: [
          {
            id: 'ask-night-quest',
            label: 'هل لديك نصيحة لقضاء ليلتي الأولى بأمان؟',
            nextNodeId: 'night_offer',
            questTag: 'accept',
            condition: { questId: 'quest-first-night', questStatusIn: ['available'] },
          },
          {
            id: 'ask-settlements-quest',
            label: 'أخبرني عن استكشاف القرى الأخرى.',
            nextNodeId: 'settlements_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-village', questStatusIn: ['available'] },
          },
          {
            id: 'ask-realm',
            label: 'اذكر لي أسماء جميع المستوطنات في هذه الأراضي.',
            nextNodeId: 'realm_lore',
          },
          {
            id: 'bye',
            label: 'دمت بخير أيها الشيخ ثورن.',
            nextNodeId: 'farewell',
          },
        ],
      },
      greet_evening: {
        id: 'greet_evening',
        lines: [
          'تزداد السماء عمقًا وهدوءًا. سيعود القرويون قريبًا إلى منازلهم للنوم حتى الصباح.',
        ],
        choices: [
          {
            id: 'ask-night-quest',
            label: 'كيف أقضي ليلتي الأولى بأمان؟',
            nextNodeId: 'night_offer',
            questTag: 'accept',
            condition: { questId: 'quest-first-night', questStatusIn: ['available'] },
          },
          {
            id: 'ask-settlements-quest',
            label: 'أخبرني عن القرى الأخرى.',
            nextNodeId: 'settlements_offer',
            questTag: 'accept',
            condition: { questId: 'quest-the-village', questStatusIn: ['available'] },
          },
          {
            id: 'bye',
            label: 'ليلة هانئة أيها الشيخ ثورن.',
            nextNodeId: 'farewell',
          },
        ],
      },
      night_offer: {
        id: 'night_offer',
        questId: 'quest-first-night',
        lines: [
          'عندما يحل المساء، اقترب من أي سرير في منازل القرية أو معسكرات الاستكشاف أو سرير التخييم الذي صنعته واضغط «نوم».',
          'نم حتى الصباح لتستعيد قوتك، ثم تحدّث معي عند الفجر!',
        ],
        choices: [
          {
            id: 'accept-night',
            label: 'سأرتاح في سرير الليلة وأحيّيك عند الفجر.',
            nextNodeId: 'night_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-first-night' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: عبر الليل الهادئ (نم في سرير حتى الصباح).',
              },
            ],
          },
          {
            id: 'decline-night',
            label: 'ربما لاحقًا أيها الشيخ.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      night_accepted: {
        id: 'night_accepted',
        questId: 'quest-first-night',
        lines: [
          'أحلام سعيدة تحت النجوم أو تحت سقف كوخ دافئ!',
        ],
        nextNodeId: null,
      },
      night_ready: {
        id: 'night_ready',
        questId: 'quest-first-night',
        lines: [
          'صباح الخير! تبدو مرتاحًا ومستعدًا للعالم الواسع أمامك!',
        ],
        choices: [
          {
            id: 'complete-night',
            label: 'حيِّ الشيخ ثورن بعد ليلة هانئة.',
            nextNodeId: 'night_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-first-night' }],
          },
        ],
      },
      night_completed: {
        id: 'night_completed',
        questId: 'quest-first-night',
        lines: [
          'المسافر المرتاح يرى ضعف المسافة! خُذ 100 خبرة و50 عملة.',
        ],
        nextNodeId: null,
      },
      settlements_offer: {
        id: 'settlements_offer',
        questId: 'quest-the-village',
        lines: [
          'يمتد وادينا أميالًا في كل اتجاه الآن! اكتشف ما لا يقل عن 8 قرى إقليمية أو مناجم أو معسكرات مهجورة وأخبرني بما رأيت.',
        ],
        choices: [
          {
            id: 'accept-settlements',
            label: 'سأستكشف القرى البعيدة والآثار.',
            nextNodeId: 'settlements_accepted',
            questTag: 'accept',
            effects: [
              { type: 'startQuest', questId: 'quest-the-village' },
              {
                type: 'notice',
                message: 'تم قبول المهمة: المستوطنات السبع (اكتشف 8 مواقع أو قرى).',
              },
            ],
          },
          {
            id: 'decline-settlements',
            label: 'ليس بعد.',
            nextNodeId: 'greet_day',
          },
        ],
      },
      settlements_accepted: {
        id: 'settlements_accepted',
        questId: 'quest-the-village',
        lines: [
          'افتح خريطة العالم في أي وقت لتتبع كل مستوطنة جديدة تصل إليها!',
        ],
        nextNodeId: null,
      },
      settlements_ready: {
        id: 'settlements_ready',
        questId: 'quest-the-village',
        lines: [
          'لقد عبرت خطاك قرى بعيدة ومعسكرات وآثارًا! دعنا ندوّن سجل رحلتك!',
        ],
        choices: [
          {
            id: 'complete-settlements',
            label: 'شارك اكتشافاتك عبر المستوطنات السبع.',
            nextNodeId: 'settlements_completed',
            questTag: 'complete',
            effects: [{ type: 'completeQuest', questId: 'quest-the-village' }],
          },
        ],
      },
      settlements_completed: {
        id: 'settlements_completed',
        questId: 'quest-the-village',
        lines: [
          'أنت حقًا أسطورة الوادي! تفضّل 150 خبرة و90 عملة.',
        ],
        nextNodeId: null,
      },
      realm_lore: {
        id: 'realm_lore',
        lines: [
          'تقع أوكهولو في القلب؛ وتؤوي باينهافن الحطّابين غربًا؛ وتزدهر غرينفيلدز بالزراعة جنوبًا؛ وتستخرج كراغووتش الحديد شمالًا؛ وتصطاد ريفرفورد من النهر؛ وترعى ويندمير في السهول الشرقية؛ وتتاجر غراندكروس قرب الكثبان.',
        ],
        nextNodeId: 'greet_day',
      },
      farewell: {
        id: 'farewell',
        lines: ['سِر بحكمة أيها المسافر.'],
        nextNodeId: null,
      },
    },
  },
};
