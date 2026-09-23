import { ArrowUpRight, CheckCircle2, GraduationCap, Leaf, Package, Sparkles, Truck, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogTask } from '../types';
import { topicLabel } from '../ui/fields';
import { Card, LevelBadge } from './ui';

const topicIcons = { retail: Package, education: GraduationCap, logistics: Truck, agriculture: Leaf };

export function TaskCard({ task, matches = [] }: { task: CatalogTask; matches?: string[] }) {
  const fields = Object.entries(task.card).filter(([key, value]) => !['title', 'topic'].includes(key) && value.trim());
  const TopicIcon = topicIcons[task.card.topic as keyof typeof topicIcons] || Workflow;
  return <Card className={`task-card rating-${task.rating.readiness}`}>
    <div className="task-card-top"><span className="task-topic"><span className="task-topic-icon"><TopicIcon size={17} strokeWidth={1.7} /></span>{topicLabel(task.card.topic)}</span><LevelBadge level={task.rating.readiness} /></div>
    <Link className="task-title" to={`/tasks/${task.id}`}>{task.card.title || 'Задача без названия'}</Link>
    <p className="task-description">{task.card.need || task.card.context || 'Бизнес уточняет подробности задачи. Вы уже можете предложить своё решение.'}</p>
    {matches.length > 0 && <div className="recommendation-reason"><Sparkles size={14} aria-hidden="true" /><span>Совпадение: {matches.join(', ')}</span></div>}
    <div className="task-meta"><span><CheckCircle2 size={14} aria-hidden="true" />{fields.length} из 9 разделов</span>{task.card.expected_result && <span className="task-result-note">Результат описан</span>}</div>
    <div className="task-card-footer"><div className="task-readiness"><svg className="task-score-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" className="task-score-track" /><circle cx="20" cy="20" r="16" className="task-score-fill" pathLength="100" strokeDasharray={`${task.rating.score} 100`} transform="rotate(-90 20 20)" /></svg><div><span className="score-number">{task.rating.score}<small>/100</small></span><span className="task-score-caption">Готовность</span></div></div><Link className="button button-secondary task-open-button" to={`/tasks/${task.id}`} aria-label={`Открыть задачу «${task.card.title}»`}>Открыть <ArrowUpRight size={16} /></Link></div>
  </Card>;
}
