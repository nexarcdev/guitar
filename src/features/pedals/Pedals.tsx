import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { engine } from '../../audio/engine';
import { VuGauge } from '../gauges/Gauges';
import type { SlotView } from '../../core/protocol';
import s from './Pedals.module.css';

export function Pedals() {
  const { pedals, drag, output, mic, looper, native } = useStore(
    useShallow((x) => ({ pedals: x.pedals, drag: x.drag, output: x.output, mic: x.engine.mic, looper: x.looper, native: x.engine.channel === 'engine' })),
  );
  const knob = useRef<{ i: number; y: number; l: number } | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= pedals.length || to === from) return;
    const ps = [...useStore.getState().pedals];
    const [m] = ps.splice(from, 1);
    ps.splice(to, 0, m);
    actions.setPedals(ps);
    useStore.setState({ drag: useStore.getState().drag === null ? null : to });
  };

  return (
    <div className={s.page}>
      <div className={s.top}>
        <div className={s.topRow}>
          <div className="kicker">{'SIGNAL CHAIN · ' + (mic === 'live' ? (native ? 'FRETLINE ENGINE' : 'MIC') : 'NO INPUT') + ' → OUTPUT ' + (output ? 'ON' : 'OFF')}</div>
          <span className={s.delay}>{output && engine.delayMs() ? 'About ' + engine.delayMs() + ' ms delay' : ''}</span>
        </div>
        <div className={s.hint}>Drag the grip to reorder · drag a knob to adjust · tap the footswitch</div>
      </div>
      <div className={s.vus}>
        <VuGauge kind="in" />
        <VuGauge kind="out" />
      </div>
      {!output && (
        <div className="notice">
          <span>Output is off. Turn it on to hear your guitar through this board. Use headphones so the mic doesn’t feed back.</span>
          <button className="notice-btn" onClick={() => actions.setOutput(true)}>
            Turn on output
          </button>
        </div>
      )}
      <div className={s.board}>
        {pedals.map((p, i) => (
          <div key={p.name} className={s.pedal} data-pedal-idx={i} data-on={p.on} data-drag={drag === i}>
            <button
              className={s.grip}
              aria-label={'Move ' + p.name + '. Use the arrow keys to reorder'}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                useStore.setState({ drag: i });
              }}
              onPointerMove={(e) => {
                const from = useStore.getState().drag;
                if (from === null) return;
                const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as HTMLElement).dataset?.pedalIdx !== undefined) as HTMLElement | undefined;
                if (el) move(from, +el.dataset.pedalIdx!);
              }}
              onPointerUp={() => useStore.setState({ drag: null })}
              onPointerCancel={() => useStore.setState({ drag: null })}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
              }}
            >
              ••••
            </button>
            <div style={{ textAlign: 'center' }}>
              <div className={s.pname}>{p.name}</div>
              <div className={s.ptype}>{p.type}</div>
            </div>
            <div
              className={s.knob}
              role="slider"
              tabIndex={0}
              aria-label={p.name + ' level'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={p.level}
              style={{ background: `conic-gradient(from 225deg,${p.on ? 'var(--gold)' : 'rgba(255,255,255,.35)'} 0deg ${p.level * 2.7}deg,rgba(255,255,255,.1) ${p.level * 2.7}deg 270deg,transparent 270deg 360deg)` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                knob.current = { i, y: e.clientY, l: p.level };
              }}
              onPointerMove={(e) => {
                const k = knob.current;
                if (!k || k.i !== i) return;
                const l = Math.max(0, Math.min(100, Math.round(k.l + (k.y - e.clientY) * 0.7)));
                if (l !== useStore.getState().pedals[i].level) actions.setPedal(i, { level: l });
              }}
              onPointerUp={() => (knob.current = null)}
              onPointerCancel={() => (knob.current = null)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 10 : 1;
                const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? step : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -step : 0;
                if (d) {
                  e.preventDefault();
                  actions.setPedal(i, { level: Math.max(0, Math.min(100, p.level + d)) });
                }
              }}
            >
              <div className={s.knobFace}>{p.level}</div>
            </div>
            <button
              className={s.foot}
              aria-label={p.name + (p.on ? ' on' : ' off')}
              aria-pressed={p.on}
              onClick={() => {
                engine.resume();
                actions.setPedal(i, { on: !p.on });
              }}
            />
          </div>
        ))}
      </div>
      <section className={s.looper} aria-label="Looper">
        <div className={s.loopHead}>
          <div className="kicker">{looper.len ? 'LOOPER · ' + (looper.len / looper.rate).toFixed(1) + ' S LOOP' : 'LOOPER'}</div>
          <div className={s.hint}>Tap a slot: record → play → overdub · ■ stops it</div>
        </div>
        <div className={s.slots}>
          {looper.slots.map((l, i) => (
            <Slot key={i} i={i} v={l} free={looper.free && l.state === 'recording' && !looper.len} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Slot({ i, v, free }: { i: number; v: SlotView; free: boolean }) {
  const st = v.state;
  const rec = st === 'recording' || st === 'overdubbing';
  const label = st === 'empty' ? 'RECORD' : st === 'recording' ? '● REC' : st === 'overdubbing' ? '● DUB' : st === 'playing' ? 'PLAYING' : 'STOPPED';
  const labelColor = st === 'empty' ? 'var(--muted)' : rec ? 'var(--red)' : st === 'playing' ? 'var(--gold)' : 'var(--ink)';
  const deg = st === 'empty' ? 0 : st === 'stopped' || free ? 360 : Math.round(v.progress * 360);
  const ring = rec ? 'var(--red)' : st === 'empty' ? 'rgba(255,255,255,.1)' : 'var(--gold)';
  const shadow = st === 'playing' ? '0 0 28px rgba(233,185,73,.35)' : rec ? '0 0 28px rgba(224,64,64,.4)' : '0 8px 20px rgba(0,0,0,.4)';
  const action = st === 'empty' ? 'Record' : st === 'recording' ? 'Finish recording' : st === 'playing' ? 'Overdub' : st === 'overdubbing' ? 'Finish overdub' : 'Play';
  return (
    <div className={s.slot}>
      <button
        className={s.ring}
        aria-label={'Loop ' + (i + 1) + ': ' + action}
        style={{ background: `conic-gradient(${ring} ${deg}deg,rgba(255,255,255,.1) 0)`, boxShadow: shadow }}
        onClick={() => engine.loop('tap', i)}
      >
        <span className={s.ringFace} style={{ color: labelColor, animation: rec ? 'recPulse 1s ease-in-out infinite' : 'none' }}>
          {label}
        </span>
      </button>
      <div className={s.slotRow}>
        <span className={s.slotName}>Loop {i + 1}</span>
        <button
          className={s.mini}
          aria-label={st === 'stopped' ? 'Play loop' : 'Stop loop'}
          disabled={st === 'empty' || st === 'recording'}
          onClick={() => engine.loop('stop', i)}
        >
          {st === 'stopped' ? '▶' : '■'}
        </button>
        <button className={`${s.mini} ${s.miniX}`} aria-label="Clear loop" disabled={st === 'empty'} onClick={() => engine.loop('clear', i)}>
          ✕
        </button>
      </div>
    </div>
  );
}
