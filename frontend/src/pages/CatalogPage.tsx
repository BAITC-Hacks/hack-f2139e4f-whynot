import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, Search, Sparkles, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useAsync } from '../hooks/useAsync';
import { TaskCard } from '../components/TaskCard';
import { Button, EmptyState, ErrorBanner, PageHeader, Select, Skeleton } from '../components/ui';
import { matchTask, teamLevel, TOPICS } from '../ui/fields';
import type { CatalogFilters, CatalogPage as CatalogResponse, Readiness } from '../types';

const PAGE_SIZE = 9;
const topics = TOPICS;

async function allCatalog(filters: CatalogFilters): Promise<CatalogResponse> {
  const first = await api.getCatalog({ ...filters, limit: 100, offset: 0 });
  const items = [...first.items];
  for (let offset = first.items.length; offset < first.total;) {
    const next = await api.getCatalog({ ...filters, limit: 100, offset });
    if (!next.items.length) break;
    items.push(...next.items);
    offset += next.items.length;
  }
  return { items, total: items.length, limit: items.length, offset: 0 };
}

export function CatalogPage({ recommendations = false }: { recommendations?: boolean }) {
  const { actor, role, team } = useRole();
  const [topic, setTopic] = useState('');
  const [readiness, setReadiness] = useState<Readiness | ''>('');
  const [page, setPage] = useState(0);
  const filters: CatalogFilters = { ...(topic ? { topic } : {}), ...(readiness ? { readiness } : {}) };
  const request = useAsync(() => recommendations ? allCatalog(filters) : api.getCatalog({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }), [topic, readiness, recommendations, recommendations ? 0 : page, actor?.id]);
  const recommended = useMemo(() => (request.data?.items || []).map(task => ({ task, matches: team ? matchTask(task.card, team) : [] })).filter(item => item.task.rating.score >= 40 && item.matches.length > 0).sort((a, b) => b.matches.length - a.matches.length || b.task.rating.score - a.task.rating.score), [request.data, team]);
  const total = recommendations ? recommended.length : request.data?.total || 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const safePage = Math.min(page, maxPage);
  const items = recommendations ? recommended.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE) : (request.data?.items || []).map(task => ({ task, matches: [] as string[] }));
  const level = teamLevel(team?.points || 0);

  return <div className="page">
    <PageHeader title={recommendations ? 'Подходит вашей команде' : 'Каталог задач'} subtitle={recommendations ? 'Совпадения по интересам, навыкам и технологиям вашего профиля.' : 'Настоящие задачи бизнеса. Найдите ту, где ваши навыки принесут результат.'} actions={actor && role === 'business' ? <Link className="button button-primary" to="/new">Создать задачу <ArrowRight size={16} /></Link> : undefined} />
    <section className="hero catalog-hero">
      <div className="hero-copy"><div className="hero-eyebrow"><Sparkles size={15} /> ОТ ИДЕИ К РЕЗУЛЬТАТУ</div><h2 className="hero-title">Ваш следующий<br />большой шаг — здесь.</h2><p>Выберите задачу, предложите решение и получайте опыт за подтверждённые результаты.</p><div className="row"><span className="hero-pill">Открытый каталог</span><span className="hero-pill">Ручной выбор команды</span></div></div>
      <div className="hero-progress"><Trophy size={30} /><span>{team ? `Уровень ${level.index} · ${level.name}` : 'Результат имеет значение'}</span><strong>{team ? `${team.points} XP` : '20 → 50 XP'}</strong>{team && <div className="xp-bar"><span style={{ width: `${level.progress}%` }} /></div>}<small>{team ? level.next ? `${level.next - team.points} XP до следующего уровня` : 'Максимальный уровень достигнут' : 'За этапы, подтверждённые бизнесом'}</small></div>
    </section>
    {recommendations && <div className="notice"><Sparkles size={18} /><span>Подбор по совпадению навыков и тегов, среди задач с готовностью от 40 баллов. Мы проверяем весь доступный каталог. Команду выбирает бизнес.</span></div>}
    <div className="filter-bar"><Select label="Тема" value={topic} onChange={event => { setTopic(event.target.value); setPage(0); }}><option value="">Все темы</option>{topics.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select><Select label="Готовность" value={readiness} onChange={event => { setReadiness(event.target.value as Readiness | ''); setPage(0); }}><option value="">Все уровни</option><option value="draft">Черновик · 0–39</option><option value="working">Рабочая · 40–69</option><option value="ready">Готовая · 70–89</option><option value="priority">Приоритетная · 90–100</option></Select><div className="muted text-small">{!request.loading && `${total} задач найдено`}</div></div>
    {request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}
    {request.loading ? <div className="task-grid">{[1, 2, 3].map(key => <Skeleton key={key} lines={6} />)}</div> : recommendations && !team ? <EmptyState icon={Compass} title="Расскажите о команде" description="Добавьте интересы, навыки и технологии в профиль — здесь появятся подходящие задачи." action={<Link className="button button-primary" to="/team/profile">Заполнить профиль</Link>} /> : items.length ? <><div className="row between"><h2 className="section-title">{recommendations ? 'Есть точки пересечения' : 'Открытые возможности'}</h2><span className="muted text-small">{recommendations ? 'По числу совпадений' : 'По готовности ↓'}</span></div><div className="task-grid">{items.map(item => <TaskCard key={item.task.id} task={item.task} matches={item.matches} />)}</div><div className="catalog-pagination"><Button variant="secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ArrowLeft size={16} /> Назад</Button><span className="muted text-small">Страница {safePage + 1} из {maxPage + 1}</span><Button variant="secondary" disabled={safePage >= maxPage} onClick={() => setPage(safePage + 1)}>Далее <ArrowRight size={16} /></Button></div></> : !request.error && <EmptyState icon={Search} title={recommendations ? 'Пока нет совпадений' : 'Задачи не найдены'} description={recommendations ? 'Дополните профиль или загляните в общий каталог: вы можете откликнуться на любую опубликованную задачу.' : 'Измените фильтры или вернитесь позже — новые задачи появятся здесь.'} action={recommendations ? <Link className="button button-secondary" to="/catalog">Открыть весь каталог</Link> : <Button variant="secondary" onClick={() => { setTopic(''); setReadiness(''); setPage(0); if (!topic && !readiness && page === 0) void request.reload(); }}>{topic || readiness ? 'Сбросить фильтры' : 'Обновить каталог'}</Button>} />}
    {!recommendations && <p className="muted text-small">Готовность показывает полноту подтверждённого описания. Низкий балл не ограничивает просмотр или отклик.</p>}
  </div>;
}
