import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { engine } from '../../audio/engine';
import type { Analysis, DeviceInfo } from '../../core/protocol';
import { actions, useStore } from '../../state/store';
import { LevelBar } from '../gauges/Gauges';
import { Options, Section } from './Section';
import s from './Studio.module.css';

const NONE: DeviceInfo[] = [];
const fmt = (db: number) => (db <= -120 ? '−∞' : Math.round(db) + ' dB');

export function InputTab() {
  const { devices, inputId, mic, onEngine, listening } = useStore(
    useShallow((x) => ({ devices: x.engine.status?.inputs ?? NONE, inputId: x.session?.inputId ?? '', mic: x.engine.mic, onEngine: x.engine.channel === 'engine', listening: x.listening })),
  );
  const micText = !listening ? 'Listening paused' : mic === 'live' ? 'Live' : mic === 'starting' ? 'Opening' : mic === 'denied' ? 'Blocked' : mic === 'nodevice' ? 'No input' : mic === 'error' ? 'Problem' : 'Off';
  return (
    <>
      <Section
        title="Input device"
        status={(onEngine ? 'Engine · ' : '') + micText}
        tone={listening && mic === 'live' ? 'ok' : mic === 'denied' || mic === 'error' ? 'bad' : undefined}
        desc={onEngine ? 'Fretline Engine is listening to this device.' : 'Your guitar cable, audio interface or microphone.'}
      >
        {devices.length > 0 ? (
          <Options
            label="Input device"
            value={inputId}
            onChange={(id) => actions.selectDevice(id)}
            options={[...(onEngine ? [{ id: '', name: 'Windows default' }] : []), ...devices].map((d) => [d.id, d.name] as [string, string])}
          />
        ) : (
          <p className={s.desc}>Allow the microphone to see your inputs.</p>
        )}
      </Section>
      <LevelSection />
      <CalibrateSection />
    </>
  );
}

function LevelSection() {
  const { levels, st } = useStore(useShallow((x) => ({ levels: x.levels, st: x.session })));
  if (!st) return null;
  const follow = st.floor.mode === 'auto';
  const threshold = levels.floorDb + st.gateDb;
  return (
    <Section
      title="Level and noise"
      status={follow ? 'Following noise' : 'Fixed'}
      desc="Drag the gold marker: anything louder counts as playing, anything quieter is treated as noise. The grey marker is the measured noise floor; the green light shows when you're playing."
    >
      <LevelBar kind="in" size="large" editable />
      <div className={s.stats}>
        <div className={s.stat}>
          <div className={s.statLabel}>Noise floor</div>
          <div className={s.statValue}>{fmt(levels.floorDb)}</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Plays above</div>
          <div className={s.statValue} style={{ color: 'var(--gold-hi)' }}>{fmt(threshold)}</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Recent peak</div>
          <div className={s.statValue}>{fmt(levels.peakDb)}</div>
        </div>
      </div>
      <Options
        label="Noise floor"
        value={follow}
        onChange={(v) => actions.setFollowNoise(v)}
        options={[
          [true, 'Follow noise', 'The marker keeps its distance above the noise'],
          [false, 'Fixed', 'The marker stays exactly where you put it'],
        ]}
      />
    </Section>
  );
}

type Step = 'idle' | 'mute' | 'measuring' | 'play' | 'listening' | 'done' | 'noisy' | 'loud' | 'nonote';
interface Result {
  noise: number;
  note: number;
  threshold: number;
}

const MEASURE_MS = 3000;
const NOTE_WAIT_MS = 20000;
const NOTE_MS = 1200;
const pct = (a: number[], p: number) => {
  const v = [...a].sort((x, y) => x - y);
  return v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))] ?? -120;
};

/**
 * Guided calibration: measure silence with the strings muted, then a real note, and put the
 * threshold between them. The player decides when each step starts; nothing runs ahead.
 */
