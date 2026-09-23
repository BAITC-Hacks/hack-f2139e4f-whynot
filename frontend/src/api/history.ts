import { apiRequest } from './client';
import type { Milestone, Proposal, Task } from '../types';

export interface BusinessProfile {
  company_name: string;
  industry: string;
  description: string;
  goals: string;
  values: string;
  use_history_for_ai: boolean;
}

export interface HistoryPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface BusinessHistoryEntry {
  task: Task;
  proposals: Array<Proposal & { milestones: Milestone[] }>;
}

export interface StudentHistoryEntry {
  task: { id: string; title: string; topic: string };
  proposal: Proposal;
  milestones: Milestone[];
}

export const historyApi = {
  getBusinessProfile: () => apiRequest<BusinessProfile>('/business/profile'),
  saveBusinessProfile: (profile: BusinessProfile) => apiRequest<BusinessProfile>('/business/profile', undefined, 'PUT', profile),
  getBusinessHistory: (offset = 0, limit = 20) => apiRequest<HistoryPage<BusinessHistoryEntry>>(`/business/history?limit=${limit}&offset=${offset}`),
  getStudentHistory: (offset = 0, limit = 20) => apiRequest<HistoryPage<StudentHistoryEntry>>(`/students/history?limit=${limit}&offset=${offset}`),
};
