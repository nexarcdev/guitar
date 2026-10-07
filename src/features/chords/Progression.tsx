// The chords played so far, oldest first, each in the voicing it was played. Tap one to put it on
// the board; play one to hear it.

import { useShallow } from 'zustand/react/shallow';
import { actions, useStore } from '../../state/store';
import { ord } from '../../theory/music';
import { grip, absFrets } from '../../theory/voicings';
import { ChordCard } from './ChordCard';
import s from './Chords.module.css';

export function Progression() {
  const { progression, frets, baseFret, locked } = useStore(useShallow((x) => ({ progression: x.progression, frets: x.frets, baseFret: x.baseFret, locked: x.locked })));
  const onBoard = (f: readonly number[], b: number) => locked && b === baseFret && f.every((v, i) => v === frets[i]);
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <div className={`kicker ${s.sectionKicker}`} style={{ marginBottom: 0 }}>
          PROGRESSION
        </div>
        {progression.length > 0 && (
          <button className={s.textBtn} onClick={actions.clearProgression}>
            Clear
          </button>
        )}
      </div>
      {progression.length === 0 ? (
        <div className={s.empty}>Chords you play collect here</div>
      ) : (
        <div className={s.cards}>
          {progression.map((e) => (
            <ChordCard
              key={e.id}
              name={e.name.name}
              sub={e.voicing.baseFret > 1 ? ord(e.voicing.baseFret) + ' fret' : undefined}
              frets={e.voicing.frets}
              baseFret={e.voicing.baseFret}
              barre={grip(absFrets(e.voicing.frets, e.voicing.baseFret)).barre}
              active={onBoard(e.voicing.frets, e.voicing.baseFret)}
              count={e.count}
              onPick={() => actions.setTarget(e.voicing.frets, e.voicing.baseFret)}
              onPlay={() => actions.strum(e.voicing)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
