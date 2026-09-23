import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, History, MessageSquare, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Badge, Button, Card, EmptyState, ErrorBanner, LevelBadge, PageHeader, Skeleton } from '../components/ui';
import { useRole } from '../context/RoleContext';
import { useAsync } from '../hooks/useAsync';
import type { Milestone, Proposal } from '../types';
import { formatDate, MILESTONES, topicLabel } from '../ui/fields';
import './ProfileHistory.css';

const PAGE_SIZE = 20;
const proposalLabels = { pending: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };

function safeLink(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function HistoryPagination({ total, limit, offset, loading, onChange }: { total: number; limit: number; offset: number; loading: boolean; onChange: (offset: number) => void }) {
  if (total <= limit && offset === 0) return null;
  return <nav className="history-pagination" aria-label="Страницы истории"><span>{total ? `${Math.min(offset + 1, total)}–${Math.min(offset + limit, total)} из ${total}` : 'Нет записей'}</span><div className="row"><Button variant="secondary" size="sm" disabled={loading || offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}><ArrowLeft size={16} aria-hidden="true" />Назад</Button><Button variant="secondary" size="sm" disabled={loading || offset + limit >= total} onClick={() => onChange(offset + limit)}>Далее<ArrowRight size={16} aria-hidden="true" /></Button></div></nav>;
}

function ConfirmedResults({ milestones }: { milestones: Milestone[] }) {
  return <section className="history-results" aria-label="Подтверждённые результаты"><h4><CheckCircle2 size={16} aria-hidden="true" />Подтверждённые результаты</h4>{milestones.length ? <ol className="history-result-list">{milestones.map(milestone => <li key={milestone.id}><div className="history-result-heading"><strong>{MILESTONES[milestone.code]?.label || milestone.code}</strong><span className="history-result-xp">+{milestone.points} XP</span></div><p>{milestone.evidence}</p><time className="muted" dateTime={milestone.confirmed_at}>Подтверждено {formatDate(milestone.confirmed_at)}</time></li>)}</ol> : <p className="muted">Подтверждённых этапов пока нет. XP начисляются после проверки результата бизнесом.</p>}</section>;
}

function ProposalRecord({ proposal, milestones, teamName }: { proposal: Proposal; milestones: Milestone[]; teamName?: string }) {
  const prototypeLink = safeLink(proposal.prototype_url);
  return <article className="history-proposal">
    <div className="history-proposal-heading"><div><h3>{teamName || 'Ваше предложение'}</h3><time className="muted" dateTime={proposal.created_at}>Отклик от {formatDate(proposal.created_at)}</time></div><Badge className={`proposal-status ${proposal.status}`}>{proposalLabels[proposal.status]}</Badge></div>
    <p className="history-proposal-idea">{proposal.idea}</p>
    <details className="history-proposal-details"><summary>План, сроки и материалы</summary><dl><div><dt>План работы</dt><dd>{proposal.plan}</dd></div><div><dt>Сроки</dt><dd>{proposal.timeline}</dd></div></dl>{prototypeLink && <a className="text-link" href={prototypeLink} target="_blank" rel="noopener noreferrer">Прототип или портфолио<ExternalLink size={15} aria-hidden="true" /></a>}</details>
    {(proposal.decision_note || proposal.decided_at) && <div className="history-decision"><MessageSquare size={16} aria-hidden="true" /><div><strong>Решение бизнеса{proposal.decided_at ? ` · ${formatDate(proposal.decided_at)}` : ''}</strong>{proposal.decision_note && <p>{proposal.decision_note}</p>}</div></div>}
    <ConfirmedResults milestones={milestones} />
  </article>;
}

export function BusinessHistoryPage() {
  const { actor } = useRole();
  return actor ? <BusinessHistory key={actor.id} actorId={actor.id} /> : <Skeleton lines={6} />;
}

function BusinessHistory({ actorId }: { actorId: string }) {
  const { teams } = useRole();
  const [offset, setOffset] = useState(0);
  const request = useAsync(() => api.getBusinessHistory(actorId, PAGE_SIZE, offset), [actorId, offset]);
  const page = request.data;

  return <div className="page history-page"><PageHeader title="История бизнеса" subtitle="Ваши задачи, решения по откликам и результаты, которые вы подтвердили." actions={<Button variant="secondary" size="sm" loading={request.loading} onClick={request.reload}><RefreshCw size={16} aria-hidden="true" />Обновить</Button>} />
    {request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}
    {request.loading ? <Skeleton lines={7} /> : page && <><div className="history-total">Задач в истории: <strong>{page.total}</strong></div>{page.items.length ? <div className="history-list">{page.items.map(({ task, proposals }) => <Card className="history-task" key={task.id}>
      <div className="history-task-heading"><div><div className="row"><Badge>{topicLabel(task.card.topic)}</Badge><Badge>{task.status === 'published' ? 'Опубликована' : 'Черновик'}</Badge></div><h2><Link to={`/tasks/${task.id}/edit`}>{task.card.title || 'Задача без названия'}</Link></h2><time className="muted" dateTime={task.created_at}>Создана {formatDate(task.created_at)}</time></div><div className="history-task-rating"><strong>{task.rating.score}<small> / 100</small></strong><LevelBadge level={task.rating.readiness} /></div></div>
      <div className="history-task-actions"><Link className="text-link" to={`/tasks/${task.id}/edit`}>Карточка задачи<ArrowRight size={15} aria-hidden="true" /></Link><Link className="text-link" to={`/tasks/${task.id}/proposals`}>Управлять откликами · {proposals.length}<ArrowRight size={15} aria-hidden="true" /></Link></div>
      {proposals.length ? <div className="history-proposals">{proposals.map((proposal, index) => <ProposalRecord key={proposal.id} proposal={proposal} milestones={proposal.milestones} teamName={teams.find(team => team.id === proposal.team_id)?.name || `Отклик команды №${index + 1}`} />)}</div> : <p className="history-no-proposals muted">На эту задачу пока не откликнулись.</p>}
    </Card>)}</div> : <EmptyState icon={History} title={offset ? 'На этой странице нет задач' : 'История начнётся с первой задачи'} description={offset ? 'Вернитесь к предыдущей странице истории.' : 'Здесь сохранятся ваши карточки, предложения команд и подтверждённые результаты.'} action={offset ? <Button variant="secondary" onClick={() => setOffset(0)}>К началу истории</Button> : <Link className="button button-primary" to="/new">Создать задачу<ArrowRight size={16} aria-hidden="true" /></Link>} />}<HistoryPagination total={page.total} offset={page.offset} limit={page.limit} loading={request.loading} onChange={setOffset} /></>}
  </div>;
}

export function StudentHistoryPage() {
  const { actor } = useRole();
  return actor ? <StudentHistory key={actor.id} actorId={actor.id} /> : <Skeleton lines={6} />;
}

function StudentHistory({ actorId }: { actorId: string }) {
  const [offset, setOffset] = useState(0);
  const request = useAsync(() => api.getStudentHistory(actorId, PAGE_SIZE, offset), [actorId, offset]);
  const page = request.data;
  return <div className="page history-page"><PageHeader title="История команды" subtitle="Предложения команды, решения бизнеса и подтверждённые результаты с начисленным XP." actions={<Button variant="secondary" size="sm" loading={request.loading} onClick={request.reload}><RefreshCw size={16} aria-hidden="true" />Обновить</Button>} />
    {request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}
    {request.loading ? <Skeleton lines={7} /> : page && <><div className="history-total">Откликов в истории: <strong>{page.total}</strong></div>{page.items.length ? <div className="history-list">{page.items.map(({ task, proposal, milestones }) => <Card className="history-task" key={proposal.id}><div className="history-task-heading"><div><Badge>{topicLabel(task.topic)}</Badge><h2><Link to={`/tasks/${task.id}`}>{task.title || 'Задача бизнеса'}</Link></h2></div><Link className="text-link" to={`/tasks/${task.id}`}>Открыть задачу<ArrowRight size={15} aria-hidden="true" /></Link></div><ProposalRecord proposal={proposal} milestones={milestones} /></Card>)}</div> : <EmptyState icon={History} title={offset ? 'На этой странице нет откликов' : 'Здесь будет история вашей работы'} description={offset ? 'Вернитесь к предыдущей странице истории.' : 'Отправьте предложение бизнесу. Здесь появятся его решение, подтверждённые этапы и XP за результат.'} action={offset ? <Button variant="secondary" onClick={() => setOffset(0)}>К началу истории</Button> : <Link className="button button-primary" to="/catalog">Найти задачу<ArrowRight size={16} aria-hidden="true" /></Link>} />}<HistoryPagination total={page.total} offset={page.offset} limit={page.limit} loading={request.loading} onChange={setOffset} /></>}
  </div>;
}
