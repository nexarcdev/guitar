import { actions, useStore } from '../../state/store';
import { MAX_CAPO, OFFSET_MAX, OFFSET_MIN, openStrings, sameArr, stringLabel, TUNINGS, tuningName, type Offsets } from '../../theory/music';
import { Button, Well } from '../../ui';
import { Options, Section } from './Section';
import s from './Studio.module.css';

export function GuitarTab() {
  const setup = useStore((x) => x.setup);
  const T = openStrings(setup.offsets);
  const tn = tuningName(setup.offsets);
  const current = TUNINGS.find(([, o]) => sameArr(o, setup.offsets))?.[0] ?? '';
  return (
    <>
      <Section title="Tuning" status={tn} desc="The tuner, chords and tabs all follow this.">
        <Options
          label="Tuning"
          value={current}
          onChange={(name) => {
            const o = TUNINGS.find(([n]) => n === name)?.[1];
            if (o) actions.setTuning([...o] as unknown as Offsets);
          }}
          options={TUNINGS.map(([name, o]) => [name, name, openStrings(o).map((x) => x.note).join(' ')] as [string, string, string])}
        />
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
              <Well key={i} className={s.peg}>
                <Button variant="cream" size="sm" className={s.arrow} aria-label={'Tune ' + stringLabel(x.note, i) + ' string up a half step'} disabled={d >= OFFSET_MAX} onClick={() => adj(1)}>
                  ▲
                </Button>
                <button type="button" className={s.hear} data-moved={d !== 0} aria-label={'Hear ' + x.note + x.oct} onClick={() => actions.pluckString(i)}>
                  <span className={s.hearNote}>{x.note}</span>
                  <span className={s.hearSub}>{(d ? (d > 0 ? '+' : '−') + Math.abs(d) + ' · ' : '') + x.hz.toFixed(0) + ' Hz'}</span>
                </button>
                <Button variant="cream" size="sm" className={s.arrow} aria-label={'Tune ' + stringLabel(x.note, i) + ' string down a half step'} disabled={d <= OFFSET_MIN} onClick={() => adj(-1)}>
                  ▼
                </Button>
              </Well>
            );
          })}
        </div>
      </Section>

      <Section title="Capo" status={setup.capo ? 'Fret ' + setup.capo : 'None'} desc="With a capo on, fret numbers count from the capo, the same way a chord chart does.">
        <div className={s.capos} role="group" aria-label="Capo">
          {Array.from({ length: MAX_CAPO + 1 }, (_, n) => (
            <Button key={n} variant={n === setup.capo ? 'primary' : 'cream'} className={s.capo} aria-pressed={n === setup.capo} onClick={() => actions.saveSetup({ capo: n })}>
              {n === 0 ? 'Off' : n}
            </Button>
          ))}
        </div>
      </Section>
    </>
  );
}
