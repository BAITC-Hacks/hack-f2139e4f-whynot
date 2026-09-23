import { ArrowUpRight, CheckCircle2, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CatalogTask } from '../types';
import { topicLabel } from '../ui/fields';
import { Card, LevelBadge, Tags } from './ui';

export function TaskCard({ task, matches = [] }: { task: CatalogTask; matches?: string[] }) {
  const fields = Object.entries(task.card).filter(([key, value]) => !['title', 'topic'].includes(key) && value.trim());
  return <Card className="task-card">
    <div className="task-card-top"><span className="task-topic">{topicLabel(task.card.topic)}</span><LevelBadge level={task.rating.readiness} /></div>
    <Link className="task-title" to={`/tasks/${task.id}`}>{task.card.title || 'Задача без названия'}</Link>
    <p className="task-description">{task.card.need || task.card.context || 'Бизнес уточняет подробности задачи. Вы уже можете предложить своё решение.'}</p>
    {matches.length > 0 && <div className="recommendation-reason"><Sparkles size={14} aria-hidden="true" /><span>Совпадение: {matches.join(', ')}</span></div>}
    <div className="task-meta"><CheckCircle2 size={14} aria-hidden="true" />{fields.length} из 9 разделов заполнено</div>
    <div className="task-card-footer"><div className="row"><span className="score-number">{task.rating.score}<small>/100</small></span><span className="muted text-small">готовность</span></div><Link className="link-button" to={`/tasks/${task.id}`} aria-label={`Открыть задачу «${task.card.title}»`}><ArrowUpRight size={20} /></Link></div>
    {task.card.expected_result && <Tags items={['Есть ожидаемый результат']} />}
  </Card>;
}
