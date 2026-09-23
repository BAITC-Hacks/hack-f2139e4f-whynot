import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, USE_MOCKS } from '../api/client';
import type { Actor, Team } from '../types';

interface RoleValue {
  actor: Actor | null; actors: Actor[]; role: Actor['role']; team: Team | null; teams: Team[];
  loading: boolean; error: string | null; selectActor: (id: string) => void;
  refreshTeam: () => Promise<void>; retry: () => void;
  login: (email: string, password: string) => Promise<Actor>;
  register: (input: { name: string; email: string; password: string; role: Actor['role'] }) => Promise<Actor>;
  logout: () => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
}
const RoleContext = createContext<RoleValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [actors, setActors] = useState<Actor[]>([]);
  const [actor, setActor] = useState<Actor | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0), teamGeneration = useRef(0), actorRef = useRef<Actor | null>(null);

  const applyActor = useCallback((next: Actor | null) => {
    teamGeneration.current++;
    actorRef.current = next;
    setActor(next); setTeam(null); setTeams([]); setError(null);
    if (!USE_MOCKS) setActors([]);
  }, []);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      if (USE_MOCKS) {
        const nextActors = await api.getActors();
        if (request !== generation.current) return;
        setActors(nextActors);
        applyActor(nextActors.find(item => item.id === actorRef.current?.id) || nextActors[0] || null);
      } else {
        const result = await api.me();
        if (request === generation.current) applyActor(result.actor);
      }
    } catch (caught) {
      if (request !== generation.current) return;
      if (caught instanceof ApiError && caught.status === 401) applyActor(null);
      else setError(errorMessage(caught));
    } finally { if (request === generation.current) setLoading(false); }
  }, [applyActor]);

  useEffect(() => { void load(); return () => { generation.current++; teamGeneration.current++; }; }, [load]);
  useEffect(() => {
    const expired = () => { generation.current++; applyActor(null); setLoading(false); };
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, [applyActor]);

  const refreshTeam = useCallback(async () => {
    const current = actorRef.current;
    const request = ++teamGeneration.current;
    if (!current) { setTeam(null); setTeams([]); return; }
    try {
      const nextTeams = await api.getTeams();
      let nextTeam: Team | null = null;
      if (current.role === 'student') {
        try { nextTeam = await api.getMyTeam(current.id); }
        catch (caught) { if (!(caught instanceof ApiError && caught.code === 'TEAM_REQUIRED')) throw caught; }
      }
      if (request === teamGeneration.current && current.id === actorRef.current?.id) {
        setTeams(nextTeams); setTeam(nextTeam); setError(null);
      }
    } catch (caught) {
      if (request === teamGeneration.current && current.id === actorRef.current?.id) setError(errorMessage(caught));
      throw caught;
    }
  }, []);
  useEffect(() => { if (actor) void refreshTeam().catch(() => { /* Displayed in Layout. */ }); }, [actor?.id, refreshTeam]);

  const selectActor = useCallback((id: string) => {
    if (!USE_MOCKS) return;
    const next = actors.find(item => item.id === id);
    if (!next || next.id === actorRef.current?.id) return;
    generation.current++; applyActor(next); setLoading(false);
  }, [actors, applyActor]);
  const login = useCallback(async (email: string, password: string) => {
    const request = ++generation.current;
    const result = await api.login({ email, password });
    if (request === generation.current) { applyActor(result.actor); setLoading(false); }
    return result.actor;
  }, [applyActor]);
  const register = useCallback(async (input: { name: string; email: string; password: string; role: Actor['role'] }) => {
    const request = ++generation.current;
    const result = await api.register(input);
    if (request === generation.current) { applyActor(result.actor); setLoading(false); }
    return result.actor;
  }, [applyActor]);
  const logout = useCallback(async () => {
    if (!USE_MOCKS) await api.logout();
    generation.current++; applyActor(null); setLoading(false);
  }, [applyActor]);
  const resetPassword = useCallback(async (token: string, password: string) => {
    await api.resetPassword(token, password);
    generation.current++; applyActor(null); setLoading(false);
  }, [applyActor]);

  return <RoleContext.Provider value={{ actor, actors, role: actor?.role || 'business', team, teams, loading, error, selectActor, refreshTeam, retry: () => { void load(); }, login, register, logout, resetPassword }}>{children}</RoleContext.Provider>;
}
export function useRole() { const value = useContext(RoleContext); if (!value) throw new Error('RoleProvider не подключён.'); return value; }
