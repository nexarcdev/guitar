// A chord to pick: a paper chart that puts the chord on the board, with one line of why it is
// here underneath.

import { ChordChart } from '../../ui';
import { absFrets, grip } from '../../theory/voicings';
import type { Frets } from '../../theory/music';
import s from './ChordCard.module.css';

export interface ChordCardProps {
  name: string;
  /** Why it is here (printed under the chart, never on it). */
  note?: string;
  /** Frets relative to the base fret, low E first. */
  frets: Frets;
  baseFret: number;
  active?: boolean;
  onPick: () => void;
}

export function ChordCard({ name, note, frets, baseFret, active, onPick }: ChordCardProps) {
  const abs = absFrets(frets, baseFret);
  return (
    <div className={s.card}>
      <button className={s.pick} data-active={!!active} aria-pressed={!!active} onClick={onPick} aria-label={name + (note ? ', ' + note : '') + '. Put on the fretboard'}>
        <ChordChart chord={name} frets={abs} baseFret={baseFret} barre={grip(abs).barre != null} width={84} />
      </button>
      {note && <span className={s.note}>{note}</span>}
    </div>
  );
}

/** The grid the cards wrap in: as many columns as fit, never overlapping. */
export function ChordCards({ children }: { children: React.ReactNode }) {
  return <div className={s.cards}>{children}</div>;
}
