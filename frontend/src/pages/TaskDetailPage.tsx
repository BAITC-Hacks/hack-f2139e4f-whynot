import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Send, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { Badge, Button, Card, ErrorBanner, Input, LevelBadge, PageHeader, Skeleton, Textarea } from '../components/ui';
import { FIELD_LABELS, formatDate, topicLabel } from '../ui/fields';
import type { CardField, Proposal, ProposalInput } from '../types';

const detailFields: CardField[] = ['context', 'need', 'users', 'data', 'constraints', 'expected_result', 'success_criteria', 'contact', 'interaction_format'];
const proposalLabels = { pending: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const { actor, role, team } = useRole();
  const { toast } = useToast();
  const task = useAsync(() => api.getCatalogTask(id), [id]);
  const proposals = useAsync<Proposal[]>(() => actor && role === 'student' && team ? api.getMyProposals(actor.id) : Promise.resolve([]), [actor?.id, team?.id, role]);
  const [form, setForm] = useState<ProposalInput>({ idea: '', plan: '', timeline: '', prototype_url: '' });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ProposalInput, string>>>({});
  const existing = proposals.data?.filter(item => item.task_id === id) || [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!actor || !team || busy) return;
    const errors: Partial<Record<keyof ProposalInput, string>> = {};
    for (const key of ['idea', 'plan', 'timeline'] as const) if (!form[key].trim()) errors[key] = 'Заполните это поле.';
    const link = form.prototype_url?.trim();
    if (link) { try { const parsed = new URL(link); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); } catch { errors.prototype_url = 'Укажите полную ссылку, начинающуюся с https:// или http://.'; } }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true); setSubmitError('');
    try {
      const result = await api.createProposal(actor.id, id, { idea: form.idea.trim(), plan: form.plan.trim(), timeline: form.timeline.trim(), prototype_url: link || null });
      proposals.setData(previous => [result, ...(previous || [])]);
      toast('Предложение отправлено. Решение появится в ваших откликах.');
    } catch (error) { setSubmitError(errorMessage(error)); } finally { setBusy(false); }
  }

  return <div className="page">
    <Link className="back-link" to="/catalog"><ArrowLeft size={16} /> Каталог задач</Link>
    {task.error && <ErrorBanner message={task.error} onRetry={task.reload} />}
    {task.loading ? <Skeleton lines={9} /> : task.data && <>
      <PageHeader title={task.data.card.title} subtitle={<span className="row"><Badge>{topicLabel(task.data.card.topic)}</Badge><LevelBadge level={task.data.rating.readiness} /><span>Опубликовано {formatDate(task.data.published_at)}</span></span>} actions={role === 'business' ? <Link className="button button-secondary" to={`/tasks/${id}/proposals`}>Отклики <ArrowRight size={16} /></Link> : undefined} />
      <div className="split-layout detail-layout"><div className="stack">
        <Card><div className="row between"><h2 className="section-title">Задача бизнеса</h2><ShieldCheck size={20} className="muted" /></div><div className="detail-grid">{detailFields.map(field => <section key={field} className={`detail-field ${!task.data?.card[field] ? 'empty-field' : ''}`}><h3>{FIELD_LABELS[field]}</h3><p>{task.data?.card[field] || 'Бизнес пока не уточнил этот раздел.'}</p></section>)}</div></Card>
        {role === 'student' && <Card id="proposal"><h2 className="section-title"><Send size={20} /> Ваше предложение</h2>{!team ? <div className="stack"><p className="muted">Создайте профиль команды, чтобы бизнес познакомился с вашим опытом.</p><Link className="button button-primary" to="/team/profile">Создать профиль команды <ArrowRight size={16} /></Link></div> : proposals.loading ? <Skeleton lines={3} /> : proposals.error ? <ErrorBanner message={proposals.error} onRetry={proposals.reload} /> : existing.length ? <div className="stack">{existing.map(proposal => <div className="notice" key={proposal.id}><CheckCircle2 size={21} /><div><strong>Вы уже отправили предложение</strong><p>{proposalLabels[proposal.status]}</p>{proposal.decision_note && <p>{proposal.decision_note}</p>}</div></div>)}<Link className="button button-secondary" to="/team/proposals">Посмотреть мои отклики <ArrowRight size={16} /></Link></div> : <form className="stack" onSubmit={submit} noValidate><p className="muted">Расскажите, как ваша команда решит задачу. Бизнес рассмотрит каждое предложение самостоятельно.</p><Textarea label="Идея решения" required maxLength={8000} counter value={form.idea} onChange={event => setForm({ ...form, idea: event.target.value })} error={fieldErrors.idea} placeholder="Что вы предлагаете и почему это поможет бизнесу?" /><Textarea label="План работы" required maxLength={8000} counter value={form.plan} onChange={event => setForm({ ...form, plan: event.target.value })} error={fieldErrors.plan} placeholder="Опишите основные шаги и результат каждого из них" /><Input label="Срок и этапы" required maxLength={500} value={form.timeline} onChange={event => setForm({ ...form, timeline: event.target.value })} error={fieldErrors.timeline} placeholder="Например: прототип за 2 недели, пилот — за месяц" /><Input label="Ссылка на прототип или портфолио" type="url" maxLength={2000} value={form.prototype_url || ''} onChange={event => setForm({ ...form, prototype_url: event.target.value })} error={fieldErrors.prototype_url} placeholder="https://… — необязательно" />{submitError && <ErrorBanner message={submitError} />}<div className="form-actions"><span className="muted text-small">От команды «{team.name}»</span><Button type="submit" loading={busy}><Send size={16} /> Отправить предложение</Button></div></form>}</Card>}
      </div><aside className="stack"><Card className="rating-card"><div className="row between"><h2 className="section-title">Готовность задачи</h2><ClipboardCheck size={20} /></div><div className={`score-orb score-${task.data.rating.readiness}`}><strong>{task.data.rating.score}</strong><span>из 100 баллов</span></div><LevelBadge level={task.data.rating.readiness} /><p className="muted text-small">Рейтинг учитывает подтверждённые сведения. Вы можете откликнуться при любом количестве баллов.</p><div className="stack">{task.data.rating.breakdown.map(item => <div key={item.key}><div className="row between text-small"><span>{item.label}</span><strong>{item.points}/{item.max_points}</strong></div><div className="progress-bar"><span style={{ width: `${item.points / item.max_points * 100}%` }} /></div></div>)}</div></Card><Card><h3>Маленькие шаги. Реальный опыт.</h3><p className="muted text-small">20 XP за прототип, 30 XP за пилот и 50 XP за передачу результата. Баллы начисляются после подтверждения бизнесом.</p></Card></aside></div>
    </>}
  </div>;
}
