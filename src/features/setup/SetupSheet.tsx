import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { ENGINE_DOWNLOAD } from '../../audio/engineChannel';
import { diagnose, playStep, STEPS, type StepId, type Verdict } from '../../audio/soundTest';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions, GATE_DB, gateLevelOf } from '../../state/store';
import type { DeviceInfo } from '../../core/protocol';

/** Stable empty list, so store selectors don't see a new array on every render. */
const NONE: DeviceInfo[] = [];
import { MAX_CAPO, OFFSET_MAX, OFFSET_MIN, openStrings, ord, sameArr, stringLabel, TUNINGS, tuningName, type Offsets } from '../../theory/music';
import s from './SetupSheet.module.css';

export function SetupSheet() {
  const { open, setup, devices, inputId, mic, level, headstock, onEngine } = useStore(
    useShallow((x) => ({
      open: x.setupOpen, setup: x.setup, devices: x.engine.status?.inputs ?? NONE, inputId: x.session?.inputId ?? '', mic: x.engine.mic, level: x.level,
      headstock: x.headstock, onEngine: x.engine.channel === 'engine',
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
            <div className="kicker">SETTINGS · YOUR GUITAR</div>
            <div id="setup-title" className={s.title}>
              {tn + (setup.capo ? ', capo on ' + ord(setup.capo) + ' fret' : ', no capo')}
            </div>
            <div className={s.version}>{'Fretline ' + __APP_VERSION__ + ' · built ' + BUILT}</div>
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
            <div className={s.secNote}>
              {(onEngine ? 'Through Fretline Engine · ' : '') + (mic === 'live' ? 'Play a note and watch the meter' : onEngine ? 'Opening the input' : 'Allow the microphone to choose an input')}
            </div>
          </div>
          {devices.length > 0 && (
            <div className={s.tunings}>
              {[...(onEngine ? [{ id: '', name: 'Windows default' }] : []), ...devices].map((d) => (
                <button key={d.id || 'default'} className={s.opt} aria-pressed={d.id === inputId} onClick={() => actions.selectDevice(d.id)}>
                  <span className={s.optName} title={d.name}>{d.name}</span>
                </button>
              ))}
            </div>
          )}
          <InputMeter level={level} />
        </div>

        <NoiseFloor />

        <NativeEngine />

        {!onEngine && <SoundCheck />}

        <Detection />

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
  const [diag, setDiag] = useState(() => engine.diagnostics()!);
  useEffect(() => {
    const t = setInterval(() => setDiag(engine.diagnostics()!), 1000);
    return () => clearInterval(t);
  }, []);
  if (!diag) return null;
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
        <span className={s.secNote}>
          {(diag.micOpen ? 'Input: ' + diag.inputLabel + (diag.inputRate ? ' · ' + Math.round(diag.inputRate / 100) / 10 + ' kHz' : '') : 'Input closed')}
        </span>
      </div>
      <OutputMeter />
      <OutputPicker />
      <SoundTest />
      {IS_WINDOWS && (
        <div className={s.help}>
          <div className={s.helpTitle}>Sound cutting out after a moment, or sounding different, once the input is on?</div>
          <InputEffectsSteps />
          <div className={s.helpTitle} style={{ marginTop: 10 }}>Other apps going quieter?</div>
          <div>
            Press <kbd>Win</kbd> + <kbd>R</kbd>, type <kbd>mmsys.cpl</kbd>, open the <b>Communications</b> tab and choose <b>Do nothing</b>.
          </div>
        </div>
      )}
    </div>
  );
}

const BUILT = (() => {
  const d = new Date(__BUILD_TIME__);
  return isNaN(+d) ? 'locally' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
})();

/**
 * What Fretline is actually sending to the speakers. If this moves while you hear nothing, the
 * sound is being muted after it leaves the app (Windows, the device, the volume mixer). If it
 * stays flat while a test tone plays, the problem is inside the app.
 */
function OutputMeter() {
  const fill = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let shown = -120;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = engine.outputDb();
      shown = Math.max(v, shown - 1.5);
      if (fill.current) fill.current.style.width = Math.max(0, Math.min(100, ((shown + 90) / 90) * 100)) + '%';
      if (label.current) label.current.textContent = shown < -85 ? 'Silent' : Math.round(shown) + ' dB';
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={s.outRow}>
      <div className={s.secNote}>Sent to speakers</div>
      <div className={s.meter} style={{ flex: 1, marginTop: 0 }} role="meter" aria-label="Output level">
        <div ref={fill} className={s.meterFill} style={{ width: 0 }} />
      </div>
      <span ref={label} className={s.outLabel}>Silent</span>
    </div>
  );
}

function Detection() {
  const { gateLevel, mlOn, ml, backend } = useStore(
    useShallow((x) => ({ gateLevel: gateLevelOf(x.session?.gateDb ?? 12), mlOn: x.session?.ml ?? true, ml: x.engine.ml, backend: x.engine.mlBackend })),
  );
  const mlText = !mlOn
    ? 'Off: tabs show single notes, chords are named from the spectrum only'
    : ml === 'ready' ? 'On · running on ' + (backend === 'native' ? 'Fretline Engine' : backend === 'webgl' ? 'the GPU' : backend === 'wasm' ? 'the CPU (WASM)' : backend || 'this device')
    : ml === 'loading' ? 'Loading'
    : ml === 'slow' ? 'Paused: this device can’t keep up in real time'
    : ml === 'unavailable' ? 'Not available in this browser'
    : 'On';
  return (
    <div>
      <div className={s.secHead}>
        <div className="kicker">NOISE GATE</div>
        <div className={s.secNote}>How loud something must be, above your measured noise, to count as playing</div>
      </div>
      <div className={s.tunings}>
        {([['low', 'Low', 'Hears soft playing'], ['normal', 'Normal', 'Recommended'], ['high', 'High', 'Ignores noisy cables']] as const).map(([id, name, sub]) => (
          <button key={id} className={s.opt} aria-pressed={gateLevel === id} onClick={() => actions.setSession({ gateDb: GATE_DB[id] })}>
            <span className={s.optName}>{name}</span>
            <span className={s.optSub}>{sub}</span>
          </button>
        ))}
      </div>
      <div className={s.secHead} style={{ marginTop: 20 }}>
        <div className="kicker">CHORD DETECTION</div>
        <div className={s.secNote}>{mlText}</div>
      </div>
      <div className={s.tunings}>
        {([[true, 'On', 'Full chords in the tab stream'], [false, 'Off', 'Lighter on older computers']] as const).map(([on, name, sub]) => (
          <button key={name} className={s.opt} aria-pressed={mlOn === on} onClick={() => actions.setSession({ ml: on })}>
            <span className={s.optName}>{name}</span>
            <span className={s.optSub}>{sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Guided test that finds where output breaks on this machine, and applies the fix when it can. */
function SoundTest() {
  const deviceId = useStore((x) => x.session?.inputId ?? '');
  const latency = useStore((x) => x.latency);
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [res, setRes] = useState<Partial<Record<StepId, Verdict>>>({});
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState('');
  const cleanup = useRef<(() => void) | null>(null);
  const savedLatency = useRef(latency);

  const stop = () => {
    cleanup.current?.();
    cleanup.current = null;
  };
  const play = async (k: number) => {
    stop();
    setErr('');
    setPlaying(true);
    try {
      cleanup.current = await playStep(STEPS[k].id, deviceId);
    } catch (e) {
      setErr('Could not open the input: ' + ((e as Error).message || 'unknown error'));
    }
    setTimeout(() => setPlaying(false), 2700);
  };
  const start = async () => {
    savedLatency.current = latency;
    setRes({});
    setI(0);
    setActive(true);
    await engine.pauseForTest();
    play(0);
  };
  const finish = async () => {
    stop();
    setActive(false);
    await engine.resumeAfterTest();
  };
  // Closing Settings mid-test (or after the result) must always hand audio back to the app.
  const activeRef = useRef(false);
  activeRef.current = active;
  useEffect(
    () => () => {
      cleanup.current?.();
      cleanup.current = null;
      if (activeRef.current) engine.resumeAfterTest();
    },
    [],
  );

  const answer = (v: Verdict) => {
    const next = { ...res, [STEPS[i].id]: v };
    setRes(next);
    const d = diagnose(next);
    if (d || i === STEPS.length - 1) {
      stop();
      setI(STEPS.length);
      if (d?.kind === 'safe') useStore.setState({ latency: 'playback' });
      return;
    }
    // A clean baseline but a broken step jumps straight to the large-buffer check.
    const k = v === 'bad' && i > 0 ? STEPS.findIndex((x) => x.id === 'graphSafe') : i + 1;
    setI(k);
    play(k);
  };

  if (!active)
    return (
      <div className={s.testIntro}>
        <button className={s.opt} style={{ minHeight: 44 }} onClick={start}>
          <span className={s.optName}>Run a sound test</span>
          <span className={s.optSub}>About 30 seconds</span>
        </button>
        <div className={s.secNote}>Sound breaking up or missing? This plays a tone a few different ways and finds what's causing it.</div>
        <LatencyChoice />
      </div>
    );

  const d = diagnose(res);
  const done = i >= STEPS.length;
  return (
    <div className={s.test} role="region" aria-label="Sound test">
      <ol className={s.testSteps}>
        {STEPS.map((st, k) => (
          <li key={st.id} data-state={res[st.id] ?? (k === i ? 'now' : 'todo')}>
            <span className={s.testMark} aria-hidden>{res[st.id] === 'clear' ? '✓' : res[st.id] === 'bad' ? '✕' : k + 1}</span>
            <span>
              <b>{st.title}</b>
              <span className={s.testDetail}>{st.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      {!done && (
        <div className={s.testAsk}>
          <span>{playing ? 'Playing…' : 'How did that sound?'}</span>
          <button className={s.testBtn} onClick={() => play(i)} disabled={playing}>Play again</button>
          <button className={s.testOk} onClick={() => answer('clear')} disabled={playing}>Clear</button>
          <button className={s.testBad} onClick={() => answer('bad')} disabled={playing}>Choppy or silent</button>
        </div>
      )}
      {err && <div className={s.warn}>{err}</div>}
      {done && (
        <div className={s.help}>
          <div className={s.helpTitle}>{d ? 'Result' : 'All clear'}</div>
          <div>{d ? d.text : 'Every step sounded clean.'}</div>
          {d?.kind === 'device' && <InputEffectsSteps />}
          {d?.kind === 'safe' && <div style={{ marginTop: 8 }}><button className={s.testOk} onClick={() => location.reload()}>Reload to apply</button></div>}
          <div style={{ marginTop: 10 }}><button className={s.testBtn} onClick={finish}>Done</button></div>
        </div>
      )}
      {!done && <button className={s.testLink} onClick={finish}>Cancel test</button>}
    </div>
  );
}

function LatencyChoice() {
  const latency = useStore((x) => x.latency);
  const [initial] = useState(latency);
  const [lb, setLb] = useState(() => engine.latencyBreakdown()!);
  useEffect(() => {
    const t = setInterval(() => setLb(engine.latencyBreakdown()!), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lb) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className={s.secHead}>
        <div className="kicker">AUDIO BUFFERS</div>
        <div className={s.secNote}>{latency !== initial ? 'Reload to apply' : lb.totalMs ? 'Delay through Output about ' + lb.totalMs + ' ms' : ''}</div>
      </div>
      <div className={s.tunings}>
        {([['lowest', 'Lowest', 'Smallest delay for pedals'], ['interactive', 'Low', 'If Lowest crackles'], ['playback', 'Safe', 'If sound breaks up']] as const).map(([id, name, sub]) => (
          <button key={id} className={s.opt} aria-pressed={latency === id} onClick={() => useStore.setState({ latency: id })}>
            <span className={s.optName}>{name}</span>
            <span className={s.optSub}>{sub}</span>
          </button>
        ))}
      </div>
      {latency !== initial && (
        <button className={s.testOk} style={{ marginTop: 8 }} onClick={() => setTimeout(() => location.reload(), 300)}>
          Reload now
        </button>
      )}
      {lb.totalMs > 0 && (
        <div className={s.breakdown} aria-label="Where the delay comes from">
          {(
            [
              ['Input', lb.inputMs, lb.inputSource === 'measured' ? 'measured' : lb.inputSource === 'reported' ? 'reported' : 'typical, not reported'],
              ['Engine', lb.engineMs, 'Chrome'],
              ['Output', lb.outputMs, 'speakers / driver'],
            ] as const
          ).map(([name, ms, note]) => (
            <div key={name} className={s.bdRow}>
              <span className={s.bdName}>{name}</span>
              <span className={s.bdBar}>
                <span style={{ width: Math.min(100, (ms / Math.max(lb.totalMs, 1)) * 100) + '%' }} />
              </span>
              <span className={s.bdMs}>{ms < 1 ? '<1' : ms} ms</span>
              <span className={s.bdNote}>{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Choose where Fretline's sound goes; each device has its own driver delay. */
function OutputPicker() {
  const { outputs, can, onEngine } = useStore(useShallow((x) => ({ outputs: x.engine.status?.outputs ?? NONE, can: x.engine.canPickOutput, onEngine: x.engine.channel === 'engine' })));
  const outputId = useStore((x) => x.session?.outputId ?? '');
  if (!can || outputs.length < 1) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className={s.secHead}>
        <div className="kicker">OUTPUT</div>
        <div className={s.secNote}>Headphones on your interface are usually much quicker than laptop speakers</div>
      </div>
      <div className={s.tunings}>
        {[{ id: '', name: onEngine ? 'Windows default' : 'System default' }, ...outputs].map((d) => (
          <button key={d.id || 'default'} className={s.opt} aria-pressed={outputId === d.id} onClick={() => actions.setSession({ outputId: d.id })}>
            <span className={s.optName} title={d.name}>{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The fix that solved it on a real Windows gaming laptop: input "noise reduction" (Realtek AI
 * noise reduction and friends) flips the driver into a call mode that chops steady tones.
 */
function InputEffectsSteps() {
  return (
    <>
      <div style={{ marginTop: 6 }}>Turn off noise reduction on your guitar input:</div>
      <ol className={s.steps}>
        <li>
          Open <b>Realtek Audio Console</b> (it comes preinstalled on many laptops). Select your guitar input, find <b>Microphone Effects</b>,
          and turn off <b>AI noise reduction</b> (also Noise Suppression and Echo Cancellation if listed).
        </li>
        <li>Using Dolby Access, Sonic Studio or NVIDIA Broadcast? Turn off their noise removal for the input too.</li>
        <li>
          In Windows Settings → System → Sound, click your guitar input and set <b>Audio enhancements</b> to Off (and <b>Voice clarity</b> if
          you see it).
        </li>
        <li>Still breaking up? Set the input and your speakers to the same rate (for example 48000 Hz) under <kbd>mmsys.cpl</kbd> → device → Advanced.</li>
      </ol>
    </>
  );
}


/**
 * The noise floor decides what counts as playing everywhere (tuner, chords, tabs, the auto level
 * and gate on Output). Auto measures it continuously; if the app started while a string was still
 * ringing, Recalibrate measures afresh. Manual fixes it, remembered per input device.
 */
function NoiseFloor() {
  const { levels, floor, mic } = useStore(useShallow((x) => ({ levels: x.levels, floor: x.session?.floor, mic: x.engine.mic })));
  if (!floor) return null;
  const manual = floor.mode === 'manual';
  const measuring = levels.measuring;
  const note = measuring != null
    ? 'Measuring: keep the strings muted'
    : manual ? 'Fixed at ' + Math.round(floor.manualDb) + ' dB · measured ' + Math.round(levels.measuredDb) + ' dB'
    : mic === 'live' ? 'Measured ' + Math.round(levels.measuredDb) + ' dB, adjusting as you play' : 'Measured while listening';
  return (
    <div>
      <div className={s.secHead}>
        <div className="kicker">NOISE FLOOR</div>
        <div className={s.secNote}>{note}</div>
      </div>
      <div className={s.tunings}>
        {([[false, 'Auto', 'Follows your setup'], [true, 'Manual', 'You set the level']] as const).map(([m, name, sub]) => (
          <button
            key={name}
            className={s.opt}
            aria-pressed={manual === m}
            onClick={() => actions.setFloor({ mode: m ? 'manual' : 'auto', manualDb: m && floor.mode === 'auto' ? Math.round(levels.measuredDb) : floor.manualDb })}
          >
            <span className={s.optName}>{name}</span>
            <span className={s.optSub}>{sub}</span>
          </button>
        ))}
      </div>
      {manual ? (
        <div className={s.floorRow}>
          <input
            type="range"
            min={-100}
            max={-20}
            step={1}
            value={Math.round(floor.manualDb)}
            aria-label="Noise floor"
            aria-valuetext={Math.round(floor.manualDb) + ' dB'}
            onChange={(e) => actions.setFloor({ mode: 'manual', manualDb: +e.target.value })}
          />
          <span className={s.floorDb}>{Math.round(floor.manualDb)} dB</span>
          <button className={s.testBtn} onClick={() => actions.setFloor({ mode: 'manual', manualDb: Math.round(levels.measuredDb) })}>
            Use measured
          </button>
        </div>
      ) : (
        <div className={s.floorRow}>
          <button className={s.testBtn} disabled={measuring != null || mic !== 'live'} onClick={() => actions.recalibrate()}>
            {measuring != null ? 'Measuring ' + Math.round(measuring * 100) + '%' : 'Recalibrate'}
          </button>
          <span className={s.secNote}>Mute the strings with your hand, then tap. Useful if a string was still ringing when Fretline started.</span>
        </div>
      )}
      {measuring != null && (
        <div className={s.meter} role="progressbar" aria-label="Measuring the noise floor" aria-valuenow={Math.round(measuring * 100)}>
          <div className={s.measureFill} style={{ width: measuring * 100 + '%' }} />
        </div>
      )}
    </div>
  );
}

/** Status dot: gold looking, green connected, red problem. */
function Dot({ state }: { state: 'look' | 'ok' | 'bad' }) {
  return <span className={s.dot} data-state={state} aria-hidden />;
}

/**
 * The native engine: Chrome on Windows can't get under ~50 ms from string to speaker, so the
 * guitar, pedals, looper and sounds can move to a small native app that plays in a few
 * milliseconds and listens with the same core.
 */
function NativeEngine() {
  const { on, conn, version, st, onEngine } = useStore(
    useShallow((x) => ({ on: x.engineOn, conn: x.engine.engine, version: x.engine.engineVersion, st: x.engine.status, onEngine: x.engine.channel === 'engine' })),
  );
  if (!IS_WINDOWS && !on) return null;
  const set = (engineOn: boolean) => useStore.setState({ engineOn });
  const head = !on
    ? 'Pedals with almost no delay'
    : onEngine ? 'Connected · Fretline Engine ' + version
    : conn === 'outdated' ? 'This engine needs an update'
    : 'Looking for Fretline Engine on this computer';
  return (
    <div>
      <div className={s.secHead}>
        <div className="kicker">LOW-LATENCY ENGINE</div>
        <div className={s.secNote}>
          {on && <Dot state={onEngine ? (st?.error ? 'bad' : 'ok') : conn === 'outdated' ? 'bad' : 'look'} />}
          {head}
        </div>
      </div>
      {!on && (
        <>
          <div className={s.secNote}>
            Chrome adds about 40 ms on the way to your speakers, which is too slow to play through pedals. Fretline Engine is a small Windows app that
            plays your guitar, pedals, looper and Fretline's sounds in a few milliseconds instead, and does the listening too. Everything else works the same.
          </div>
          <div className={s.soundRow} style={{ marginTop: 10 }}>
            <a className={s.testOk} href={ENGINE_DOWNLOAD}>Download for Windows</a>
            <button className={s.testBtn} onClick={() => set(true)}>I've installed it, connect</button>
          </div>
          <div className={s.help}>
            <div>
              The installer isn't code-signed yet. If Windows SmartScreen warns, choose <b>More info</b>, then <b>Run anyway</b>.
            </div>
            <div style={{ marginTop: 6 }}>
              When Chrome asks to let this site connect to devices on your network, choose <b>Allow</b>: that's how Fretline reaches the engine on this
              computer. Nothing leaves your machine.
            </div>
          </div>
        </>
      )}
      {on && !onEngine && (
        <>
          <div className={s.secNote}>
            {conn === 'outdated'
              ? 'The engine running on this computer (' + (version || 'unknown') + ') doesn\u2019t match this version of Fretline. Install the latest one.'
              : 'Start Fretline Engine from the Start menu; it sits in the notification area. Until it\u2019s running, Fretline uses the browser\u2019s audio as before.'}
          </div>
          {conn === 'absent' && (
            <div className={s.secNote} style={{ marginTop: 6 }}>
              Engine running but still not found? Click the icon left of the address bar, open <b>Site settings</b>, and allow <b>Local network access</b>.
            </div>
          )}
          <div className={s.soundRow} style={{ marginTop: 10 }}>
            <a className={s.testOk} href={ENGINE_DOWNLOAD}>Download</a>
            <button className={s.testBtn} onClick={() => engine.retryEngine()}>Try again</button>
            <button className={s.testLink} onClick={() => set(false)}>Stop using the engine</button>
          </div>
        </>
      )}
      {onEngine && <EnginePanel />}
    </div>
  );
}

function EnginePanel() {
  const { st, exIn, exOut } = useStore(
    useShallow((x) => ({ st: x.engine.status, exIn: x.session?.exclusiveInput ?? true, exOut: x.session?.exclusiveOutput ?? false })),
  );
  const lat = st?.latency;
  const mode = (m?: string) => m || 'closed';
  return (
    <>
      {st?.error && <div className={s.warn}>{st.error}</div>}
      {lat && (
        <>
          <div className={s.secNote}>{'Delay through Output about ' + Math.round(lat.totalMs) + ' ms (engine estimate; your driver can add a little)'}</div>
          <div className={s.breakdown} aria-label="Where the delay comes from">
            {(
              [
                ['Input', lat.inputMs, mode(st?.input?.mode)],
                ['Buffer', lat.bufferMs, 'keeps the two devices in step'],
                ['Output', lat.outputMs, mode(st?.output?.mode)],
              ] as const
            ).map(([name, ms, note]) => (
              <div key={name} className={s.bdRow}>
                <span className={s.bdName}>{name}</span>
                <span className={s.bdBar}>
                  <span style={{ width: Math.min(100, (ms / Math.max(lat.totalMs, 1)) * 100) + '%' }} />
                </span>
                <span className={s.bdMs}>{ms < 1 ? '<1' : ms.toFixed(1)} ms</span>
                <span className={s.bdNote}>{note}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <OutputMeter />
      <OutputPicker />
      <div className={s.secHead} style={{ marginTop: 14 }}>
        <div className="kicker">GUITAR INPUT MODE</div>
      </div>
      <div className={s.tunings}>
        {([[true, 'Exclusive', 'Recommended: skips Windows input effects'], [false, 'Shared', 'If another app needs this input too']] as const).map(([v, name, sub]) => (
          <button key={name} className={s.opt} aria-pressed={exIn === v} onClick={() => actions.setSession({ exclusiveInput: v })}>
            <span className={s.optName}>{name}</span>
            <span className={s.optSub}>{sub}</span>
          </button>
        ))}
      </div>
      <div className={s.secHead} style={{ marginTop: 14 }}>
        <div className="kicker">SPEAKERS MODE</div>
      </div>
      <div className={s.tunings}>
        {([[false, 'Shared', 'Other apps keep playing'], [true, 'Exclusive', 'Lowest delay; other sound stops while Fretline plays']] as const).map(([v, name, sub]) => (
          <button key={name} className={s.opt} aria-pressed={exOut === v} onClick={() => actions.setSession({ exclusiveOutput: v })}>
            <span className={s.optName}>{name}</span>
            <span className={s.optSub}>{sub}</span>
          </button>
        ))}
      </div>
      <div className={s.soundRow} style={{ marginTop: 12 }}>
        <button className={s.testLink} onClick={() => useStore.setState({ engineOn: false })}>Stop using the engine</button>
      </div>
    </>
  );
}
