import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { MAX_CAPO, OFFSET_MAX, OFFSET_MIN, openStrings, ord, sameArr, stringLabel, TUNINGS, tuningName, type Offsets } from '../../theory/music';
import s from './SetupSheet.module.css';

export function SetupSheet() {
  const { open, setup, devices, deviceId, mic, level, headstock } = useStore(
    useShallow((x) => ({
      open: x.setupOpen, setup: x.setup, devices: x.engine.devices, deviceId: x.engine.deviceId, mic: x.engine.mic, level: x.level, headstock: x.headstock,
    })),
  );
  const doneRef = useRef<HTMLButtonElement>(null);
  const close = () => useStore.setState({ setupOpen: false });

  useEffect(() => {
    if (!open) return;
    doneRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  if (!open) return null;
  const T = openStrings(setup.offsets);
  const tn = tuningName(setup.offsets);
  const capoNote =
    setup.capo === 0 ? 'No capo'
    : setup.capo === 1 ? 'Everything sounds a half step higher'
    : setup.capo === 2 ? 'Everything sounds a whole step higher'
    : 'Everything sounds ' + setup.capo + ' half steps higher';

  return (
    <div className={s.scrim} onClick={close}>
      <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="setup-title" onClick={(e) => e.stopPropagation()}>
        <div className={s.top}>
          <div style={{ minWidth: 0 }}>
            <div className="kicker">YOUR GUITAR</div>
            <div id="setup-title" className={s.title}>
              {tn + (setup.capo ? ', capo on ' + ord(setup.capo) + ' fret' : ', no capo')}
            </div>
          </div>
          <button ref={doneRef} className={s.done} onClick={close}>
            Done
          </button>
        </div>

        <div>
          <div className="kicker" style={{ marginBottom: 12 }}>TUNING</div>
          <div className={s.tunings}>
            {TUNINGS.map(([name, o]) => (
              <button key={name} className={s.opt} aria-pressed={sameArr(o, setup.offsets)} onClick={() => actions.setTuning([...o] as unknown as Offsets)}>
                <span className={s.optName}>{name}</span>
                <span className={s.optSub}>{openStrings(o).map((x) => x.note).join(' ')}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className={s.secHead}>
            <div className="kicker">{'STRINGS · ' + tn.toUpperCase()}</div>
            <div className={s.secNote}>Low → high · tap a note to hear it</div>
          </div>
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
        </div>

        <div>
          <div className={s.secHead}>
            <div className="kicker">CAPO</div>
            <div className={s.secNote}>{capoNote}</div>
          </div>
          <div className={s.capos}>
            {Array.from({ length: MAX_CAPO + 1 }, (_, n) => (
              <button key={n} className={s.capo} aria-pressed={n === setup.capo} onClick={() => actions.saveSetup({ capo: n })}>
                {n === 0 ? 'Off' : n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className={s.secHead}>
            <div className="kicker">INPUT</div>
            <div className={s.secNote}>{mic === 'live' ? 'Play a note and watch the meter' : 'Allow the microphone to choose an input'}</div>
          </div>
          {devices.length > 0 && (
            <div className={s.tunings}>
              {devices.map((d) => (
                <button key={d.id} className={s.opt} aria-pressed={d.id === deviceId} onClick={() => actions.selectDevice(d.id)}>
                  <span className={s.optName} title={d.label}>{d.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className={s.meter} role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}>
            <div className={s.meterFill} style={{ width: Math.min(100, Math.sqrt(level) * 100) + '%' }} />
          </div>
        </div>

        <div>
          <div className={s.secHead}>
            <div className="kicker">HEADSTOCK</div>
            <div className={s.secNote}>How the tuner draws your tuning pegs</div>
          </div>
          <div className={s.tunings}>
            {([['split', '3 + 3', 'Pegs on both sides'], ['inline', '6 in line', 'All pegs on one side']] as const).map(([id, name, sub]) => (
              <button key={id} className={s.opt} aria-pressed={headstock === id} onClick={() => useStore.setState({ headstock: id })}>
                <span className={s.optName}>{name}</span>
                <span className={s.optSub}>{sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={s.foot}>The tuner, chords and tabs all follow this setup. With a capo on, fret numbers count from the capo, the same way a chord chart does.</div>
      </div>
    </div>
  );
}
