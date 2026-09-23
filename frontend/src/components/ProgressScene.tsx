import { Check, Layers3, Sparkles } from 'lucide-react';
import './ProgressScene.css';

/** Decorative CSS geometry. Contains no task state or invented progress. */
export function ProgressScene() {
  return <div className="progress-scene" aria-hidden="true">
    <div className="scene-floor" />
    <div className="scene-orbit scene-orbit-back" />
    <div className="scene-document">
      {[0, 1, 2, 3, 4, 5].map(layer => <div key={layer} className="scene-document-edge" style={{ transform: `translateZ(${-layer * 2}px)` }} />)}
      <div className="scene-document-face">
        <div className="scene-document-top"><span /><span /><span /></div>
        <div className="scene-check"><Check size={36} strokeWidth={3} /></div>
        <div className="scene-lines"><span /><span /><span /></div>
        <div className="scene-document-bottom"><span /><Check size={13} /></div>
      </div>
    </div>
    <div className="scene-medal"><div className="scene-medal-edge" /><div className="scene-medal-face"><Sparkles size={29} strokeWidth={1.7} /></div></div>
    <div className="scene-chip"><Layers3 size={21} strokeWidth={1.7} /><span /><span /></div>
    <div className="scene-orbit scene-orbit-front" />
    <div className="scene-sphere scene-sphere-small" />
    <div className="scene-sphere scene-sphere-large" />
  </div>;
}
