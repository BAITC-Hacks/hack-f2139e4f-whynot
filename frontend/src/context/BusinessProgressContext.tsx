import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { subscribeBusinessActivity } from '../api/businessActivity';
import { loadBusinessProgress } from '../api/businessProgress';
import type { BusinessProgress } from '../ui/businessProgress';
import { useRole } from './RoleContext';

interface ProgressContextValue {
  data: BusinessProgress | null;
  showcaseSelection: string[] | null;
  setShowcaseSelection: (ids: string[]) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
const ProgressContext = createContext<ProgressContextValue | null>(null);

export function BusinessProgressProvider({ children }: { children: ReactNode }) {
  const { actor } = useRole();
  const { pathname } = useLocation();
  const actorId = actor?.role === 'business' ? actor.id : null;
  const [showcaseSelection, setShowcaseSelection] = useState<string[] | null>(null);
  const [data, setData] = useState<BusinessProgress | null>(null);
  const [loading, setLoading] = useState(!!actorId);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const lastLoad = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!actorId) { setData(null); setLoading(false); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const next = await loadBusinessProgress(actorId, undefined, () => request === generation.current);
      if (request === generation.current) { setData(next); lastLoad.current = Date.now(); }
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [actorId]);

  useEffect(() => {
    setData(null);
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);
  useEffect(() => subscribeBusinessActivity(changedActor => {
    if (changedActor === actorId) void refresh();
  }), [actorId, refresh]);
  useEffect(() => {
    if (actorId && lastLoad.current > 0 && Date.now() - lastLoad.current > 30000) void refresh();
  }, [pathname, actorId, refresh]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible' && actorId && Date.now() - lastLoad.current > 30000) void refresh();
    };
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, [actorId, refresh]);

  return <ProgressContext.Provider value={{ data, loading, error, refresh, showcaseSelection, setShowcaseSelection }}>{children}</ProgressContext.Provider>;
}

export function useBusinessProgress() {
  const context = useContext(ProgressContext);
  if (!context) throw new Error('BusinessProgressProvider не подключён.');
  return context;
}
