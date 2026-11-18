import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  Coins,
  Compass,
  Lock,
  MapPin,
  Moon,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Sparkles,
  Tag,
  Target,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { CoopObjectiveState } from '../../shared/multiplayerProtocol';
import type { QuestView } from '../game/quest/questTypes';
import type {
  StoryJournalSnapshot,
  StoryQuestState,
  StoryQuestView,
} from '../game/story/storyTypes';
import type {
  SideQuestCategory,
  SideQuestJournalSnapshot,
  SideQuestState,
  SideQuestView,
} from '../game/sidequest/sideQuestTypes';
import {
  QUEST_STATUS_LABELS,
  UI_TEXT,
  type Language,
} from '../game/i18n/translations';

interface QuestJournalModalProps {
  activeQuests: QuestView[];
  completedQuests: QuestView[];
  availableQuests: QuestView[];
  coopObjective?: CoopObjectiveState | null;
  storyJournal?: StoryJournalSnapshot | null;
  sideQuestJournal?: SideQuestJournalSnapshot | null;
  level: number;
  xp: number;
  xpToNextLevel: number;
  coins: number;
  lang: Language;
  onTrackQuest: (questId: string) => void;
  onStartStoryQuest?: (questId: string) => void;
  onRetryStoryQuest?: (questId: string) => void;
  onAcceptSideQuest?: (sideQuestId: string) => void;
  onAbandonSideQuest?: (sideQuestId: string) => void;
  onRetrySideQuest?: (sideQuestId: string) => void;
  onStartCoopQuest?: (questId: string) => void;
  onCompleteCoopQuest?: (questId: string) => void;
  onClose: () => void;
}

type JournalTab = 'story' | 'side' | 'active' | 'completed' | 'available';

function getStoryStateBadgeClass(state: StoryQuestState): string {
  switch (state) {
    case 'OBJECTIVE_COMPLETED':
      return 'bg-[#1d3b28] text-[#98eba8] border-[#376b4b]';
    case 'ACTIVE':
      return 'bg-[#1d303c] text-[#94ccf2] border-[#355970]';
    case 'COMPLETED':
      return 'bg-[#28352c] text-[#b4c8b9] border-[#425748]';
    case 'FAILED':
      return 'bg-[#421f1f] text-[#fca5a5] border-[#7f3636]';
    case 'AVAILABLE':
      return 'bg-[#3a2d15] text-[#f5c76b] border-[#6b4f24]';
    default:
      return 'bg-[#17211b] text-[#7c9283] border-[#283a2f]';
  }
}

function getSideStateBadgeClass(state: SideQuestState, readyToTurnIn: boolean): string {
  if (state === 'ACTIVE' && readyToTurnIn) {
    return 'bg-[#16382b] text-[#6ee7b7] border-[#2c6e53]';
  }
  switch (state) {
    case 'ACTIVE':
      return 'bg-[#14303b] text-[#67e8f9] border-[#2a5c6d]';
    case 'AVAILABLE':
      return 'bg-[#152d3c] text-[#7dd3fc] border-[#2a546d]';
    case 'COMPLETED':
      return 'bg-[#26352c] text-[#b4c8b9] border-[#3e5446]';
    case 'FAILED':
    case 'EXPIRED':
      return 'bg-[#421f1f] text-[#fca5a5] border-[#7f3636]';
    default:
      return 'bg-[#17211b] text-[#7c9283] border-[#283a2f]';
  }
}

const SIDE_QUEST_CATEGORIES: SideQuestCategory[] = [
  'rescue',
  'delivery',
  'hunting',
  'gathering',
  'exploration',
  'village',
];

