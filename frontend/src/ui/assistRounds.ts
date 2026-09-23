import type { CardData, CardField, Question } from '../types';
import { FIELD_LABELS } from './fields';

export type Answers = Partial<Record<CardField, string>>;

export function fieldLimit(field: CardField): number {
  return field === 'title' ? 200 : field === 'topic' ? 100 : 8000;
}

// Each reply adds facts to the current proposal. Repeated paragraphs do not grow
// the card when the same answer is submitted again in another round.
export function mergeRoundAnswers(card: CardData, answers: Answers): CardData {
  const merged = { ...card };
  for (const field of Object.keys(answers) as CardField[]) {
    const reply = answers[field]?.trim();
    if (!reply) continue;
    if (field === 'title' || field === 'topic' || !card[field].trim()) {
      merged[field] = reply;
      continue;
    }
    const known = card[field].trim();
    const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
    if (normalize(known) === normalize(reply)) continue;
    const seen = new Set(known.split(/\n+/).map(normalize));
    const additions = reply.split(/\n+/).map(value => value.trim()).filter(value => {
      const key = normalize(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (additions.length) merged[field] = `${known}\n${additions.join('\n')}`;
  }
  return merged;
}

export function cardLengthErrors(card: CardData): Answers {
  const errors: Answers = {};
  for (const field of Object.keys(card) as CardField[]) {
    const limit = fieldLimit(field);
    if (card[field].length > limit) {
      errors[field] = `«${FIELD_LABELS[field]}»: вместе с известными сведениями ${card[field].length} символов при лимите ${limit}. Сократите ответ или измените поле в редакторе.`;
    }
  }
  return errors;
}

export function filledCardAnswers(card: CardData): Answers {
  return Object.fromEntries(Object.entries(card).filter(([, value]) => value.trim()).map(([field, value]) => [field, value.trim()]));
}

export function appendQuestionHistory(history: Question[], questions: Question[]): Question[] {
  return [...history, ...questions].slice(-40);
}
