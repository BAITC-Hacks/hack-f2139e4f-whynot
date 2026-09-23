import type { Readiness } from '../types';

export const LEVELS: Record<Readiness, { label: string; color: string; className: string }> = {
  draft: { label: 'Черновик', color: '#8591a5', className: 'readiness-draft' },
  working: { label: 'Рабочая', color: '#3b82f6', className: 'readiness-working' },
  ready: { label: 'Готовая', color: '#10a878', className: 'readiness-ready' },
  priority: { label: 'Приоритетная', color: '#d59b22', className: 'readiness-priority' },
};

export const levelOrder: Readiness[] = ['draft', 'working', 'ready', 'priority'];
