import type { Team } from '../types';

export interface TeamProfileDraft {
  name: string;
  interests: string;
  skills: string;
  technologies: string;
}

export function teamProfileDraft(team: Team | null): TeamProfileDraft {
  return {
    name: team?.name || '',
    interests: team?.interests.join(', ') || '',
    skills: team?.skills.join(', ') || '',
    technologies: team?.technologies.join(', ') || '',
  };
}

/** Refresh server-owned values without replacing fields the user is editing. */
export function mergeTeamProfileDraft(current: TeamProfileDraft, previous: TeamProfileDraft, next: TeamProfileDraft): TeamProfileDraft {
  const merged = { ...current };
  for (const key of Object.keys(next) as (keyof TeamProfileDraft)[]) {
    if (current[key] === previous[key]) merged[key] = next[key];
  }
  return (Object.keys(next) as (keyof TeamProfileDraft)[]).every(key => merged[key] === current[key]) ? current : merged;
}
