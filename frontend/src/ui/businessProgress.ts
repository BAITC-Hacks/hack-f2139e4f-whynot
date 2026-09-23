import type { BusinessHistoryItem, CatalogTask, Milestone, MilestoneCode, Rating, Task } from '../types';

export type ProjectStageKey = 'brief' | 'published' | 'team' | MilestoneCode;
export interface ProjectStage { key: ProjectStageKey; label: string; done: boolean }
export interface ProgressAction { label: string; href: string; description: string }
export interface ProjectProgress {
  task: Task;
  proposals: BusinessHistoryItem['proposals'];
  stages: ProjectStage[];
  currentLabel: string;
  nextAction: ProgressAction;
  completed: boolean;
  milestoneCount: number;
  xp: number;
}
export interface BusinessAchievement {
  id: string;
  title: string;
  description: string;
  category: 'brief' | 'collaboration' | 'results';
  value: number;
  tiers: number[];
  tier: number;
  target: number;
  unlocked: boolean;
  progress: number;
}
export interface BusinessQuest {
  id: string;
  taskId?: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  reward: string;
}
export interface BusinessProgress {
  xp: number;
  level: { index: number; name: string; min: number; next: number | null; progress: number };
  stats: { published: number; completed: number; teams: number; pilots: number; prototypes: number; feedback: number };
  projects: ProjectProgress[];
  achievements: BusinessAchievement[];
  quests: BusinessQuest[];
}

const BUSINESS_LEVELS = [
  { name: 'Инициатор', min: 0 },
  { name: 'Практик', min: 40 },
  { name: 'Партнёр команд', min: 150 },
  { name: 'Эксперт проектов', min: 400 },
];
const MILESTONE_XP: Record<MilestoneCode, number> = { prototype: 20, pilot: 30, delivery: 50 };
const MILESTONE_CODES: MilestoneCode[] = ['prototype', 'pilot', 'delivery'];
const STAGES: { key: ProjectStageKey; label: string }[] = [
  { key: 'brief', label: 'Готовый бриф' },
  { key: 'published', label: 'Публикация' },
  { key: 'team', label: 'Сотрудничество' },
  { key: 'prototype', label: 'Прототип' },
  { key: 'pilot', label: 'Пилот' },
  { key: 'delivery', label: 'Передача результата' },
];

/** Pagination overlap and repeated records must never create extra events. */
function uniqueHistory(history: BusinessHistoryItem[]): BusinessHistoryItem[] {
  const tasks = new Map<string, BusinessHistoryItem>();
  for (const item of history) {
    const previous = tasks.get(item.task.id);
    const task = !previous || item.task.revision >= previous.task.revision ? item.task : previous.task;
    const proposals = new Map<string, BusinessHistoryItem['proposals'][number]>();
    for (const proposal of [...(previous?.proposals || []), ...item.proposals]) {
      if (proposal.task_id !== task.id) continue;
      const earlier = proposals.get(proposal.id);
      const milestones = new Map<MilestoneCode, Milestone>();
      for (const milestone of [...(earlier?.milestones || []), ...proposal.milestones]) {
        if (milestone.proposal_id === proposal.id && MILESTONE_CODES.includes(milestone.code) && !milestones.has(milestone.code)) {
          milestones.set(milestone.code, milestone);
        }
      }
      // A pending copy from an overlapping page must not replace a recorded decision.
      const latest = earlier && (earlier.decided_at || '') > (proposal.decided_at || '') ? earlier : proposal;
      proposals.set(proposal.id, { ...latest, milestones: [...milestones.values()] });
    }
    tasks.set(task.id, { task, proposals: [...proposals.values()] });
  }
  return [...tasks.values()];
}

function publishedVersion(task: Task, cards: CatalogTask[]): Task | CatalogTask | undefined {
  if (task.published_revision === null) return undefined;
  return cards.find(card => card.id === task.id && card.revision === task.published_revision)
    || (task.published_revision === task.revision ? task : undefined);
}

