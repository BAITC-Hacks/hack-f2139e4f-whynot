import { api } from './client';
import type { BusinessHistoryItem, BusinessHistoryPage, CatalogTask } from '../types';
import { buildBusinessProgress } from '../ui/businessProgress';

interface ProgressSource {
  history: (actorId: string, limit: number, offset: number) => Promise<BusinessHistoryPage>;
  published: (taskId: string) => Promise<CatalogTask>;
}
const source: ProgressSource = { history: api.getBusinessHistory, published: api.getCatalogTask };

// Load every history page: a page-sized sample must never become a business total.
export async function loadBusinessProgress(actorId: string, provider = source, isCurrent = () => true) {
  const items: BusinessHistoryItem[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let offset = 0;
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Загрузка отменена.'); };
  do {
    assertCurrent();
    const page = await provider.history(actorId, 100, offset);
    assertCurrent();
    if (total !== null && total !== page.total) throw new Error('История изменилась во время загрузки. Обновите прогресс.');
    total = page.total;
    if (page.offset !== offset || (offset < total && page.items.length === 0)) throw new Error('Не удалось загрузить полную историю. Повторите запрос.');
    for (const item of page.items) {
      if (item.task.owner_id !== actorId || seen.has(item.task.id)) throw new Error('История изменилась во время загрузки. Обновите прогресс.');
      seen.add(item.task.id);
      items.push(item);
    }
    offset += page.items.length;
  } while (offset < total);
  if (items.length !== total) throw new Error('Не удалось загрузить полную историю. Повторите запрос.');

  // An edited draft can differ from the public card. Use its published snapshot
  // for quality awards, so unsaved/unpublished edits cannot unlock an award.
  const changed = items.filter(({ task }) => task.published_revision !== null && task.published_revision !== task.revision);
  const snapshots: CatalogTask[] = [];
  for (let index = 0; index < changed.length; index += 4) {
    assertCurrent();
    snapshots.push(...await Promise.all(changed.slice(index, index + 4).map(async ({ task }) => {
      const snapshot = await provider.published(task.id);
      if (snapshot.id !== task.id || snapshot.revision !== task.published_revision) throw new Error('Публикация изменилась во время загрузки. Обновите прогресс.');
      return snapshot;
    })));
    assertCurrent();
  }
  return buildBusinessProgress(items, snapshots);
}
