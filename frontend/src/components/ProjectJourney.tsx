import { Box, Check, Flag, FlaskConical, Globe2, SquareCheckBig, Users } from 'lucide-react';
import './ProjectJourney.css';

type JourneyStage = { key: string; label: string; done: boolean };

export type ProjectJourneyProps = {
  stages: JourneyStage[];
  compact?: boolean;
};

const stageIcons = [SquareCheckBig, Globe2, Users, Box, FlaskConical, Flag];

export function ProjectJourney({ stages, compact = false }: ProjectJourneyProps) {
  const visibleStages = stages.slice(0, 6);
  const currentIndex = visibleStages.findIndex(stage => !stage.done);

  return <div className={`project-journey${compact ? ' project-journey--compact' : ''}`}>
    <ol className="project-journey-list" aria-label="Путь проекта от идеи до результата">
      {visibleStages.map((stage, index) => {
        const Icon = stage.done ? Check : stageIcons[index];
        const current = index === currentIndex;
        return <li key={stage.key} className={`project-journey-step${stage.done ? ' is-done' : ''}${current ? ' is-current' : ''}`} aria-current={current ? 'step' : undefined}>
          <span className="project-journey-marker" aria-hidden="true"><Icon size={compact ? 14 : 17} strokeWidth={stage.done ? 2.5 : 1.75} /></span>
          <span className="project-journey-text"><span className="project-journey-label">{stage.label}</span><span className="project-journey-status">{stage.done ? 'Готово' : current ? 'Следующий шаг' : 'Впереди'}</span></span>
        </li>;
      })}
    </ol>
  </div>;
}

export default ProjectJourney;
