import { describe, expect, it } from 'vitest';
import type { Question } from '../types';
import { appendQuestionHistory, cardLengthErrors, filledCardAnswers, mergeRoundAnswers } from './assistRounds';
import { emptyCard } from './fields';

describe('Раунды уточняющих вопросов', () => {
  it('передаёт все известные сведения и сохраняет ответы из предыдущих раундов', () => {
    const initial = { ...emptyCard('logistics'), title: 'Маршруты', data: 'CSV с адресами', context: 'Планируем доставку вручную' };
    const firstRound = mergeRoundAnswers(initial, { data: '500 доставок в день', constraints: 'План нужен к 8 утра' });
    const firstRequest = filledCardAnswers(firstRound);
    expect(firstRequest).toMatchObject({ title: 'Маршруты', topic: 'logistics', data: 'CSV с адресами\n500 доставок в день', constraints: 'План нужен к 8 утра', context: initial.context });
    expect(firstRequest).not.toHaveProperty('contact');

    // The backend applies these fields as full replacement values in its reply.
    const secondRound = mergeRoundAnswers({ ...initial, ...firstRequest }, { data: 'История за полгода', users: 'Диспетчеры' });
    expect(secondRound.data).toBe('CSV с адресами\n500 доставок в день\nИстория за полгода');
    expect(secondRound.constraints).toBe('План нужен к 8 утра');
    expect(secondRound.context).toBe(initial.context);
    expect(initial.data).toBe('CSV с адресами');
  });

  it('не дублирует повторные ответы, а название и тему заменяет', () => {
    const card = { ...emptyCard(), title: 'Старое название', data: 'CSV с адресами\n500 доставок в день' };
    const merged = mergeRoundAnswers(card, { title: 'Новые маршруты', topic: 'logistics', data: '500   доставок в день\nВыгрузка каждое утро\nВыгрузка каждое утро', contact: '   ' });
    expect(merged).toMatchObject({ title: 'Новые маршруты', topic: 'logistics', data: 'CSV с адресами\n500 доставок в день\nВыгрузка каждое утро', contact: '' });
    expect(mergeRoundAnswers(merged, { data: merged.data }).data).toBe(merged.data);
  });

  it('проверяет размер итогового поля и оставляет весь текст для исправления', () => {
    const base = { ...emptyCard(), data: 'a'.repeat(7999) };
    const merged = mergeRoundAnswers(base, { data: 'b' });
    expect(merged.data).toHaveLength(8001);
    expect(cardLengthErrors(merged).data).toContain('8001');
    expect(cardLengthErrors({ ...base, data: 'a'.repeat(8000), title: 'a'.repeat(200), topic: 'b'.repeat(100) })).toEqual({});
    expect(cardLengthErrors({ ...base, title: 'a'.repeat(201), topic: 'b'.repeat(101) })).toMatchObject({ title: expect.any(String), topic: expect.any(String) });
  });

  it('отправляет последние 40 заданных вопросов вместе с текущим раундом', () => {
    const history: Question[] = Array.from({ length: 39 }, (_, index) => ({ field: 'data', question: `Уточнение номер ${index}?` }));
    const current: Question[] = [{ field: 'users', question: 'Кто будет проверять маршруты?' }, { field: 'constraints', question: 'Когда нужен первый маршрут?' }];
    const combined = appendQuestionHistory(history, current);
    expect(combined).toHaveLength(40);
    expect(combined[0]).toEqual(history[1]);
    expect(combined.slice(-2)).toEqual(current);
    expect(history).toHaveLength(39);
  });
});