function hasConfirmedCriteria(card: Task | CatalogTask | undefined): boolean {
  if (!card?.card.success_criteria.trim()) return false;
  if ('confirmed_fields' in card) return card.confirmed_fields.includes('success_criteria');
  // Catalog snapshots have no confirmed_fields; their backend rating preserves that evidence.
  const criterion = successCriterion(card.rating);
  return !!criterion && criterion.points > 0
    && !criterion.unconfirmed_fields.includes('success_criteria')
    && !card.rating.unconfirmed_fields.includes('success_criteria');
}

function projectAction(task: Task, stage: ProjectStageKey | undefined): ProgressAction {
  const edit = `/tasks/${encodeURIComponent(task.id)}/edit`;
  const proposals = `/tasks/${encodeURIComponent(task.id)}/proposals`;
  switch (stage) {
    case 'brief': return { label: 'Уточнить бриф', href: edit, description: 'Уточните детали и проверьте сведения, чтобы карточка набрала 70 баллов готовности. Публикация доступна с любым рейтингом после подтверждения.' };
    case 'published': return { label: 'Подготовить публикацию', href: edit, description: 'Проверьте текущую редакцию, вручную подтвердите сведения и опубликуйте задачу.' };
    case 'team': return { label: 'Открыть отклики', href: proposals, description: 'Рассмотрите предложения и самостоятельно решите, с кем начать работу.' };
    case 'prototype': return { label: 'Открыть этапы', href: proposals, description: 'Обсудите прототип с командой. Подтвердите этап, только когда проверите выполненную работу.' };
    case 'pilot': return { label: 'Открыть этапы', href: proposals, description: 'Согласуйте проверку решения на практике. Подтвердите пилот после проверки результата.' };
    case 'delivery': return { label: 'Открыть этапы', href: proposals, description: 'Проверьте переданный результат и инструкцию, затем подтвердите завершённый этап.' };
    default: return { label: 'Посмотреть результаты', href: proposals, description: 'Все этапы этого проекта подтверждены. Результаты сохранены в истории.' };
  }
}

function achievement(id: string, title: string, description: string, category: BusinessAchievement['category'], value: number, tiers: number[]): BusinessAchievement {
  const tier = tiers.filter(threshold => value >= threshold).length;
  const target = tiers[Math.min(tier, tiers.length - 1)];
  return { id, title, description, category, value, tiers, tier, target, unlocked: tier > 0, progress: Math.min(100, value / target * 100) };
}

function successCriterion(rating: Rating) {
  // The backend category is `success`; older mock snapshots used the field name.
  return rating.breakdown.find(item => item.key === 'success')
    || rating.breakdown.find(item => item.key === 'success_criteria');
}

function criteriaGain(rating: Rating): number {
  const criterion = successCriterion(rating);
  return criterion ? Math.max(0, criterion.max_points - criterion.points) : 0;
}

