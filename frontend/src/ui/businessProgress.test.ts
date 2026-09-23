import { describe, expect, it } from 'vitest';
import type { BusinessHistoryItem, CatalogTask, Milestone, MilestoneCode, Task } from '../types';
import { buildBusinessProgress } from './businessProgress';
import { emptyCard } from './fields';

function task(id = 'task-1', overrides: Partial<Task> = {}): Task {
  return {
    id, owner_id: 'business-1', raw_description: 'Задача бизнеса',
    card: { ...emptyCard(), title: 'Учёт остатков', success_criteria: 'Не менее 90% верных ответов.' },
    revision: 1, confirmed_revision: 1, published_revision: 1, confirmed_fields: ['title', 'success_criteria'],
    status: 'published', created_at: '2026-09-23T00:00:00Z',
    rating: { score: 90, preview_score: 90, readiness: 'priority', missing_fields: [], unconfirmed_fields: [], breakdown: [
      { key: 'success', label: 'Критерии успеха', points: 15, max_points: 15, missing_fields: [], unconfirmed_fields: [], suggestion: '' },
    ] },
    ...overrides,
  };
}
function milestone(proposalId: string, code: MilestoneCode, evidence = 'Результат проверен на согласованных примерах и принят бизнесом.'): Milestone {
  return { id: `${proposalId}-${code}`, proposal_id: proposalId, code, evidence, points: 999, confirmed_by: 'business-1', confirmed_at: '2026-09-23T01:00:00Z' };
}
function proposal(taskId = 'task-1', id = 'proposal-1', codes: MilestoneCode[] = [], overrides: Partial<BusinessHistoryItem['proposals'][number]> = {}): BusinessHistoryItem['proposals'][number] {
  return { id, task_id: taskId, team_id: `team-${id}`, idea: 'Соберём прототип', plan: 'Прототип и пилот', timeline: '2 недели', prototype_url: null, status: 'accepted', decision_note: '', created_at: '2026-09-23T00:00:00Z', decided_at: '2026-09-23T01:00:00Z', milestones: codes.map(code => milestone(id, code)), ...overrides };
}
function snapshot(source: Task): CatalogTask {
  return { id: source.id, card: source.card, revision: source.revision, rating: source.rating, published_at: '2026-09-23T00:00:00Z' };
}
function published(count: number): BusinessHistoryItem[] {
  return Array.from({ length: count }, (_, index) => ({ task: task(`task-${index}`), proposals: [] }));
}

