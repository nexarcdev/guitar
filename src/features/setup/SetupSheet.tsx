import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
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
          <InputMeter level={level} />
        </div>

        <SoundCheck />

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

const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? '') === 'Windows' || /Windows/.test(navigator.userAgent));

/** Level on a dB scale with the measured noise floor marked, plus the automatic boost applied. */
function InputMeter({ level }: { level: number }) {
  const { floorDb, peakDb, gainDb } = useStore((x) => x.levels);
  const mic = useStore((x) => x.engine.mic);
  const pos = (d: number) => Math.max(0, Math.min(100, ((d + 90) / 90) * 100));
  const lvlDb = 20 * Math.log10(level + 1e-9);
  const played = peakDb > floorDb + 14;
  const quiet = played && peakDb - floorDb < 24;
  return (
    <>
      <div className={s.meter} role="meter" aria-label="Input level" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={Math.round(lvlDb)}>
        <div className={s.meterFill} style={{ width: pos(lvlDb) + '%' }} />
        {mic === 'live' && <div className={s.floorMark} style={{ left: pos(floorDb) + '%' }} title="Noise floor" />}
      </div>
      {mic === 'live' && (
        <div className={s.meterText}>
          {'Noise floor ' + Math.round(floorDb) + ' dB' + (played ? ' · playing peaks ' + Math.round(peakDb) + ' dB' : ' · play a string to measure your level') + (gainDb >= 1 ? ' · auto level +' + Math.round(gainDb) + ' dB' : '')}
        </div>
      )}
      {quiet && (
        <div className={s.warn}>Your guitar is only a little louder than the background noise. Turn the guitar's volume knob all the way up, or raise the input level for this device in your system sound settings.</div>
      )}
    </>
  );
}

function SoundCheck() {
  const [diag, setDiag] = useState(() => engine.diagnostics());
  useEffect(() => {
    const t = setInterval(() => setDiag(engine.diagnostics()), 1000);
    return () => clearInterval(t);
  }, []);
  const status =
    diag.state === 'running'
      ? 'Audio running · ' + Math.round(diag.sampleRate / 100) / 10 + ' kHz · ' + diag.outputMs + ' ms output latency'
      : diag.state === 'not started' ? 'Audio not started yet' : 'Audio is ' + diag.state + ', tap anywhere to start it';
  return (
    <div>
      <div className={s.secHead}>
        <div className="kicker">SOUND CHECK</div>
        <div className={s.secNote}>{status}</div>
      </div>
      <div className={s.soundRow}>
        <button className={s.opt} style={{ minHeight: 44 }} onClick={() => { engine.resume(); engine.reference(440); }}>
          <span className={s.optName}>Play a test tone</span>
        </button>
        <span className={s.secNote}>{diag.micOpen ? 'Input: ' + diag.inputLabel : 'Input closed'}</span>
      </div>
      {IS_WINDOWS && (
        <div className={s.help}>
          <div className={s.helpTitle}>Sound cutting out, or other apps going quiet?</div>
          <div>
            Windows turns other audio down when it thinks you are on a call. Fretline opens your input in a way that should avoid this, but if it
            still happens, switch it off once:
          </div>
          <ol className={s.steps}>
            <li>Press <kbd>Win</kbd> + <kbd>R</kbd>, type <kbd>mmsys.cpl</kbd> and press <kbd>Enter</kbd>.</li>
            <li>Open the <b>Communications</b> tab.</li>
            <li>Choose <b>Do nothing</b>, then <b>OK</b>.</li>
          </ol>
          <div className={s.secNote}>
            Or open <a href="ms-settings:sound">Windows Sound settings</a>, scroll to <b>More sound settings</b>, and use the same Communications tab.
          </div>
        </div>
      )}
    </div>
  );
}
