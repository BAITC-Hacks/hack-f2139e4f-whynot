import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CheckCircle2, ExternalLink, History, Plus, Save, Sparkles, Trophy } from 'lucide-react';
import { errorMessage } from '../api/client';
import { historyApi, type BusinessHistoryEntry, type BusinessProfile } from '../api/history';
import { useRole } from '../context/RoleContext';
import { useAsync } from '../hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, LevelBadge, PageHeader, Skeleton, Textarea } from '../components/ui';
import { formatDate, MILESTONES, topicLabel } from '../ui/fields';
import type { Milestone, Proposal } from '../types';

const PAGE_SIZE = 20;
const proposalLabels: Record<Proposal['status'], string> = {
  pending: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено',
};

function prototypeLink(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function ProfileEditor({ initialProfile }: { initialProfile: BusinessProfile }) {
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  function change<K extends keyof BusinessProfile>(field: K, value: BusinessProfile[K]) {
    setProfile(previous => ({ ...previous, [field]: value }));
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!profile.company_name.trim()) { setError('Укажите название бизнеса.'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      const result = await historyApi.saveBusinessProfile({
        company_name: profile.company_name.trim(), industry: profile.industry.trim(),
        description: profile.description.trim(), goals: profile.goals.trim(),
        values: profile.values.trim(), use_history_for_ai: profile.use_history_for_ai,
      });
      if (active.current) { setProfile(result); setSaved(true); }
    } catch (caught) { if (active.current) setError(errorMessage(caught)); }
    finally { if (active.current) setSaving(false); }
  }

  return <div className="split-layout">
    <Card><form className="stack" onSubmit={save}>
      <Input label="Название бизнеса" autoComplete="organization" required maxLength={200} value={profile.company_name} disabled={saving} onChange={event => change('company_name', event.target.value)} />
      <Input label="Отрасль" maxLength={100} value={profile.industry} disabled={saving} onChange={event => change('industry', event.target.value)} placeholder="Например: образование, доставка, розничная торговля" />
      <Textarea label="О бизнесе" maxLength={4000} counter value={profile.description} disabled={saving} onChange={event => change('description', event.target.value)} placeholder="Чем занимается компания, кто ваши клиенты и как вы работаете" />
      <Textarea label="Цели бизнеса" maxLength={4000} counter value={profile.goals} disabled={saving} onChange={event => change('goals', event.target.value)} placeholder="Каких результатов вы хотите достичь и как измеряете успех" />
      <Textarea label="Ценности и принципы" maxLength={4000} counter value={profile.values} disabled={saving} onChange={event => change('values', event.target.value)} placeholder="Что важно учитывать в решениях: доступность, качество, забота о клиентах…" />
      <div className="stack">
        <label className="row"><input type="checkbox" checked={profile.use_history_for_ai} disabled={saving} onChange={event => change('use_history_for_ai', event.target.checked)} aria-describedby="history-ai-hint" /><span>Учитывать историю моих задач в вопросах ИИ</span></label>
        <p id="history-ai-hint" className="muted text-small">Помощник сможет учитывать ваши предыдущие подтверждённые задачи. Сохранённые цели и ценности учитываются отдельно, даже если история выключена.</p>
      </div>
      {error && <ErrorBanner message={error} />}
      {saved && <p className="notice" role="status"><CheckCircle2 size={19} aria-hidden="true" />Профиль сохранён. Помощник учтёт его при следующем уточнении задачи.</p>}
      <div className="form-actions"><Button type="submit" loading={saving}><Save size={17} aria-hidden="true" />Сохранить профиль</Button></div>
    </form></Card>
    <aside className="stack"><Card><Sparkles size={25} aria-hidden="true" /><h3>Контекст для помощника</h3><p>Опишите цели и принципы один раз. При создании новых карточек помощник будет задавать вопросы с учётом вашего бизнеса.</p><p>Обновляйте профиль, когда меняются приоритеты. Так новые задачи будут соответствовать вашим текущим целям.</p><Link className="text-link" to="/business/history"><History size={16} aria-hidden="true" />Открыть историю задач</Link></Card></aside>
  </div>;
}

function BusinessProfileContent() {
  const request = useAsync(historyApi.getBusinessProfile);
  return <div className="page">
    <PageHeader title="Профиль бизнеса" subtitle="Цели, ценности и опыт компании помогают точнее сформулировать каждую задачу." />
    {request.loading ? <Skeleton lines={7} /> : request.error ? <ErrorBanner message={request.error} onRetry={request.reload} /> : request.data && <ProfileEditor initialProfile={request.data} />}
  </div>;
}

export function BusinessProfilePage() {
  const { actor } = useRole();
  return actor ? <BusinessProfileContent key={actor.id} /> : <Skeleton lines={5} />;
}

function MilestoneResults({ milestones }: { milestones: Milestone[] }) {
  if (!milestones.length) return <p className="muted text-small">Подтверждённых результатов пока нет.</p>;
  return <div className="milestone-list">{milestones.map(milestone => <div className="milestone-item" key={milestone.id}>
    <CheckCircle2 size={20} aria-hidden="true" />
    <div><div className="row between"><strong>{MILESTONES[milestone.code].label}</strong><Badge>+{milestone.points} XP</Badge></div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{milestone.evidence}</p>
      <span className="muted text-small">Подтверждено бизнесом {formatDate(milestone.confirmed_at)}</span>
    </div>
  </div>)}</div>;
}

function ProposalSummary({ proposal }: { proposal: Proposal }) {
  const link = prototypeLink(proposal.prototype_url);
  return <div className="stack">
    <div className="row"><Badge className={`proposal-status ${proposal.status}`}>{proposalLabels[proposal.status]}</Badge><span className="muted text-small">Отклик от {formatDate(proposal.created_at)}</span></div>
    <div className="detail-field"><h3>Идея решения</h3><p>{proposal.idea}</p></div>
    <div className="detail-field"><h3>План и сроки</h3><p>{proposal.plan}</p><p>{proposal.timeline}</p></div>
    {link && <a className="text-link" href={link} target="_blank" rel="noopener noreferrer">Прототип или портфолио<ExternalLink size={15} aria-hidden="true" /></a>}
    {proposal.decided_at && <p className="muted text-small">Решение принято {formatDate(proposal.decided_at)}</p>}
    {proposal.decision_note && <div className="notice"><div><strong>Комментарий бизнеса</strong><p style={{ whiteSpace: 'pre-wrap' }}>{proposal.decision_note}</p></div></div>}
  </div>;
}

function Pagination({ offset, total, count, loading, onChange }: { offset: number; total: number; count: number; loading: boolean; onChange: (offset: number) => void }) {
  if (!total) return null;
  return <nav className="row between" aria-label="Страницы истории">
    <p className="muted text-small">{count ? `${offset + 1}–${offset + count}` : '0'} из {total}</p>
    <div className="row"><Button variant="secondary" disabled={loading || offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>Назад</Button><Button variant="secondary" disabled={loading || offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>Далее</Button></div>
  </nav>;
}

function BusinessHistoryCard({ entry }: { entry: BusinessHistoryEntry }) {
  const { task, proposals } = entry;
  const completed = proposals.flatMap(proposal => proposal.milestones);
  return <Card className="proposal-card stack">
    <div className="row between"><div className="stack"><div className="row"><Badge>{topicLabel(task.card.topic)}</Badge><Badge>{task.status === 'published' ? 'Опубликована' : 'Черновик'}</Badge></div><h2><Link to={`/tasks/${task.id}/edit`}>{task.card.title || 'Задача без названия'}</Link></h2><p className="muted text-small">Создана {formatDate(task.created_at)} · Редакция {task.revision}</p></div><div className="stack"><strong>{task.rating.score}/100</strong><LevelBadge level={task.rating.readiness} /></div></div>
    <p className="muted">{task.card.need || task.card.context || task.raw_description}</p>
    {task.card.expected_result && <div className="detail-field"><h3>Ожидаемый результат</h3><p>{task.card.expected_result}</p></div>}
    <div className="row"><Badge>Откликов: {proposals.length}</Badge><Badge>Принято: {proposals.filter(proposal => proposal.status === 'accepted').length}</Badge><Badge>Подтверждено этапов: {completed.length}</Badge></div>
    {proposals.length > 0 && <details><summary>Решения по откликам и результаты</summary><div className="stack">{proposals.map((proposal, index) => <section className="stack" key={proposal.id} aria-label={`Отклик ${index + 1}`}><h3>Отклик {index + 1}</h3><ProposalSummary proposal={proposal} /><MilestoneResults milestones={proposal.milestones} /></section>)}</div></details>}
    <div className="form-actions"><Link className="button button-secondary button-sm" to={`/tasks/${task.id}/edit`}>Открыть карточку</Link><Link className="text-link" to={`/tasks/${task.id}/proposals`}>Отклики и этапы</Link></div>
  </Card>;
}

function BusinessHistoryContent() {
  const [offset, setOffset] = useState(0);
  const request = useAsync(() => historyApi.getBusinessHistory(offset, PAGE_SIZE), [offset]);
  return <div className="page">
    <PageHeader title="История задач бизнеса" subtitle="Ваши карточки, решения по откликам и подтверждённые результаты команд." actions={<Link className="button button-primary" to="/new"><Plus size={17} aria-hidden="true" />Создать задачу</Link>} />
    <div className="notice"><Building2 size={20} aria-hidden="true" /><span>Цели бизнеса и использование истории помощником можно настроить в <Link className="text-link" to="/business/profile">профиле бизнеса</Link>.</span></div>
    {request.loading ? <Skeleton lines={7} /> : request.error ? <ErrorBanner message={request.error} onRetry={request.reload} /> : request.data && <div className="stack">
      {request.data.items.length ? request.data.items.map(entry => <BusinessHistoryCard key={entry.task.id} entry={entry} />) : <EmptyState icon={History} title="История пока пуста" description="Создайте первую карточку. Здесь сохранятся ваши задачи, отклики команд и результаты работы." action={<Link className="button button-primary" to="/new">Создать задачу</Link>} />}
      <Pagination offset={request.data.offset} total={request.data.total} count={request.data.items.length} loading={request.loading} onChange={setOffset} />
    </div>}
  </div>;
}

export function BusinessHistoryPage() {
  const { actor } = useRole();
  return actor ? <BusinessHistoryContent key={actor.id} /> : <Skeleton lines={5} />;
}

function StudentHistoryContent() {
  const [offset, setOffset] = useState(0);
  const request = useAsync(() => historyApi.getStudentHistory(offset, PAGE_SIZE), [offset]);
  return <div className="page">
    <PageHeader title="Мои задачи и результаты" subtitle="История ваших откликов, решений бизнеса и результатов, за которые начислены баллы." actions={<Link className="button button-secondary" to="/team/progress"><Trophy size={17} aria-hidden="true" />Мой прогресс</Link>} />
    {request.loading ? <Skeleton lines={7} /> : request.error ? <ErrorBanner message={request.error} onRetry={request.reload} /> : request.data && <div className="stack">
      {request.data.items.length ? request.data.items.map(({ task, proposal, milestones }) => <Card className="proposal-card stack" key={proposal.id}>
        <div className="row between"><div className="stack"><Badge>{topicLabel(task.topic)}</Badge><h2><Link to={`/tasks/${task.id}`}>{task.title || 'Задача без названия'}</Link></h2></div><Badge className="success">{milestones.reduce((sum, milestone) => sum + milestone.points, 0)} XP</Badge></div>
        <ProposalSummary proposal={proposal} />
        <section className="stack"><h3>Подтверждённые результаты</h3><MilestoneResults milestones={milestones} /></section>
        <div className="form-actions"><Link className="button button-secondary button-sm" to={`/tasks/${task.id}`}>Открыть задачу</Link>{milestones.some(milestone => milestone.code === 'delivery') && <Badge className="success">Результат передан</Badge>}</div>
      </Card>) : <EmptyState icon={History} title="Здесь появится ваш опыт" description="Отправьте предложение по задаче из каталога. Решение бизнеса и результаты работы сохранятся в вашей истории." action={<Link className="button button-primary" to="/catalog">Найти задачу</Link>} />}
      <Pagination offset={request.data.offset} total={request.data.total} count={request.data.items.length} loading={request.loading} onChange={setOffset} />
    </div>}
  </div>;
}

export function StudentHistoryPage() {
  const { actor } = useRole();
  return actor ? <StudentHistoryContent key={actor.id} /> : <Skeleton lines={5} />;
}
