import { useEffect, useId, useMemo, useState } from 'react';
import { Award, ArrowRight, CheckCircle2, ClipboardCheck, Handshake, SlidersHorizontal, Trophy } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBusinessProgress } from '../context/BusinessProgressContext';
import { useRole } from '../context/RoleContext';
import { formatDate, MILESTONES, topicLabel } from '../ui/fields';
import { Badge, Button, Card, ErrorBanner, Skeleton } from './ui';
import './BusinessShowcase.css';

type ProgressData = NonNullable<ReturnType<typeof useBusinessProgress>['data']>;
type Achievement = ProgressData['achievements'][number];
type Project = ProgressData['projects'][number];
const categoryIcons = { brief: ClipboardCheck, collaboration: Handshake, results: Trophy };
function sameSelection(first: string[] | null, second: string[]) {
  return first !== null && first.length === second.length && first.every((id, index) => id === second[index]);
}

function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const Icon = categoryIcons[achievement.category];
  return <article className={`business-showcase-badge business-showcase-tier-${achievement.tier}`}>
    <div className="business-showcase-badge-top"><span className="business-showcase-medal"><Icon size={23} strokeWidth={1.7} aria-hidden="true" /></span><span className="business-showcase-tier">Ступень {achievement.tier} из {achievement.tiers.length}</span></div>
    <h3>{achievement.title}</h3><p>{achievement.description}</p>
    <span className="business-showcase-earned"><CheckCircle2 size={14} aria-hidden="true" />Получено</span>
  </article>;
}

function ProjectCase({ project }: { project: Project }) {
  const { teams } = useRole();
  const results = project.proposals.filter(proposal => proposal.status === 'accepted').flatMap(proposal => proposal.milestones.map(milestone => ({ milestone, teamId: proposal.team_id })))
    .sort((first, second) => second.milestone.confirmed_at.localeCompare(first.milestone.confirmed_at));
  return <article className="business-showcase-case">
    <div className="business-showcase-case-heading"><div><span className="business-showcase-case-topic">{topicLabel(project.task.card.topic)}</span><h3><Link to={`/tasks/${project.task.id}/edit`}>{project.task.card.title || 'Задача без названия'}</Link></h3></div><Badge className={project.completed ? 'business-showcase-completed' : 'business-showcase-in-progress'}>{project.completed ? 'Завершён' : 'В работе'}</Badge></div>
    <ul className="business-showcase-results">{results.map(({ milestone, teamId }) => <li key={milestone.id}><div className="business-showcase-result-heading"><span><CheckCircle2 size={15} aria-hidden="true" />{MILESTONES[milestone.code]?.label || milestone.code}</span><time dateTime={milestone.confirmed_at}>{formatDate(milestone.confirmed_at)}</time></div><p>{milestone.evidence}</p><span className="business-showcase-result-team">{teams.find(team => team.id === teamId)?.name || 'Команда проекта'} · +{milestone.points} XP команде</span></li>)}</ul>
    <Link className="text-link business-showcase-case-link" to={`/tasks/${project.task.id}/proposals`}>Результаты и отклики<ArrowRight size={15} aria-hidden="true" /></Link>
  </article>;
}

