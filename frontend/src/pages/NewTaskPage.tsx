import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, FileText, Lightbulb, Sparkles } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useRole } from '../context/RoleContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, ErrorBanner, Input, PageHeader, Select, Textarea } from '../components/ui';
import { TOPICS } from '../ui/fields';
import { VoiceInput } from '../components/VoiceInput';
import type { Task } from '../types';

export function NewTaskPage() {
  const { actor } = useRole();
  return <NewTaskScreen key={actor?.id ?? 'anonymous'} />;
}

function NewTaskScreen() {
  const { actor } = useRole();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('retail');
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState(false);
  const [created, setCreated] = useState<Task | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setValidation(true);
    if (!actor || voiceBusy || submitting.current || (!created && (!description.trim() || !topic.trim()))) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const task = created ?? await api.createTask(actor.id, { raw_description: description.trim(), title: title.trim(), topic });
      if (!active.current) return;
      setCreated(task);
      const assist = await api.assistTask(actor.id, task.id);
      if (!active.current) return;
      toast('Черновик сохранён. Давайте уточним детали.', 'success');
      navigate(`/new/questions?task=${encodeURIComponent(task.id)}`, { state: { task, assist } });
    } catch (reason) {
      if (active.current) setError(errorMessage(reason));
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <div className="page">
    <PageHeader title="Большие проекты начинаются с идеи" subtitle="Расскажите о задаче своими словами. Поможем превратить её в понятный бриф для команды." />
    <div className="flow-steps" aria-label="Создание задачи">
      <div className="flow-step active"><span className="step-number">1</span> Идея</div>
      <div className="flow-step"><span className="step-number">2</span> Уточнение</div>
      <div className="flow-step"><span className="step-number">3</span> Карточка и запуск</div>
    </div>
    <div className="editor-layout">
      <Card>
        <form className="stack" onSubmit={submit}>
          <div className="row"><span className="icon-tile"><Lightbulb size={22} /></span><div><h2 className="section-title">Какую задачу вы хотите решить?</h2><p className="muted text-small">Достаточно описать текущую ситуацию и желаемые изменения.</p></div></div>
          <Input label="Рабочее название · необязательно" placeholder="Например, прогноз остатков для магазина" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={busy || !!created} />
          <Select label="Тема задачи" value={topic} onChange={e => setTopic(e.target.value)} disabled={busy || !!created}>{TOPICS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
          <Textarea label="Описание задачи" placeholder="Сейчас закупщик вручную проверяет остатки. Хотим заранее понимать, какие товары заканчиваются, чтобы сократить потери продаж…" value={description} onChange={e => setDescription(e.target.value)} rows={9} maxLength={8000} disabled={busy || !!created} error={validation && !description.trim() ? 'Расскажите хотя бы немного о вашей задаче.' : undefined} />
          <p className="muted text-small">{description.length.toLocaleString('ru-RU')} / 8 000 символов. Укажите только те сведения, которыми готовы поделиться.</p>
          {actor && <VoiceInput actorId={actor.id} disabled={busy || !!created} description={description} onDescriptionChange={setDescription} onActivityChange={setVoiceBusy} />}
          <div className="stack" style={{ gap: 8 }}>
            <span className="muted text-small">Или начните с примера:</span>
            <div className="form-actions">
              {[
                { label: 'Остатки магазина', topic: 'retail', description: 'Хотим заранее понимать, какие товары заканчиваются в магазине. Сейчас проверяем остатки вручную.' },
                { label: 'Обратная связь студентов', topic: 'education', description: 'Нужен удобный способ собирать обратную связь студентов после занятий. Пока всё теряется в чатах.' },
                { label: 'Планирование доставок', topic: 'logistics', description: 'Хотим тратить меньше времени на планирование доставок. Сейчас маршруты составляем вручную.' },
              ].map(example => <Button key={example.topic} size="sm" variant="secondary" disabled={busy || !!created} onClick={() => { setDescription(example.description); setTopic(example.topic); }}>{example.label}</Button>)}
            </div>
          </div>
          {created && <div className="notice"><Check size={18} /><span>Черновик уже сохранён. Повторный запрос продолжит работу с этой задачей.</span></div>}
          {error && <ErrorBanner message={error} />}
          <div className="form-actions"><Button type="submit" loading={busy} disabled={voiceBusy}>{created ? 'Повторить уточнение' : 'Перейти к уточнению'}<ArrowRight size={17} /></Button>{created && <Link to={`/tasks/${created.id}/edit`} className="text-link">Заполнить карточку вручную</Link>}</div>
        </form>
      </Card>
      <aside className="stack">
        <Card><Sparkles size={24} className="accent-text" /><h3>От идеи до запуска</h3><p className="muted">Помощник предложит структуру и вопросы. Вы решаете, какие сведения оставить в карточке.</p><div className="notice text-small">Публикация происходит только после вашего подтверждения.</div></Card>
        <Card><FileText size={22} /><h3>Что полезно рассказать</h3><ul className="muted"><li>Что сейчас занимает время?</li><li>Кому поможет решение?</li><li>Какие данные уже есть?</li><li>Какой результат вы ждёте?</li></ul></Card>
      </aside>
    </div>
  </div>;
}