function CalibrateSection() {
  const mic = useStore((x) => x.engine.mic);
  const listening = useStore((x) => x.listening);
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const frames = useRef<number[]>([]);
  const noise = useRef(-120);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const off = useRef<(() => void) | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    off.current?.();
    off.current = null;
  };
  useEffect(() => stop, []);

  const collect = (fn: (db: number) => void) => {
    off.current?.();
    off.current = engine.on('analysis', (a: Analysis) => a.frames.forEach((f) => fn(20 * Math.log10(f.rms + 1e-9))));
  };

  const measureSilence = () => {
    // Calibration only makes sense with the floor following the noise.
    if (useStore.getState().session?.floor.mode === 'manual') actions.setFollowNoise(true);
    actions.recalibrate();
    frames.current = [];
    setStep('measuring');
    setProgress(0);
    collect((db) => frames.current.push(db));
    const t0 = performance.now();
    timer.current = setInterval(() => {
      const p = (performance.now() - t0) / MEASURE_MS;
      setProgress(Math.min(1, p));
      if (p < 1) return;
      stop();
      const f = frames.current;
      // Silence is steady: a pick, a bump or a ringing string shows up as a wide spread between
      // the quietest and loudest moments. And no idle guitar input is this loud.
      if (!f.length || pct(f, 0.98) - pct(f, 0.1) > 15) {
        setStep('noisy');
        return;
      }
      if (pct(f, 0.8) > -45) {
        setStep('loud');
        return;
      }
      noise.current = pct(f, 0.8);
      setStep('play');
    }, 50);
  };

  const listenForNote = () => {
    setStep('listening');
    setProgress(0);
    let above = 0;
    let attackAt = 0;
    const note: number[] = [];
    const t0 = performance.now();
    collect((db) => {
      if (!attackAt) {
        above = db > noise.current + 15 ? above + 1 : 0;
        if (above >= 3) attackAt = performance.now();
      }
      if (attackAt) note.push(db);
    });
    timer.current = setInterval(() => {
      const now = performance.now();
      if (!attackAt) {
        if (now - t0 > NOTE_WAIT_MS) {
          stop();
          setStep('nonote');
        }
        return;
      }
      setProgress(Math.min(1, (now - attackAt) / NOTE_MS));
      if (now - attackAt < NOTE_MS) return;
      stop();
      const n = noise.current;
      const body = pct(note, 0.5);
      const head = body - n;
      // Between the two, closer to the noise (notes decay and must stay audible), at least 6 dB
      // above the noise and 10 dB below the note.
      const th = Math.min(body - 10, n + Math.max(6, Math.min(24, head * 0.35)));
      const gateDb = Math.round(Math.max(3, Math.min(30, th - engine.levels.measuredDb)));
      actions.setSession({ gateDb });
      setResult({ noise: n, note: body, threshold: engine.levels.measuredDb + gateDb });
      setStep('done');
    }, 50);
  };

  const ready = listening && mic === 'live';
  const head = result ? result.note - result.noise : 0;
  const steps = (
    <div className={s.wizSteps} aria-hidden>
      <span data-state={step === 'mute' || step === 'measuring' || step === 'noisy' || step === 'loud' ? 'now' : step === 'idle' ? '' : 'done'}>1 Silence</span>
      <span>·</span>
      <span data-state={step === 'play' || step === 'listening' || step === 'nonote' ? 'now' : step === 'done' ? 'done' : ''}>2 A note</span>
    </div>
  );
  const body: Record<Step, { title: string; text: string; action?: [string, () => void]; progress?: boolean }> = {
    idle: {
      title: 'Find your levels',
      text: 'Two short steps: Fretline listens to your setup with the strings muted, then to one note, and puts the marker between them.',
      action: ['Start', () => setStep('mute')],
    },
    mute: { title: 'Mute your strings', text: 'Rest your hand across all six strings so nothing rings, then press Ready and stay still for 3 seconds.', action: ['Ready', measureSilence] },
    measuring: { title: 'Measuring the silence…', text: 'Keep the strings muted.', progress: true },
    noisy: { title: 'Something rang while measuring', text: 'A string or a bump made a sound. Mute the strings and try again.', action: ['Try again', () => setStep('mute')] },
    loud: {
      title: 'Too loud for silence',
      text: 'Even muted, the input is very loud. Check that the strings are muted, and that no amp, effects unit or other sound is feeding this input.',
      action: ['Try again', () => setStep('mute')],
    },
    play: { title: 'Now play one note', text: 'Pick any single string at your normal strength and let it ring. Fretline waits until it hears you.', action: ['Listen', listenForNote] },
    listening: { title: 'Listening for your note…', text: 'Play a note now and let it ring.', progress: true },
    nonote: { title: "Didn't hear a note", text: 'Nothing came through above the noise. Check the input device above and the guitar volume knob, then try again.', action: ['Try again', () => setStep('play')] },
    done: {
      title: head >= 30 ? 'All set: plenty of headroom' : head >= 18 ? 'All set' : 'Set, but your guitar is quiet',
      text:
        `Noise ${fmt(result?.noise ?? -120)} · your note ${fmt(result?.note ?? -120)} · ${Math.round(head)} dB apart. The marker is at ${fmt(result?.threshold ?? -120)}.` +
        (head < 18 ? ' Turn the guitar volume knob up, or raise the input level of your interface, for more reliable detection.' : ''),
      action: ['Done', () => setStep('idle')],
    },
  };
  const b = body[step];
  return (
    <Section
      title="Calibrate"
      status={step === 'done' ? Math.round(head) + ' dB headroom' : step === 'idle' ? '' : 'In progress'}
      tone={step === 'done' ? (head >= 18 ? 'ok' : 'warn') : undefined}
      desc="Use it when you change guitar, cable or room, or if a string was ringing when Fretline started."
    >
      <div className={s.wizard} aria-live="polite">
        {steps}
        <div className={s.wizTitle}>{b.title}</div>
        <div className={s.wizText}>{b.text}</div>
        {b.progress && (
          <div className={s.progress} role="progressbar" aria-label={b.title} aria-valuenow={Math.round(progress * 100)}>
            <div style={{ width: progress * 100 + '%' }} />
          </div>
        )}
        <div className={s.row}>
          {b.action && (
            <button className={s.testOk} disabled={!ready && step !== 'done'} onClick={b.action[1]}>
              {b.action[0]}
            </button>
          )}
          {step === 'done' && (
            <button className={s.testBtn} onClick={() => setStep('mute')}>
              Redo
            </button>
          )}
          {step !== 'idle' && step !== 'done' && (
            <button
              className={s.testLink}
              onClick={() => {
                stop();
                setStep('idle');
              }}
            >
              Cancel
            </button>
          )}
          {!ready && step !== 'done' && <span className={s.desc} style={{ margin: 0 }}>Needs the input live and listening.</span>}
        </div>
      </div>
    </Section>
  );
}
