import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
type ToastEntry = { id: number; message: string; type: ToastType };
const ToastContext = createContext<{ toast: (message: string, type?: ToastType) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id); if (timer) clearTimeout(timer);
    timers.current.delete(id); setItems(previous => previous.filter(item => item.id !== id));
  }, []);
  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId.current;
    setItems(previous => [...previous.slice(-3), { id, message, type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), type === 'error' ? 9000 : 6000));
  }, [dismiss]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  return <ToastContext.Provider value={{ toast }}>{children}<div className="toast-container" aria-label="Уведомления">{items.map(item => {
    const Icon = item.type === 'success' ? CheckCircle2 : item.type === 'error' ? CircleAlert : Info;
    return <div key={item.id} className={`toast toast-${item.type}`} role={item.type === 'error' ? 'alert' : 'status'}><Icon size={21} aria-hidden="true" /><span>{item.message}</span><button type="button" onClick={() => dismiss(item.id)} aria-label="Закрыть уведомление"><X size={17} /></button></div>;
  })}</div></ToastContext.Provider>;
}

export function useToast() { const value = useContext(ToastContext); if (!value) throw new Error('useToast должен использоваться внутри ToastProvider'); return value; }
