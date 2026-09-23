import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, LockKeyhole, LogIn } from 'lucide-react';
import { api, errorMessage, USE_MOCKS } from '../api/client';
import { Button, Card, ErrorBanner, Input, PageHeader, Select } from '../components/ui';
import { useRole } from '../context/RoleContext';
import type { Actor } from '../types';

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <div className="page" style={{ maxWidth: 580, marginInline: 'auto' }}><PageHeader title={title} subtitle={subtitle} /><Card className="stack">{USE_MOCKS ? <div className="notice"><p>Сейчас включён демо-режим. Для регистрации и входа подключите приложение к серверу.</p></div> : children}</Card></div>;
}
function destination(state: unknown, fallback: string) {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !/^\/(login|register|forgot-password|reset-password)(?:[/?#]|$)/.test(from) ? from : fallback;
}

export function LoginPage() {
  const { actor, login } = useRole();
  const location = useLocation(), navigate = useNavigate();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const next = destination(location.state, '/catalog');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await login(email.trim(), password); navigate(next, { replace: true }); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  if (actor && !USE_MOCKS) return <Navigate to={next} replace />;
  return <AuthFrame title="Вход в TaskRank" subtitle="Ваши задачи, история и результаты — в одном аккаунте.">{location.state?.passwordReset && <div className="notice" role="status"><CheckCircle2 size={22} /><p>Пароль обновлён. Войдите с новым паролем.</p></div>}<form className="stack" onSubmit={submit}><Input label="Email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /><Input label="Пароль" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />{error && <ErrorBanner message={error} />}<Button type="submit" loading={busy}><LogIn size={17} /> Войти</Button><Link to="/forgot-password">Забыли пароль?</Link></form><p className="muted">Ещё нет аккаунта? <Link to="/register" state={location.state}>Зарегистрироваться</Link></p></AuthFrame>;
}

export function RegisterPage() {
  const { actor, register } = useRole();
  const location = useLocation(), navigate = useNavigate();
  const [role, setRole] = useState<Actor['role']>('business');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!name.trim()) { setError('Укажите имя или название бизнеса.'); return; }
    if (password !== confirmation) { setError('Пароли не совпадают.'); return; }
    setBusy(true); setError('');
    try {
      const registered = await register({ name: name.trim(), email: email.trim(), password, role });
      navigate(destination(location.state, registered.role === 'business' ? '/business/profile' : '/team/profile'), { replace: true });
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  if (actor && !USE_MOCKS) return <Navigate to={destination(location.state, actor.role === 'business' ? '/business/profile' : '/team/profile')} replace />;
  return <AuthFrame title="Создать аккаунт" subtitle="Бизнес публикует задачи, студенты предлагают решения и сохраняют результаты."><form className="stack" onSubmit={submit}><Select label="Я регистрируюсь как" value={role} onChange={event => setRole(event.target.value as Actor['role'])}><option value="business">Представитель бизнеса</option><option value="student">Студент</option></Select><Input label={role === 'business' ? 'Название бизнеса' : 'Ваше имя'} autoComplete={role === 'business' ? 'organization' : 'name'} required maxLength={120} value={name} onChange={event => setName(event.target.value)} /><Input label="Email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /><Input label="Пароль" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="Не менее 12 символов." value={password} onChange={event => setPassword(event.target.value)} /><Input label="Повторите пароль" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} />{error && <ErrorBanner message={error} />}<Button type="submit" loading={busy}>Зарегистрироваться</Button></form><p className="muted">Уже зарегистрированы? <Link to="/login" state={location.state}>Войти</Link></p></AuthFrame>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [delivery, setDelivery] = useState<'file' | 'smtp'>('smtp');
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { const result = await api.forgotPassword(email.trim()); setDelivery(result.delivery || 'smtp'); setSent(true); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  return <AuthFrame title="Восстановить пароль" subtitle="Укажите email, который использовали при регистрации.">{sent ? <div className="notice" role="status"><CheckCircle2 size={22} /><p>{delivery === 'file' ? 'Если адрес зарегистрирован, письмо для восстановления сохранено локально. Отправка на email в этой версии пока не настроена; обратитесь к администратору.' : 'Если аккаунт с таким email существует, письмо со ссылкой для восстановления будет отправлено. Проверьте почту.'}</p></div> : <form className="stack" onSubmit={submit}><Input label="Email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />{error && <ErrorBanner message={error} />}<Button type="submit" loading={busy}>Отправить ссылку</Button></form>}<Link to="/login">Вернуться ко входу</Link></AuthFrame>;
}

export function ResetPasswordPage() {
  const { resetPassword } = useRole();
  const location = useLocation(), navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') || new URLSearchParams(location.search).get('token') || '');
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (location.hash || new URLSearchParams(location.search).has('token')) navigate('/reset-password', { replace: true }); }, [location.hash, location.search, navigate]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !token) return;
    if (password !== confirmation) { setError('Пароли не совпадают.'); return; }
    setBusy(true); setError('');
    try { await resetPassword(token, password); navigate('/login', { replace: true, state: { passwordReset: true } }); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  return <AuthFrame title="Новый пароль" subtitle="После сохранения войдите с новым паролем.">{!token ? <p>Откройте ссылку из письма для восстановления. Если ссылка устарела, <Link to="/forgot-password">запросите новую</Link>.</p> : <form className="stack" onSubmit={submit}><Input label="Новый пароль" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="Не менее 12 символов." value={password} onChange={event => setPassword(event.target.value)} /><Input label="Повторите пароль" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} />{error && <><ErrorBanner message={error} /><Link to="/forgot-password">Запросить новую ссылку</Link></>}<Button type="submit" loading={busy}><LockKeyhole size={17} /> Сохранить пароль</Button></form>}<Link to="/login">Перейти ко входу</Link></AuthFrame>;
}
