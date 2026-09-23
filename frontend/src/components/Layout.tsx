import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, ChevronRight, CircleHelp, Compass, Flag, GraduationCap, Layers3, LayoutGrid, Menu, Plus, Send, ShieldCheck, Sparkles, Trophy, Users, X, Zap } from 'lucide-react';
import { USE_MOCKS } from '../api/client';
import { useRole } from '../context/RoleContext';
import { teamLevel as getTeamLevel } from '../ui/fields';
import { Badge, ErrorBanner, Skeleton } from './ui';

const navItems = {
  business: [
    { to: '/catalog', label: 'Каталог задач', icon: LayoutGrid },
    { to: '/business/tasks', label: 'Мои задачи', icon: Layers3 },
    { to: '/new', label: 'Создать задачу', icon: Plus },
  ],
  student: [
    { to: '/catalog', label: 'Каталог задач', icon: LayoutGrid },
    { to: '/recommendations', label: 'Для вашей команды', icon: Compass },
    { to: '/team/proposals', label: 'Мои отклики', icon: Send },
    { to: '/team/profile', label: 'Моя команда', icon: Users },
    { to: '/team/progress', label: 'Мой прогресс', icon: Trophy },
  ],
};

export function Layout() {
  const { actor, actors, role, team, selectActor, loading, error, retry } = useRole();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const location = useLocation(); const navigate = useNavigate();
  const teamLevel = getTeamLevel(team?.points ?? 0);
  const activePage = navItems[role].find(item => item.to === location.pathname)?.label ?? (location.pathname.includes('proposals') ? 'Отклики команд' : location.pathname.includes('edit') ? 'Редактор задачи' : 'Карточка задачи');
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const mobile = window.matchMedia('(max-width: 680px)');
    const focusFrame = requestAnimationFrame(() => {
      if (mobile.matches) sidebarRef.current?.querySelector<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled)')?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
      if (event.key === 'Tab' && mobile.matches) {
        const navigationItems = sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled)');
        const focusable = [menuButtonRef.current, ...Array.from(navigationItems ?? [])].filter((item): item is HTMLElement => item !== null);
        if (!focusable.length) return;
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex + 1) % focusable.length;
        event.preventDefault(); focusable[nextIndex].focus();
      }
    };
    const onViewport = () => { if (!mobile.matches) setMenuOpen(false); };
    window.addEventListener('keydown', onKey); mobile.addEventListener('change', onViewport);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey); mobile.removeEventListener('change', onViewport);
      if (mobile.matches) menuButtonRef.current?.focus();
    };
  }, [menuOpen]);
  const chooseRole = (newRole: 'business' | 'student') => { const nextActor = actors.find(item => item.role === newRole); if (nextActor) { selectActor(nextActor.id); navigate('/catalog'); } };
  const initials = (actor?.name ?? 'TR').split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  return <div className="app-shell"><a href="#main-content" className="skip-link">К содержимому</a>
    <header className="app-topbar"><div className="topbar-brand-group"><button ref={menuButtonRef} type="button" className="icon-button mobile-menu-button" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="app-sidebar" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button><Link to="/catalog" className="brand" aria-label="TaskRank — каталог задач"><span className="brand-mark"><Layers3 size={21} strokeWidth={2.2} /></span><span>Task<span className="brand-accent">Rank</span><span className="brand-dot">.</span></span></Link><span className="topbar-separator" /><span className="brand-caption">Место, где идеи растут</span></div>
      <div className="topbar-right"><div className="role-switch" aria-label="Роль в приложении"><button type="button" className={role === 'business' ? 'active' : ''} aria-pressed={role === 'business'} onClick={() => chooseRole('business')} disabled={loading || !actors.some(item => item.role === 'business')}><BriefcaseBusiness size={15} />Бизнес</button><button type="button" className={role === 'student' ? 'active' : ''} aria-pressed={role === 'student'} onClick={() => chooseRole('student')} disabled={loading || !actors.some(item => item.role === 'student')}><GraduationCap size={17} />Команда</button></div><div className="account"><span className="avatar">{initials}</span><div><strong>{actor?.name ?? 'Загрузка…'}</strong><small>{role === 'business' ? 'Представитель бизнеса' : team?.name ?? 'Участник команды'}</small></div></div></div>
    </header>
    {menuOpen && <button className="sidebar-backdrop" type="button" tabIndex={-1} aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <aside ref={sidebarRef} id="app-sidebar" className={`app-sidebar ${menuOpen ? 'is-open' : ''}`}><div className="sidebar-section"><span className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</span><nav className="main-nav" aria-label="Главная навигация">{navItems[role].map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{to === '/team/progress' && <span className="nav-dot" />}</NavLink>)}</nav></div>
      <div className="actor-picker"><label htmlFor="demo-actor">{USE_MOCKS ? 'Демо-профиль' : 'Профиль для демо'}</label><select id="demo-actor" value={actor?.id ?? ''} disabled={loading || actors.length === 0} onChange={event => { selectActor(event.target.value); navigate('/catalog'); }}>{!actor && <option value="">Выберите профиль</option>}{actors.filter(item => item.role === role).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="actor-hint">{USE_MOCKS ? 'Данные сохраняются до перезагрузки' : 'Выбор профиля без авторизации'}</span></div>
      {role === 'student' && team && <Link to="/team/progress" className="sidebar-xp"><div className="sidebar-xp-head"><span className="xp-crest"><ShieldCheck size={21} /></span><div><small>УРОВЕНЬ {teamLevel.index}</small><strong>{teamLevel.name}</strong></div><ChevronRight size={15} /></div><div className="xp-meta"><strong><Zap size={14} fill="currentColor" />{team.points} <span>XP</span></strong><span>{teamLevel.next ? `из ${teamLevel.next}` : 'Высший уровень'}</span></div><div className="xp-bar"><span style={{ width: `${teamLevel.progress}%` }} /></div><p>{teamLevel.next ? `Ещё ${(teamLevel.next - team.points)} XP до нового уровня` : 'Продолжайте создавать полезное'}</p></Link>}
      <div className="sidebar-quest"><span className="quest-label">{role === 'business' ? <Sparkles size={14} /> : <Flag size={14} />}{role === 'business' ? 'ОТ ИДЕИ К РЕЗУЛЬТАТУ' : 'СЛЕДУЮЩИЙ ШАГ'}</span><h3>{role === 'business' ? 'Начните с потребности' : 'Ваш опыт нужен бизнесу'}</h3><p>{role === 'business' ? 'Расскажите о задаче — поможем превратить её в понятную карточку.' : 'Найдите задачу, предложите решение и получите опыт за результат.'}</p><Link to={role === 'business' ? '/new' : '/recommendations'}>{role === 'business' ? 'Создать задачу' : 'Найти свой проект'}<ArrowRight size={14} /></Link><Sparkles className="quest-decoration" size={64} strokeWidth={.8} aria-hidden="true" /></div>
      <div className="sidebar-footer"><div><span className="live-dot" />{USE_MOCKS ? <Badge className="mock-badge">Мок-режим</Badge> : 'Подключение к API'}</div><p>Идеи становятся результатами.<br />Вместе с командами.</p><span className="sidebar-copyright">TaskRank · 2026 <ArrowUpRight size={13} /></span></div>
    </aside>
    <main id="main-content" className="app-main" tabIndex={-1}><div className="breadcrumb"><span>Рабочее пространство</span><ChevronRight size={12} /><span>{activePage}</span></div>{actor ? <>{error && <div className="page"><ErrorBanner message={error} onRetry={retry} /></div>}<Outlet /></> : error ? <div className="page"><ErrorBanner message={error} onRetry={retry} /></div> : loading ? <div className="page"><Skeleton lines={3} /><div className="task-grid"><Skeleton lines={5} /><Skeleton lines={5} /></div></div> : <div className="page"><ErrorBanner message="Нет доступных профилей. Проверьте подключение и повторите загрузку." onRetry={retry} /></div>}<footer className="main-footer"><span>TaskRank — от идеи до первого результата</span><span><CircleHelp size={13} />Решения принимают люди</span></footer></main>
  </div>;
}

export default Layout;
