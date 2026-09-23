import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Layers3, RotateCw } from 'lucide-react';
import './ProjectArtifact.css';

type ArtifactStage = { key: string; label: string; done: boolean };

export type ProjectArtifactProps = {
  stages: ArtifactStage[];
  compact?: boolean;
  title?: string;
  showHeading?: boolean;
};

type PieceProps = { name: string; complete: boolean; width: number; height: number; depth: number; x?: number; y?: number; z?: number; tone: 'stone' | 'purple' | 'teal' | 'amber' | 'glass' };

function Piece({ name, complete, width, height, depth, x = 0, y = 0, z = 0, tone }: PieceProps) {
  const style = { '--piece-width': `${width}px`, '--piece-height': `${height}px`, '--piece-depth': `${depth}px`, '--piece-x': `${x}px`, '--piece-y': `${y}px`, '--piece-z': `${z}px` } as CSSProperties;
  return <div className={`project-artifact-piece project-artifact-piece--${tone} project-artifact-piece--${name}${complete ? ' is-complete' : ' is-ghost'}`} style={style}>
    <span className="project-artifact-face project-artifact-face--front" />
    <span className="project-artifact-face project-artifact-face--back" />
    <span className="project-artifact-face project-artifact-face--left" />
    <span className="project-artifact-face project-artifact-face--right" />
    <span className="project-artifact-face project-artifact-face--top" />
    <span className="project-artifact-face project-artifact-face--bottom" />
  </div>;
}

export function ProjectArtifact({ stages, compact = false, title = 'Ваша идея обретает форму', showHeading = true }: ProjectArtifactProps) {
  const [turns, setTurns] = useState(0);
  const parts = stages.slice(0, 6);
  const completed = parts.filter(stage => stage.done).length;
  const done = (index: number) => Boolean(parts[index]?.done);
  const delivered = done(5);
  const style = { '--artifact-turn': `${-33 + turns * 90}deg` } as CSSProperties;

  return <figure className={`project-artifact${compact ? ' project-artifact--compact' : ''}${delivered ? ' is-delivered' : ''}`}>
    {!compact && showHeading && <div className="project-artifact-heading"><span className="project-artifact-eyebrow"><Layers3 size={13} aria-hidden="true" />КОНСТРУКТОР ПРОЕКТА</span><h3>{title}</h3></div>}
    <div className="project-artifact-viewport" style={style} aria-hidden="true">
      <div className="project-artifact-halo" />
      <div className="project-artifact-grid" />
      <div className="project-artifact-shadow" />
      <div className="project-artifact-model">
        <Piece name="base" complete width={198} height={13} depth={150} y={60} tone="stone" />
        <Piece name="foundation" complete={done(0)} width={174} height={10} depth={124} y={48} tone="purple" />
        <Piece name="wall" complete={done(1)} width={150} height={66} depth={10} y={10} z={-51} tone="purple" />
        <Piece name="column-left" complete={done(2)} width={11} height={62} depth={11} x={-72} y={11} z={49} tone="teal" />
        <Piece name="column-right" complete={done(2)} width={11} height={62} depth={11} x={72} y={11} z={49} tone="teal" />
        <Piece name="workbench" complete={done(3)} width={94} height={23} depth={48} x={-9} y={29} z={4} tone="amber" />
        <Piece name="glass" complete={done(4)} width={5} height={57} depth={88} x={72} y={11} z={-1} tone="glass" />
        <Piece name="roof" complete={done(5)} width={177} height={12} depth={130} y={-28} tone="purple" />
        {delivered && <div className="project-artifact-roof-seal"><Check size={17} strokeWidth={2.3} /></div>}
      </div>
      <div className="project-artifact-dot project-artifact-dot--one" />
      <div className="project-artifact-dot project-artifact-dot--two" />
    </div>
    <figcaption className="project-artifact-caption"><span className="project-artifact-count"><strong>{completed}</strong> из {parts.length} частей готово</span>{!compact && <span className="project-artifact-caption-note">{delivered ? 'Результат передан бизнесу' : 'Каждый этап добавляет новую деталь'}</span>}<span className="project-artifact-screen-reader">{parts.map(stage => `${stage.label}: ${stage.done ? 'готово' : 'пока не завершено'}`).join('. ')}</span></figcaption>
    {!compact && <button type="button" className="project-artifact-rotate" onClick={() => setTurns(value => value + 1)}><RotateCw size={14} aria-hidden="true" />Повернуть модель</button>}
  </figure>;
}

export default ProjectArtifact;