export function BusinessShowcase() {
  const { actor } = useRole();
  const { data, loading, error, refresh, showcaseSelection, setShowcaseSelection } = useBusinessProgress();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [filter, setFilter] = useState<'results' | 'completed'>('results');
  const [visibleCount, setVisibleCount] = useState(3);
  const headingId = useId();
  const pickerId = useId();
  const earned = useMemo(() => (data?.achievements ?? []).filter(achievement => achievement.unlocked)
    .sort((first, second) => second.tier - first.tier || second.value - first.value || first.id.localeCompare(second.id)), [data]);
  const savedFor = searchParams.get('showcaseFor');
  const savedIds = searchParams.get('showcase');
  const usesSavedSelection = !!actor && savedFor === actor.id && savedIds !== null;
  const selectedIds = useMemo(() => {
    const ids = usesSavedSelection ? (savedIds || '').split(',') : showcaseSelection ?? earned.slice(0, 3).map(achievement => achievement.id);
    return [...new Set(ids.filter(id => earned.some(achievement => achievement.id === id)))].slice(0, 3);
  }, [usesSavedSelection, savedIds, showcaseSelection, earned]);

  useEffect(() => {
    // Wait for confirmed history before validating a saved selection; loading must not erase it.
    if (!actor || !data || loading || error) return;
    if (usesSavedSelection) {
      if (!sameSelection(showcaseSelection, selectedIds)) setShowcaseSelection(selectedIds);
      return;
    }
    // Ignore foreign or unscoped URL settings instead of importing them into this session.
    if (savedFor !== null || savedIds !== null || showcaseSelection === null) return;
    if (!sameSelection(showcaseSelection, selectedIds)) setShowcaseSelection(selectedIds);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('showcase', selectedIds.join(','));
      next.set('showcaseFor', actor.id);
      return next;
    }, { replace: true });
  }, [actor, data, loading, error, usesSavedSelection, savedFor, savedIds, showcaseSelection, selectedIds, setShowcaseSelection, setSearchParams]);
  const selected = selectedIds.map(id => earned.find(achievement => achievement.id === id)).filter((achievement): achievement is Achievement => Boolean(achievement));
  // Earned status comes from fresh history, including while the picker is open.
  const draftIds = draft.filter(id => earned.some(achievement => achievement.id === id));
  const resultProjects = (data?.projects ?? []).filter(project => project.milestoneCount > 0);
  const projects = resultProjects.filter(project => filter === 'results' || project.completed);

  function startEditing() { setDraft(selectedIds); setEditing(true); }
  function toggleAchievement(id: string) {
    setDraft(current => {
      const valid = current.filter(item => earned.some(achievement => achievement.id === item));
      return valid.includes(id) ? valid.filter(item => item !== id) : valid.length < 3 ? [...valid, id] : valid;
    });
  }
  function saveSelection() {
    if (!actor) return;
    setShowcaseSelection(draftIds);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('showcase', draftIds.join(','));
      next.set('showcaseFor', actor.id);
      return next;
    }, { replace: true });
    setEditing(false);
  }

  return <Card className="business-showcase" aria-labelledby={headingId}>
    <div className="business-showcase-heading"><div><span className="business-showcase-kicker"><Award size={16} aria-hidden="true" />Результаты вашей компании</span><h2 id={headingId}>Витрина достижений</h2><p>Отметьте важные достижения и посмотрите, что получилось вместе с командами.</p></div>{data && !loading && !error && !editing && <Button variant="secondary" size="sm" onClick={startEditing}><SlidersHorizontal size={15} aria-hidden="true" />Настроить витрину</Button>}</div>
    {loading ? <Skeleton lines={4} /> : error ? <ErrorBanner message={error} onRetry={refresh} /> : data ? <>
      <dl className="business-showcase-stats"><div><dt>Завершённых проектов</dt><dd>{data.stats.completed}</dd></div><div><dt>Команд с результатом</dt><dd>{data.stats.teams}</dd></div><div><dt>Подтверждённых пилотов</dt><dd>{data.stats.pilots}</dd></div></dl>
      {editing ? <section className="business-showcase-picker" aria-labelledby={pickerId}><div className="business-showcase-picker-heading"><h3 id={pickerId}>Выберите до трёх достижений</h3><span aria-live="polite">{draftIds.length} / 3</span></div><p>В витрину можно добавить только полученные достижения. Выбор сохраняется в адресе этой страницы.</p>{earned.length ? <fieldset><legend className="sr-only">Полученные достижения для витрины</legend><div className="business-showcase-choices">{earned.map(achievement => <label key={achievement.id} className={`business-showcase-choice ${draftIds.includes(achievement.id) ? 'is-selected' : ''}`}><input type="checkbox" checked={draftIds.includes(achievement.id)} disabled={!draftIds.includes(achievement.id) && draftIds.length >= 3} onChange={() => toggleAchievement(achievement.id)} /><span><strong>{achievement.title}</strong><small>Ступень {achievement.tier} из {achievement.tiers.length}</small><span>{achievement.description}</span></span></label>)}</div></fieldset> : <div className="business-showcase-empty"><Award size={22} aria-hidden="true" /><p>Полученных достижений пока нет. Они появятся по мере работы над задачами и подтверждения результатов.</p></div>}<div className="business-showcase-picker-actions"><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Отмена</Button><Button size="sm" onClick={saveSelection}>Сохранить выбор</Button></div></section> : selected.length ? <div className="business-showcase-badges">{selected.map(achievement => <AchievementBadge key={achievement.id} achievement={achievement} />)}</div> : <div className="business-showcase-empty"><Award size={23} aria-hidden="true" /><div><h3>{earned.length ? 'Достижения пока не выбраны' : 'Первые достижения впереди'}</h3><p>{earned.length ? 'Добавьте до трёх полученных достижений через настройки витрины.' : 'Публикуйте задачи и подтверждайте результаты команд — здесь появятся ваши достижения.'}</p></div></div>}
      <section className="business-showcase-projects" aria-label="Кейсы с подтверждёнными результатами"><div className="business-showcase-projects-heading"><div><h3>Кейсы с результатом</h3><p>Этапы, которые вы проверили и подтвердили.</p></div><div className="business-showcase-filters" role="group" aria-label="Какие кейсы показать"><button type="button" aria-pressed={filter === 'results'} onClick={() => { setFilter('results'); setVisibleCount(3); }}>Все с результатом <span>{resultProjects.length}</span></button><button type="button" aria-pressed={filter === 'completed'} onClick={() => { setFilter('completed'); setVisibleCount(3); }}>Завершённые <span>{resultProjects.filter(project => project.completed).length}</span></button></div></div>{projects.length ? <><div className="business-showcase-cases">{projects.slice(0, visibleCount).map(project => <ProjectCase key={project.task.id} project={project} />)}</div>{visibleCount < projects.length && <Button variant="secondary" size="sm" className="business-showcase-more" onClick={() => setVisibleCount(count => count + 3)}>Показать ещё · {projects.length - visibleCount}</Button>}</> : <div className="business-showcase-empty"><ClipboardCheck size={23} aria-hidden="true" /><div><h3>{filter === 'completed' ? 'Завершённых проектов пока нет' : 'Подтверждённых результатов пока нет'}</h3><p>{filter === 'completed' ? 'Кейс станет завершённым после подтверждения передачи результата.' : 'После проверки прототипа, пилота или передачи результата кейс появится в витрине.'}</p><Link className="text-link" to="/business/tasks">Перейти к задачам<ArrowRight size={15} aria-hidden="true" /></Link></div></div>}</section>
    </> : null}
  </Card>;
}
