import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText, Globe, MessageSquare, Plus, Rocket } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useAsync } from '../hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorBanner, LevelBadge, PageHeader, Skeleton } from '../components/ui';
import { formatDate, topicLabel } from '../ui/fields';

export function BusinessTasksPage() {
  const { actor } = useRole();
  const { data: tasks, loading, error, reload } = useAsync(() => api.getMyTasks(actor!.id), [actor?.id]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countErrors, setCountErrors] = useState<Record<string, string>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [refreshCounts, setRefreshCounts] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    if (!actor || !tasks) return;
    setCounts({});
    setCountErrors({});
    setCountsLoading(tasks.length > 0);
    void Promise.allSettled(tasks.map(task => api.getTaskProposals(actor.id, task.id))).then(results => {
      if (request !== generation.current) return;
      const nextCounts: Record<string, number> = {};
      const nextErrors: Record<string, string> = {};
      results.forEach((result, index) => { if (result.status === 'fulfilled') nextCounts[tasks[index].id] = result.value.length; else nextErrors[tasks[index].id] = errorMessage(result.reason); });
      setCounts(nextCounts);
      setCountErrors(nextErrors);
      setCountsLoading(false);
    });
    return () => { generation.current++; };
  }, [actor?.id, tasks, refreshCounts]);
  const visible = tasks?.filter(task => filter === 'all' || task.status === filter) ?? [];
  const published = tasks?.filter(task => task.status === 'published').length ?? 0;
  const completed = tasks?.filter(task => task.rating.readiness === 'ready' || task.rating.readiness === 'priority').length ?? 0;

  return <div className="page">
    <PageHeader title="От идеи к реальному результату" subtitle="Ваши задачи, их готовность и предложения команд — всё в одном месте." actions={<Link className="button button-primary" to="/new"><Plus size={18} />Создать задачу</Link>} />
    <div className="hero"><div><span className="eyebrow">КАБИНЕТ БИЗНЕСА</span><h2>Следующая большая идея — ваша</h2><p>Понятная задача притягивает сильные команды. Добавляйте детали, повышайте готовность и выбирайте, с кем двигаться дальше.</p><Link className="button button-primary" to="/new">Описать идею<ArrowUpRight size={17} /></Link></div><Rocket size={80} aria-hidden="true" /></div>
    {loading && !tasks && <Skeleton lines={6} />}
    {error && <ErrorBanner message={error} onRetry={reload} />}
    {tasks && <>
      <div className="stats-grid"><Card><FileText size={20} /><strong className="stat-value">{tasks.length}</strong><span className="muted">Всего задач</span></Card><Card><Globe size={20} /><strong className="stat-value">{published}</strong><span className="muted">Опубликовано</span></Card><Card><Rocket size={20} /><strong className="stat-value">{completed}</strong><span className="muted">Готовых и приоритетных</span></Card></div>
      <div className="row between"><h2 className="section-title">Мои задачи</h2><div className="tabs" role="group" aria-label="Статус задачи">{([{ value: 'all', label: 'Все' }, { value: 'draft', label: 'Черновики' }, { value: 'published', label: 'Опубликованные' }] as const).map(tab => <button className={`tab ${filter === tab.value ? 'active' : ''}`} key={tab.value} type="button" aria-pressed={filter === tab.value} onClick={() => setFilter(tab.value)}>{tab.label}</button>)}</div></div>
      {!visible.length ? <EmptyState icon={FileText} title={tasks.length ? 'В этом разделе пока пусто' : 'Здесь начнётся ваш первый проект'} description={tasks.length ? 'Выберите другой фильтр или создайте новую задачу.' : 'Опишите идею, а помощник задаст вопросы и поможет составить карточку.'} action={<Link className="button button-primary" to="/new"><Plus size={16} />Создать задачу</Link>} /> : <div className="task-list">{visible.map(task => <Card className="task-list-item" key={task.id}><div className="task-list-main"><div className="row"><Badge>{topicLabel(task.card.topic)}</Badge><Badge>{task.status === 'published' ? 'Опубликована' : 'Приватный черновик'}</Badge></div><Link className="task-title" to={`/tasks/${task.id}/edit`}>{task.card.title || 'Задача без названия'}</Link><p className="muted line-clamp-2">{task.card.need || task.card.context || task.raw_description}</p><div className="task-list-meta"><span className="muted text-small">{formatDate(task.created_at)}</span><span className="muted text-small">Редакция {task.revision}</span>{task.published_revision !== null && task.published_revision !== task.revision && <span className="text-small">Есть неопубликованные изменения</span>}</div></div><div className="stack task-list-score"><div className="row"><strong className={`rating-value rating-${task.rating.readiness}`}>{task.rating.score}<span className="muted text-small">/100</span></strong><LevelBadge level={task.rating.readiness} /></div>{task.rating.preview_score > task.rating.score && <span className="muted text-small">После подтверждения: {task.rating.preview_score}</span>}<div className="form-actions"><Link className="button button-secondary button-sm" to={`/tasks/${task.id}/edit`}>Открыть карточку</Link><Link className="text-link text-small" to={`/tasks/${task.id}/proposals`} title={countErrors[task.id]}><MessageSquare size={15} />{countsLoading ? 'Отклики…' : countErrors[task.id] ? 'Отклики · не удалось загрузить' : `Отклики · ${counts[task.id] ?? '—'}`}</Link></div></div></Card>)}</div>}
      {Object.keys(countErrors).length > 0 && <div className="notice"><span>Не удалось загрузить количество откликов для части задач.</span><Button size="sm" variant="ghost" loading={countsLoading} onClick={() => setRefreshCounts(value => value + 1)}>Повторить</Button></div>}
    </>}
  </div>;
}
