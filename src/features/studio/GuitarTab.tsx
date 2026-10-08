import { useShallow } from 'zustand/react/shallow';
import { actions, useStore } from '../../state/store';
import { MAX_CAPO, OFFSET_MAX, OFFSET_MIN, openStrings, sameArr, stringLabel, TUNINGS, tuningName, type Offsets } from '../../theory/music';
import { Options, Section } from './Section';
import s from './Studio.module.css';

export function GuitarTab() {
  const { setup, headstock } = useStore(useShallow((x) => ({ setup: x.setup, headstock: x.headstock })));
  const T = openStrings(setup.offsets);
  const tn = tuningName(setup.offsets);
  return (
    <>
      <Section title="Tuning" status={tn} desc="The tuner, chords and tabs all follow this.">
        <div className={s.tunings}>
          {TUNINGS.map(([name, o]) => (
            <button key={name} className={s.opt} aria-pressed={sameArr(o, setup.offsets)} onClick={() => actions.setTuning([...o] as unknown as Offsets)}>
              <span className={s.optName}>{name}</span>
              <span className={s.optSub}>{openStrings(o).map((x) => x.note).join(' ')}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Strings" desc="Low to high. Raise or lower any string a half step; tap a note to hear it.">
        <div className={s.pegs}>
          {T.map((x, i) => {
            const d = setup.offsets[i];
            const adj = (k: number) => {
              const o = [...setup.offsets] as number[];
              o[i] = Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, o[i] + k));
              actions.setTuning(o as unknown as Offsets);
              actions.pluckString(i, o as unknown as Offsets);
            };
            return (
              <div key={i} className={s.peg}>
                <button className={s.arrow} aria-label={'Tune ' + stringLabel(x.note, i) + ' string up a half step'} disabled={d >= OFFSET_MAX} onClick={() => adj(1)}>
                  ▲
                </button>
                <button className={s.hear} style={{ color: d ? 'var(--gold-hi)' : 'var(--ink)' }} aria-label={'Hear ' + x.note + x.oct} onClick={() => actions.pluckString(i)}>
                  <div className={s.hearNote}>{x.note}</div>
                  <div className={s.hearSub}>{(d ? (d > 0 ? '+' : '−') + Math.abs(d) + ' · ' : '') + x.hz.toFixed(0) + ' Hz'}</div>
                </button>
                <button className={s.arrow} aria-label={'Tune ' + stringLabel(x.note, i) + ' string down a half step'} disabled={d <= OFFSET_MIN} onClick={() => adj(-1)}>
                  ▼
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Capo"
        status={setup.capo ? 'Fret ' + setup.capo : 'None'}
        desc="With a capo on, fret numbers count from the capo, the same way a chord chart does."
      >
        <div className={s.capos}>
          {Array.from({ length: MAX_CAPO + 1 }, (_, n) => (
            <button key={n} className={s.capo} aria-pressed={n === setup.capo} onClick={() => actions.saveSetup({ capo: n })}>
              {n === 0 ? 'Off' : n}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Headstock" desc="How the tuner draws your tuning pegs.">
        <Options
          label="Headstock"
          value={headstock}
          onChange={(v) => useStore.setState({ headstock: v })}
          options={[
            ['split', '3 + 3', 'Pegs on both sides'],
            ['inline', '6 in line', 'All pegs on one side'],
          ]}
        />
      </Section>
    </>
  );
}