describe('business progress derived from backend history', () => {
  it('counts publication and each milestone once per task despite duplicates and multiple teams', () => {
    const first = proposal('task-1', 'a', ['prototype', 'pilot', 'delivery']);
    first.milestones.push({ ...first.milestones[0], id: 'duplicate-id' });
    const second = proposal('task-1', 'b', ['prototype', 'pilot', 'delivery']);
    const record = { task: task(), proposals: [first, second, first] };
    const before = structuredClone(record);
    const result = buildBusinessProgress([record, record]);
    expect(result.xp).toBe(110);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ milestoneCount: 3, xp: 110, completed: true });
    expect(result.stats).toEqual({ published: 1, completed: 1, teams: 2, pilots: 1, prototypes: 1, feedback: 6 });
    expect(result.achievements.find(item => item.id === 'full-journey')?.value).toBe(1);
    expect(record).toEqual(before);
  });

  it('ignores milestones of pending and rejected proposals, and unrelated embedded records', () => {
    const pending = proposal('task-1', 'pending', ['prototype', 'pilot', 'delivery'], { status: 'pending', decided_at: null });
    const rejected = proposal('task-1', 'rejected', ['prototype', 'pilot', 'delivery'], { status: 'rejected' });
    const foreign = proposal('other-task', 'foreign', ['delivery']);
    const result = buildBusinessProgress([{ task: task(), proposals: [pending, rejected, foreign] }]);
    expect(result.xp).toBe(10);
    expect(result.stats).toMatchObject({ completed: 0, teams: 0, prototypes: 0, pilots: 0, feedback: 0 });
    expect(result.projects[0].stages.find(stage => stage.key === 'team')?.done).toBe(false);
    expect(result.projects[0].proposals).toHaveLength(2);
  });

  it('keeps stages independent when delivery is confirmed before prototype or pilot', () => {
    const result = buildBusinessProgress([{ task: task(), proposals: [proposal('task-1', 'a', ['delivery'])] }]);
    const project = result.projects[0];
    expect(project).toMatchObject({ completed: true, milestoneCount: 1, xp: 60, currentLabel: 'Прототип' });
    expect(project.stages.filter(stage => stage.done).map(stage => stage.key)).toEqual(['brief', 'published', 'team', 'delivery']);
    expect(project.nextAction.href).toBe('/tasks/task-1/proposals');
    expect(result.achievements.find(item => item.id === 'full-journey')?.value).toBe(0);
  });

  it('requires all three stages in one accepted proposal for a full journey', () => {
    const result = buildBusinessProgress([{ task: task(), proposals: [proposal('task-1', 'a', ['prototype']), proposal('task-1', 'b', ['pilot', 'delivery'])] }]);
    expect(result.projects[0].milestoneCount).toBe(3);
    expect(result.xp).toBe(110);
    expect(result.achievements.find(item => item.id === 'full-journey')?.value).toBe(0);
  });

  it('counts each participating team once only after a confirmed milestone', () => {
    const result = buildBusinessProgress([
      { task: task('one'), proposals: [proposal('one', 'a', ['prototype'], { team_id: 'shared' }), proposal('one', 'b', [], { team_id: 'no-result' })] },
      { task: task('two'), proposals: [proposal('two', 'c', ['pilot'], { team_id: 'shared' })] },
    ]);
    expect(result.stats.teams).toBe(1);
    expect(result.achievements.find(item => item.id === 'collaboration-start')?.value).toBe(2);
  });

  it('uses published snapshots, not the quality of newer private edits', () => {
    const original = task();
    const current = task('task-1', { revision: 2, confirmed_revision: null, confirmed_fields: [], rating: { ...original.rating, score: 0, preview_score: 100 } });
    const withoutSnapshot = buildBusinessProgress([{ task: current, proposals: [] }]);
    expect(withoutSnapshot.xp).toBe(10);
    expect(withoutSnapshot.achievements.find(item => item.id === 'all-clear')?.value).toBe(0);
    expect(withoutSnapshot.projects[0].stages[0].done).toBe(false);
    const withSnapshot = buildBusinessProgress([{ task: current, proposals: [] }], [snapshot(original)]);
    expect(withSnapshot.achievements.find(item => item.id === 'all-clear')?.value).toBe(1);
    expect(withSnapshot.achievements.find(item => item.id === 'measurable-result')?.value).toBe(1);
    expect(withSnapshot.projects[0].stages[0].done).toBe(true);
    const stale = snapshot(task('task-1', { revision: 3 }));
    expect(buildBusinessProgress([{ task: current, proposals: [] }], [stale]).achievements.find(item => item.id === 'all-clear')?.value).toBe(0);
  });

  it('uses a current confirmed score for the brief, but only published quality for badges', () => {
    const ready = task('ready', { revision: 2, confirmed_revision: 2, rating: { ...task().rating, score: 70, preview_score: 100 } });
    const draft = task('draft', { published_revision: null, status: 'draft', confirmed_revision: null, confirmed_fields: [], rating: { ...task().rating, score: 0, preview_score: 100 } });
    const result = buildBusinessProgress([{ task: ready, proposals: [] }, { task: draft, proposals: [] }]);
    expect(result.projects.map(project => project.stages[0].done)).toEqual([true, false]);
    expect(result.achievements.find(item => item.id === 'all-clear')?.value).toBe(0);
    expect(result.stats.published).toBe(1);
    expect(result.xp).toBe(10);
  });

  it('does not count unconfirmed success criteria in published quality', () => {
    const source = task();
    const unconfirmed = snapshot(source);
    unconfirmed.rating = { ...source.rating, unconfirmed_fields: ['success_criteria'], breakdown: [{ ...source.rating.breakdown[0], points: 0, unconfirmed_fields: ['success_criteria'] }] };
    expect(buildBusinessProgress([{ task: source, proposals: [] }], [unconfirmed]).achievements.find(item => item.id === 'measurable-result')?.value).toBe(0);
    expect(buildBusinessProgress([{ task: source, proposals: [] }]).achievements.find(item => item.id === 'measurable-result')?.value).toBe(1);
  });

  it.each([
    [0, 0, 'Инициатор', 40], [3, 0, 'Инициатор', 40],
    [4, 1, 'Практик', 150], [14, 1, 'Практик', 150],
    [15, 2, 'Партнёр команд', 400], [39, 2, 'Партнёр команд', 400],
    [40, 3, 'Эксперт проектов', null],
  ])('uses the business level thresholds for %i publications', (count, index, name, next) => {
    const result = buildBusinessProgress(published(count as number));
    expect(result.xp).toBe((count as number) * 10);
    expect(result.level).toMatchObject({ index, name, next });
    expect(result.level.progress).toBeGreaterThanOrEqual(0);
    expect(result.level.progress).toBeLessThanOrEqual(100);
    if (next === null) expect(result.level.progress).toBe(100);
  });

  it('has twelve achievements with three earned tiers and a next target', () => {
    const result = buildBusinessProgress(published(3));
    expect(result.achievements).toHaveLength(12);
    expect(result.achievements.find(item => item.id === 'first-brief')).toMatchObject({ value: 3, tier: 2, target: 10, progress: 30, unlocked: true });
    expect(result.achievements.find(item => item.id === 'clear-customer')).toMatchObject({ value: 3, tier: 1, target: 5, progress: 60 });
    expect(result.achievements.every(item => item.tiers.length === 3)).toBe(true);
    expect(buildBusinessProgress(published(12)).achievements.find(item => item.id === 'first-brief')).toMatchObject({ tier: 3, target: 10, progress: 100 });
    expect(buildBusinessProgress([]).achievements.every(item => !item.unlocked && item.tier === 0 && item.progress === 0)).toBe(true);
  });

  it('counts evidence by trimmed length without pretending to assess its meaning', () => {
    const accepted = proposal();
    accepted.milestones = [milestone(accepted.id, 'prototype', `  ${'я'.repeat(39)}  `), milestone(accepted.id, 'pilot', 'я'.repeat(40)), milestone(accepted.id, 'delivery', `  ${'я'.repeat(40)}  `)];
    accepted.milestones.push(accepted.milestones[1]);
    const result = buildBusinessProgress([{ task: task(), proposals: [accepted] }]);
    expect(result.stats.feedback).toBe(2);
    expect(result.achievements.find(item => item.id === 'reliable-feedback')).toMatchObject({ value: 2, tier: 0, target: 5, progress: 40 });
  });

  it('offers at most one quest per task and prioritizes reviews, missing criteria and revision checks', () => {
    const pending = task('pending', { confirmed_revision: null });
    pending.card.success_criteria = '';
    const missing = task('criteria');
    missing.card.success_criteria = '';
    missing.rating.breakdown[0] = { ...missing.rating.breakdown[0], points: 8, max_points: 15 };
    const check = task('check', { revision: 2, confirmed_revision: 1 });
    const publishTask = task('publish', { published_revision: null, status: 'draft' });
    const stage = task('stage');
    const records: BusinessHistoryItem[] = [
      { task: publishTask, proposals: [] }, { task: stage, proposals: [proposal('stage', 'stage')] },
      { task: check, proposals: [] }, { task: missing, proposals: [] },
      { task: pending, proposals: [proposal('pending', 'pending', [], { status: 'pending', decided_at: null })] },
    ];
    const result = buildBusinessProgress([...records, ...records]);
    expect(result.quests.map(quest => quest.taskId)).toEqual(['pending', 'criteria', 'check']);
    expect(new Set(result.quests.map(quest => quest.taskId)).size).toBe(3);
    expect(result.quests[1]).toMatchObject({ reward: 'До +7 к готовности после подтверждения', href: '/tasks/criteria/edit#card-success_criteria' });
    expect(result.quests[2].cta).toBe('Проверить карточку');
    expect(result.quests[0].description).toContain('вручную');
    expect(result.quests.every(quest => quest.description.includes('«Учёт остатков»'))).toBe(true);
  });

  it('never invents a submitted result or a new publication reward for an update', () => {
    const stage = buildBusinessProgress([{ task: task(), proposals: [proposal()] }]).quests[0];
    expect(stage).toMatchObject({ id: 'stage-task-1', cta: 'К работе с командой', href: '/tasks/task-1/proposals' });
    expect(stage.description).toContain('только после проверки');
    const update = buildBusinessProgress([{ task: task('update', { revision: 2, confirmed_revision: 2 }), proposals: [] }]);
    expect(update.xp).toBe(10);
    expect(update.quests[0]).toMatchObject({ title: 'Обновите публикацию', reward: 'Актуальная карточка в каталоге' });
    expect(buildBusinessProgress([]).quests).toEqual([expect.objectContaining({ id: 'start-first-brief', href: '/new' })]);
  });

  it('uses the real backend success category and accepts older mock snapshots', () => {
    const source = task();
    expect(source.rating.breakdown[0].key).toBe('success');
    const oldSnapshot = snapshot(source);
    oldSnapshot.rating = { ...source.rating, breakdown: [{ ...source.rating.breakdown[0], key: 'success_criteria' }] };
    const result = buildBusinessProgress([{ task: source, proposals: [] }], [oldSnapshot]);
    expect(result.achievements.find(item => item.id === 'measurable-result')?.value).toBe(1);
  });

  it('shows a read-only catalog action while waiting for proposals', () => {
    const result = buildBusinessProgress([{ task: task(), proposals: [proposal('task-1', 'rejected', [], { status: 'rejected' })] }]);
    expect(result.quests).toEqual([expect.objectContaining({ id: 'view-task-1', href: '/tasks/task-1', title: 'Посмотрите опубликованную задачу' })]);
    expect(result.quests[0].description).toContain('«Учёт остатков»');
    expect(result.quests[0].description).toContain('новых откликов пока нет');
    expect(result.quests[0].reward).not.toContain('XP');
  });

  it('offers a useful next-project action when every project is completed', () => {
    const result = buildBusinessProgress([{ task: task(), proposals: [proposal('task-1', 'done', ['prototype', 'pilot', 'delivery'])] }]);
    expect(result.quests).toEqual([expect.objectContaining({ id: 'start-next-brief', href: '/new' })]);
    expect(result.quests[0].taskId).toBeUndefined();
    expect(result.quests[0].description).toContain('Завершено проектов: 1');
    expect(result.quests[0].description).toContain('Опубликовано задач: 1');
  });

  it('does not make the 70-point brief stage a publication requirement', () => {
    const low = task('low', { status: 'draft', published_revision: null, rating: { ...task().rating, score: 20, preview_score: 20 } });
    const result = buildBusinessProgress([{ task: low, proposals: [] }]);
    expect(result.projects[0].stages[0].done).toBe(false);
    expect(result.projects[0].nextAction.description).toContain('Публикация доступна с любым рейтингом');
    expect(result.quests[0].id).toBe('publish-low');
  });
});
