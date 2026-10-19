// The chords played so far, oldest first, along the bottom of the glass. Tap one to put it on the
// board in the voicing it was played (Strum plays the board).

import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, useStore } from '../../state/store';
import { ord } from '../../theory/music';
import { Button } from '../../ui';
import s from './Chords.module.css';

export function Progression() {
  const { progression, frets, baseFret, locked } = useStore(useShallow((x) => ({ progression: x.progression, frets: x.frets, baseFret: x.baseFret, locked: x.locked })));
  const row = useRef<HTMLDivElement>(null);
  const onBoard = (f: readonly number[], b: number) => locked && b === baseFret && f.every((v, i) => v === frets[i]);

  // The newest chord stays in view.
  useEffect(() => {
    const el = row.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [progression.length]);

  return (
    <div className={s.prog}>
      <span className={s.progLabel}>Progression</span>
      <div ref={row} className={s.progRow} role="list" aria-label="Progression">
        {progression.length === 0 ? (
          <span className={s.progEmpty}>Chords you play collect here</span>
        ) : (
          progression.map((e) => {
            const pos = e.voicing.baseFret > 1 ? ', ' + ord(e.voicing.baseFret) + ' fret' : '';
            return (
              <button
                key={e.id}
                role="listitem"
                className={s.progChord}
                data-on={onBoard(e.voicing.frets, e.voicing.baseFret)}
                aria-label={e.name.name + pos + (e.count > 1 ? ', played ' + e.count + ' times' : '') + '. Put on the fretboard'}
                onClick={() => actions.setTarget(e.voicing.frets, e.voicing.baseFret)}
              >
                {e.name.name}
                {e.count > 1 && <span className={s.progCount}>×{e.count}</span>}
              </button>
            );
          })
        )}
      </div>
      {progression.length > 0 && (
        <Button variant="dark" size="sm" onClick={actions.clearProgression}>
          Clear
        </Button>
      )}
    </div>
  );
}
