import type { CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { engine } from '../../audio/engine';
import { LevelMeter } from '../gauges/Gauges';
import type { SlotView } from '../../core/protocol';
import { Button, Knob, Lamp, Panel, Screw, Window, cx } from '../../ui';
import s from './Pedals.module.css';

/** Enclosure colours by family: cherry dynamics, amber gain, teal modulation, ivory time and space. */
const FAM: Record<string, { enclosure: string; foot: string; ink: string }> = {
  DYNAMICS: { enclosure: 'linear-gradient(180deg,#e2563d,#b8321c)', foot: '#5a1509', ink: '#fff3ee' },
  GAIN: { enclosure: 'linear-gradient(180deg,#e9a23b,#c57f1e)', foot: '#5a3a08', ink: '#1c1612' },
  MOD: { enclosure: 'linear-gradient(180deg,#5aa89a,#3c8578)', foot: '#173c35', ink: '#0e1a18' },
  TIME: { enclosure: 'linear-gradient(180deg,#ebe0c6,#d4c39d)', foot: '#8e7a50', ink: '#2b1d10' },
  SPACE: { enclosure: 'linear-gradient(180deg,#ebe0c6,#d4c39d)', foot: '#8e7a50', ink: '#2b1d10' },
};

export function Pedals() {
  const { pedals, drag, output, mic, looper, native, listening } = useStore(
    useShallow((x) => ({ pedals: x.pedals, drag: x.drag, output: x.output, mic: x.engine.mic, looper: x.looper, native: x.engine.channel === 'engine', listening: x.listening })),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= pedals.length || to === from) return;
    const ps = [...useStore.getState().pedals];
    const [m] = ps.splice(from, 1);
    ps.splice(to, 0, m);
    actions.setPedals(ps);
    useStore.setState({ drag: useStore.getState().drag === null ? null : to });
  };

  const live = mic === 'live';
  const kicker = 'Signal chain · ' + (live ? (native ? 'Fretline engine' : 'Mic') : 'No input') + ' → output ' + (output ? 'on' : 'off');
  const delay = engine.delayMs();

  return (
    <div className={s.page}>
      <Panel title={kicker} lamp={live && listening ? 'live' : 'off'} pulse={live && listening} meta="Drag the grip to reorder · drag a knob to adjust · tap the footswitch">
        <Window surface="glass" pad="14px 16px" gap={10} flex="none">
          <div className={s.meters}>
            <LevelMeter kind="in" height={18} />
            <LevelMeter kind="out" height={18} label={output && delay ? `Speakers out · ${delay} ms` : 'Speakers out'} />
          </div>
        </Window>
        {!output && (
          <div className={s.notice}>
            <span>Output is off. Turn it on to hear your guitar through this board. Use headphones so the mic doesn’t feed back.</span>
            <Button variant="primary" size="sm" onClick={() => actions.setOutput(true)}>
              Turn on output
            </Button>
          </div>
        )}
        <div className={s.board}>
          {pedals.map((p, i) => {
            const f = FAM[p.type] ?? FAM.TIME;
            return (
              <div
                key={p.name}
                className={s.pedal}
                data-pedal-idx={i}
                data-on={p.on}
                data-drag={drag === i}
                style={{ background: f.enclosure, color: f.ink, '--foot': f.foot } as CSSProperties}
              >
                <Screw size={8} style={{ top: 6, left: 6 }} />
                <Screw size={8} style={{ top: 6, right: 6 }} />
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
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      move(i, i - 1);
                    }
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      move(i, i + 1);
                    }
                  }}
                >
                  ••••
                </button>
                <div className={s.names}>
                  <div className={s.pname}>{p.name}</div>
                  <div className={s.ptype}>{p.type}</div>
                </div>
                <Knob value={p.level} size={70} cap="black" color={f.ink} on={p.on} ariaLabel={p.name + ' level'} valueText={String(p.level)} onChange={(v) => actions.setPedal(i, { level: v })} />
                <Lamp tone={p.on ? 'live' : 'off'} size={10} />
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
            );
          })}
        </div>
      </Panel>
      <Panel surface="ivory" title={looper.len ? 'Looper · ' + (looper.len / looper.rate).toFixed(1) + ' s loop' : 'Looper'} meta="Tap a slot: record → play → overdub · ■ stops it" aria-label="Looper">
        <div className={s.slots}>
          {looper.slots.map((l, i) => (
            <Slot key={i} i={i} v={l} free={looper.free && l.state === 'recording' && !looper.len} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Slot({ i, v, free }: { i: number; v: SlotView; free: boolean }) {
  const st = v.state;
  const rec = st === 'recording' || st === 'overdubbing';
  const empty = st === 'empty';
  const label = empty ? 'RECORD' : st === 'recording' ? '● REC' : st === 'overdubbing' ? '● DUB' : st === 'playing' ? 'PLAYING' : 'STOPPED';
  const tone = empty ? 'empty' : rec ? 'rec' : st === 'playing' ? 'playing' : 'stopped';
  const deg = empty ? 0 : st === 'stopped' || free ? 360 : Math.round(v.progress * 360);
  const ring = rec ? 'var(--cherry)' : empty ? 'rgba(90,60,20,0.2)' : 'var(--amber)';
  const action = empty ? 'Record' : st === 'recording' ? 'Finish recording' : st === 'playing' ? 'Overdub' : st === 'overdubbing' ? 'Finish overdub' : 'Play';
  return (
    <div className={s.slot}>
      <button
        className={s.ring}
        data-tone={tone}
        aria-label={'Loop ' + (i + 1) + ': ' + action}
        style={{ background: `conic-gradient(${ring} ${deg}deg, rgba(90,60,20,0.2) 0)` }}
        onClick={() => engine.loop('tap', i)}
      >
        <span className={cx(s.face, rec && s.pulse)}>{label}</span>
      </button>
      <div className={s.slotRow}>
        <span className={s.slotName}>Loop {i + 1}</span>
        <Button variant="cream" size="sm" icon aria-label={st === 'stopped' ? 'Play loop' : 'Stop loop'} disabled={empty || st === 'recording'} onClick={() => engine.loop('stop', i)}>
          {st === 'stopped' ? '▶' : '■'}
        </Button>
        <Button variant="cream" size="sm" icon aria-label="Clear loop" disabled={empty} onClick={() => engine.loop('clear', i)}>
          ✕
        </Button>
      </div>
    </div>
  );
}
