import type { StudentProfile, StudentProfileInput } from '../types';

export const POSITION_PRESETS = ['Frontend', 'Backend', 'Дизайн', 'QA / тестирование', 'Анализ данных', 'AI / ML', 'Менеджмент проекта'];
export interface StudentProfileDraft { username:string; phone:string; positions:string[]; customPositions:string; skills:string }
export type StudentProfileErrors = Partial<Record<'username'|'phone'|'positions'|'skills',string>>;
export function uniqueTags(value:string):string[] {
  const seen = new Set<string>();
  return value.split(/[,;\n]/).map(item => item.trim()).filter(item => { const key=item.toLowerCase(); if(!item || seen.has(key))return false;seen.add(key);return true; });
}
export function studentDraft(profile?:StudentProfile):StudentProfileDraft {
  return { username:profile?.username || '',phone:profile?.phone || '',positions:profile?.positions.filter(item=>POSITION_PRESETS.includes(item)) || [],customPositions:profile?.positions.filter(item=>!POSITION_PRESETS.includes(item)).join(', ') || '',skills:profile?.skills.join(', ') || '' };
}
export function studentProfileInput(draft:StudentProfileDraft):StudentProfileInput {
  return { username:draft.username.trim().replace(/^@/,'').toLowerCase(),phone:draft.phone.replace(/[\s()\-]/g,''),positions:uniqueTags([...draft.positions,draft.customPositions].join(',')),skills:uniqueTags(draft.skills) };
}
export function validateStudentProfile(input:StudentProfileInput):StudentProfileErrors {
  const errors:StudentProfileErrors={};
  if(!/^[a-z][a-z0-9_]{2,31}$/.test(input.username))errors.username='От 3 до 32 латинских букв, цифр или _. Первый символ — буква.';
  if(!/^\+[1-9]\d{9,14}$/.test(input.phone))errors.phone='Введите международный номер: + и от 10 до 15 цифр. Например, +77001234567.';
  if(!input.positions.length || input.positions.length>10 || input.positions.some(item=>item.length>80))errors.positions='Выберите от 1 до 10 направлений, до 80 символов каждое.';
  if(!input.skills.length || input.skills.length>30 || input.skills.some(item=>item.length>100))errors.skills='Добавьте от 1 до 30 навыков, до 100 символов каждый.';
  return errors;
}
export function completeStudentProfile(profile:StudentProfile):boolean { return Object.keys(validateStudentProfile({...profile,username:profile.username || ''})).length===0; }
