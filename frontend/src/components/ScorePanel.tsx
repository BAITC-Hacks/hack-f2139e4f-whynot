import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Sparkles, Trophy } from 'lucide-react';
import { Card, LevelBadge } from './ui';
import { useToast } from '../context/ToastContext';
import { FIELD_LABELS } from '../ui/fields';
import type { CardField, Rating, Readiness } from '../types';

const levelNames: Record<Readiness, string> = { draft: 'Черновик', working: 'Рабочая', ready: 'Готовая', priority: 'Приоритетная' };
const levelRanks: Record<Readiness, number> = { draft: 0, working: 1, ready: 2, priority: 3 };

export function ScorePanel({ rating, onFocus, showHints = true }: { rating: Rating; onFocus?: (field: CardField) => void; showHints?: boolean }) {
  const { toast } = useToast();
  const [display, setDisplay] = useState(rating.score);
  const previous = useRef(rating);
  const scoreRef = useRef(rating.score);
  useEffect(() => {
    const start = scoreRef.current;
    const end = rating.score;
    const previousLevel = previous.current.readiness;
    previous.current = rating;
    if (levelRanks[rating.readiness] > levelRanks[previousLevel]) toast(`Новый уровень: «${levelNames[rating.readiness]}»! Карточка стала понятнее командам.`, 'success');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || start === end) { setDisplay(end); scoreRef.current = end; return; }
    let frame = 0;
    const startTime = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - startTime) / 800);
      const value = Math.round(start + (end - start) * (1 - Math.pow(1 - progress, 3)));
      setDisplay(value);
      scoreRef.current = value;
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rating.score, rating.readiness, toast]);
  const nextLevel = rating.score < 40 ? 40 : rating.score < 70 ? 70 : rating.score < 90 ? 90 : 100;
  const circumference = 2 * Math.PI * 56;
  const improvements = rating.breakdown.flatMap(item => {
    const field = item.missing_fields[0] ?? item.unconfirmed_fields[0];
    const gain = item.max_points - item.points;
    return field && gain > 0 ? [{ ...item, field, gain }] : [];
  }).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const segments = [
    { level: 'draft', width: 40, title: 'Черновик: 0–39' },
    { level: 'working', width: 30, title: 'Рабочая: 40–69' },
    { level: 'ready', width: 20, title: 'Готовая: 70–89' },
    { level: 'priority', width: 10, title: 'Приоритетная: 90–100' },
  ];

  return <Card className="score-panel">
    <div className="row between"><h3 className="section-title">Готовность задачи</h3><Trophy size={19} className="accent-text" /></div>
    <div className={`score-orbit rating-${rating.readiness}`} aria-label={`Подтверждённый рейтинг: ${rating.score} из 100`}>
      <svg viewBox="0 0 144 144" width="164" height="164" aria-hidden="true"><circle cx="72" cy="72" r="56" fill="none" stroke="var(--border, #e7e8ef)" strokeWidth="10" /><circle cx="72" cy="72" r="56" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - display / 100)} transform="rotate(-90 72 72)" /></svg>
      <div className="score-caption"><strong className="score-number">{display}</strong><span className="score-unit">из 100</span></div>
    </div>
    <div className="row" style={{ justifyContent: 'center' }}><LevelBadge level={rating.readiness} /></div>
    <p className="muted text-small" style={{ textAlign: 'center' }}>Подтверждённые баллы</p>
    {rating.preview_score > rating.score && <div className="score-preview"><Sparkles size={16} /><span>После подтверждения <strong>{rating.preview_score} / 100</strong></span></div>}
    <p className="text-small muted">{rating.score === 100 ? 'Все критерии готовности выполнены.' : `До ${nextLevel === 100 ? 'максимума' : 'следующего уровня'} — ${nextLevel - rating.score} баллов.`}</p>
    <div className="readiness-scale" role="img" aria-label="Уровни готовности: черновик — от 0, рабочая — от 40, готовая — от 70, приоритетная — от 90 баллов.">
      <div className="readiness-scale-track">{segments.map(segment => <span key={segment.level} className={`level-${segment.level}`} style={{ width: `${segment.width}%` }} title={segment.title} />)}<span className="readiness-scale-pointer" style={{ left: `${rating.score}%` }} /></div>
      <div className="readiness-scale-labels">{[0, 40, 70, 90, 100].map(value => <span key={value} className={value === 0 ? 'first' : value === 100 ? 'last' : undefined} style={{ left: `${value}%` }}>{value}</span>)}</div>
    </div>
    {showHints && onFocus && improvements.length > 0 && <section className="score-next-steps" aria-label="Как повысить готовность задачи"><h4>Следующий шаг к сильной задаче</h4><div className="score-hints">{improvements.map(item => <button key={item.key} type="button" className="score-hint" onClick={() => onFocus(item.field)}><span className="score-hint-header"><strong className="text-small">{item.missing_fields.length ? `Добавить: ${FIELD_LABELS[item.field].toLocaleLowerCase('ru')}` : 'Просмотреть и подтвердить'}</strong><span className="score-hint-gain text-small">до +{item.gain} баллов</span></span><span className="text-small muted">{item.suggestion || item.label}</span><ArrowUpRight size={14} aria-hidden="true" /></button>)}</div></section>}
    <div className="score-breakdown">{rating.breakdown.map(item => {
      return <div className="score-breakdown-item" key={item.key}>
        <div className="row between"><span className="text-small">{item.label}</span><strong className="text-small">{item.points}<span className="muted">/{item.max_points}</span></strong></div>
        <div className="progress-bar" aria-hidden="true"><span style={{ width: `${item.max_points ? item.points / item.max_points * 100 : 0}%` }} /></div>
        {showHints && !onFocus && item.suggestion && <p className="muted text-small">{item.suggestion}</p>}
        {item.points === item.max_points && <span className="text-small success-text"><Check size={13} /> Готово</span>}
      </div>;
    })}</div>
    <p className="muted text-small">Рейтинг рассчитывается по подтверждённым сведениям. Он помогает команде понять задачу.</p>
  </Card>;
}
