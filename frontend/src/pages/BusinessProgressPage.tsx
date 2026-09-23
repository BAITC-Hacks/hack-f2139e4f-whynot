import { useState } from 'react';
import { ArrowRight, Check, Layers3, Plus, RefreshCw, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BusinessAchievementCard, BusinessLevelSummary, BusinessQuests } from '../components/BusinessProgressWidgets';
import { ProjectArtifact } from '../components/ProjectArtifact';
import { ProjectJourney } from '../components/ProjectJourney';
import { Button, EmptyState, ErrorBanner, PageHeader, Skeleton } from '../components/ui';
import { useBusinessProgress } from '../context/BusinessProgressContext';
import './BusinessProgressPage.css';

const categories = [{ id: 'all', label: 'Все достижения' }, { id: 'brief', label: 'Качество задач' }, { id: 'collaboration', label: 'Сотрудничество' }, { id: 'results', label: 'Результаты' }] as const;
const levels = [{ name: 'Инициатор', xp: 0 }, { name: 'Практик', xp: 40 }, { name: 'Партнёр команд', xp: 150 }, { name: 'Эксперт проектов', xp: 400 }];

export function BusinessProgressPage() {
  const { data, loading, error, refresh } = useBusinessProgress();
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [collection, setCollection] = useState('all');
  const [visibleCount, setVisibleCount] = useState(6);
  const [selectedProject, setSelectedProject] = useState('');
  const showcase = data?.projects.find(project => project.task.id === selectedProject) ?? data?.projects.find(project => !project.completed) ?? data?.projects[0];
  const achievements = data?.achievements.filter(item => (category === 'all' || item.category === category) && (status === 'all' || (status === 'earned' ? item.unlocked : !item.unlocked))) ?? [];
  const projects = data?.projects.filter(project => collection === 'all' || (collection === 'completed' ? project.completed : !project.completed)) ?? [];
  const unlocked = data?.achievements.filter(item => item.unlocked).length ?? 0;

  return <div className="page bp-page"><PageHeader title="Прогресс бизнеса" subtitle="От первого брифа до проектов, которыми можно гордиться." actions={<Button variant="secondary" loading={loading} onClick={() => void refresh()}><RefreshCw size={15} />Обновить</Button>} />
    {error && <ErrorBanner message={error} onRetry={refresh} />}
    {loading && !data && <Skeleton lines={8} />}
    {data && <>
      <section className="bp-progress-hero">
        <div className="bp-progress-intro"><span className="bp-kicker">Ваш путь в Tapsyrma</span><h2>Идеи обретают<br /><span>форму.</span></h2><p>Развивайте проекты вместе с командами. Каждый подтверждённый этап добавляет деталь в коллекцию и опыт вашему бизнесу.</p><BusinessLevelSummary data={data} /><Link className="bp-hero-link" to="/business/profile">Витрина моих результатов<ArrowRight size={16} /></Link></div>
        <div className="bp-featured-project">{showcase ? <><label className="bp-artifact-select">Проект в фокусе<select value={showcase.task.id} onChange={event => setSelectedProject(event.target.value)}>{data.projects.map(project => <option key={project.task.id} value={project.task.id}>{project.task.card.title || 'Задача без названия'}</option>)}</select></label><ProjectArtifact stages={showcase.stages} showHeading={false} title={showcase.task.card.title || 'Ваш проект'} /><div className="bp-artifact-caption"><span>{showcase.completed ? 'Результат передан' : 'Собираем по шагам'}</span><h3>{showcase.task.card.title || 'Задача без названия'}</h3><p>{showcase.nextAction.description}</p><Link className="text-link" to={showcase.nextAction.href}>{showcase.nextAction.label}<ArrowRight size={15} /></Link></div></> : <><ProjectArtifact stages={['Бриф готов', 'Опубликован', 'Команда принята', 'Прототип', 'Пилот', 'Передача'].map((label, i) => ({ key: String(i), label, done: false }))} title="Ваш первый проект" /><div className="bp-artifact-caption"><span>Первая коллекция начинается здесь</span><h3>Соберите свой первый проект</h3><p>Опишите задачу, найдите команду и принимайте результаты. Модель будет расти вместе с проектом.</p><Link className="button button-primary" to="/new"><Plus size={15} />Создать задачу</Link></div></>}</div>
      </section>

      <ol className="bp-level-road" aria-label="Уровни бизнеса">{levels.map((level, index) => <li className={data.level.index >= index ? 'is-reached' : ''} key={level.name} aria-current={data.level.index === index ? 'step' : undefined}><span>{data.level.index > index ? <Check size={16} /> : index + 1}</span><div><strong>{level.name}</strong><small>{level.xp} XP</small></div>{data.level.index === index && <b>Вы здесь</b>}</li>)}</ol>
      <details className="bp-rules"><summary>Как растёт опыт бизнеса</summary><p>Опыт рассчитывается по сохранённой истории: публикация — 10 XP, прототип — 20 XP, пилот — 30 XP, передача результата — 50 XP. Каждый этап учитывается один раз на задачу, даже если над ней работают несколько команд. Получение достижения не добавляет повторные баллы.</p><p>Рейтинг готовности карточки и XP команд считаются отдельно. Этапы подтверждает бизнес после проверки работы. Награды за качество описания зависят от опубликованной версии карточки.</p><p>Обратная связь учитывается по описаниям подтверждённых результатов от 40 символов. Их содержание не оценивается автоматически.</p></details>

      <BusinessQuests data={data} />

      <section aria-labelledby="business-achievements-heading"><div className="bp-section-heading"><div><h2 id="business-achievements-heading">Достижения бизнеса <span className="bp-heading-count">{unlocked} / 12</span></h2><p>У каждой награды три ступени. Начните с первой и двигайтесь дальше.</p></div><Link to="/business/profile">Настроить витрину<ArrowRight size={15} /></Link></div><div className="bp-filter-row"><div className="bp-filter-tabs" role="group" aria-label="Категория достижений">{categories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div><label className="bp-filter-select">Статус<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Все награды</option><option value="earned">Полученные</option><option value="locked">Впереди</option></select></label></div>{achievements.length ? <div className="bp-achievements-grid">{achievements.map(achievement => <BusinessAchievementCard key={achievement.id} achievement={achievement} />)}</div> : <EmptyState icon={Trophy} title="В этом разделе пока нет наград" description="Посмотрите все достижения: у каждого есть понятное условие получения." action={<Button variant="secondary" onClick={() => { setCategory('all'); setStatus('all'); }}>Все достижения</Button>} />}</section>

      <section aria-labelledby="business-collection-heading"><div className="bp-section-heading"><div><h2 id="business-collection-heading">Коллекция проектов</h2><p>У каждого проекта свой объект. Каждая деталь — пройденный этап.</p></div><span>{data.stats.completed} завершено</span></div><div className="bp-filter-tabs bp-collection-filter" role="group" aria-label="Проекты в коллекции">{[{ value: 'all', label: 'Все проекты' }, { value: 'active', label: 'В работе' }, { value: 'completed', label: 'С результатом' }].map(item => <button type="button" key={item.value} aria-pressed={collection === item.value} className={collection === item.value ? 'active' : ''} onClick={() => { setCollection(item.value); setVisibleCount(6); }}>{item.label}</button>)}</div>{projects.length ? <><div className="bp-collection-grid">{projects.slice(0, visibleCount).map(project => <article className={`bp-collection-card ${project.completed ? 'is-complete' : ''}`} key={project.task.id}><div className="bp-collection-card-top"><span>{project.completed ? 'Результат передан' : project.currentLabel}</span><strong>{project.xp} XP</strong></div><ProjectArtifact stages={project.stages} compact title={project.task.card.title || 'Задача без названия'} /><h3><Link to={`/tasks/${project.task.id}/edit`}>{project.task.card.title || 'Задача без названия'}</Link></h3><ProjectJourney stages={project.stages} compact /><Link className="bp-collection-action" to={project.nextAction.href}>{project.nextAction.label}<ArrowRight size={15} /></Link></article>)}</div>{projects.length > visibleCount && <Button variant="secondary" onClick={() => setVisibleCount(value => value + 6)}>Показать ещё проекты</Button>}</> : <EmptyState icon={Layers3} title={data.projects.length ? 'Таких проектов пока нет' : 'Ваша коллекция пока пуста'} description="Завершайте этапы задач: здесь будут сохраняться их модели и результаты." action={<Link className="button button-primary" to="/new">Создать задачу<ArrowRight size={15} /></Link>} />}</section>
    </>}
  </div>;
}