function taskQuest(project: ProjectProgress): { priority: number; quest: BusinessQuest } | undefined {
  const { task, proposals } = project;
  const edit = `/tasks/${encodeURIComponent(task.id)}/edit`;
  const reviews = `/tasks/${encodeURIComponent(task.id)}/proposals`;
  const base = { taskId: task.id };
  const title = `«${task.card.title.trim() || 'Задача без названия'}»`;
  if (proposals.some(proposal => proposal.status === 'pending')) {
    return { priority: 0, quest: { ...base, id: `review-${task.id}`, title: 'Рассмотрите отклики', description: `${title}: прочитайте идеи команд и вручную примите или отклоните предложения.`, href: reviews, cta: 'Рассмотреть отклики', reward: 'Следующий шаг к сотрудничеству' } };
  }
  if (!task.card.success_criteria.trim()) {
    const gain = criteriaGain(task.rating);
    return { priority: 1, quest: { ...base, id: `criteria-${task.id}`, title: 'Добавьте критерии успеха', description: `${title}: опишите, по каким измеримым признакам вы примете результат команды.`, href: `${edit}#card-success_criteria`, cta: 'Уточнить критерии', reward: gain > 0 ? `До +${gain} к готовности после подтверждения` : 'Понятный способ проверить результат' } };
  }
  if (task.confirmed_revision !== task.revision) {
    return { priority: 2, quest: { ...base, id: `check-${task.id}`, title: 'Проверьте текущую редакцию', description: `${title}: сверьте текст с фактами. Подтвердите сведения вручную только после проверки.`, href: edit, cta: 'Проверить карточку', reward: 'Подготовка к публикации' } };
  }
  if (task.published_revision !== task.revision) {
    return { priority: 3, quest: { ...base, id: `publish-${task.id}`, title: task.published_revision === null ? 'Опубликуйте задачу' : 'Обновите публикацию', description: `${title}: текущая редакция подтверждена. Откройте карточку и опубликуйте её для команд.`, href: edit, cta: 'Открыть карточку', reward: task.published_revision === null ? '+10 XP за первую публикацию задачи' : 'Актуальная карточка в каталоге' } };
  }
  if (proposals.some(proposal => proposal.status === 'accepted') && !project.completed) {
    return { priority: 4, quest: { ...base, id: `stage-${task.id}`, title: 'Проверьте ход проекта', description: `${title}: обсудите результат с командой. Подтверждайте этап только после проверки выполненной работы.`, href: reviews, cta: 'К работе с командой', reward: 'XP за подтверждённый результат' } };
  }
  if (task.published_revision !== null && !proposals.some(proposal => proposal.status === 'accepted')) {
    return { priority: 5, quest: { ...base, id: `view-${task.id}`, title: 'Посмотрите опубликованную задачу', description: `${title}: задача доступна в каталоге. Проверьте, как её видят команды; новых откликов пока нет.`, href: `/tasks/${encodeURIComponent(task.id)}`, cta: 'Посмотреть в каталоге', reward: 'Готова к новым предложениям' } };
  }
  return undefined;
}

