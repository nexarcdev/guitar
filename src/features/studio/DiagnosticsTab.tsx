import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { engine } from '../../audio/engine';
import { diagnose, playStep, STEPS, type StepId, type Verdict } from '../../audio/soundTest';
import { useStore } from '../../state/store';
import { Section } from './Section';
import s from './Studio.module.css';

export const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  (((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? '') === 'Windows' || /Windows/.test(navigator.userAgent));

export const BUILT = (() => {
  const d = new Date(__BUILD_TIME__);
  return isNaN(+d) ? 'locally' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
})();

export function DiagnosticsTab() {
  const { onEngine, st, ml, backend, version, gainDb } = useStore(
    useShallow((x) => ({ onEngine: x.engine.channel === 'engine', st: x.engine.status, ml: x.engine.ml, backend: x.engine.mlBackend, version: x.engine.engineVersion, gainDb: x.levels.gainDb })),
  );
  const khz = (r?: number) => (r ? Math.round(r / 100) / 10 + ' kHz' : '');
  return (
    <>
      <Section title="This setup" desc="What Fretline is using right now.">
        <dl className={s.kv}>
          <dt>Fretline</dt>
          <dd>{__APP_VERSION__ + ' · built ' + BUILT}</dd>
          <dt>Audio</dt>
          <dd>{onEngine ? 'Fretline Engine ' + version : 'This browser'}</dd>
          <dt>Input</dt>
          <dd>{st?.input ? [st.input.name, khz(st.input.rate), st.input.mode].filter(Boolean).join(' · ') : 'Closed'}</dd>
          <dt>Output</dt>
          <dd>{st?.output ? [st.output.name || 'Default', khz(st.output.rate), st.output.mode].filter(Boolean).join(' · ') : 'Closed'}</dd>
          <dt>Auto level</dt>
          <dd>{gainDb >= 1 ? '+' + Math.round(gainDb) + ' dB on the monitored guitar' : 'None'}</dd>
          <dt>Chord detection</dt>
          <dd>{ml + (backend ? ' · ' + backend : '')}</dd>
          {st?.error && (
            <>
              <dt>Problem</dt>
              <dd style={{ color: 'var(--red-ink)' }}>{st.error}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section title="Delay through Output" desc="Where the time from string to speaker goes.">
        <Breakdown />
      </Section>

      {!onEngine && (
        <Section title="Sound test" desc="Sound breaking up or missing? This plays a tone a few different ways and finds what's causing it. About 30 seconds.">
          <SoundTest />
        </Section>
      )}

      {IS_WINDOWS && (
        <Section title="Windows audio help">
          <div className={s.help} style={{ marginTop: 0 }}>
            <div className={s.helpTitle}>Sound cutting out after a moment, or sounding different, once the input is on?</div>
            <InputEffectsSteps />
            <div className={s.helpTitle} style={{ marginTop: 10 }}>Other apps going quieter?</div>
            <div>
              Press <kbd>Win</kbd> + <kbd>R</kbd>, type <kbd>mmsys.cpl</kbd>, open the <b>Communications</b> tab and choose <b>Do nothing</b>.
            </div>
            {onEngine && (
              <>
                <div className={s.helpTitle} style={{ marginTop: 10 }}>Engine log</div>
                <div>
                  <kbd>%LOCALAPPDATA%\Fretline\engine.log</kbd>
                </div>
              </>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

/** The delay from string to speaker, by stage, for whichever channel is in use. */
export function Breakdown() {
  const onEngine = useStore((x) => x.engine.channel === 'engine');
  const lat = useStore((x) => x.engine.status?.latency);
  const st = useStore((x) => x.engine.status);
  const [lb, setLb] = useState(() => engine.latencyBreakdown());
  useEffect(() => {
    if (onEngine) return;
    const t = setInterval(() => setLb(engine.latencyBreakdown()), 1000);
    return () => clearInterval(t);
  }, [onEngine]);
  const rows: Array<[string, number, string]> = onEngine
    ? lat
      ? [
          ['Input', lat.inputMs, st?.input?.mode ?? ''],
          ['Buffer', lat.bufferMs, 'keeps the two devices in step'],
          ['Output', lat.outputMs, st?.output?.mode ?? ''],
        ]
      : []
    : lb && lb.totalMs
      ? [
          ['Input', lb.inputMs, lb.inputSource === 'measured' ? 'measured' : lb.inputSource === 'reported' ? 'reported' : 'typical, not reported'],
          ['Browser', lb.engineMs, 'audio engine'],
          ['Output', lb.outputMs, 'speakers / driver'],
        ]
      : [];
  if (!rows.length) return <p className={s.desc} style={{ margin: 0 }}>Shown once the input and speakers are open.</p>;
  const total = rows.reduce((a, r) => a + r[1], 0);
  return (
    <>
      <div className={s.desc} style={{ margin: 0 }}>{'About ' + Math.round(total) + ' ms' + (onEngine ? ' (engine estimate; your driver can add a little)' : '')}</div>
      <div className={s.breakdown} aria-label="Where the delay comes from">
        {rows.map(([name, ms, note]) => (
          <div key={name} className={s.bdRow}>
            <span className={s.bdName}>{name}</span>
            <span className={s.bdBar}>
              <span style={{ width: Math.min(100, (ms / Math.max(total, 1)) * 100) + '%' }} />
            </span>
            <span className={s.bdMs}>{ms < 1 ? '<1' : ms.toFixed(ms < 10 ? 1 : 0)} ms</span>
            <span className={s.bdNote}>{note}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Guided test that finds where output breaks on this machine, and applies the fix when it can. */
function SoundTest() {
  const deviceId = useStore((x) => x.session?.inputId ?? '');
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [res, setRes] = useState<Partial<Record<StepId, Verdict>>>({});
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState('');
  const cleanup = useRef<(() => void) | null>(null);

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
  // Leaving the Studio mid-test (or after the result) must always hand audio back to the app.
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
      <div className={s.row}>
        <button className={s.testOk} onClick={start}>
          Run the sound test
        </button>
      </div>
    );

  const d = diagnose(res);
  const done = i >= STEPS.length;
  return (
    <div className={s.test} role="region" aria-label="Sound test" style={{ marginTop: 0 }}>
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
        <li>With Fretline Engine, Exclusive guitar input skips all of these effects.</li>
      </ol>
    </>
  );
}
