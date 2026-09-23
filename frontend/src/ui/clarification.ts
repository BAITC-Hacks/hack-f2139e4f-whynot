import type { AssistResult, CardData, CardField, Question } from '../types';

export class ClarificationRevisionError extends Error {
  constructor() { super('Карточка изменилась во время уточнения. Ваши ответы сохранены. Загрузите новую редакцию и сравните сведения перед применением.'); this.name = 'ClarificationRevisionError'; }
}

export type AnswerDrafts = Partial<Record<CardField, string>>;
export interface ClarificationSession {
  assist: AssistResult | null;
  answers: AnswerDrafts;
  previousQuestions: Question[];
}

export function fieldLimit(field: CardField) {
  return field === 'title' ? 200 : field === 'topic' ? 100 : 8000;
}

export function mergeClarificationAnswers(card: CardData, answers: AnswerDrafts): CardData {
  const result = { ...card };
  for (const [key, text] of Object.entries(answers)) {
    const field = key as CardField;
    const addition = text?.trim();
    if (!addition) continue;
    const previous = card[field].trim();
    result[field] = field === 'title' || field === 'topic' || !previous
      ? addition
      : `${previous}\n\n${addition}`;
  }
  return result;
}

export function fullClarificationAnswers(card: CardData | null): AnswerDrafts {
  return card ? Object.fromEntries(Object.entries(card).filter(([, value]) => value.trim())) : {};
}

export function createClarificationSession(assist: AssistResult | null = null): ClarificationSession {
  return { assist, answers: {}, previousQuestions: assist?.questions.slice(-40) ?? [] };
}

/** A failed request leaves the current round and all input unchanged. */
export async function requestClarificationRound(
  session: ClarificationSession,
  send: (answers: AnswerDrafts, previousQuestions: Question[]) => Promise<AssistResult>,
): Promise<ClarificationSession> {
  const candidate = session.assist ? mergeClarificationAnswers(session.assist.suggested_card, session.answers) : null;
  const result = await send(fullClarificationAnswers(candidate), session.previousQuestions);
  if (session.assist && result.based_on_revision !== session.assist.based_on_revision) throw new ClarificationRevisionError();
  return {
    assist: result,
    answers: {},
    previousQuestions: [...session.previousQuestions, ...result.questions].slice(-40),
  };
}
