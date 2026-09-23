import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, CheckCircle2, GraduationCap, Layers3 } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage, USE_MOCKS } from '../api/client';
import { Button, ErrorBanner, Input, Skeleton } from '../components/ui';
import { useRole } from '../context/RoleContext';
import type { MessageResult } from '../types';
import './AuthPages.css';

// Only app-relative return paths are accepted; login links cannot redirect off-site.
function returnPath(state: unknown, fallback: string) {
  const from = state && typeof state === 'object' && 'from' in state ? (state as { from?: unknown }).from : null;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || /[\\\u0000-\u001f]/.test(from)) return fallback;
  if (/^\/(login|register|forgot-password|reset-password)(?:[/?#]|$)/.test(from)) return fallback;
  return from;
}

function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-page"><Link className="brand auth-brand" to="/catalog" aria-label="Tapsyrma — каталог задач"><span className="brand-mark"><Layers3 size={21} /></span><span>Tapsyrma<span className="brand-dot">.</span></span></Link><section className="card auth-card"><header><h1>{title}</h1><p>{description}</p></header>{children}</section><Link className="auth-back" to="/catalog"><ArrowLeft size={15} />Вернуться в каталог</Link></main>;
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const context = useRole();
  const location = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'business' | 'student'>('business');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = typeof location.state?.message === 'string' ? location.state.message : null;
  const destination = (accountRole: 'business' | 'student') => returnPath(location.state, register ? (accountRole === 'business' ? '/business/profile' : '/team/profile') : '/catalog');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (register && name.trim().length < 2) { setError('Укажите имя или название организации — от двух символов.'); return; }
    setBusy(true);
    setError(null);
    try {
      const actor = register
        ? await context.register({ name: name.trim(), email: email.trim(), password, role })
        : await context.login({ email: email.trim(), password });
      setPassword('');
      navigate(destination(actor.role), { replace: true });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (USE_MOCKS) return <Navigate to="/catalog" replace />;
  if (context.loading) return <AuthFrame title="Проверяем вход" description="Загружаем ваш аккаунт."><Skeleton lines={3} /></AuthFrame>;
  if (context.actor) return <Navigate to={destination(context.actor.role)} replace />;
  return <AuthFrame title={register ? 'Создать аккаунт' : 'Войти в Tapsyrma'} description={register ? 'Выберите роль и настройте своё рабочее пространство.' : 'Продолжите работу над задачами и предложениями.'}>
    {status && <div className="auth-status" role="status"><CheckCircle2 size={18} /><span>{status}</span></div>}
    {context.error && !error && <ErrorBanner message={context.error} />}
    {error && <ErrorBanner message={error} />}
    <form className="auth-form" onSubmit={submit}>
      {register && <fieldset className="auth-role" disabled={busy}><legend>Ваша роль</legend><div><label className={role === 'business' ? 'selected' : ''}><input type="radio" name="role" value="business" checked={role === 'business'} onChange={() => setRole('business')} /><BriefcaseBusiness size={20} /><span><strong>Бизнес</strong><small>Создаю задачи</small></span></label><label className={role === 'student' ? 'selected' : ''}><input type="radio" name="role" value="student" checked={role === 'student'} onChange={() => setRole('student')} /><GraduationCap size={21} /><span><strong>Студент</strong><small>Предлагаю решения</small></span></label></div></fieldset>}
      {register && <Input label={role === 'business' ? 'Ваше имя или организация' : 'Ваше имя'} name="name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={200} required disabled={busy} />}
      <Input label="Электронная почта" name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required disabled={busy} />
      <Input label="Пароль" name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={register ? 12 : 1} maxLength={128} hint={register ? 'От 12 до 128 символов.' : undefined} required disabled={busy} />
      <div className="auth-password-options"><label><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Показать пароль</label>{!register && <Link to="/forgot-password">Забыли пароль?</Link>}</div>
      <Button type="submit" loading={busy}>{register ? 'Создать аккаунт' : 'Войти'}<ArrowRight size={16} /></Button>
    </form>
    <p className="auth-alternative">{register ? 'Уже есть аккаунт?' : 'Впервые здесь?'} <Link to={register ? '/login' : '/register'} state={location.state}>{register ? 'Войти' : 'Зарегистрироваться'}</Link></p>
  </AuthFrame>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MessageResult | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setResult(null);
    try { setResult(await api.forgotPassword(email.trim())); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (USE_MOCKS) return <Navigate to="/catalog" replace />;
  return <AuthFrame title="Восстановить доступ" description="Укажите почту, с которой зарегистрировали аккаунт.">
    {error && <ErrorBanner message={error} />}
    {result ? <div className="auth-recovery-result"><div className="auth-status" role="status"><CheckCircle2 size={19} /><span>{result.message}</span></div><p>{result.delivery === 'file' ? 'В локальном режиме письма не отправляются на почту. Попросите администратора открыть ссылку из письма в серверной папке outbox.' : 'Если аккаунт существует, письмо содержит ссылку для смены пароля. Проверьте входящие и папку «Спам».'}</p><p>Ссылка действует 30 минут. Новый запрос отменяет предыдущую ссылку.</p><Button variant="secondary" onClick={() => setResult(null)}>Указать почту снова</Button></div> : <form className="auth-form" onSubmit={submit}><Input label="Электронная почта" type="email" name="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required disabled={busy} /><Button type="submit" loading={busy}>Получить ссылку</Button></form>}
    <p className="auth-alternative"><Link to="/login">Вернуться ко входу</Link></p>
  </AuthFrame>;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearSession } = useRole();
  // Reading is pure so React StrictMode can initialize twice. Clear only after commit.
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const captureToken = useCallback(() => {
    if (!window.location.hash) return;
    requestVersion.current++;
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
    setPassword(''); setConfirmation(''); setError(null); setBusy(false);
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);
  useEffect(() => {
    window.addEventListener('hashchange', captureToken);
    return () => { window.removeEventListener('hashchange', captureToken); requestVersion.current++; };
  }, [captureToken]);
  // Also handle in-app navigation to another reset link without a browser reload.
  useEffect(() => { captureToken(); }, [location.hash, captureToken]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) { setError('Пароли не совпадают. Повторите новый пароль.'); return; }
    const request = ++requestVersion.current;
    setBusy(true); setError(null);
    try {
      const result = await api.resetPassword(token, password);
      clearSession();
      if (request !== requestVersion.current) return;
      setPassword(''); setConfirmation('');
      navigate('/login', { replace: true, state: { message: result.message } });
    } catch (cause) { if (request === requestVersion.current) setError(errorMessage(cause)); }
    finally { if (request === requestVersion.current) setBusy(false); }
  };
  if (USE_MOCKS) return <Navigate to="/catalog" replace />;
  return <AuthFrame title="Новый пароль" description="После смены пароля нужно будет войти в аккаунт заново.">
    {token.length < 20 || token.length > 200 ? <div className="auth-recovery-result"><ErrorBanner message="В ссылке нет токена восстановления. Запросите новую ссылку и откройте её из письма." /><Link className="button button-primary" to="/forgot-password">Запросить новую ссылку</Link></div> : <>{error && <ErrorBanner message={error} />}<form className="auth-form" onSubmit={submit}><Input label="Новый пароль" name="new-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} hint="От 12 до 128 символов." required disabled={busy} /><Input label="Повторите пароль" name="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={12} maxLength={128} required disabled={busy} /><Button type="submit" loading={busy}>Сохранить пароль</Button></form><p className="auth-alternative">Ссылка устарела? <Link to="/forgot-password">Получить новую</Link></p></>}
  </AuthFrame>;
}
