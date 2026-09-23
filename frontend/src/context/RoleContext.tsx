import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, invalidateSessionRequests, subscribeSessionExpired, USE_MOCKS } from '../api/client';
import type { Actor, LoginInput, RegisterInput, Team } from '../types';

interface RoleValue {
  actor: Actor | null;
  actors: Actor[];
  role: 'business' | 'student';
  team: Team | null;
  teams: Team[];
  loading: boolean;
  error: string | null;
  sessionVersion: number;
  selectActor: (id: string) => void;
  refreshTeam: () => Promise<void>;
  retry: () => void;
  login: (input: LoginInput) => Promise<Actor>;
  register: (input: RegisterInput) => Promise<Actor>;
  logout: () => Promise<void>;
  clearSession: () => void;
}
const RoleContext = createContext<RoleValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [actors, setActors] = useState<Actor[]>([]);
  const [actor, setActor] = useState<Actor | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const generation = useRef(0);
  const teamRequest = useRef(0);
  const actorRef = useRef<Actor | null>(null);
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const authPending = useRef(false);

  const replaceActor = useCallback((next: Actor | null) => {
    const identityChanged = actorRef.current?.id !== next?.id;
    generation.current++;
    actorRef.current = next;
    setActor(next);
    setError(null);
    setLoading(false);
    if (identityChanged) {
      invalidateSessionRequests();
      teamRequest.current++;
      setTeam(null);
      setTeams([]);
      setSessionVersion(value => value + 1);
    }
  }, []);
  const discardSession = useCallback(() => {
    replaceActor(null);
    setActors([]);
  }, [replaceActor]);
  const broadcastSessionChange = useCallback(() => {
    // No actor, credential or other account data is sent between tabs.
    sessionChannel.current?.postMessage('session-changed');
  }, []);
  const clearSession = useCallback(() => {
    discardSession();
    broadcastSessionChange();
  }, [discardSession, broadcastSessionChange]);

  const load = useCallback(async (background = false) => {
    if (background && authPending.current) return;
    const request = ++generation.current;
    // Rechecking an unchanged account must keep unsaved forms mounted.
    if (!background) { setLoading(true); setError(null); }
    try {
      if (USE_MOCKS) {
        const nextActors = await api.getActors();
        if (request !== generation.current) return;
        setActors(nextActors);
        const selected = nextActors.find(item => item.id === actorRef.current?.id)
          || nextActors.find(item => item.role === 'business') || nextActors[0] || null;
        replaceActor(selected);
        if (!selected) setError('Демо-профили недоступны. Повторите загрузку.');
      } else {
        try {
          const session = await api.getSession();
          if (request === generation.current) replaceActor(session.actor);
        } catch (cause) {
          if (request !== generation.current) return;
          if (cause instanceof ApiError && cause.status === 401 && cause.code === 'LOGIN_REQUIRED') discardSession();
          else throw cause;
        }
      }
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [discardSession, replaceActor]);

  useEffect(() => {
    void load();
    return () => { generation.current++; teamRequest.current++; };
  }, [load]);
  useEffect(() => subscribeSessionExpired(() => {
    discardSession();
    setError('Сессия изменилась или завершилась. Войдите в аккаунт снова.');
  }), [discardSession]);
  useEffect(() => {
    if (USE_MOCKS) return;
    const syncSession = () => { void load(true); };
    const onFocus = () => { if (document.visibilityState === 'visible') syncSession(); };
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('tapsyrma-session');
      sessionChannel.current = channel;
      channel.onmessage = event => { if (event.data === 'session-changed') syncSession(); };
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      channel?.close();
      if (sessionChannel.current === channel) sessionChannel.current = null;
    };
  }, [load]);

  const selectActor = useCallback((id: string) => {
    if (!USE_MOCKS) return;
    const next = actors.find(item => item.id === id);
    if (next && next.id !== actorRef.current?.id) replaceActor(next);
  }, [actors, replaceActor]);

  const refreshTeam = useCallback(async () => {
    const current = actorRef.current;
    const request = ++teamRequest.current;
    if (!current) { setTeam(null); setTeams([]); return; }
    try {
      const nextTeams = await api.getTeams();
      let nextTeam: Team | null = null;
      if (current.role === 'student') {
        try { nextTeam = await api.getMyTeam(current.id); }
        catch (cause) {
          if (!(cause instanceof ApiError && cause.code === 'TEAM_REQUIRED')) throw cause;
        }
      }
      if (request === teamRequest.current && current.id === actorRef.current?.id) {
        setTeams(nextTeams);
        setTeam(nextTeam);
        setError(null);
      }
    } catch (cause) {
      if (request === teamRequest.current && current.id === actorRef.current?.id) setError(errorMessage(cause));
      throw cause;
    }
  }, []);
  useEffect(() => {
    if (actor) void refreshTeam().catch(() => { /* Layout displays the error. */ });
  }, [actor?.id, sessionVersion, refreshTeam]);

  const login = useCallback(async (input: LoginInput) => {
    const request = ++generation.current;
    authPending.current = true;
    try {
      const session = await api.login(input);
      if (request === generation.current) replaceActor(session.actor);
      broadcastSessionChange();
      return session.actor;
    } finally { authPending.current = false; }
  }, [replaceActor, broadcastSessionChange]);
  const register = useCallback(async (input: RegisterInput) => {
    const request = ++generation.current;
    authPending.current = true;
    try {
      const session = await api.register(input);
      if (request === generation.current) replaceActor(session.actor);
      broadcastSessionChange();
      return session.actor;
    } finally { authPending.current = false; }
  }, [replaceActor, broadcastSessionChange]);
  const logout = useCallback(async () => {
    authPending.current = true;
    generation.current++;
    try { await api.logout(); clearSession(); }
    finally { authPending.current = false; }
  }, [clearSession]);

  return <RoleContext.Provider value={{ actor, actors, role: actor?.role || 'business', team, teams, loading, error, sessionVersion, selectActor, refreshTeam, retry: () => { void load(); }, login, register, logout, clearSession }}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const value = useContext(RoleContext);
  if (!value) throw new Error('RoleProvider не подключён.');
  return value;
}