export const QuestJournalModal: React.FC<QuestJournalModalProps> = ({
  activeQuests,
  completedQuests,
  availableQuests,
  coopObjective = null,
  storyJournal = null,
  sideQuestJournal = null,
  level,
  xp,
  xpToNextLevel,
  coins,
  lang,
  onTrackQuest,
  onStartStoryQuest,
  onRetryStoryQuest,
  onAcceptSideQuest,
  onAbandonSideQuest,
  onRetrySideQuest,
  onStartCoopQuest,
  onCompleteCoopQuest,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const hasActiveCoop = Boolean(coopObjective && coopObjective.status === 'active');
  const [tab, setTab] = useState<JournalTab>(
    storyJournal
      ? 'story'
      : sideQuestJournal
        ? 'side'
        : activeQuests.length > 0 || hasActiveCoop
          ? 'active'
          : 'available',
  );
  const [sideCategoryFilter, setSideCategoryFilter] = useState<
    'all' | SideQuestCategory
  >('all');

  const xpPct = Math.max(0, Math.min(100, (xp / Math.max(1, xpToNextLevel)) * 100));
  const list =
    tab === 'active'
      ? activeQuests
      : tab === 'completed'
        ? completedQuests
        : availableQuests;

  const renderStoryQuestCard = (sq: StoryQuestView, highlight = false) => {
    const nextObj =
      sq.objectives.find((o) => o.active && !o.completed) ??
      sq.objectives.find((o) => !o.completed) ??
      null;
    const isTrackable =
      sq.state === 'ACTIVE' ||
      sq.state === 'OBJECTIVE_COMPLETED' ||
      sq.state === 'AVAILABLE';

    return (
      <div
        key={`${highlight ? 'hl-' : ''}${sq.questId}`}
        data-testid={highlight ? `story-active-card-${sq.questId}` : `story-quest-${sq.questId}`}
        className={`p-4 rounded-xl border ${
          highlight
            ? 'bg-[#17291e] border-[#e5a93c]/60 shadow-lg'
            : sq.state === 'LOCKED'
              ? 'bg-[#121e17] border-[#213328] opacity-75'
              : 'bg-[#15241b] border-[#273f31]'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {sq.state === 'LOCKED' && <Lock className="w-3.5 h-3.5 text-[#7c9283] shrink-0" />}
            <h3 className="font-display text-base font-bold text-[#f4f7f1]">
              {sq.title}
            </h3>
            <span
              className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide ${getStoryStateBadgeClass(
                sq.state,
              )}`}
            >
              {t.storyStateLabels[sq.state]}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {sq.state === 'AVAILABLE' && onStartStoryQuest && (
              <button
                type="button"
                data-testid={`start-story-quest-${sq.questId}`}
                onClick={() => onStartStoryQuest(sq.questId)}
                className="px-2.5 py-1 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] text-[11px] font-display font-bold cursor-pointer"
              >
                {t.storyStartQuestBtn}
              </button>
            )}
            {sq.state === 'FAILED' && onRetryStoryQuest && (
              <button
                type="button"
                data-testid={`retry-story-quest-${sq.questId}`}
                onClick={() => onRetryStoryQuest(sq.questId)}
                className="px-2.5 py-1 rounded-lg bg-[#ef4444] hover:bg-[#f87171] text-[#ffffff] text-[11px] font-display font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t.storyRetryQuestBtn}</span>
              </button>
            )}
            {isTrackable && (
              <button
                type="button"
                data-testid={`track-story-quest-${sq.questId}`}
                onClick={() => onTrackQuest(sq.questId)}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                  sq.tracked
                    ? 'bg-[#e5a93c] border-[#e5a93c] text-[#111914]'
                    : 'bg-[#1b2e23] hover:bg-[#233b2d] border-[#314c3c] text-[#dce7dd]'
                }`}
              >
                <Compass className="w-3 h-3" />
                <span>{sq.tracked ? t.trackedBtn : t.trackHudBtn}</span>
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-[#a3b8a8] leading-relaxed mb-2.5">
          {sq.description}
        </p>

        {highlight && (nextObj || sq.state === 'OBJECTIVE_COMPLETED') && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-[#1d3224] border border-[#e5a93c]/40 text-xs flex items-center justify-between gap-2">
            <span className="text-[#f5c76b] font-semibold">
              {t.storyNextObjectiveLabel}: {sq.currentObjectiveText}
            </span>
            <span className="font-mono-num text-[11px] text-[#dce7dd]" dir="ltr">
              {sq.progressText}
            </span>
          </div>
        )}

        <div className="space-y-1.5 mb-3">
          {sq.objectives.map((obj, idx) => (
            <div
              key={obj.id}
              className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg ${
                obj.completed
                  ? 'bg-[#13221a] text-[#8ca894] line-through'
                  : obj.active
                    ? 'bg-[#1c3024] text-[#f4f7f1] border border-[#e5a93c]/35'
                    : 'bg-[#13211a] text-[#889e8e]'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {obj.completed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#78d48b] shrink-0" />
                ) : (
                  <Circle
                    className={`w-3.5 h-3.5 shrink-0 ${
                      obj.active ? 'text-[#e5a93c]' : 'text-[#5b7162]'
                    }`}
                  />
                )}
                <span>
                  {idx + 1}. {obj.description}
                </span>
              </span>
              {obj.target > 1 && (
                <span className="font-mono-num text-[11px] text-[#d9e5da]" dir="ltr">
                  {obj.current}/{obj.target}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[#e5a93c]">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>
            {t.rewardLabel} {sq.rewardSummary}
          </span>
        </div>
      </div>
    );
  };

  const renderSideQuestCard = (sq: SideQuestView) => {
    const isTrackable =
      sq.state === 'ACTIVE' ||
      sq.state === 'AVAILABLE' ||
      sq.state === 'FAILED' ||
      sq.state === 'EXPIRED';

    return (
      <div
        key={sq.sideQuestId}
        data-testid={`side-quest-card-${sq.sideQuestId}`}
        className={`p-4 rounded-xl border ${
          sq.state === 'ACTIVE' && sq.readyToTurnIn
            ? 'bg-[#132920] border-[#34d399]/60 shadow-lg'
            : sq.state === 'ACTIVE'
              ? 'bg-[#13252a] border-[#22d3ee]/50'
              : sq.state === 'LOCKED'
                ? 'bg-[#121e17] border-[#213328] opacity-80'
                : 'bg-[#15241b] border-[#273f31]'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {sq.state === 'LOCKED' && (
              <Lock className="w-3.5 h-3.5 text-[#7c9283] shrink-0" />
            )}
            <h3 className="font-display text-base font-bold text-[#f4f7f1]">
              {sq.title}
            </h3>
            <span className="px-2 py-0.5 rounded-md border bg-[#182c22] text-[#a7ccb2] border-[#2e4b3a] text-[10px] font-semibold inline-flex items-center gap-1">
              <Tag className="w-2.5 h-2.5 shrink-0" />
              {t.sideQuestCategoryLabels[sq.category]}
            </span>
            <span
              className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide ${getSideStateBadgeClass(
                sq.state,
                sq.readyToTurnIn,
              )}`}
            >
              {sq.readyToTurnIn
                ? t.readyToTurnIn
                : t.sideQuestStateLabels[sq.state]}
            </span>
            {sq.repeatable && (
              <span className="px-2 py-0.5 rounded-md border bg-[#1c2834] text-[#93c5fd] border-[#31485e] text-[10px] font-semibold inline-flex items-center gap-1">
                <RefreshCw className="w-2.5 h-2.5 shrink-0" />
                {t.sideQuestRepeatableBadge}
              </span>
            )}
            {sq.requiredLevel > 1 && (
              <span className="px-2 py-0.5 rounded-md border bg-[#262317] text-[#fcd34d] border-[#4e4324] text-[10px] font-semibold font-mono-num">
                {t.sideQuestLevelReqBadge(sq.requiredLevel)}
              </span>
            )}
            {sq.timeWindow === 'night' && (
              <span className="px-2 py-0.5 rounded-md border bg-[#1d2036] text-[#c4b5fd] border-[#3c3f68] text-[10px] font-semibold inline-flex items-center gap-1">
                <Moon className="w-2.5 h-2.5 shrink-0" />
                {t.sideQuestNightOnlyBadge}
              </span>
            )}
            {sq.remainingHours !== null && sq.state === 'ACTIVE' && (
              <span className="px-2 py-0.5 rounded-md border bg-[#362614] text-[#fdba74] border-[#664523] text-[10px] font-semibold inline-flex items-center gap-1 font-mono-num">
                <Clock className="w-2.5 h-2.5 shrink-0" />
                {t.sideQuestTimedBadge(sq.remainingHours)}
              </span>
            )}
            {sq.cooldownRemainingSeconds > 0 && sq.state === 'COMPLETED' && (
              <span className="px-2 py-0.5 rounded-md border bg-[#1a262c] text-[#94a3b8] border-[#33464f] text-[10px] font-semibold inline-flex items-center gap-1 font-mono-num">
                <Clock className="w-2.5 h-2.5 shrink-0" />
                {t.sideQuestCooldownBadge(sq.cooldownRemainingSeconds)}
              </span>
            )}
            {sq.completedCount > 0 && sq.repeatable && (
              <span className="px-2 py-0.5 rounded-md border bg-[#192c21] text-[#86efac] border-[#2c523c] text-[10px] font-semibold font-mono-num">
                {t.sideQuestCompletedCountBadge(sq.completedCount)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {sq.state === 'AVAILABLE' && onAcceptSideQuest && (
              <button
                type="button"
                data-testid={`accept-side-quest-${sq.sideQuestId}`}
                onClick={() => onAcceptSideQuest(sq.sideQuestId)}
                className="px-2.5 py-1 rounded-lg bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#08151d] text-[11px] font-display font-bold cursor-pointer"
              >
                {t.sideQuestAcceptBtn}
              </button>
            )}
            {(sq.state === 'FAILED' || sq.state === 'EXPIRED') && onRetrySideQuest && (
              <button
                type="button"
                data-testid={`retry-side-quest-${sq.sideQuestId}`}
                onClick={() => onRetrySideQuest(sq.sideQuestId)}
                className="px-2.5 py-1 rounded-lg bg-[#ef4444] hover:bg-[#f87171] text-[#ffffff] text-[11px] font-display font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t.sideQuestRetryBtn}</span>
              </button>
            )}
            {(sq.state === 'ACTIVE' || sq.state === 'FAILED' || sq.state === 'EXPIRED') &&
              onAbandonSideQuest && (
                <button
                  type="button"
                  data-testid={`abandon-side-quest-${sq.sideQuestId}`}
                  onClick={() => onAbandonSideQuest(sq.sideQuestId)}
                  className="px-2.5 py-1 rounded-lg bg-[#1d2c24] hover:bg-[#2a3f33] border border-[#354f40] text-[#cbd5ce] text-[11px] font-semibold cursor-pointer"
                >
                  {t.sideQuestAbandonBtn}
                </button>
              )}
            {isTrackable && (
              <button
                type="button"
                data-testid={`track-side-quest-${sq.sideQuestId}`}
                onClick={() => onTrackQuest(sq.sideQuestId)}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                  sq.tracked
                    ? 'bg-[#22d3ee] border-[#22d3ee] text-[#08181c]'
                    : 'bg-[#1b2e23] hover:bg-[#233b2d] border-[#314c3c] text-[#dce7dd]'
                }`}
              >
                <Compass className="w-3 h-3" />
                <span>{sq.tracked ? t.trackedBtn : t.trackHudBtn}</span>
              </button>
            )}
          </div>
        </div>

        {sq.chainTitle && (
          <div className="text-[11px] font-semibold text-[#7dd3fc] mb-1">
            {sq.chainTitle}
          </div>
        )}

        <p className="text-xs text-[#a3b8a8] leading-relaxed mb-2">
          {sq.description}
        </p>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#9bb3a1] mb-2.5">
          <span className="inline-flex items-center gap-1">
            <UserCheck className="w-3 h-3 text-[#38bdf8] shrink-0" />
            <span>
              {t.sideQuestGiverLabel}: <strong className="text-[#e1ece3]">{sq.giverName}</strong>
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3 text-[#7dd3fc] shrink-0" />
            <span>
              {t.sideQuestLocationLabel}: <strong className="text-[#e1ece3]">{sq.location}</strong>
            </span>
          </span>
        </div>

        {sq.state === 'LOCKED' && sq.lockReason && (
          <div className="mb-2.5 px-3 py-1.5 rounded-lg bg-[#19251e] border border-[#2c4034] text-xs text-[#b7cab9] flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-[#9cb0a0] shrink-0" />
            <span>{sq.lockReason}</span>
          </div>
        )}

        {sq.state === 'ACTIVE' && (
          <div className="mb-2.5 px-3 py-2 rounded-lg bg-[#122b30] border border-[#22d3ee]/40 text-xs flex items-center justify-between gap-2">
            <span className="text-[#7dd3fc] font-semibold">
              {t.storyNextObjectiveLabel}: {sq.currentObjectiveText}
            </span>
            <span className="font-mono-num text-[11px] text-[#dce7dd]" dir="ltr">
              {sq.progressText}
            </span>
          </div>
        )}

        <div className="space-y-1.5 mb-3">
          {sq.objectives.map((obj, idx) => (
            <div
              key={obj.id}
              className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg ${
                obj.completed
                  ? 'bg-[#13221a] text-[#8ca894] line-through'
                  : obj.active
                    ? 'bg-[#162d32] text-[#f4f7f1] border border-[#22d3ee]/35'
                    : 'bg-[#13211a] text-[#889e8e]'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {obj.completed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
                ) : (
                  <Circle
                    className={`w-3.5 h-3.5 shrink-0 ${
                      obj.active ? 'text-[#22d3ee]' : 'text-[#5b7162]'
                    }`}
                  />
                )}
                <span>
                  {idx + 1}. {obj.description}
                </span>
              </span>
              {obj.target > 1 && (
                <span className="font-mono-num text-[11px] text-[#d9e5da]" dir="ltr">
                  {obj.current}/{obj.target}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[#e5a93c]">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>
            {t.rewardLabel} {sq.rewardSummary}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/72 p-3 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quest-journal-title"
      data-testid="quest-journal-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl bg-[#101c16] border border-[#2a3f33] p-4 sm:p-6 text-[#f1f5ee] shadow-2xl overflow-x-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <ScrollText className="w-5 h-5 text-[#e5a93c]" />
            <h2 id="quest-journal-title" className="font-display text-xl font-bold">
              {t.questJournal}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-lg bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] flex items-center justify-center cursor-pointer"
            aria-label={t.closeBtn}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Adventurer Progression Bar */}
        <div className="mb-4 p-3.5 rounded-xl bg-[#15241c] border border-[#273f31] flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-center justify-between text-xs font-medium mb-1.5">
              <span className="font-display font-bold text-[#f3f7f0]">
                {t.levelAdventurer(level)}
              </span>
              <span className="font-mono-num text-[#b8ccb9]">
                {xp} / {xpToNextLevel} {t.xpShort}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[#0d1712] overflow-hidden">
              <div
                className="h-full bg-[#e5a93c] transition-[width] duration-200"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>

          <div className="px-3 py-1.5 rounded-xl bg-[#1b2d23] border border-[#2f493a] flex items-center gap-2">
            <Coins className="w-4 h-4 text-[#e5a93c]" />
            <span className="font-mono-num text-sm font-bold text-[#f5f8f2]">
              {coins}
            </span>
            <span className="text-xs text-[#9fb5a3]">{t.coinsLabel}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab('story')}
            data-testid="quest-tab-story"
            className={`min-h-[40px] px-1.5 sm:px-2.5 py-2 rounded-xl border text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer truncate inline-flex items-center justify-center gap-1 ${
              tab === 'story'
                ? 'bg-[#253a28] border-[#e5a93c]/80 text-[#ffffff]'
                : 'bg-[#15241c] border-[#263c2f] text-[#a9beae] hover:bg-[#1b2f24]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-[#e5a93c] shrink-0" />
            <span className="truncate">
              {t.tabStory(
                storyJournal?.completedQuestCount ?? 0,
                storyJournal?.totalQuestCount ?? 12,
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('side')}
            data-testid="quest-tab-side"
            className={`min-h-[40px] px-1.5 sm:px-2.5 py-2 rounded-xl border text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer truncate inline-flex items-center justify-center gap-1 ${
              tab === 'side'
                ? 'bg-[#18333a] border-[#38bdf8]/80 text-[#ffffff]'
                : 'bg-[#15241c] border-[#263c2f] text-[#a9beae] hover:bg-[#1b2f24]'
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
            <span className="truncate">
              {t.tabSideQuests(
                sideQuestJournal?.totalUniqueCompleted ?? 0,
                sideQuestJournal?.totalQuests ?? 13,
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('active')}
            data-testid="quest-tab-active"
            className={`min-h-[40px] px-1.5 sm:px-2.5 py-2 rounded-xl border text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer truncate ${
              tab === 'active'
                ? 'bg-[#21382c] border-[#e5a93c]/70 text-[#ffffff]'
                : 'bg-[#15241c] border-[#263c2f] text-[#a9beae] hover:bg-[#1b2f24]'
            }`}
          >
            {t.tabActive(activeQuests.length)}
          </button>
          <button
            type="button"
            onClick={() => setTab('completed')}
            data-testid="quest-tab-completed"
            className={`min-h-[40px] px-1.5 sm:px-2.5 py-2 rounded-xl border text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer truncate ${
              tab === 'completed'
                ? 'bg-[#21382c] border-[#e5a93c]/70 text-[#ffffff]'
                : 'bg-[#15241c] border-[#263c2f] text-[#a9beae] hover:bg-[#1b2f24]'
            }`}
          >
            {t.tabCompleted(completedQuests.length)}
          </button>
          <button
            type="button"
            onClick={() => setTab('available')}
            data-testid="quest-tab-available"
            className={`min-h-[40px] px-1.5 sm:px-2.5 py-2 rounded-xl border text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer truncate ${
              tab === 'available'
                ? 'bg-[#21382c] border-[#e5a93c]/70 text-[#ffffff]'
                : 'bg-[#15241c] border-[#263c2f] text-[#a9beae] hover:bg-[#1b2f24]'
            }`}
          >
            {t.tabAvailable(availableQuests.length)}
          </button>
        </div>

        {/* Quest List */}
        <div className="flex-1 overflow-y-auto space-y-3 pe-1">
          {tab === 'story' && storyJournal && (
            <div data-testid="story-campaign-panel" className="space-y-4">
              {/* Chapter Progress & Stepper */}
              <div className="p-3.5 rounded-xl bg-[#15241c] border border-[#2a4234]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <div>
                    <div className="text-[11px] font-semibold text-[#e5a93c] uppercase tracking-wider">
                      {t.storyCampaignTitle}
                    </div>
                    <div className="font-display text-sm font-bold text-[#f4f7f1]">
                      {t.storyChapterProgress(
                        storyJournal.currentChapterNumber,
                        storyJournal.totalChapters,
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] text-[#9fb5a3]">
                    {t.storyCompleteFallbackHint}
                  </span>
                </div>

                <div className="grid grid-cols-6 gap-1.5">
                  {storyJournal.chapters.map((ch) => (
                    <div
                      key={ch.chapterId}
                      title={ch.title}
                      className={`px-2 py-1.5 rounded-lg border text-center text-[11px] font-semibold flex items-center justify-center gap-1 ${
                        ch.completed
                          ? 'bg-[#1c3826] border-[#4ade80]/50 text-[#98eba8]'
                          : ch.current
                            ? 'bg-[#2a331d] border-[#e5a93c]/80 text-[#f5c76b]'
                            : ch.unlocked
                              ? 'bg-[#182920] border-[#2e4839] text-[#c5d6c7]'
                              : 'bg-[#111b15] border-[#1f3026] text-[#6d8274]'
                      }`}
                    >
                      {ch.completed ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                      ) : !ch.unlocked ? (
                        <Lock className="w-3 h-3 shrink-0" />
                      ) : null}
                      <span dir="ltr">{ch.number}</span>
                    </div>
                  ))}
                </div>
              </div>

              {storyJournal.campaignCompleted && (
                <div className="p-4 rounded-xl bg-[#1a3322] border border-[#4ade80]/60">
                  <div className="flex items-center gap-2 text-[#98eba8] font-display font-bold text-base mb-1">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>{t.storyCompletedCampaignTitle}</span>
                  </div>
                  <p className="text-xs text-[#cde3d2] leading-relaxed">
                    {t.storyCompletedCampaignDesc}
                  </p>
                </div>
              )}

              {storyJournal.activeMainQuest && !storyJournal.campaignCompleted && (
                <div>
                  <div className="text-xs font-display font-bold text-[#e5a93c] mb-1.5">
                    {t.storyActiveQuestLabel}
                  </div>
                  {renderStoryQuestCard(storyJournal.activeMainQuest, true)}
                </div>
              )}

              {/* Chapters Breakdown */}
              <div className="space-y-3">
                {storyJournal.chapters.map((ch) => (
                  <div
                    key={ch.chapterId}
                    data-testid={`story-chapter-${ch.chapterId}`}
                    className={`p-3.5 rounded-xl border ${
                      ch.current
                        ? 'bg-[#14231a] border-[#e5a93c]/40'
                        : ch.unlocked
                          ? 'bg-[#132018] border-[#253a2d]'
                          : 'bg-[#101a14] border-[#1e2f25]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div>
                        <h4 className="font-display text-sm font-bold text-[#f4f7f1]">
                          {ch.title}
                        </h4>
                        <p className="text-[11px] text-[#9eb3a3]">{ch.subtitle}</p>
                      </div>
                      {ch.completed ? (
                        <span className="px-2 py-0.5 rounded-md border bg-[#1d3b28] text-[#98eba8] border-[#376b4b] text-[10px] font-semibold">
                          {t.storyStateLabels.COMPLETED}
                        </span>
                      ) : !ch.unlocked ? (
                        <span className="px-2 py-0.5 rounded-md border bg-[#17211b] text-[#7c9283] border-[#283a2f] text-[10px] font-semibold inline-flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          {t.storyStateLabels.LOCKED}
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-2.5">
                      {ch.quests.map((sq) => renderStoryQuestCard(sq, false))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'side' && sideQuestJournal && (() => {
            const matchesCat = (sq: SideQuestView) =>
              sideCategoryFilter === 'all' || sq.category === sideCategoryFilter;
            const filteredActive = sideQuestJournal.activeQuests.filter(matchesCat);
            const filteredFailed = sideQuestJournal.failedOrExpiredQuests.filter(matchesCat);
            const filteredAvailable = sideQuestJournal.availableQuests.filter(matchesCat);
            const filteredLocked = sideQuestJournal.lockedQuests.filter(matchesCat);
            const filteredCompleted = sideQuestJournal.completedQuests.filter(matchesCat);
            const totalVisible =
              filteredActive.length +
              filteredFailed.length +
              filteredAvailable.length +
              filteredLocked.length +
              filteredCompleted.length;

            return (
              <div data-testid="side-quests-panel" className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#132226] border border-[#25454e]">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <div className="text-[11px] font-semibold text-[#38bdf8] uppercase tracking-wider">
                        {t.sideQuestsSectionTitle}
                      </div>
                      <p className="text-[11px] text-[#a4bcc2] mt-0.5">
                        {t.sideQuestsSubtitle}
                      </p>
                    </div>
                    <div className="px-2.5 py-1 rounded-lg bg-[#10292f] border border-[#2b5661] flex items-center gap-1.5 text-xs">
                      <Award className="w-3.5 h-3.5 text-[#38bdf8]" />
                      <span className="text-[#9ec3cc]">{t.sideQuestReputationLabel}:</span>
                      <span className="font-mono-num font-bold text-[#f1f8fa]">
                        {sideQuestJournal.reputation}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setSideCategoryFilter('all')}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        sideCategoryFilter === 'all'
                          ? 'bg-[#38bdf8] border-[#38bdf8] text-[#08151d]'
                          : 'bg-[#112126] border-[#253f46] text-[#9bb3b9] hover:bg-[#172c32]'
                      }`}
                    >
                      {t.sideQuestFilterAll}
                    </button>
                    {SIDE_QUEST_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSideCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                          sideCategoryFilter === cat
                            ? 'bg-[#38bdf8] border-[#38bdf8] text-[#08151d]'
                            : 'bg-[#112126] border-[#253f46] text-[#9bb3b9] hover:bg-[#172c32]'
                        }`}
                      >
                        {t.sideQuestCategoryLabels[cat]}
                      </button>
                    ))}
                  </div>
                </div>

                {totalVisible === 0 && (
                  <div className="p-6 rounded-xl bg-[#15241c] border border-[#24392d] text-center text-sm text-[#9cb0a0]">
                    {t.sideQuestEmptyNotice}
                  </div>
                )}

                {filteredActive.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-display font-bold text-[#22d3ee]">
                      {t.sideQuestGroupActive} ({filteredActive.length})
                    </div>
                    {filteredActive.map(renderSideQuestCard)}
                  </div>
                )}

                {filteredFailed.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-display font-bold text-[#fca5a5]">
                      {t.sideQuestGroupFailed} ({filteredFailed.length})
                    </div>
                    {filteredFailed.map(renderSideQuestCard)}
                  </div>
                )}

                {filteredAvailable.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-display font-bold text-[#7dd3fc]">
                      {t.sideQuestGroupAvailable} ({filteredAvailable.length})
                    </div>
                    {filteredAvailable.map(renderSideQuestCard)}
                  </div>
                )}

                {filteredLocked.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-display font-bold text-[#8ca894]">
                      {t.sideQuestGroupLocked} ({filteredLocked.length})
                    </div>
                    {filteredLocked.map(renderSideQuestCard)}
                  </div>
                )}

                {filteredCompleted.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-display font-bold text-[#86efac]">
                      {t.sideQuestGroupCompleted} ({filteredCompleted.length})
                    </div>
                    {filteredCompleted.map(renderSideQuestCard)}
                  </div>
                )}
              </div>
            );
          })()}

          {tab === 'active' && hasActiveCoop && coopObjective && (
            <div
              data-testid="journal-coop-objective-card"
              className="p-4 rounded-xl bg-[#13261f] border border-[#2dd4bf]/55"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Target className="w-4 h-4 text-[#2dd4bf] shrink-0" />
                  <h3 className="font-display text-base font-bold text-[#f4f7f1]">
                    {coopObjective.title}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md border bg-[#12332c] text-[#99f6e4] border-[#2dd4bf]/45 text-[10px] font-semibold tracking-wide">
                    {t.coopObjectiveActiveLabel}
                  </span>
                </div>
                <span dir="ltr" className="font-mono-num text-xs font-bold text-[#9ef0b0]">
                  {coopObjective.progress} / {coopObjective.targetCount}
                </span>
              </div>

              <p className="text-xs text-[#b7cab9] leading-relaxed mb-2.5">
                {coopObjective.description}
              </p>

              <div className="h-1.5 rounded-full bg-[#0a140f] overflow-hidden mb-2.5">
                <div
                  className="h-full bg-[#2dd4bf] transition-[width] duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      (coopObjective.progress / Math.max(1, coopObjective.targetCount)) * 100,
                    )}%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-[#99f6e4]">{t.partySubtitle}</span>
                {typeof coopObjective.targetX === 'number' &&
                  typeof coopObjective.targetZ === 'number' && (
                    <span dir="ltr" className="inline-flex items-center gap-1 font-mono-num text-[#7dd3fc]">
                      <MapPin className="w-3 h-3" />
                      X {Math.round(coopObjective.targetX)}, Z {Math.round(coopObjective.targetZ)}
                    </span>
                  )}
              </div>
            </div>
          )}

          {tab !== 'story' && tab !== 'side' && list.length === 0 && !(tab === 'active' && hasActiveCoop) && (
            <div className="p-6 rounded-xl bg-[#15241c] border border-[#24392d] text-center text-sm text-[#9cb0a0]">
              {tab === 'active' && t.emptyActiveQuests}
              {tab === 'completed' && t.emptyCompletedQuests}
              {tab === 'available' && t.emptyAvailableQuests}
            </div>
          )}

          {tab !== 'story' && tab !== 'side' && list.map((q) => {
            const isCoop = q.scope === 'cooperative';
            return (
              <div
                key={q.id}
                data-testid={`journal-quest-${q.id}`}
                className={`p-4 rounded-xl border ${
                  isCoop
                    ? 'bg-[#13251f] border-[#2dd4bf]/40'
                    : 'bg-[#16261d] border-[#273e31]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-base font-bold text-[#f4f7f1]">
                      {q.title}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide inline-flex items-center gap-1 ${
                        isCoop
                          ? 'bg-[#10332b] text-[#99f6e4] border-[#2dd4bf]/45'
                          : 'bg-[#1c2a22] text-[#b4ccb9] border-[#334b3d]'
                      }`}
                    >
                      {isCoop && <Users className="w-2.5 h-2.5" />}
                      {isCoop ? t.questScopeCoop : t.questScopePersonal}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide ${
                        q.status === 'ready'
                          ? 'bg-[#1d3b28] text-[#98eba8] border-[#376b4b]'
                          : q.status === 'active'
                            ? 'bg-[#1d303c] text-[#94ccf2] border-[#355970]'
                            : q.status === 'completed'
                              ? 'bg-[#28352c] text-[#b4c8b9] border-[#425748]'
                              : 'bg-[#3a2d15] text-[#f5c76b] border-[#6b4f24]'
                      }`}
                    >
                      {QUEST_STATUS_LABELS[lang][q.status]}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isCoop && q.status === 'available' && onStartCoopQuest && (
                      <button
                        type="button"
                        data-testid={`start-coop-quest-${q.id}`}
                        onClick={() => onStartCoopQuest(q.id)}
                        className="px-2.5 py-1 rounded-lg bg-[#2dd4bf] hover:bg-[#5eead4] text-[#091915] text-[11px] font-display font-bold cursor-pointer"
                      >
                        {t.questStartCoopBtn}
                      </button>
                    )}
                    {isCoop && q.status === 'ready' && !q.coopClaimed && onCompleteCoopQuest && (
                      <button
                        type="button"
                        data-testid={`complete-coop-quest-${q.id}`}
                        onClick={() => onCompleteCoopQuest(q.id)}
                        className="px-2.5 py-1 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] text-[#111914] text-[11px] font-display font-bold cursor-pointer"
                      >
                        {t.questClaimRewardBtn}
                      </button>
                    )}
                    {(q.status === 'active' || q.status === 'ready') && (
                      <button
                        type="button"
                        onClick={() => onTrackQuest(q.id)}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                          q.tracked
                            ? 'bg-[#e5a93c] border-[#e5a93c] text-[#111914]'
                            : 'bg-[#1b2e23] hover:bg-[#233b2d] border-[#314c3c] text-[#dce7dd]'
                        }`}
                      >
                        <Compass className="w-3 h-3" />
                        <span>{q.tracked ? t.trackedBtn : t.trackHudBtn}</span>
                      </button>
                    )}
                  </div>
                </div>

                {isCoop && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#99f6e4] mb-1.5">
                    <span>{t.questCoopActiveHint}</span>
                    {typeof q.coopContributorCount === 'number' && q.coopContributorCount > 0 && (
                      <span className="font-mono-num">
                        {t.questCoopContributors(q.coopContributorCount)}
                      </span>
                    )}
                  </div>
                )}

                <p className="text-xs text-[#9eb3a3] leading-relaxed mb-3">
                  {q.description}
                </p>

                {/* Objectives */}
                <div className="space-y-1.5 mb-3">
                  {q.objectives.map((obj, idx) => (
                    <div
                      key={obj.id}
                      className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg ${
                        obj.completed
                          ? 'bg-[#13221a] text-[#8ca894] line-through'
                          : obj.active
                            ? 'bg-[#1c3024] text-[#f4f7f1] border border-[#e5a93c]/35'
                            : 'bg-[#13211a] text-[#889e8e]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {obj.completed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#78d48b] shrink-0" />
                        ) : (
                          <Circle
                            className={`w-3.5 h-3.5 shrink-0 ${
                              obj.active ? 'text-[#e5a93c]' : 'text-[#5b7162]'
                            }`}
                          />
                        )}
                        <span>
                          {idx + 1}. {obj.description}
                        </span>
                      </span>
                      {obj.target > 1 && (
                        <span className="font-mono-num text-[11px] text-[#d9e5da]" dir="ltr">
                          {obj.current}/{obj.target}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Reward */}
                <div className="flex items-center gap-1.5 text-[11px] text-[#e5a93c]">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {t.rewardLabel} {q.rewardSummary}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
