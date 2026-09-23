import { describe, expect, it, vi } from 'vitest';
import type { AssistResult, CardData, Question } from '../types';
import { type AnswerDrafts, ClarificationRevisionError, createClarificationSession, mergeClarificationAnswers, requestClarificationRound } from './clarification';

const initialCard: CardData = {
  title: 'Учёт остатков', topic: 'retail', context: 'В магазине ручной учёт.', need: 'Снизить потери.', users: '',
  data: 'Есть таблица CSV.', constraints: '', expected_result: '', success_criteria: '', contact: '', interaction_format: '',
};
const questions: Question[] = [
  { field: 'data', question: 'За какой период собраны данные?' },
  { field: 'users', question: 'Кто будет пользоваться результатом?' },
  { field: 'constraints', question: 'Какие сроки и ограничения есть?' },
];
function result(card = initialCard, revision = 1): AssistResult {
  return { provider: 'stub', fallback_reason: null, based_on_revision: revision, suggested_card: { ...card }, questions, missing_fields: [] };
}

describe('clarification rounds', () => {
  it('passes full accumulated values across rounds and does not duplicate answers after a successful round', async () => {
    let session = createClarificationSession(result());
    session.answers = { data: 'За полгода.', users: 'Закупщик.' };
    const firstSend = vi.fn(async (answers: AnswerDrafts, _previousQuestions: Question[]) => result({ ...initialCard, ...answers }));
    session = await requestClarificationRound(session, firstSend);
    expect(firstSend.mock.calls[0][0]).toMatchObject({ context: 'В магазине ручной учёт.', data: 'Есть таблица CSV.\n\nЗа полгода.', users: 'Закупщик.' });
    expect(session.answers).toEqual({});
    expect(mergeClarificationAnswers(session.assist!.suggested_card, session.answers).data).toBe('Есть таблица CSV.\n\nЗа полгода.');
    session.answers = { data: 'Обновляем раз в день.' };
    const nextSend = vi.fn(async (answers: AnswerDrafts, _previousQuestions: Question[]) => result({ ...initialCard, ...answers }));
    session = await requestClarificationRound(session, nextSend);
    expect(nextSend.mock.calls[0][0]).toMatchObject({ data: 'Есть таблица CSV.\n\nЗа полгода.\n\nОбновляем раз в день.', users: 'Закупщик.' });
    expect(session.previousQuestions).toHaveLength(9);
  });

  it('replaces title and topic while preserving previous details and ignoring empty input', () => {
    const merged = mergeClarificationAnswers(initialCard, { title: ' Новое название ', topic: 'education', data: '  ', need: 'Ускорить закупки.' });
    expect(merged).toMatchObject({ title: 'Новое название', topic: 'education', data: initialCard.data, need: 'Снизить потери.\n\nУскорить закупки.' });
    expect(initialCard.title).toBe('Учёт остатков');
  });

  it('keeps answers and question history after an API failure so retry sends exactly the same full values', async () => {
    const session = createClarificationSession(result());
    session.answers = { data: 'Данные обезличены.' };
    const before = structuredClone(session);
    const failedSend = vi.fn().mockRejectedValue(new Error('Сеть недоступна'));
    await expect(requestClarificationRound(session, failedSend)).rejects.toThrow('Сеть недоступна');
    expect(session).toEqual(before);
    const retrySend = vi.fn(async (answers: AnswerDrafts, _previousQuestions: Question[]) => result({ ...initialCard, ...answers }));
    const next = await requestClarificationRound(session, retrySend);
    expect(retrySend.mock.calls[0]).toEqual(failedSend.mock.calls[0]);
    expect(next.answers).toEqual({});
    expect(session.answers.data).toBe('Данные обезличены.');
  });

  it('rejects a result based on a newer revision instead of silently authorizing overwrite of newer edits', async () => {
    const session = createClarificationSession(result());
    session.answers = { need: 'Снизить списания.' };
    const before = structuredClone(session);
    await expect(requestClarificationRound(session, async answers => result({ ...initialCard, ...answers }, 2))).rejects.toBeInstanceOf(ClarificationRevisionError);
    expect(session).toEqual(before);
    expect(session.assist?.based_on_revision).toBe(1);
  });

  it('sends only the last 40 questions and starts a new task with empty history', async () => {
    let session = createClarificationSession(result());
    for (let index = 0; index < 16; index++) {
      session = await requestClarificationRound(session, async answers => ({ ...result({ ...initialCard, ...answers }), questions: questions.map(question => ({ ...question, question: `${question.question} ${index}` })) }));
    }
    const send = vi.fn(async (_answers: AnswerDrafts, _previousQuestions: Question[]) => result());
    await requestClarificationRound(session, send);
    expect(send.mock.calls[0]?.[1]).toHaveLength(40);
    expect(session.previousQuestions[0]).toEqual({ ...questions[2], question: `${questions[2].question} 2` });
    expect(session.previousQuestions.at(-1)?.question).toBe(`${questions[2].question} 15`);
    expect(createClarificationSession().previousQuestions).toEqual([]);
    expect(createClarificationSession(result()).previousQuestions).toEqual(questions);
  });
});
