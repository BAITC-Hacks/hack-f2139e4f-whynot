import { BusinessProjectStatus } from '../components/BusinessProgressWidgets';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, CheckCircle2, ExternalLink, Flag, MessageSquare, Trophy, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Select, Skeleton, Tags, Textarea } from '../components/ui';
import { formatDate, MILESTONES } from '../ui/fields';
import type { Milestone, MilestoneCode, Proposal, Team } from '../types';

const statusLabel = { pending: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };
const codes: MilestoneCode[] = ['prototype', 'pilot', 'delivery'];
function safeLink(value: string | null) { if (!value) return null; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } }

function ProposalCard({ proposal, team, actorId, onUpdated }: { proposal: Proposal; team?: Team; actorId: string; onUpdated: () => Promise<void> }) {
  const { toast } = useToast();
  const { refreshTeam } = useRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [code, setCode] = useState<MilestoneCode>('prototype');
  const [evidence, setEvidence] = useState('');
  const milestones = useAsync<Milestone[]>(() => proposal.status === 'accepted' ? api.getMilestones(actorId, proposal.id) : Promise.resolve([]), [actorId, proposal.id, proposal.status]);
  const completed = milestones.data || [];
  const available = codes.filter(item => !completed.some(milestone => milestone.code === item));
  useEffect(() => { if (!available.includes(code) && available[0]) setCode(available[0]); }, [available.join(','), code]);
  const link = safeLink(proposal.prototype_url);

  async function decide(decision: 'accepted' | 'rejected') {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.decideProposal(actorId, proposal.id, decision, decision === 'rejected' ? note.trim() : ''); setRejectOpen(false); await onUpdated(); toast(decision === 'accepted' ? 'Предложение принято. Теперь можно подтверждать результаты команды.' : 'Предложение отклонено.'); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (busy || !available.includes(code)) return;
    if (!evidence.trim()) { setError('Опишите проверенный результат этапа.'); return; }
    setBusy(true); setError('');
    try { const result = await api.confirmMilestone(actorId, proposal.id, code, evidence.trim()); milestones.setData(previous => [...(previous || []).filter(item => item.id !== result.id), result]); setEvidence(''); await Promise.all([onUpdated(), refreshTeam()]); toast(`Этап «${MILESTONES[result.code].label}» подтверждён. Команда получила +${result.points} XP!`); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }

  return <Card className="proposal-card"><div className="row between"><div><h2>{team?.name || 'Команда'}</h2><p className="muted text-small">{formatDate(proposal.created_at)}{team ? ` · ${team.points} XP` : ''}</p></div><Badge className={`proposal-status ${proposal.status}`}>{statusLabel[proposal.status]}</Badge></div>{team && <Tags items={[...new Set([...team.skills, ...team.technologies])]} />}<div className="detail-field"><h3>Идея</h3><p>{proposal.idea}</p></div><div className="detail-field"><h3>План работы</h3><p>{proposal.plan}</p></div><div className="detail-field"><h3>Сроки</h3><p>{proposal.timeline}</p></div>{link && <a className="text-link" href={link} target="_blank" rel="noopener noreferrer">Прототип или портфолио <ExternalLink size={15} /></a>}{proposal.decision_note && <div className="notice"><MessageSquare size={18} /><div><strong>Комментарий бизнеса</strong><p>{proposal.decision_note}</p></div></div>}
    {proposal.status === 'pending' && <div className="stack">{rejectOpen ? <div className="inline-confirm"><h3>Отклонить предложение?</h3><p className="muted text-small">Команда увидит ваше решение. Позже изменить его будет нельзя.</p><Textarea label="Комментарий команде (необязательно)" disabled={busy} maxLength={8000} value={note} onChange={event => setNote(event.target.value)} /><div className="row"><Button variant="danger" loading={busy} onClick={() => void decide('rejected')}>Подтвердить отказ</Button><Button variant="ghost" disabled={busy} onClick={() => { setRejectOpen(false); setNote(''); }}>Отмена</Button></div></div> : <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRejectOpen(true)}><X size={17} /> Отклонить</Button><Button loading={busy} onClick={() => void decide('accepted')}><Check size={17} /> Принять предложение</Button></div>}</div>}
    {proposal.status === 'accepted' && <section className="stack"><div className="row between"><h3 className="section-title"><Flag size={18} /> Подтверждённые этапы</h3><span className="muted text-small">{completed.length}/3</span></div>{milestones.loading ? <Skeleton lines={2} /> : milestones.error ? <ErrorBanner message={milestones.error} onRetry={milestones.reload} /> : <><div className="milestone-list">{completed.map(milestone => <div key={milestone.id} className="milestone-item"><CheckCircle2 size={21} /><div><div className="row between"><strong>{MILESTONES[milestone.code].label}</strong><Badge>+{milestone.points} XP</Badge></div><p>{milestone.evidence}</p><span className="muted text-small">Подтверждён {formatDate(milestone.confirmed_at)}</span></div></div>)}</div>{available.length ? <form className="stack" onSubmit={confirm}><Select label="Подтвердить результат" disabled={busy} value={code} onChange={event => setCode(event.target.value as MilestoneCode)}>{available.map(item => <option value={item} key={item}>{MILESTONES[item].label} · +{MILESTONES[item].points} XP</option>)}</Select><Textarea label="Что вы проверили и приняли?" disabled={busy} required maxLength={8000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Например: прототип проверен на 20 согласованных примерах, результат принят" /><Button type="submit" loading={busy}><Trophy size={17} /> Подтвердить этап</Button><p className="muted text-small">Нажимая кнопку, вы подтверждаете выполненную командой работу. За каждый этап баллы начисляются один раз.</p></form> : <div className="notice"><Trophy size={22} /><div><strong>Все этапы завершены!</strong><p>Команда получила 100 XP за этот проект.</p></div></div>}</>}</section>}
    {error && <ErrorBanner message={error} />}
  </Card>;
}

export function ProposalsPage() {
  const { id = '' } = useParams();
  const { actor } = useRole();
  const [filter, setFilter] = useState<'all' | Proposal['status']>('all');
  const request = useAsync(async () => { if (!actor) return { proposals: [] as Proposal[], teams: [] as Team[] }; const [proposals, teams] = await Promise.all([api.getTaskProposals(actor.id, id), api.getTeams()]); return { proposals, teams }; }, [actor?.id, id]);
  const visible = (request.data?.proposals || []).filter(item => filter === 'all' || item.status === filter);
  return <div className="page"><Link className="back-link" to="/business/tasks"><ArrowLeft size={16} /> Мои задачи</Link><PageHeader title="Предложения команд" subtitle="Познакомьтесь с идеями и выберите, с кем хотите работать." /><BusinessProjectStatus taskId={id} /><div className="notice"><MessageSquare size={20} /><span>Решение принимаете вы. Можно принять несколько предложений. Баллы начисляются за подтверждённые этапы работы.</span></div><div className="tabs" role="group" aria-label="Статус предложения">{(['all', 'pending', 'accepted', 'rejected'] as const).map(value => <button className={`tab ${filter === value ? 'active' : ''}`} key={value} type="button" onClick={() => setFilter(value)}>{value === 'all' ? 'Все предложения' : statusLabel[value]} <span>{(request.data?.proposals || []).filter(item => value === 'all' || item.status === value).length}</span></button>)}</div>{request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}{request.loading ? <Skeleton lines={7} /> : visible.length && actor ? <div className="proposal-grid">{visible.map(proposal => <ProposalCard key={proposal.id} actorId={actor.id} proposal={proposal} team={request.data?.teams.find(team => team.id === proposal.team_id)} onUpdated={request.reload} />)}</div> : !request.error && <EmptyState icon={MessageSquare} title={filter === 'all' ? 'Первые предложения ещё впереди' : 'Здесь пока нет предложений'} description={filter === 'all' ? 'После публикации команда сможет найти вашу задачу в каталоге и отправить идею решения.' : 'Выберите другой статус, чтобы увидеть остальные предложения.'} />}</div>;
}
