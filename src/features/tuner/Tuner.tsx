import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { engine } from '../../audio/engine';
import { trail } from '../../state/trail';
import { openStrings, stringLabel } from '../../theory/music';
import { useViewport } from '../shell/useViewport';
import s from './Tuner.module.css';

const GOLD = '#e9b949';
const INK = '#f7efe8';

export function Tuner() {
  const setup = useStore((x) => x.setup);
  const listening = useStore((x) => x.listening);
  const live = useStore((x) => x.engine.mic === 'live' && x.engine.running);
  const { tString, auto, detected, cents, freq, voiced, tuned, headstock } = useStore(
    useShallow((x) => ({ tString: x.tString, auto: x.auto, detected: x.detected, cents: x.cents, freq: x.freq, voiced: x.voiced, tuned: x.tuned, headstock: x.headstock })),
  );
  const { isMobile } = useViewport();

  const T = openStrings(setup.offsets);
  const hearing = listening && live;
  const reading = hearing && voiced;
  const tIdx = detected ?? tString;
  const st = T[tIdx];
  const c = reading ? cents : 0;
  const inTune = reading && Math.abs(c) < 4;
  const tone = !reading ? 'idle' : inTune ? 'in' : 'off';

  const status = !listening ? 'Paused' : !live ? 'No input' : !voiced ? 'Play a string' : inTune ? 'In tune' : c < 0 ? 'Tune up ↑' : 'Tune down ↓';
  const mode = !listening ? 'PAUSED' : live ? 'LISTENING · MIC' : 'NO INPUT';
  const hint = (setup.capo ? 'Take the capo off to tune. The tuner listens for open strings. ' : '') + (hearing ? 'Play one string at a time.' : '');

  // headstock geometry: posts are 80 units apart split, 44 in line; pegs line up with them.
  const inline = headstock === 'inline';
  const pegSize = isMobile ? 60 : 72;
  const pegGap = inline ? (isMobile ? 12 : 14) : isMobile ? 32 : 40;
  const hs = (pegSize + pegGap) / (inline ? 44 : 80);

  const peg = (i: number) => {
    const x = T[i];
    return (
      <button
        key={i}
        className={s.peg}
        style={{ width: pegSize, height: pegSize }}
        aria-label={x.note + x.oct + ' string'}
        aria-pressed={i === tIdx}
        data-active={i === tIdx}
        data-tuned={tuned.includes(i)}
        data-live={hearing}
        onClick={() => actions.selectString(i)}
      >
        {stringLabel(x.note, i)}
      </button>
    );
  };

  return (
    <div className={s.grid}>
      <div className={s.col}>
        <div className={s.kickerRow}>
          <div className="kicker">{mode}</div>
          <button className={s.auto} aria-label="Auto-detect string" aria-pressed={auto} onClick={() => useStore.setState({ auto: !auto })}>
            <span>AUTO</span>
            <span className={s.switch} data-on={auto}>
              <span className={s.knob} />
            </span>
          </button>
        </div>
        <div className={s.scope}>
          <div className={s.flatSharp} aria-hidden>
            <span>♭</span>
            <span>♯</span>
          </div>
          <div className={s.center} data-in={inTune} />
          <TrailCanvas active={hearing} />
          <div className={s.needle} style={{ left: 50 + Math.max(-50, Math.min(50, c)) * 0.84 + '%' }} aria-hidden>
            <div className={s.puck} data-state={tone}>
              {reading ? (c > 0 ? '+' : '') + Math.round(c) : '·'}
            </div>
            <div className={s.pointer} />
          </div>
          <div className={s.noteWrap}>
            <div className={s.note} data-in={inTune} aria-live="polite">
              {st.note}
            </div>
            <div className={s.freq}>{reading ? freq.toFixed(1) + ' Hz' : 'target ' + st.hz.toFixed(2) + ' Hz'}</div>
          </div>
        </div>
        <div className={s.statusRow}>
          <div className={s.status} data-tone={tone}>
            {status}
          </div>
          <div className={s.hint}>{hint}</div>
        </div>
      </div>
      <div className={s.headCol}>
        <div className={s.head}>
          <div className={s.pegs} style={{ gap: pegGap }}>
            {(inline ? [5, 4, 3, 2, 1, 0] : [2, 1, 0]).map(peg)}
          </div>
          <div className={s.svgWrap}>
            <Headstock inline={inline} scale={hs} active={tIdx} tuned={tuned} />
          </div>
          <div className={s.pegs} style={{ gap: pegGap, width: inline ? pegSize : undefined }}>
            {inline ? null : [3, 4, 5].map(peg)}
          </div>
        </div>
        <div className={s.actions}>
          <button className="btn-gold" onClick={() => engine.reference(T[tString].hz)}>
            Play reference
          </button>
          <button className="btn-ghost" onClick={actions.resetTuned}>
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}

const SPLIT_POSTS: Array<[number, number]> = [[66, 230], [66, 150], [66, 70], [134, 70], [134, 150], [134, 230]];
const INLINE_POSTS: Array<[number, number]> = [0, 1, 2, 3, 4, 5].map((k) => [70, 260 - k * 44]);
const NUT_X = [72, 83.2, 94.4, 105.6, 116.8, 128];

function Headstock({ inline, scale, active, tuned }: { inline: boolean; scale: number; active: number; tuned: number[] }) {
  const posts = inline ? INLINE_POSTS : SPLIT_POSTS;
  return (
    <svg width={200 * scale} height={300 * scale} viewBox="0 0 200 300" style={{ display: 'block', flex: 'none', overflow: 'visible' }} aria-hidden>
      <defs>
        <linearGradient id="hsWood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a0603a" />
          <stop offset=".55" stopColor="#7a4224" />
          <stop offset="1" stopColor="#52290f" />
        </linearGradient>
        <linearGradient id="hsChrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fafafa" />
          <stop offset=".5" stopColor="#9c9c9c" />
          <stop offset="1" stopColor="#e6e6e6" />
        </linearGradient>
      </defs>
      {inline ? (
        <path
          d="M62 300 L62 286 C50 282 44 270 46 254 L48 40 C48 20 60 10 80 10 C108 10 128 18 140 34 C150 48 146 70 138 84 C132 96 138 140 138 160 L138 300 Z"
          fill="url(#hsWood)" stroke="#e9dcc6" strokeWidth="2.5" strokeLinejoin="round"
        />
      ) : (
        <>
          <path
            d="M62 300 L62 196 C62 176 48 164 50 132 L50 62 C50 46 60 42 68 44 L84 47 C92 48 95 34 100 32 C105 34 108 48 116 47 L132 44 C140 42 150 46 150 62 L150 132 C152 164 138 176 138 196 L138 300 Z"
            fill="url(#hsWood)" stroke="#e9dcc6" strokeWidth="2.5" strokeLinejoin="round"
          />
          <path d="M100 186 C92 186 92 240 100 258 C108 240 108 186 100 186 Z" fill="rgba(0,0,0,.45)" />
        </>
      )}
      <rect x="62" y="268" width="76" height="6" fill="#f1e7d2" />
      {posts.map(([x, y], i) => (
        <line
          key={'s' + i} x1={x} y1={y} x2={NUT_X[i]} y2={300}
          stroke={i === active ? '#f6d98a' : 'rgba(235,235,235,.8)'} strokeWidth={(2.2 - i * 0.24).toFixed(2)} strokeLinecap="round"
          style={{ transition: 'stroke .3s' }}
        />
      ))}
      {posts.map(([x, y], i) => (
        <g key={'p' + i}>
          <circle cx={x} cy={y} r="13" fill="none" stroke={i === active ? GOLD : tuned.includes(i) ? 'rgba(233,185,73,.55)' : 'transparent'} strokeWidth="2.5" style={{ transition: 'stroke .3s' }} />
          <circle cx={x} cy={y} r="9" fill="url(#hsChrome)" stroke="#555" strokeWidth=".8" />
          <circle cx={x} cy={y} r="3" fill="#2a2a2a" />
        </g>
      ))}
    </svg>
  );
}

/** The streaming pitch history: one dot per reading, scrolling down and fading over 4.5 s. */
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
      for (const p of trail.points) {
        const age = (now - p.t) / 1000;
        const a = Math.max(0, 1 - age / 4.5) * 0.85;
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = Math.abs(p.c) < 4 ? GOLD : INK;
        const x = (w * (50 + Math.max(-50, Math.min(50, p.c)) * 0.84)) / 100 - 2;
        const y = 98 + age * 44;
        ctx.beginPath();
        ctx.roundRect(x, y, 4, 7, 1);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return <canvas ref={ref} className={s.canvas} aria-hidden />;
}
