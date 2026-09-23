import { describe, expect, it } from 'vitest';
import type { Team } from '../types';
import { mergeTeamProfileDraft, teamProfileDraft } from './teamProfile';

const team: Team = { id: 'team-1', owner_id: 'student-1', name: 'WhyNot', interests: ['Образование'], skills: ['Дизайн'], technologies: ['React'], points: 0 };

describe('Profile drafts during background team refresh', () => {
  it('preserves unsaved profile edits when XP increases', () => {
    const previous = teamProfileDraft(team);
    const draft = { ...previous, name: 'Новое имя', skills: 'Дизайн, Аналитика' };
    const next = teamProfileDraft({ ...team, points: 50 });
    expect(mergeTeamProfileDraft(draft, previous, next)).toBe(draft);
    expect(draft.name).toBe('Новое имя');
  });

  it('updates untouched fields while keeping edited fields after a remote profile update', () => {
    const previous = teamProfileDraft(team);
    const draft = { ...previous, technologies: 'React, Python' };
    const next = teamProfileDraft({ ...team, name: 'Имя с сервера', skills: ['Дизайн', 'SQL'], technologies: ['Vue'], points: 20 });
    expect(mergeTeamProfileDraft(draft, previous, next)).toEqual({ ...next, technologies: 'React, Python' });
    expect(draft).toEqual({ ...previous, technologies: 'React, Python' });
  });

  it('preserves an intentional cleared field and new input while the first profile request finishes', () => {
    const previous = teamProfileDraft(team);
    const cleared = { ...previous, name: '' };
    expect(mergeTeamProfileDraft(cleared, previous, teamProfileDraft({ ...team, name: 'Изменённое имя' })).name).toBe('');
    const empty = teamProfileDraft(null);
    expect(mergeTeamProfileDraft({ ...empty, skills: 'Введено пользователем' }, empty, previous)).toEqual({ ...previous, skills: 'Введено пользователем' });
  });

  it('uses a saved profile as the new baseline for subsequent refreshes', () => {
    const saved = teamProfileDraft({ ...team, name: 'Новая команда', technologies: ['Python'] });
    const afterRefresh = teamProfileDraft({ ...team, name: 'Новая команда', technologies: ['Python', 'React'], points: 30 });
    expect(mergeTeamProfileDraft(saved, saved, afterRefresh)).toEqual(afterRefresh);
    expect(mergeTeamProfileDraft(saved, saved, { ...saved })).toBe(saved);
  });
});
