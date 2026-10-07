// The open chords every guitarist learns first. Under a capo they are named by what they sound as.

import { useShallow } from 'zustand/react/shallow';
import { actions, useStore } from '../../state/store';
import { identifyFrets } from '../../theory/music';
import { COMMON, toVoicing } from '../../theory/common';
import { ChordCard } from './ChordCard';
import s from './Chords.module.css';

export function CommonChords() {
  const { setup, frets, baseFret, locked } = useStore(useShallow((x) => ({ setup: x.setup, frets: x.frets, baseFret: x.baseFret, locked: x.locked })));
  return (
    <div className={s.section} style={{ marginTop: 22 }}>
      <div className={`kicker ${s.sectionKicker}`}>COMMON CHORDS</div>
      <div className={s.cards}>
        {COMMON.map((c) => {
          const r = identifyFrets(c.frets, 1, setup);
          const name = r.root != null ? r.name : c.label;
          return (
            <ChordCard
              key={c.label}
              name={name}
              sub={name !== c.label ? 'played as ' + c.label : undefined}
              frets={c.frets}
              baseFret={1}
              active={locked && baseFret === 1 && c.frets.every((v, i) => v === frets[i])}
              onPick={() => actions.setTarget(c.frets, 1)}
              onPlay={() => actions.strum(toVoicing(c.frets, 1, setup))}
            />
          );
        })}
      </div>
    </div>
  );
}
