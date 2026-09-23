import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Building2, CheckCircle2, Save, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Button, Card, ErrorBanner, Input, PageHeader, Skeleton, Textarea } from '../components/ui';
import { useRole } from '../context/RoleContext';
import { useAsync } from '../hooks/useAsync';
import type { BusinessProfile } from '../types';
import './ProfileHistory.css';

export function BusinessProfilePage() {
  const { actor } = useRole();
  return actor ? <BusinessProfileForm key={actor.id} actorId={actor.id} /> : <Skeleton lines={6} />;
}

function BusinessProfileForm({ actorId }: { actorId: string }) {
  const request = useAsync(() => api.getBusinessProfile(actorId), [actorId]);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (request.data) setProfile(request.data); }, [request.data]);

  function update<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    setProfile(current => current ? { ...current, [key]: value } : current);
    setSaved(false);
    setSaveError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || saving) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const next = await api.saveBusinessProfile(actorId, {
        ...profile,
        company_name: profile.company_name.trim(),
        industry: profile.industry.trim(),
        description: profile.description.trim(),
        goals: profile.goals.trim(),
        values: profile.values.trim(),
      });
      if (mounted.current) { setProfile(next); setSaved(true); }
    } catch (caught) {
      if (mounted.current) setSaveError(errorMessage(caught));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return <div className="page">
    <PageHeader title="Профиль бизнеса" subtitle="Расскажите о компании один раз — помощник учтёт этот контекст при работе над задачами." />
    {request.loading && <Skeleton lines={7} />}
    {request.error && <ErrorBanner message={request.error} onRetry={request.reload} />}
    {!request.loading && profile && <div className="business-profile-layout">
      <Card className="business-profile-form">
        <div className="row"><Building2 size={22} aria-hidden="true" /><h2>О вашей компании</h2></div>
        <p className="muted">Заполните то, что считаете важным. Любое поле можно изменить или оставить пустым.</p>
        <form className="stack" onSubmit={save}>
          <fieldset disabled={saving} className="business-profile-fields">
            <div className="business-profile-basics">
              <Input label="Название компании" maxLength={200} value={profile.company_name} onChange={event => update('company_name', event.target.value)} placeholder="Название вашей компании" autoComplete="organization" />
              <Input label="Отрасль" maxLength={100} value={profile.industry} onChange={event => update('industry', event.target.value)} placeholder="Например, образование или ритейл" />
            </div>
            <Textarea label="Чем занимается компания" value={profile.description} onChange={event => update('description', event.target.value)} maxLength={4000} counter rows={4} placeholder="Ваш продукт, услуги и клиенты" />
            <Textarea label="Цели" value={profile.goals} onChange={event => update('goals', event.target.value)} maxLength={4000} counter rows={3} placeholder="Чего вы хотите достичь и какие задачи для вас важны" />
            <Textarea label="Ценности и принципы работы" value={profile.values} onChange={event => update('values', event.target.value)} maxLength={4000} counter rows={3} placeholder="Что важно учитывать при работе с вашей компанией" />
            <div className="business-history-setting">
              <label className="business-history-toggle"><input type="checkbox" checked={profile.use_history_for_ai} onChange={event => update('use_history_for_ai', event.target.checked)} aria-describedby="business-history-hint" /><span>Учитывать прошлые задачи в AI-помощнике</span></label>
              <p id="business-history-hint">Помощник получит контекст из пяти последних подтверждённых или опубликованных задач вашей компании. Контакты и неподтверждённые изменения в историю не входят. При отключении используется только профиль компании.</p>
            </div>
          </fieldset>
          {saveError && <ErrorBanner message={saveError} />}
          <div className="business-profile-save"><span className="business-profile-save-status" role="status">{saved && <><CheckCircle2 size={17} aria-hidden="true" />Профиль сохранён</>}</span><Button type="submit" loading={saving}><Save size={16} aria-hidden="true" />Сохранить профиль</Button></div>
        </form>
      </Card>
      <aside className="stack">
        <Card className="business-profile-explainer"><Sparkles size={23} aria-hidden="true" /><h2>Контекст для помощника</h2><p>Профиль и разрешённая вами история помогают задавать более точные вопросы при создании карточки.</p><p>Это контекст запроса, а не обучение модели на ваших данных. Факты прошлых задач не переносятся в новую карточку без уточнения и вашего подтверждения.</p><Link className="text-link" to="/new">Создать задачу<ArrowRight size={16} aria-hidden="true" /></Link></Card>
        <Card className="business-profile-explainer"><h3>История работы</h3><p>Задачи, решения по откликам и подтверждённые результаты собраны в отдельном разделе.</p><Link className="text-link" to="/business/history">Открыть историю<ArrowRight size={16} aria-hidden="true" /></Link></Card>
      </aside>
    </div>}
  </div>;
}
