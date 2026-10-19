// The open chords every guitarist learns first. Under a capo they are named by what they sound as.

import { useShallow } from 'zustand/react/shallow';
import { actions, useStore } from '../../state/store';
import { identifyFrets } from '../../theory/music';
import { COMMON } from '../../theory/common';
import { ChordCard, ChordCards } from './ChordCard';
import s from './Chords.module.css';

export function CommonChords() {
  const { setup, frets, baseFret, locked } = useStore(useShallow((x) => ({ setup: x.setup, frets: x.frets, baseFret: x.baseFret, locked: x.locked })));
  return (
    <section className={s.section} aria-label="Common shapes">
      <h3 className={s.sectionTitle}>Common shapes</h3>
      <ChordCards>
        {COMMON.map((c) => {
          const r = identifyFrets(c.frets, 1, setup);
          const name = r.root != null ? r.name : c.label;
          return (
            <ChordCard
              key={c.label}
              name={name}
              note={name !== c.label ? 'Played as ' + c.label : undefined}
              frets={c.frets}
              baseFret={1}
              active={locked && baseFret === 1 && c.frets.every((v, i) => v === frets[i])}
              onPick={() => actions.setTarget(c.frets, 1)}
            />
          );
        })}
      </ChordCards>
    </section>
  );
}
