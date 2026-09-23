import { ArrowRight, Check, ChevronRight, FileCheck2, Flag, Gem, Handshake, Layers3, LockKeyhole, Medal, MessageSquare, PackageCheck, Rocket, Target, Trophy, Users, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBusinessProgress } from '../context/BusinessProgressContext';
import type { BusinessAchievement, BusinessProgress } from '../ui/businessProgress';
import { Button, ErrorBanner, Skeleton } from './ui';
import { ProjectJourney } from './ProjectJourney';
import './BusinessProgressWidgets.css';

const achievementIcons = [FileCheck2, Gem, Layers3, Target, Handshake, Rocket, Flag, PackageCheck, Medal, Trophy, Users, MessageSquare];
const achievementIds = ['first-brief', 'all-clear', 'clear-customer', 'measurable-result', 'collaboration-start', 'first-prototype', 'field-tested', 'project-delivered', 'full-journey', 'regular-partner', 'diverse-teams', 'reliable-feedback'];
const tierNames = ['Ещё впереди', 'Бронза', 'Серебро', 'Золото'];

export function AchievementEmblem({ achievement }: { achievement: BusinessAchievement }) {
  const Icon = achievementIcons[achievementIds.indexOf(achievement.id)] ?? Trophy;
  return <span className={`bp-emblem bp-emblem-tier-${achievement.tier}`} aria-hidden="true"><span><Icon size={25} strokeWidth={1.65} /></span>{achievement.unlocked && <i><Check size={10} strokeWidth={3} /></i>}</span>;
}

export function BusinessAchievementCard({ achievement }: { achievement: BusinessAchievement }) {
  const allDone = achievement.tier === achievement.tiers.length;
  return <article className={`bp-achievement ${achievement.unlocked ? 'is-unlocked' : ''}`}>
    <div className="bp-achievement-top"><AchievementEmblem achievement={achievement} /><span className={`bp-tier bp-tier-${achievement.tier}`}>{achievement.unlocked ? tierNames[achievement.tier] : <><LockKeyhole size={12} />Не открыто</>}</span></div>
    <h3>{achievement.title}</h3><p>{achievement.description}</p>
    <div className="bp-achievement-progress"><span>{allDone ? 'Все ступени открыты' : achievement.unlocked ? 'Следующая ступень' : 'До первой награды'}</span><strong>{achievement.value} / {achievement.target}</strong></div>
    <div className="bp-meter" role="progressbar" aria-label={`Прогресс достижения «${achievement.title}»`} aria-valuemin={0} aria-valuemax={achievement.target} aria-valuenow={Math.min(achievement.value, achievement.target)}><span style={{ width: `${achievement.progress}%` }} /></div>
    <ol className="bp-tier-steps" aria-label="Ступени достижения">{achievement.tiers.map((target, index) => <li key={target} className={achievement.value >= target ? 'is-done' : ''}><span>{achievement.value >= target ? <Check size={10} /> : index + 1}</span>{tierNames[index + 1]} · {target}</li>)}</ol>
  </article>;
}

export function BusinessLevelSummary({ data, compact = false }: { data: BusinessProgress; compact?: boolean }) {
  const { level, xp } = data;
  return <div className={`bp-level-summary ${compact ? 'is-compact' : ''}`}>
    <div className="bp-level-label"><span className="bp-level-number">{level.index + 1}</span><div><span className="bp-kicker">Уровень бизнеса</span><strong>{level.name}</strong></div><Trophy size={20} aria-hidden="true" /></div>
    <div className="bp-level-points"><strong>{xp.toLocaleString('ru-RU')}<span> XP</span></strong><span>{level.next === null ? 'Высший уровень' : `из ${level.next}`}</span></div>
    <div className="bp-meter" role="progressbar" aria-label="Опыт бизнеса" aria-valuemin={level.min} aria-valuemax={level.next ?? Math.max(level.min, xp)} aria-valuenow={xp}><span style={{ width: `${level.progress}%` }} /></div>
    <p>{level.next === null ? 'Продолжайте собирать результаты в портфолио.' : `Ещё ${level.next - xp} XP до следующего уровня`}</p>
  </div>;
}

export function BusinessSidebarProgress() {
  const { data, error, loading, refresh } = useBusinessProgress();
  if (!data) return error ? <div className="bp-sidebar-status"><p>Прогресс не загрузился</p><Button variant="ghost" size="sm" onClick={() => void refresh()}>Повторить</Button></div> : loading ? <div className="bp-sidebar-status" role="status">Загружаем прогресс…</div> : null;
  return <div className="bp-sidebar"><Link to="/business/progress" className="bp-sidebar-level"><BusinessLevelSummary data={data} compact /><span className="bp-sidebar-link">Достижения и коллекция<ChevronRight size={14} /></span></Link>{error && <button type="button" className="bp-refresh-link" onClick={() => void refresh()}>Не удалось обновить · повторить</button>}{data.quests[0] && <div className="bp-sidebar-quest"><span className="bp-kicker">Следующий шаг</span><strong>{data.quests[0].title}</strong><p>{data.quests[0].reward}</p><Link to={data.quests[0].href}>{data.quests[0].cta}<ArrowRight size={14} /></Link></div>}</div>;
}

export function BusinessQuests({ data }: { data: BusinessProgress }) {
  return <section className="bp-quests" aria-labelledby="business-quests-heading"><div className="bp-section-heading"><div><h2 id="business-quests-heading">Следующие шаги</h2><p>Действия по вашим текущим проектам</p></div><span>{data.quests.length} из 3</span></div><div className="bp-quest-list">{data.quests.map((quest, index) => <Link className="bp-quest" to={quest.href} key={quest.id}><span className="bp-quest-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{quest.title}</h3><p>{quest.description}</p><span className="bp-quest-reward"><Zap size={12} />{quest.reward}</span></div><span className="bp-quest-cta">{quest.cta}<ArrowRight size={16} /></span></Link>)}</div></section>;
}

export function BusinessProjectStatus({ taskId }: { taskId: string }) {
  const { data, error } = useBusinessProgress();
  const project = data?.projects.find(item => item.task.id === taskId);
  if (!project || error) return null;
  return <section className="bp-inline-journey" aria-label="Путь проекта"><div className="bp-section-heading"><h2>Путь проекта</h2><Link to="/business/progress">Мой прогресс<ArrowRight size={15} /></Link></div><ProjectJourney stages={project.stages} compact /></section>;
}

export function BusinessOverview() {
  const { data, error, loading, refresh } = useBusinessProgress();
  if (!data) return error ? <ErrorBanner message={error} onRetry={refresh} /> : <Skeleton lines={3} />;
  return <section className="bp-overview"><BusinessLevelSummary data={data} /><div className="bp-overview-main"><span className="bp-kicker">Результаты вашей работы</span><h2>{data.stats.completed ? `Завершено проектов: ${data.stats.completed}` : 'Каждый проект приближает к новому уровню'}</h2><p>Открыто достижений: {data.achievements.filter(item => item.unlocked).length} / 12 · Прототипы: {data.stats.prototypes} · Пилоты: {data.stats.pilots}</p><Link className="button button-secondary" to="/business/progress">Посмотреть достижения<ArrowRight size={16} /></Link>{loading && <span className="bp-updating" role="status">Обновляем прогресс…</span>}{error && <ErrorBanner message={error} onRetry={refresh} />}</div></section>;
}
