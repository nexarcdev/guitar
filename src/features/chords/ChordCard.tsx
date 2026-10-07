// A flat tile for one chord: diagram, name, one line of why it is here, and a play button. The
// tile itself puts the chord on the board.

import type { Frets } from '../../theory/music';
import type { Barre } from '../../theory/voicings';
import { ChordDiagram } from './ChordDiagram';
import s from './ChordCard.module.css';

export interface ChordCardProps {
  name: string;
  sub?: string;
  frets: Frets;
  baseFret: number;
  barre?: Barre | null;
  active?: boolean;
  count?: number;
  onPick: () => void;
  onPlay: () => void;
}

export function ChordCard({ name, sub, frets, baseFret, barre, active, count, onPick, onPlay }: ChordCardProps) {
  return (
    <div className={s.card} data-active={!!active}>
      <button className={s.pick} onClick={onPick} aria-label={name + (sub ? ', ' + sub : '') + '. Put on the fretboard'}>
        <ChordDiagram frets={frets} baseFret={baseFret} barre={barre} className={s.diagram} />
        <span className={s.name}>{name}</span>
        {sub && <span className={s.sub}>{sub}</span>}
      </button>
      <div className={s.foot}>
        {count && count > 1 ? <span className={s.count}>×{count}</span> : <span />}
        <button className={s.play} onClick={onPlay} aria-label={'Play ' + name}>
          ▶
        </button>
      </div>
    </div>
  );
}
