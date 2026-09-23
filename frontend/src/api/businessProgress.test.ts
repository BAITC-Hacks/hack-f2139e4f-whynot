import { describe, expect, it, vi } from 'vitest';
import type { BusinessHistoryItem, BusinessHistoryPage, CardData, CatalogTask, Rating, Task } from '../types';
import { loadBusinessProgress } from './businessProgress';

type Source = NonNullable<Parameters<typeof loadBusinessProgress>[1]>;
const actorId = 'business-A';
const card: CardData = { title: 'Задача', topic: 'retail', context: '', need: '', users: '', data: '', constraints: '', expected_result: '', success_criteria: '', contact: '', interaction_format: '' };
const rating = (score: number, criteria = false): Rating => ({
  score, preview_score: score, readiness: score >= 90 ? 'priority' : score >= 70 ? 'ready' : score >= 40 ? 'working' : 'draft',
  breakdown: [{ key: 'success_criteria', label: 'Критерии успеха', points: criteria ? 15 : 0, max_points: 15, missing_fields: criteria ? [] : ['success_criteria'], unconfirmed_fields: [], suggestion: '' }],
  missing_fields: [], unconfirmed_fields: [],
});
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, owner_id: actorId, raw_description: 'Описание задачи', card: { ...card, title: id },
  revision: 1, confirmed_revision: 1, published_revision: 1, confirmed_fields: [],
  status: 'published', rating: rating(20), created_at: '2026-09-23T10:00:00Z', ...overrides,
});
const item = (value: Task): BusinessHistoryItem => ({ task: value, proposals: [] });
const page = (items: BusinessHistoryItem[], total = items.length, offset = 0): BusinessHistoryPage => ({ items, total, limit: 100, offset });
const snapshot = (value: Task, score: number, criteria = false): CatalogTask => ({
  id: value.id, revision: value.published_revision ?? 1, card: { ...value.card, success_criteria: criteria ? 'Проверка на 20 примерах' : '' },
  rating: rating(score, criteria), published_at: '2026-09-23T10:00:00Z',
});
const source = () => ({ history: vi.fn<Source['history']>(), published: vi.fn<Source['published']>() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('Полный прогресс текущего бизнеса', () => {
  it('учитывает все 205 задач, последовательно запрашивая каждую страницу истории', async () => {
    const records = Array.from({ length: 205 }, (_, index) => item(task(`task-${index}`)));
    const provider = source();
    provider.history.mockImplementation(async (_actor, _limit, offset) => page(records.slice(offset, offset + 100), records.length, offset));
    const result = await loadBusinessProgress(actorId, provider);
    expect(provider.history.mock.calls).toEqual([[actorId, 100, 0], [actorId, 100, 100], [actorId, 100, 200]]);
    expect(result.projects).toHaveLength(205);
    expect(result.stats.published).toBe(205);
    expect(result.xp).toBe(2050);
    expect(provider.published).not.toHaveBeenCalled();
  });

  it('не смешивает историю разных аккаунтов, даже если сервер вернул чужую задачу', async () => {
    const provider = source();
    provider.history.mockResolvedValue(page([item(task('own')), item(task('foreign', { owner_id: 'business-B' }))]));
    await expect(loadBusinessProgress(actorId, provider)).rejects.toThrow('История изменилась');
    expect(provider.published).not.toHaveBeenCalled();
  });

  it('отбрасывает поздние страницы и опубликованные карточки после смены поколения загрузки', async () => {
    const historyProvider = source();
    const historyResponse = deferred<BusinessHistoryPage>();
    historyProvider.history.mockReturnValue(historyResponse.promise);
    let current = true;
    const oldHistory = loadBusinessProgress(actorId, historyProvider, () => current);
    current = false;
    historyResponse.resolve(page([item(task('old'))], 101));
    await expect(oldHistory).rejects.toThrow('Загрузка отменена');
    expect(historyProvider.history).toHaveBeenCalledTimes(1);
    expect(historyProvider.published).not.toHaveBeenCalled();

    const edited = task('edited', { revision: 2 });
    const snapshotProvider = source();
    const snapshotResponse = deferred<CatalogTask>();
    const snapshotStarted = deferred<void>();
    snapshotProvider.history.mockResolvedValue(page([item(edited)]));
    snapshotProvider.published.mockImplementation(() => { snapshotStarted.resolve(); return snapshotResponse.promise; });
    current = true;
    const oldSnapshot = loadBusinessProgress(actorId, snapshotProvider, () => current);
    await snapshotStarted.promise;
    current = false;
    snapshotResponse.resolve(snapshot(edited, 95, true));
    await expect(oldSnapshot).rejects.toThrow('Загрузка отменена');
  });

  it('оценивает достижения по опубликованной версии, а не по улучшенному или ухудшенному черновику', async () => {
    const improvedDraft = task('improved-draft', { revision: 2, rating: rating(100, true), card: { ...card, success_criteria: 'Новые критерии' }, confirmed_fields: ['success_criteria'] });
    const weakenedDraft = task('weakened-draft', { revision: 3, rating: rating(10), card: { ...card, success_criteria: '' } });
    const provider = source();
    provider.history.mockResolvedValue(page([item(improvedDraft), item(weakenedDraft)]));
    provider.published.mockImplementation(async id => id === improvedDraft.id ? snapshot(improvedDraft, 20) : snapshot(weakenedDraft, 95, true));
    const result = await loadBusinessProgress(actorId, provider);
    expect(provider.published.mock.calls).toEqual([[improvedDraft.id], [weakenedDraft.id]]);
    expect(result.achievements.find(award => award.id === 'all-clear')?.value).toBe(1);
    expect(result.achievements.find(award => award.id === 'measurable-result')?.value).toBe(1);
    expect(result.stats.published).toBe(2);
    expect(result.xp).toBe(20);
  });

  it('возвращает ошибку вместо частичных итогов при сбое следующей страницы или снимка публикации', async () => {
    const records = Array.from({ length: 100 }, (_, index) => item(task(`task-${index}`)));
    const provider = source();
    provider.history.mockResolvedValueOnce(page(records, 101)).mockRejectedValueOnce(new Error('Сервер недоступен'));
    await expect(loadBusinessProgress(actorId, provider)).rejects.toThrow('Сервер недоступен');
    expect(provider.published).not.toHaveBeenCalled();

    const changedHistory = source();
    changedHistory.history.mockResolvedValueOnce(page(records, 101)).mockResolvedValueOnce(page([item(task('task-100'))], 102, 100));
    await expect(loadBusinessProgress(actorId, changedHistory)).rejects.toThrow('История изменилась');

    const missingSnapshot = source();
    missingSnapshot.history.mockResolvedValue(page([item(task('edited', { revision: 2 }))]));
    missingSnapshot.published.mockRejectedValue(new Error('Публикация недоступна'));
    await expect(loadBusinessProgress(actorId, missingSnapshot)).rejects.toThrow('Публикация недоступна');
  });

  it('отклоняет снимок другой публикации, появившийся после загрузки истории', async () => {
    const edited = task('republished-during-load', { revision: 2, published_revision: 1 });
    const provider = source();
    provider.history.mockResolvedValue(page([item(edited)]));
    provider.published.mockResolvedValue({ ...snapshot(edited, 95, true), revision: 2 });
    await expect(loadBusinessProgress(actorId, provider)).rejects.toThrow();

    const wrongTask = source();
    wrongTask.history.mockResolvedValue(page([item(edited)]));
    wrongTask.published.mockResolvedValue({ ...snapshot(edited, 95, true), id: 'another-task' });
    await expect(loadBusinessProgress(actorId, wrongTask)).rejects.toThrow();
  });
});
