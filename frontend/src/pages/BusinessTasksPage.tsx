import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { useBusinessProgress } from '../context/BusinessProgressContext';
import { BusinessOverview, BusinessQuests } from '../components/BusinessProgressWidgets';
import { ProjectJourney } from '../components/ProjectJourney';
import { Badge, Button, Card, EmptyState, ErrorBanner, LevelBadge, PageHeader, Skeleton } from '../components/ui';
import { formatDate, topicLabel } from '../ui/fields';
import './BusinessProgressPage.css';

export function BusinessTasksPage() {
  const { data, loading, error, refresh } = useBusinessProgress();
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');
  const visible = data?.projects.filter(({ task }) => filter === 'all' || task.status === filter) ?? [];
  return <div className="page">
    <PageHeader title="Мои проекты" subtitle="Задачи, команды и результаты — на одной дорожке прогресса." actions={<Link className="button button-primary" to="/new"><Plus size={17} />Создать задачу</Link>} />
    {error && <ErrorBanner message={error} onRetry={refresh} />}
    {loading && !data && <Skeleton lines={7} />}
    {data && <>
      <BusinessOverview />
      <BusinessQuests data={data} />
      <div className="bp-task-counts"><span>Задачи <strong>{data.projects.length}</strong></span><span><strong>{data.stats.published}</strong>опубликовано</span><span><strong>{data.stats.completed}</strong>с переданным результатом</span></div>
      <div className="bp-section-heading bp-task-list-header"><h2>Мои задачи</h2><Button variant="ghost" size="sm" loading={loading} onClick={() => void refresh()}><RefreshCw size={14} />Обновить</Button></div>
      <div className="bp-filter-tabs bp-collection-filter" role="group" aria-label="Статус задачи">{([{ value: 'all', label: 'Все' }, { value: 'draft', label: 'Черновики' }, { value: 'published', label: 'Опубликованные' }] as const).map(tab => <button className={filter === tab.value ? 'active' : ''} key={tab.value} type="button" aria-pressed={filter === tab.value} onClick={() => setFilter(tab.value)}>{tab.label}</button>)}</div>
      {!visible.length ? <EmptyState icon={FileText} title={data.projects.length ? 'В этом разделе пока пусто' : 'Здесь начнётся ваш первый проект'} description={data.projects.length ? 'Выберите другой фильтр или создайте новую задачу.' : 'Опишите идею, а помощник задаст вопросы и поможет составить карточку.'} action={<Link className="button button-primary" to="/new"><Plus size={16} />Создать задачу</Link>} /> : <div className="bp-task-list">{visible.map(project => {
        const { task, proposals } = project;
        return <Card className="bp-task-project" key={task.id}><div className="bp-task-project-top"><div className="bp-task-project-main"><div className="row"><Badge>{topicLabel(task.card.topic)}</Badge><Badge>{task.status === 'published' ? 'Опубликована' : 'Приватный черновик'}</Badge>{project.completed && <Badge>Результат передан</Badge>}</div><Link className="task-title" to={`/tasks/${task.id}/edit`}>{task.card.title || 'Задача без названия'}</Link><p className="muted line-clamp-2">{task.card.need || task.card.context || task.raw_description}</p><div className="task-list-meta"><span className="muted text-small">{formatDate(task.created_at)} · Редакция {task.revision}</span>{task.published_revision !== null && task.published_revision !== task.revision && <span className="text-small">Есть неопубликованные изменения</span>}</div></div><div className="bp-task-project-score"><strong className={`rating-value rating-${task.rating.readiness}`}>{task.rating.score}<span className="muted text-small">/100</span></strong><LevelBadge level={task.rating.readiness} />{task.rating.preview_score > task.rating.score && <span className="muted text-small">После подтверждения: {task.rating.preview_score}</span>}</div></div><ProjectJourney stages={project.stages} compact /><div className="bp-task-project-footer"><p>{project.nextAction.description}</p><Link className="button button-secondary button-sm" to={project.nextAction.href}>{project.nextAction.label}<ArrowRight size={15} /></Link><Link className="text-link" to={`/tasks/${task.id}/proposals`}><MessageSquare size={15} />Отклики · {proposals.length}</Link></div></Card>;
      })}</div>}
    </>}
  </div>;
}
