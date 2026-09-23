import { useState } from 'react';
import { ArrowRight, Award, CheckCircle2, Compass, ExternalLink, Flag, Layers3, LockKeyhole, MessageSquare, Rocket, ShieldCheck, Sparkles, Target, Trophy, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useAsync } from '../hooks/useAsync';
import { ProposalChat } from '../components/ProposalChat';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Skeleton, Tags } from '../components/ui';
import { formatDate, MILESTONES, teamLevel, topicLabel } from '../ui/fields';
import type { CatalogTask, Proposal } from '../types';

const proposalLabels = { pending: 'На рассмотрении', accepted: 'Принято', rejected: 'Отклонено' };
function safeLink(value: string | null) { if (!value) return null; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } }

export { TeamProfilePage } from './TeamProfilePage';

export function TeamProposalsPage() {
  const { actor, team } = useRole();
  const [filter, setFilter] = useState<'all' | Proposal['status']>('all');
  const request = useAsync(async () => {
    if (!actor || !team) return { proposals: [] as Proposal[], tasks: {} as Record<string, CatalogTask> };
    const proposals = await api.getMyProposals(actor.id);
    const taskIds = [...new Set(proposals.map(proposal => proposal.task_id))];
    const results = await Promise.allSettled(taskIds.map(id => api.getCatalogTask(id)));
    const tasks: Record<string, CatalogTask> = {};
    results.forEach(result => { if (result.status === 'fulfilled') tasks[result.value.id] = result.value; });
    return { proposals, tasks };
  }, [actor?.id, team?.id]);
  const visible = (request.data?.proposals || []).filter(item => filter === 'all' || item.status === filter);
  return <div className="page"><PageHeader title="Мои отклики" subtitle="Все предложения команды и решения бизнеса в одном месте." actions={<Link className="button button-primary" to="/catalog">Найти новую задачу <ArrowRight size={17} /></Link>} />{!team ? <EmptyState icon={Users} title="Сначала познакомимся" description="Создайте профиль команды, чтобы отправлять предложения бизнесу." action={<Link className="button button-primary" to="/team/profile">Создать профиль</Link>} /> : <><div className="tabs" role="group" aria-label="Статус отклика">{(['all', 'pending', 'accepted', 'rejected'] as const).map(value => <button type="button" key={value} className={`tab ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{value === 'all' ? 'Все отклики' : proposalLabels[value]} <span>{(request.data?.proposals || []).filter(item => value === 'all' || item.status === value).length}</span></button>)}</div>{request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}{request.loading ? <Skeleton lines={6} /> : visible.length ? <div className="stack">{visible.map(proposal => {
    const task = request.data?.tasks[proposal.task_id]; const link = safeLink(proposal.prototype_url);
    return <Card key={proposal.id} className="proposal-card"><div className="row between"><div><span className="muted text-small">{task ? topicLabel(task.card.topic) : 'Задача бизнеса'} · {formatDate(proposal.created_at)}</span><h2><Link to={`/tasks/${proposal.task_id}`}>{task?.card.title || 'Открыть задачу'}</Link></h2></div><Badge className={`proposal-status ${proposal.status}`}>{proposalLabels[proposal.status]}</Badge></div><div className="detail-field"><h3>Ваше решение</h3><p>{proposal.idea}</p></div><details><summary>План и сроки предложения</summary><div className="detail-field"><h3>План</h3><p>{proposal.plan}</p><h3>Срок</h3><p>{proposal.timeline}</p></div>{link && <a className="text-link" href={link} target="_blank" rel="noopener noreferrer">Прототип или портфолио <ExternalLink size={15} /></a>}</details>{proposal.decision_note && <div className="notice"><MessageSquare size={18} /><div><strong>Комментарий бизнеса</strong><p>{proposal.decision_note}</p></div></div>}{proposal.status === 'accepted' && <div className="notice"><CheckCircle2 size={21} /><div><strong>Пора превратить идею в результат</strong><p>Согласуйте с бизнесом работу над прототипом. После подтверждения этапов опыт появится в вашем профиле.</p></div></div>}{proposal.status === 'rejected' && <p className="muted text-small">Это предложение не было выбрано. В каталоге есть другие задачи, где пригодится ваш опыт.</p>}<ProposalChat proposal={proposal}/></Card>;
  })}</div> : !request.error && <EmptyState icon={MessageSquare} title={filter === 'all' ? 'Первый отклик — начало истории' : 'Пока нет откликов с этим статусом'} description={filter === 'all' ? 'Найдите интересную задачу и расскажите бизнесу, как ваша команда может помочь.' : 'Попробуйте другой фильтр или найдите новую задачу.'} action={<Link className="button button-primary" to="/catalog">Открыть каталог <ArrowRight size={16} /></Link>} />}</>}</div>;
}

export function TeamProgressPage() {
  const { actor, team } = useRole();
  const request = useAsync(async () => {
    if (!actor || !team) return null;
    const [currentTeam, proposals] = await Promise.all([api.getMyTeam(actor.id), api.getMyProposals(actor.id)]);
    return { team: currentTeam, proposals };
  }, [actor?.id, team?.id, team?.points]);
  const current = request.data?.team || team;
  const points = current?.points || 0;
  const level = teamLevel(points);
  const accepted = request.data?.proposals.filter(item => item.status === 'accepted').length || 0;
  const achievements = [
    { title: 'В команде', description: 'Создан профиль команды', unlocked: Boolean(current), icon: Users },
    { title: 'Есть контакт', description: 'Бизнес принял предложение', unlocked: accepted > 0, icon: CheckCircle2 },
    { title: 'Первый результат', description: 'Получен опыт за подтверждённый этап', unlocked: points > 0, icon: Rocket },
    { title: 'Первая сотня', description: 'Заработано 100 XP', unlocked: points >= 100, icon: Trophy },
    { title: 'Эксперты дела', description: 'Заработано 200 XP', unlocked: points >= 200, icon: ShieldCheck },
    { title: 'Мастерство', description: 'Заработано 400 XP', unlocked: points >= 400, icon: Award },
  ];
  return <div className="page"><PageHeader title="Ваш прогресс" subtitle="Каждый принятый результат — новая ступень для вашей команды." />{!current ? <EmptyState icon={Compass} title="Большие дела начинаются с команды" description="Создайте профиль, найдите задачу и получите первые баллы за результат." action={<Link className="button button-primary" to="/team/profile">Создать команду</Link>} /> : <>{request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}<section className="hero team-progress-hero"><div className="hero-copy"><div className="hero-eyebrow"><Trophy size={16} /> ВАША ИСТОРИЯ РОСТА</div><h2 className="hero-title">{level.name}</h2><p>{current.name} · уровень {level.index}</p><div className="hero-level-stats"><strong>{points}<span> XP</span></strong><span>Опыт за подтверждённую работу</span></div></div><div className="hero-progress"><Award size={42} /><span>{level.next ? 'До нового уровня осталось' : 'Максимальный уровень достигнут'}</span><strong>{level.next ? `${level.next - points} XP` : 'Мастерство'}</strong><div className="xp-bar"><span style={{ width: `${level.progress}%` }} /></div><small>{level.next ? `${points - level.min} / ${level.next - level.min} XP на этом уровне` : 'Продолжайте накапливать опыт'}</small></div></section><div className="stats-grid"><Card className="stat-card"><Trophy size={22} /><strong>{points}</strong><span>Всего XP</span></Card><Card className="stat-card"><Flag size={22} /><strong>{request.loading ? '…' : accepted}</strong><span>Принятых предложений</span></Card><Card className="stat-card"><Layers3 size={22} /><strong>{request.loading ? '…' : request.data?.proposals.length || 0}</strong><span>Всего откликов</span></Card><Card className="stat-card"><Award size={22} /><strong>{request.loading ? '…' : achievements.filter(item => item.unlocked).length}</strong><span>Открытых достижений</span></Card></div><div className="row between"><h2 className="section-title">Коллекция достижений</h2><span className="muted text-small">На основе ваших результатов</span></div>{request.loading ? <Skeleton lines={4} /> : <div className="achievement-grid">{achievements.map(({ title, description, unlocked, icon: Icon }) => <Card key={title} className={`achievement-card ${unlocked ? 'unlocked' : 'locked'}`}><div className="achievement-icon"><Icon size={29} /></div><h3>{title}</h3><p>{description}</p><Badge>{unlocked ? <><CheckCircle2 size={13} /> Получено</> : <><LockKeyhole size={13} /> Впереди</>}</Badge></Card>)}</div>}<Card><div className="row between"><h2 className="section-title"><Target size={20} /> Как получить следующий уровень</h2><Link className="text-link" to="/catalog">Выбрать задачу <ArrowRight size={16} /></Link></div><div className="milestone-journey">{Object.entries(MILESTONES).map(([code, item], index) => <div key={code} className="milestone-step"><span className="step-number">0{index + 1}</span><div><h3>{item.label}</h3><p className="muted text-small">{item.description}</p></div><Badge>+{item.points} XP</Badge></div>)}</div><p className="muted text-small">Этапы подтверждает представитель бизнеса после проверки результата. Повторное подтверждение не добавляет баллы.</p></Card><Card><div className="row"><Sparkles size={23} /><div><h3>Задачи с точками пересечения</h3><p className="muted">Найдите проект, который подходит интересам и навыкам команды.</p></div><Link className="button button-secondary" to="/recommendations">Найти задачу <ArrowRight size={16} /></Link></div>{current.skills.length > 0 && <Tags items={current.skills} />}</Card></>}</div>;
}