/** Business XP is derived from confirmed history, independently of Team.points. */
export function buildBusinessProgress(history: BusinessHistoryItem[], publishedCards: CatalogTask[] = []): BusinessProgress {
  const records = uniqueHistory(history);
  const teamIds = new Set<string>();
  const feedbackIds = new Set<string>();
  let published90 = 0;
  let publishedCriteria = 0;
  let collaborating = 0;
  let fullJourneys = 0;
  const stats = { published: 0, completed: 0, teams: 0, pilots: 0, prototypes: 0, feedback: 0 };

  const projects = records.map(({ task, proposals }): ProjectProgress => {
    const published = task.published_revision !== null;
    const snapshot = publishedVersion(task, publishedCards);
    const accepted = proposals.filter(proposal => proposal.status === 'accepted');
    const codes = new Set<MilestoneCode>();
    for (const proposal of accepted) {
      if (proposal.milestones.length) teamIds.add(proposal.team_id);
      for (const milestone of proposal.milestones) {
        codes.add(milestone.code);
        if (milestone.evidence.trim().length >= 40) feedbackIds.add(`${proposal.id}:${milestone.code}`);
      }
    }
    if (published) stats.published++;
    if (snapshot && snapshot.rating.score >= 90) published90++;
    if (hasConfirmedCriteria(snapshot)) publishedCriteria++;
    if (accepted.length) collaborating++;
    if (accepted.some(proposal => MILESTONE_CODES.every(code => proposal.milestones.some(milestone => milestone.code === code)))) fullJourneys++;
    if (codes.has('prototype')) stats.prototypes++;
    if (codes.has('pilot')) stats.pilots++;
    if (codes.has('delivery')) stats.completed++;
    const done: Record<ProjectStageKey, boolean> = {
      brief: task.rating.score >= 70 || (snapshot?.rating.score || 0) >= 70,
      published,
      team: accepted.length > 0,
      prototype: codes.has('prototype'),
      pilot: codes.has('pilot'),
      delivery: codes.has('delivery'),
    };
    const stages = STAGES.map(stage => ({ ...stage, done: done[stage.key] }));
    const current = stages.find(stage => !stage.done);
    return {
      task, proposals, stages,
      currentLabel: current?.label || 'Проект завершён',
      nextAction: projectAction(task, current?.key),
      completed: codes.has('delivery'),
      milestoneCount: codes.size,
      xp: (published ? 10 : 0) + [...codes].reduce((sum, code) => sum + MILESTONE_XP[code], 0),
    };
  });
  stats.teams = teamIds.size;
  stats.feedback = feedbackIds.size;
  const xp = projects.reduce((sum, project) => sum + project.xp, 0);
  const index = BUSINESS_LEVELS.reduce((current, level, candidate) => xp >= level.min ? candidate : current, 0);
  const selected = BUSINESS_LEVELS[index];
  const next = BUSINESS_LEVELS[index + 1]?.min ?? null;
  const level = { index, name: selected.name, min: selected.min, next, progress: next === null ? 100 : (xp - selected.min) / (next - selected.min) * 100 };
  const achievements = [
    achievement('first-brief', 'Первый бриф', 'Опубликуйте задачи для команд.', 'brief', stats.published, [1, 3, 10]),
    achievement('all-clear', 'Всё по делу', 'Опубликуйте задачи с подтверждённой готовностью от 90 баллов.', 'brief', published90, [1, 3, 10]),
    achievement('clear-customer', 'Понятный заказчик', 'Регулярно публикуйте задачи с готовностью от 90 баллов.', 'brief', published90, [3, 5, 10]),
    achievement('measurable-result', 'Измеримый результат', 'Публикуйте задачи с заполненными и подтверждёнными критериями успеха.', 'brief', publishedCriteria, [3, 5, 10]),
    achievement('collaboration-start', 'Начало сотрудничества', 'Начните сотрудничество, вручную приняв предложения по задачам.', 'collaboration', collaborating, [1, 3, 10]),
    achievement('first-prototype', 'Первый прототип', 'Подтвердите работающие прототипы по задачам.', 'results', stats.prototypes, [1, 3, 10]),
    achievement('field-tested', 'Проверено на практике', 'Подтвердите пилоты по задачам.', 'results', stats.pilots, [1, 3, 10]),
    achievement('project-delivered', 'Проект завершён', 'Примите переданные результаты проектов.', 'results', stats.completed, [1, 3, 10]),
    achievement('full-journey', 'От идеи до внедрения', 'Подтвердите прототип, пилот и передачу результата в одном принятом предложении.', 'results', fullJourneys, [1, 3, 10]),
    achievement('regular-partner', 'Постоянный партнёр', 'Доведите несколько проектов до передачи результата.', 'collaboration', stats.completed, [3, 5, 10]),
    achievement('diverse-teams', 'Разные команды — общий результат', 'Подтвердите результаты работы разных команд.', 'collaboration', stats.teams, [3, 5, 10]),
    achievement('reliable-feedback', 'Надёжная обратная связь', 'Опишите проверенный результат не менее чем 40 символами при подтверждении этапа.', 'collaboration', stats.feedback, [5, 10, 20]),
  ];
  const quests = projects.map(taskQuest)
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map(item => item.quest);
  if (!quests.length) quests.push(records.length
    ? { id: 'start-next-brief', title: 'Сформулируйте следующую задачу', description: `Завершено проектов: ${stats.completed}. Опубликовано задач: ${stats.published}. Опишите следующую потребность бизнеса и подготовьте новый бриф для команд.`, href: '/new', cta: 'Создать задачу', reward: '+10 XP после публикации новой задачи' }
    : { id: 'start-first-brief', title: 'Сформулируйте первую задачу', description: 'Опишите задачу бизнеса, затем проверьте и опубликуйте карточку для команд.', href: '/new', cta: 'Создать задачу', reward: '+10 XP после первой публикации' });
  return { xp, level, stats, projects, achievements, quests };
}
