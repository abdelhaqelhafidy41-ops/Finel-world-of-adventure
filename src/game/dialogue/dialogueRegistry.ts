import rawDialogues from './npcDialogues.json';
import { AR_DIALOGUE_TREES } from '../i18n/arContent';
import type { Language } from '../i18n/translations';
import type { DialogueTree } from './dialogueTypes';

export {
  getQuestDefinition,
  getAllQuestDefinitions,
  registerQuestDefinition,
} from '../quest/questRegistry';

const dialogueTrees: Map<string, DialogueTree> = new Map(
  Object.entries(rawDialogues as unknown as Record<string, DialogueTree>),
);
const proceduralDialogueTreesEn = new Map<string, DialogueTree>();
const proceduralDialogueTreesAr = new Map<string, DialogueTree>();

const isDevEnvironment = (): boolean => {
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean } };
    if (typeof meta?.env?.DEV === 'boolean') return meta.env.DEV;
  } catch {
    // ignore
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
};

const warnedMissingArabic = new Set<string>();

export function warnMissingArabicLocalization(npcId: string, dialogueId: string): void {
  if (!isDevEnvironment()) return;
  const key = `${npcId}:${dialogueId}`;
  if (warnedMissingArabic.has(key)) return;
  warnedMissingArabic.add(key);
  console.warn(`Missing Arabic localization:\nnpcId=${npcId}\ndialogueId=${dialogueId}`);
}

export interface BilingualText {
  en: string;
  ar: string;
}

export function resolveBilingualText(
  value: string | BilingualText,
  lang: Language,
  context?: { npcId: string; dialogueId: string },
): string {
  if (typeof value === 'string') {
    return value;
  }
  if (lang === 'ar') {
    if (value.ar && value.ar.trim().length > 0) {
      return value.ar;
    }
    if (context) {
      warnMissingArabicLocalization(context.npcId, context.dialogueId);
    }
    return 'مرحبًا أيها المغامر.';
  }
  return value.en;
}

/**
 * Retrieves a data-driven dialogue tree for an NPC ID in the requested language.
 * In Arabic mode, never silently falls back to English dialogue trees.
 */
export function getDialogueTree(
  npcId: string,
  lang: Language = 'en',
): DialogueTree | undefined {
  if (lang === 'ar') {
    const arTree = proceduralDialogueTreesAr.get(npcId) ?? AR_DIALOGUE_TREES[npcId];
    if (arTree) {
      return arTree;
    }
    if (proceduralDialogueTreesEn.has(npcId) || dialogueTrees.has(npcId)) {
      warnMissingArabicLocalization(npcId, 'dialogue_tree');
    }
    return undefined;
  }
  return proceduralDialogueTreesEn.get(npcId) ?? dialogueTrees.get(npcId);
}

/**
 * Registers or overrides an NPC dialogue tree dynamically without editing the engine.
 */
export function registerDialogueTree(tree: DialogueTree): void {
  dialogueTrees.set(tree.npcId, tree);
}

export function registerProceduralDialogueTree(
  treeEn: DialogueTree,
  treeAr?: DialogueTree,
): void {
  proceduralDialogueTreesEn.set(treeEn.npcId, treeEn);
  if (treeAr) {
    proceduralDialogueTreesAr.set(treeAr.npcId, treeAr);
  }
}

export function clearProceduralDialogues(): void {
  proceduralDialogueTreesEn.clear();
  proceduralDialogueTreesAr.clear();
}

export function getAllDialogueTrees(): DialogueTree[] {
  return [...Array.from(dialogueTrees.values()), ...Array.from(proceduralDialogueTreesEn.values())];
}
