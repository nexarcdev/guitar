import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { engine } from '../../audio/engine';
import { trail } from '../../state/trail';
import { openStrings, stringLabel } from '../../theory/music';
import { Button, Chip, Knob, Lamp, Panel, Switch, Window, WellButton } from '../../ui';
import s from './Tuner.module.css';

const AMBER = '#e9a23b';
const TEAL = '#4db6a4';

/** Ruler position of a reading, 0..1 across -50..+50 cents. */
const along = (c: number) => (Math.max(-50, Math.min(50, c)) + 50) / 100;

export function Tuner() {
  const setup = useStore((x) => x.setup);
  const listening = useStore((x) => x.listening);
  const live = useStore((x) => x.engine.mic === 'live' && x.engine.running);
  const { tString, auto, detected, cents, freq, voiced, tuned } = useStore(
    useShallow((x) => ({ tString: x.tString, auto: x.auto, detected: x.detected, cents: x.cents, freq: x.freq, voiced: x.voiced, tuned: x.tuned })),
  );

  const T = openStrings(setup.offsets);
  const hearing = listening && live;
  const reading = hearing && voiced;
  const tIdx = detected ?? tString;
  const st = T[tIdx];
  const c = reading ? cents : 0;
  const inTune = reading && Math.abs(c) < 4;

  const status = !listening ? 'Paused' : !live ? 'No input' : !voiced ? 'Play a string' : inTune ? 'In tune' : c < 0 ? 'Tune up' : 'Tune down';
  const statusTone = !reading ? 'muted' : inTune ? 'ok' : 'live';
  const mode = !listening ? 'Paused' : live ? 'Listening · mic' : 'No input';
  const others = [0, 1, 2, 3, 4, 5].filter((k) => k !== tIdx && !tuned.includes(k));
  const next = tuned.length && others.length ? Math.min(...others) : -1;

  return (
    <div className={s.grid}>
      <Panel
        title={mode}
        lamp={hearing ? 'live' : 'off'}
        pulse={hearing}
        className={s.reading}
        meta={<Switch on={auto} label="Auto" labelSide="left" ariaLabel="Auto-detect string" onToggle={(v) => useStore.setState({ auto: v })} />}
      >
        <Window surface="glass" pad="0" className={s.scope}>
          <TrailCanvas active={hearing} />
          <div className={s.ruler} aria-hidden />
          <div className={s.scale} aria-hidden>
            <span>−50</span>
            <span>−25</span>
            <span className={s.zero}>0</span>
            <span>+25</span>
            <span>+50</span>
          </div>
          <div className={s.center} aria-hidden />
          <div className={s.needleTrack} aria-hidden>
            <div className={s.needle} data-in={inTune} data-idle={!reading} style={{ left: along(c) * 100 + '%' }} />
          </div>
          <div className={s.readout}>
            <div className={s.note} data-in={inTune} aria-live="polite">
              {st.note}
            </div>
            <div className={s.hz}>
              {reading ? (
                <>
                  {freq.toFixed(1)} Hz · <span className={s.cents}>{(c > 0 ? '+' : '') + Math.round(c)} ¢</span>
                </>
              ) : (
                <>
                  {st.hz.toFixed(1)} Hz · <span className={s.cents}>target</span>
                </>
              )}
            </div>
          </div>
          {setup.capo > 0 && <div className={s.capoHint}>Take the capo off to tune: the tuner listens for open strings.</div>}
          <div className={s.status}>
            <Chip size="lg" label={status} tone={statusTone} live />
          </div>
        </Window>
      </Panel>

      <Panel surface="ivory" title="Strings" meta={`${tuned.length} of 6 in tune`}>
        <div className={s.strings}>
          {T.map((x, i) => {
            const active = i === tIdx;
            const done = tuned.includes(i);
            const isNext = i === next;
            const sub = active ? (hearing ? 'Listening' : 'Selected') : done ? 'In tune' : isNext ? 'Next' : '';
            return (
              <WellButton
                key={i}
                className={s.string}
                edge={active ? AMBER : done ? 'rgba(77,182,164,0.6)' : undefined}
                aria-label={x.note + x.oct + ' string'}
                aria-pressed={active}
                data-state={active ? 'active' : done ? 'tuned' : isNext ? 'next' : 'idle'}
                onClick={() => actions.selectString(i)}
              >
                <Lamp tone={active ? 'on' : done ? 'ok' : 'off'} size={14} surface="well" />
                <span className={s.sName}>{stringLabel(x.note, i)}</span>
                <span className={s.sSub}>{sub}</span>
              </WellButton>
            );
          })}
        </div>
        <div className={s.knobs}>
          <Knob
            value={setup.capo}
            min={0}
            max={12}
            onChange={(v) => actions.saveSetup({ capo: v })}
            label={`Capo · ${setup.capo}`}
            ariaLabel="Capo fret"
            valueText={setup.capo ? `Fret ${setup.capo}` : 'No capo'}
            size={78}
            cap="cream"
            color="#1f8c7c"
            on={setup.capo > 0}
            labelColor="#6b5636"
          />
        </div>
        <div className={s.actions}>
          <Button variant="primary" size="lg" grow onClick={() => engine.reference(T[tString].hz)}>
            Play reference
          </Button>
          <Button variant="dark" size="lg" grow onClick={actions.resetTuned}>
            Start over
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/** The streaming pitch history: one tick per reading, falling down the glass and fading over 4.5 s. */
function TrailCanvas({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!active) return;
      const now = performance.now();
      // Same span as the ruler: 40 px in from each side.
      const x0 = 40, span = Math.max(1, w - 80);
      for (const p of trail.points) {
        const age = (now - p.t) / 1000;
        const a = Math.max(0, 1 - age / 4.5) * 0.5;
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = Math.abs(p.c) < 4 ? TEAL : AMBER;
        ctx.beginPath();
        ctx.roundRect(x0 + span * along(p.c) - 2, 100 + age * 44, 4, 7, 1);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} className={s.canvas} aria-hidden />;
}
