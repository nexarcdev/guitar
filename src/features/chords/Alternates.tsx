// Other ways to play the chord on the board, grouped by what each one teaches.

import { useShallow } from 'zustand/react/shallow';
import { actions, useStore } from '../../state/store';
import type { ChordName } from '../../theory/music';
import type { AltKind } from '../../theory/alternates';
import { ChordCard, ChordCards } from './ChordCard';
import s from './Chords.module.css';

const GROUPS: Array<[AltKind, string]> = [
  ['position', 'Same chord, elsewhere'],
  ['voicing', 'Other voicing'],
  ['simpler', 'Easier'],
  ['substitute', 'Try instead'],
];

/** The reason without the chord name it starts with: the card already shows the name. */
function why(name: string, reason: string) {
  return reason.replace(new RegExp('^(Same )?' + name.replace(/[/#()]/g, '\\$&') + '[,:]?\\s*'), '').replace(/^[a-z]/, (c) => c.toUpperCase());
}

export function Alternates({ name }: { name: ChordName }) {
  const { alternates, frets, baseFret } = useStore(useShallow((x) => ({ alternates: x.alternates, frets: x.frets, baseFret: x.baseFret })));
  if (!alternates.length || name.root == null) return null;
  const onBoard = (f: readonly number[], b: number) => b === baseFret && f.every((v, i) => v === frets[i]);
  return (
    <section className={s.section} aria-label={'Alternates for ' + name.name}>
      <h3 className={s.sectionTitle}>Alternates for {name.name}</h3>
      {GROUPS.map(([kind, label]) => {
        const list = alternates.filter((a) => a.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className={s.altGroup}>
            <div className={s.altLabel}>{label}</div>
            <ChordCards>
              {list.map((a, i) => (
                <ChordCard
                  key={kind + i}
                  name={a.name.name}
                  note={why(a.name.name, a.reason) || undefined}
                  frets={a.voicing.frets}
                  baseFret={a.voicing.baseFret}
                  active={onBoard(a.voicing.frets, a.voicing.baseFret)}
                  onPick={() => actions.setTarget(a.voicing.frets, a.voicing.baseFret)}
                />
              ))}
            </ChordCards>
          </div>
        );
      })}
    </section>
  );
}
