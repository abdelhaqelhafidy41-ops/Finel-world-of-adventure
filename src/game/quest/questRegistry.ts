import rawQuests from './quests.json';
import type { QuestDefinition } from './questTypes';

const questRegistry = new Map<string, QuestDefinition>(
  (rawQuests as unknown as QuestDefinition[]).map((q) => [q.id, q]),
);
const proceduralQuestIds = new Set<string>();
const modQuests = new Map<string, { modId: string; quest: QuestDefinition }>();

export function getQuestDefinition(questId: string): QuestDefinition | undefined {
  return modQuests.get(questId)?.quest ?? questRegistry.get(questId);
}

export function getAllQuestDefinitions(): QuestDefinition[] {
  if (modQuests.size === 0) {
    return Array.from(questRegistry.values());
  }
  const merged = new Map<string, QuestDefinition>(questRegistry);
  for (const [id, entry] of modQuests.entries()) {
    merged.set(id, entry.quest);
  }
  return Array.from(merged.values());
}

/**
 * Dynamically registers a new quest definition without modifying QuestManager.
 */
export function registerQuestDefinition(quest: QuestDefinition): void {
  questRegistry.set(quest.id, quest);
}

export function registerProceduralQuest(quest: QuestDefinition): void {
  proceduralQuestIds.add(quest.id);
  questRegistry.set(quest.id, quest);
}

export function clearProceduralQuests(): void {
  for (const id of proceduralQuestIds) {
    questRegistry.delete(id);
  }
  proceduralQuestIds.clear();
}

export function registerModQuestDefinition(
  modId: string,
  quest: QuestDefinition,
): void {
  modQuests.set(quest.id, { modId, quest });
}

export function unregisterModQuests(modId: string): void {
  for (const [questId, entry] of modQuests.entries()) {
    if (entry.modId === modId) {
      modQuests.delete(questId);
    }
  }
}

export function clearAllModQuests(): void {
  modQuests.clear();
}
