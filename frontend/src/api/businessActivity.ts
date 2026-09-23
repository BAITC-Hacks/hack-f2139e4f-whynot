const listeners = new Set<(actorId: string) => void>();

export function subscribeBusinessActivity(listener: (actorId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyBusinessActivity(actorId: string) {
  listeners.forEach(listener => listener(actorId));
}
