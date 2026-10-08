// The editable fretboard: six string rows, a nut column that toggles open and muted, five fret
// columns, chevrons to move along the neck. Marks paint a verdict onto the strings.

import { openStrings, stringLabel, type Frets, type Setup } from '../../theory/music';
import type { StringMark } from '../../theory/verdict';
import s from './Fretboard.module.css';

export interface FretboardProps {
  frets: Frets;
  baseFret: number;
  setup: Setup;
  marks: ReadonlyArray<StringMark> | null;
  onNut: (string: number) => void;
  onFret: (string: number, fret: number) => void;
  onBase: (baseFret: number) => void;
}

export function Fretboard({ frets, baseFret, setup, marks, onNut, onFret, onBase }: FretboardProps) {
  const T = openStrings(setup.offsets);
  return (
    <div>
      <div className={s.fretRow}>
        <button className={s.chev} style={{ justifySelf: 'start' }} aria-label="Lower frets" disabled={baseFret <= 1} onClick={() => onBase(baseFret - 1)}>
          ‹
        </button>
        {[0, 1, 2, 3, 4].map((k) => (
          <div key={k} className={s.fretNum}>
            {baseFret + k}
          </div>
        ))}
        <button className={s.chev} style={{ justifySelf: 'end' }} aria-label="Higher frets" disabled={baseFret >= 12} onClick={() => onBase(baseFret + 1)}>
          ›
        </button>
      </div>
      <div className={s.board}>
        {[5, 4, 3, 2, 1, 0].map((i) => {
          const f = frets[i];
          const m = marks?.[i];
          const heard = m === 'ok';
          const wrong = m === 'wrongOpen';
          const nutColor = wrong ? 'var(--red)' : f === -1 ? 'var(--muted-2)' : heard ? 'var(--green)' : f === 0 ? 'var(--gold)' : 'var(--muted)';
          return (
            <div key={i} className={s.string} data-heard={heard} data-wrong={wrong} data-missing={m === 'missing'}>
              <button
                className={s.nut}
                style={{ color: nutColor }}
                aria-label={stringLabel(T[i].note, i) + ' string: ' + (f === -1 ? 'muted' : f === 0 ? 'open' : 'fretted') + '. Toggle open or muted'}
                onClick={() => onNut(i)}
              >
                <span className={s.nutLabel}>{stringLabel(T[i].note, i)}</span>
                <span style={{ textAlign: 'center' }}>{f === -1 ? '✕' : f === 0 ? '○' : ''}</span>
              </button>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={s.cell} aria-label={'Fret ' + (baseFret + n - 1) + ' on ' + stringLabel(T[i].note, i)} aria-pressed={f === n} onClick={() => onFret(i, n)}>
                  <span className={s.fdot} data-on={f === n} />
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
