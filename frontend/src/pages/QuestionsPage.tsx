import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, MessageCircle, RefreshCw, Sparkles } from 'lucide-react';
import { ApiError, api, errorMessage } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Skeleton, Textarea } from '../components/ui';
import { FIELD_LABELS, topicLabel } from '../ui/fields';
import { ClarificationRevisionError, createClarificationSession, fieldLimit, mergeClarificationAnswers, requestClarificationRound } from '../ui/clarification';
import type { AssistResult, CardData, CardField, Task } from '../types';

export function QuestionsPage() {
  const [params] = useSearchParams();
  const { actor } = useRole();
  return <QuestionsScreen key={`${actor?.id ?? 'anonymous'}:${params.get('task')}`} />;
}

function QuestionsScreen() {
  const { actor } = useRole();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const taskId = params.get('task');
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as { task?: Task; assist?: AssistResult } | null;
  const initial = routeState?.task?.id === taskId && routeState.task.owner_id === actor?.id ? routeState : null;
  const [task, setTask] = useState<Task | null>(initial?.task ?? null);
  const [session, setSession] = useState(() => createClarificationSession(initial?.assist ?? null));
  const { assist, answers } = session;
  const [loading, setLoading] = useState(!initial?.assist);
  const [busy, setBusy] = useState<'assist' | 'save' | 'server' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [serverTask, setServerTask] = useState<Task | null>(null);
  const active = useRef(true);
  const locked = useRef(false);
  const request = useRef(0);

  useEffect(() => { active.current = true; return () => { active.current = false; request.current++; }; }, []);
  useEffect(() => {
    if (!actor || !taskId || initial?.assist) return;
    const id = ++request.current;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const current = await api.getTask(actor.id, taskId);
        if (!active.current || id !== request.current) return;
        setTask(current);
        const result = await api.assistTask(actor.id, taskId);
        if (active.current && id === request.current) setSession(createClarificationSession(result));
      } catch (reason) {
        if (active.current && id === request.current) setError(errorMessage(reason));
      } finally { if (active.current && id === request.current) setLoading(false); }
    })();
  }, [actor?.id, taskId]);

  const candidate: CardData | null = assist ? mergeClarificationAnswers(assist.suggested_card, answers) : null;
  const oversizedFields = candidate ? (Object.keys(candidate) as CardField[]).filter(field => candidate[field].length > fieldLimit(field)) : [];
  const sizeError = oversizedFields.length ? `Сократите ответ: поле «${FIELD_LABELS[oversizedFields[0]]}» вместе с прежними сведениями превышает ${fieldLimit(oversizedFields[0]).toLocaleString('ru-RU')} символов.` : null;

  async function regenerate() {
    if (!actor || !taskId || locked.current || sizeError) return;
    locked.current = true;
    const id = ++request.current;
    setBusy('assist');
    setError(null);
    try {
      const next = await requestClarificationRound(session, (allAnswers, previousQuestions) => api.assistTask(actor.id, taskId, allAnswers, previousQuestions));
      if (active.current && id === request.current) { setSession(next); setConflict(false); setServerTask(null); }
    } catch (reason) {
      if (active.current && id === request.current) {
        setError(errorMessage(reason));
        if (reason instanceof ClarificationRevisionError) { setConflict(true); setServerTask(null); }
      }
    }
    finally { if (id === request.current) { locked.current = false; if (active.current) { setBusy(null); setLoading(false); } } }
  }

  async function save(revision?: number) {
    if (!actor || !taskId || !assist || !candidate || locked.current || sizeError) return;
    locked.current = true;
    setBusy('save');
    setError(null);
    try {
      const result = await api.updateCard(actor.id, taskId, candidate, revision ?? assist.based_on_revision);
      if (!active.current) return;
      toast('Предложенные сведения сохранены. Просмотрите и подтвердите карточку.', 'success');
      navigate(`/tasks/${result.id}/edit`);
    } catch (reason) {
      if (!active.current) return;
      setError(errorMessage(reason));
      if (reason instanceof ApiError && reason.code === 'STALE_REVISION') { setConflict(true); setServerTask(null); }
    } finally { locked.current = false; if (active.current) setBusy(null); }
  }

  async function loadServer() {
    if (!actor || !taskId || locked.current) return;
    locked.current = true;
    setBusy('server');
    try { const result = await api.getTask(actor.id, taskId); if (active.current) setServerTask(result); }
    catch (reason) { if (active.current) setError(errorMessage(reason)); }
    finally { locked.current = false; if (active.current) setBusy(null); }
  }

  if (!taskId) return <div className="page"><EmptyState title="Сначала создайте задачу" description="Вопросы появятся после описания вашей идеи." action={<Link to="/new" className="button button-primary">Описать задачу</Link>} /></div>;
  if (loading) return <div className="page"><PageHeader title="Готовим вопросы к вашей идее" subtitle="Сохраняем исходные сведения и ищем, какие детали стоит уточнить." /><Skeleton lines={7} /></div>;

  return <div className="page">
    <PageHeader title="Хорошие вопросы — сильная задача" subtitle="Ответьте на то, что уже знаете. Остальные детали можно добавить позже." actions={<Link className="text-link" to={`/tasks/${taskId}/edit`}>К редактору</Link>} />
    <div className="flow-steps" aria-label="Создание задачи"><div className="flow-step done"><span className="step-number"><Check size={16} /></span> Идея</div><div className="flow-step active"><span className="step-number">2</span> Уточнение</div><div className="flow-step"><span className="step-number">3</span> Карточка и запуск</div></div>
    {error && <ErrorBanner message={error} onRetry={!assist && !busy ? regenerate : undefined} />}
    {sizeError && <ErrorBanner message={sizeError} />}
    <div className="editor-layout">
      <div className="stack">
        {assist && <>
          <Card><div className="row"><MessageCircle size={22} className="accent-text" /><h2 className="section-title">Добавим важные детали</h2></div><p className="muted text-small">Новый ответ дополняет сведения прошлого раунда. Название и тема заменяются. После успешного уточнения поля ответа очистятся, а сведения останутся в карточке ниже.</p><div className="stack">{assist.questions.map((question, index) => <div className="form-section" key={question.field}><span className="eyebrow">ВОПРОС {index + 1} · {FIELD_LABELS[question.field]}</span><Textarea label={question.question} placeholder="Ваш ответ — или оставьте поле пустым" rows={3} maxLength={fieldLimit(question.field)} value={answers[question.field] ?? ''} onChange={event => setSession(current => ({ ...current, answers: { ...current.answers, [question.field]: event.target.value } }))} disabled={!!busy} /></div>)}</div></Card>
          <Card><div className="row between"><h2 className="section-title">Предложенная карточка</h2><Sparkles size={20} className="accent-text" /></div><p className="muted text-small">Проверьте сведения перед применением. Ответы выше дополняют предложение помощника.</p><div className="stack">{candidate && Object.entries(candidate).filter(([, value]) => value.trim()).map(([field, value]) => <div key={field}><strong className="text-small">{FIELD_LABELS[field as CardField]}</strong><p className="muted" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{field === 'topic' ? topicLabel(value) : value}</p></div>)}</div><div className="notice text-small">Применение сохраняет черновик. Подтвердить сведения и опубликовать задачу можно на следующем шаге.</div></Card>
          {conflict && <Card><h3>Карточка уже изменилась</h3><p className="muted">Ваши ответы сохранены на этом экране. Загрузите новую редакцию и сравните её с вашим вариантом.</p><Button variant="secondary" loading={busy === 'server'} disabled={!!busy} onClick={loadServer}>Загрузить серверную версию</Button>{serverTask && candidate && <div className="stack"><p className="text-small">Редакция на сервере: {serverTask.revision}</p>{(Object.keys(candidate) as CardField[]).filter(field => candidate[field] !== serverTask.card[field]).map(field => <div key={field}><h4>{FIELD_LABELS[field]}</h4><div className="compare-grid"><div className="compare-cell"><strong>Ваш вариант</strong><p>{candidate[field] || 'Пусто'}</p></div><div className="compare-cell"><strong>На сервере</strong><p>{serverTask.card[field] || 'Пусто'}</p></div></div></div>)}<div className="form-actions"><Button loading={busy === 'save'} disabled={!!busy || !!sizeError} onClick={() => save(serverTask.revision)}>Применить мой вариант к новой редакции</Button><Link className="text-link" to={`/tasks/${taskId}/edit`}>Открыть серверную карточку</Link></div></div>}</Card>}
          <div className="form-actions"><Button loading={busy === 'save'} disabled={!!busy || conflict || !!sizeError} onClick={() => save()}>Применить и открыть карточку<ArrowRight size={17} /></Button><Button variant="secondary" loading={busy === 'assist'} disabled={!!busy || conflict || !!sizeError} onClick={regenerate}><RefreshCw size={16} />Уточнить с учётом ответов</Button></div>
          <p className="text-small muted">Можно пропустить вопросы: нажмите «Применить и открыть карточку» с пустыми ответами.</p>
        </>}
      </div>
      <aside className="stack">
        <Card><Sparkles size={24} className="accent-text" /><h3>{assist?.provider === 'stub' ? 'Шаблонный помощник' : 'AI-помощник'}</h3><p className="muted text-small">{assist?.provider === 'stub' ? 'Работает локальная заглушка: вопросы сформированы по шаблону. Живая AI-модель сейчас не используется.' : 'Помощник помогает структурировать идею. Окончательные сведения проверяете вы.'}</p>{assist?.fallback_reason && <div className="notice text-small">{assist.fallback_reason}</div>}</Card>
        {task && <Card><h3>Ваша идея</h3><p className="muted text-small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.raw_description}</p></Card>}
      </aside>
    </div>
  </div>;
}
