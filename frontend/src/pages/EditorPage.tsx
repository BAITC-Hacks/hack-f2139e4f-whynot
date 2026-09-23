import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CheckCircle2, FileCheck2, Globe, Save, Sparkles } from 'lucide-react';
import { ApiError, api, errorMessage } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { Badge, Button, Card, ErrorBanner, Input, PageHeader, Select, Skeleton, Textarea } from '../components/ui';
import { ScorePanel } from '../components/ScorePanel';
import { FIELD_GROUPS, FIELD_HINTS, FIELD_LABELS, TOPICS } from '../ui/fields';
import type { CardData, CardField, Task } from '../types';

const sameCard = (a: CardData, b: CardData) => (Object.keys(a) as CardField[]).every(field => a[field] === b[field]);
const trimCard = (card: CardData): CardData => Object.fromEntries(Object.entries(card).map(([key, value]) => [key, value.trim()])) as CardData;

export function EditorPage() {
  const { id } = useParams();
  return <EditorScreen key={id} />;
}

function EditorScreen() {
  const { id = '' } = useParams();
  const { actor } = useRole();
  const { toast } = useToast();
  const { data: task, setData: setTask, loading, error: loadError, reload } = useAsync(() => api.getTask(actor!.id, id), [actor?.id, id]);
  const [card, setCard] = useState<CardData | null>(null);
  const [busy, setBusy] = useState<'save' | 'confirm' | 'publish' | 'server' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [serverTask, setServerTask] = useState<Task | null>(null);
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (task && !card) setCard({ ...task.card }); }, [task, card]);

  function focusField(field: CardField) {
    const input = document.getElementById(`card-${field}`);
    input?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
  }

  function acceptResult(result: Task) {
    if (!active.current) return;
    setTask(result);
    setCard({ ...result.card });
    setConflict(false);
    setServerTask(null);
    setError(null);
  }

  function handleError(reason: unknown) {
    if (!active.current) return;
    setError(errorMessage(reason));
    if (reason instanceof ApiError && reason.code === 'STALE_REVISION') {
      setConflict(true);
      setServerTask(null);
    }
  }

  async function save(revision?: number) {
    if (!actor || !task || !card || locked.current) return;
    locked.current = true;
    setBusy('save');
    setError(null);
    try {
      const result = await api.updateCard(actor.id, task.id, trimCard(card), revision ?? task.revision);
      if (active.current) { acceptResult(result); toast('Изменения сохранены. Подтвердите карточку, чтобы обновить рейтинг.', 'success'); }
    } catch (reason) { handleError(reason); }
    finally { locked.current = false; if (active.current) setBusy(null); }
  }

  async function confirm() {
    if (!actor || !task || !card || locked.current) return;
    setValidation(true);
    if (!card.title.trim() || !card.topic.trim()) {
      focusField(!card.title.trim() ? 'title' : 'topic');
      return;
    }
    locked.current = true;
    setBusy('confirm');
    setError(null);
    try {
      let current = task;
      const value = trimCard(card);
      if (!sameCard(value, task.card)) {
        current = await api.updateCard(actor.id, task.id, value, task.revision);
        if (!active.current) return;
        acceptResult(current);
      }
      const result = await api.confirmTask(actor.id, task.id, current.revision);
      if (active.current) { acceptResult(result); toast('Сведения подтверждены. Рейтинг пересчитан.', 'success'); }
    } catch (reason) { handleError(reason); }
    finally { locked.current = false; if (active.current) setBusy(null); }
  }

  async function publish() {
    if (!actor || !task || !card || locked.current || !sameCard(card, task.card) || task.confirmed_revision !== task.revision) return;
    locked.current = true;
    setBusy('publish');
    setError(null);
    try {
      const result = await api.publishTask(actor.id, task.id, task.revision);
      if (active.current) { acceptResult(result); toast('Задача опубликована. Теперь команды могут откликнуться!', 'success'); }
    } catch (reason) { handleError(reason); }
    finally { locked.current = false; if (active.current) setBusy(null); }
  }

  async function loadServer() {
    if (!actor || !task || locked.current) return;
    locked.current = true;
    setBusy('server');
    try { const result = await api.getTask(actor.id, task.id); if (active.current) setServerTask(result); }
    catch (reason) { handleError(reason); }
    finally { locked.current = false; if (active.current) setBusy(null); }
  }

  if (loading && !task) return <div className="page"><PageHeader title="Загружаем карточку" /><Skeleton lines={9} /></div>;
  if (loadError && !task) return <div className="page"><ErrorBanner message={loadError} onRetry={reload} /></div>;
  if (!task || !card) return null;
  const dirty = !sameCard(card, task.card);
  const confirmed = task.confirmed_revision === task.revision && !dirty;
  const published = task.published_revision === task.revision && !dirty;
  const completeCount = (Object.keys(card) as CardField[]).filter(field => field !== 'topic' && card[field].trim()).length;

  return <div className="page">
    <PageHeader title="Соберите задачу, которую хочется решить" subtitle="Проверьте детали, подтвердите сведения и откройте задачу для команд." actions={<Link to="/business/tasks" className="text-link">Мои задачи</Link>} />
    <div className="flow-steps" aria-label="Состояние карточки"><div className="flow-step done"><span className="step-number"><Check size={16} /></span> Идея</div><div className={`flow-step ${confirmed ? 'done' : 'active'}`}><span className="step-number">2</span> {confirmed ? 'Сведения подтверждены' : 'Проверка карточки'}</div><div className={`flow-step ${published ? 'done' : confirmed ? 'active' : ''}`}><span className="step-number">3</span> {published ? 'Опубликовано' : 'Публикация'}</div></div>
    {error && <ErrorBanner message={error} />}
    {task.status === 'published' && !published && <div className="notice"><Globe size={18} /><span>В каталоге доступна редакция {task.published_revision}. Текущие изменения появятся после подтверждения и новой публикации.</span></div>}
    {published && <div className="notice success"><CheckCircle2 size={19} /><span>Задача опубликована и доступна командам.</span><Link className="text-link" to={`/tasks/${task.id}`}>Посмотреть в каталоге</Link><Link className="text-link" to={`/tasks/${task.id}/proposals`}>Отклики</Link></div>}
    <div className="editor-layout">
      <div className="stack">
        <Card><div className="row between"><div><span className="eyebrow">ВАША КАРТОЧКА</span><h2 className="section-title">Уже заполнено {completeCount} из 10 полей</h2></div><Badge>{dirty ? 'Есть несохранённые правки' : `Редакция ${task.revision}`}</Badge></div><div className="progress-bar" aria-label={`Заполнено ${completeCount} из 10 полей`}><span style={{ width: `${completeCount * 10}%` }} /></div><p className="muted text-small">Заполненность помогает двигаться по карточке. Баллы начисляются после подтверждения сведений.</p>{!dirty && <Link className="text-link" to={`/new/questions?task=${encodeURIComponent(task.id)}`}><Sparkles size={16} />Открыть вопросы помощника</Link>}{dirty && <p className="muted text-small">Сохраните правки, чтобы открыть вопросы помощника.</p>}</Card>
        <form className="stack" onSubmit={event => { event.preventDefault(); void save(); }}>
          {FIELD_GROUPS.map((group, index) => <Card key={group.title} className="field-group"><div className="field-heading"><span className="step-number">{index + 1}</span><h2 className="section-title">{group.title}</h2></div><div className="stack">
            {group.fields.map(field => <div key={field}>
              {field === 'title' ? <Input id={`card-${field}`} label={FIELD_LABELS[field]} value={card[field]} onChange={event => setCard(current => current && { ...current, [field]: event.target.value })} placeholder={FIELD_HINTS[field]} maxLength={200} disabled={!!busy} error={validation && !card.title.trim() ? 'Добавьте название задачи.' : undefined} /> : <Textarea id={`card-${field}`} label={FIELD_LABELS[field]} value={card[field]} onChange={event => setCard(current => current && { ...current, [field]: event.target.value })} placeholder={FIELD_HINTS[field]} maxLength={8000} rows={field === 'context' || field === 'need' ? 4 : 3} disabled={!!busy} />}
              <div className="row between text-small field-status"><span className={card[field].trim() && task.confirmed_fields.includes(field) && card[field] === task.card[field] ? 'success-text' : 'muted'}>{!card[field].trim() ? 'Можно заполнить позже' : task.confirmed_fields.includes(field) && card[field] === task.card[field] ? '✓ Подтверждено' : 'Нужно подтвердить'}</span><span className="muted">{card[field].length.toLocaleString('ru-RU')} / {field === 'title' ? '200' : '8 000'}</span></div>
              {field === 'title' && <Select id="card-topic" label="Тема" value={card.topic} onChange={event => setCard(current => current && { ...current, topic: event.target.value })} disabled={!!busy} error={validation && !card.topic.trim() ? 'Выберите тему.' : undefined}>{!TOPICS.some(topic => topic.value === card.topic) && <option value={card.topic}>{card.topic || 'Выберите тему'}</option>}{TOPICS.map(topic => <option key={topic.value} value={topic.value}>{topic.label}</option>)}</Select>}
            </div>)}
          </div></Card>)}
          {conflict && <Card><h3>Согласуйте две версии карточки</h3><p className="muted">Кто-то уже сохранил новую редакцию. Ваш текст остаётся здесь — его можно сравнить с серверной версией и сохранить осознанно.</p><Button type="button" variant="secondary" loading={busy === 'server'} disabled={!!busy} onClick={loadServer}>Загрузить серверную версию</Button>{serverTask && <div className="stack"><p className="muted text-small">На сервере — редакция {serverTask.revision}. Сохранение вашего варианта заменит карточку целиком.</p>{(Object.keys(card) as CardField[]).filter(field => card[field] !== serverTask.card[field]).map(field => <div key={field}><h4>{FIELD_LABELS[field]}</h4><div className="compare-grid"><div className="compare-cell"><strong>Ваш вариант</strong><p>{card[field] || 'Пусто'}</p></div><div className="compare-cell"><strong>На сервере</strong><p>{serverTask.card[field] || 'Пусто'}</p></div></div></div>)}{sameCard(card, serverTask.card) && <p>Содержимое карточек совпадает.</p>}<div className="form-actions"><Button type="button" loading={busy === 'save'} disabled={!!busy} onClick={() => save(serverTask.revision)}>Сохранить мой вариант</Button><Button type="button" variant="secondary" disabled={!!busy} onClick={() => { acceptResult(serverTask); toast('Загружена серверная карточка.', 'info'); }}>Использовать серверную версию</Button></div></div>}</Card>}
          <Card><div className="row"><FileCheck2 size={23} className="accent-text" /><h2 className="section-title">Готовы показать задачу командам?</h2></div><p className="muted">Нажимая «Подтвердить карточку», вы подтверждаете достоверность заполненных сведений. После этого задачу можно опубликовать.</p><div className="form-actions"><Button type="submit" variant="secondary" loading={busy === 'save'} disabled={!!busy || !dirty || conflict}><Save size={16} />Сохранить</Button><Button type="button" loading={busy === 'confirm'} disabled={!!busy || confirmed || conflict} onClick={confirm}><CheckCircle2 size={16} />{confirmed ? 'Карточка подтверждена' : 'Подтвердить карточку'}</Button><Button type="button" variant={confirmed ? 'primary' : 'secondary'} loading={busy === 'publish'} disabled={!!busy || !confirmed || published || conflict} onClick={publish}><Globe size={16} />{published ? 'Опубликовано' : task.status === 'published' ? 'Обновить публикацию' : 'Опубликовать'}</Button></div><p className="muted text-small">Задачу можно опубликовать с любым рейтингом. Команды смогут отправлять предложения независимо от рейтинга.</p></Card>
        </form>
      </div>
      <aside className="stack"><ScorePanel rating={task.rating} onFocus={focusField} />{dirty && <div className="notice text-small">Рейтинг показывает последнюю сохранённую редакцию. Сохраните изменения для обновления предварительной оценки.</div>}</aside>
    </div>
  </div>;
}
