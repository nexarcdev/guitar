import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { BufferHealth, EngineEvent, StreamHealth, Telemetry } from '../../core/protocol';
import { useStore } from '../../state/store';
import { Section, type Tone } from './Section';
import s from './Studio.module.css';

const ms = (v: number) => (Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)) + ' ms';
const times = (n: number) => (n === 1 ? 'once' : n + ' times');

/** The verdict for the chip: the worst thing going on now. */
function verdict(t: Telemetry, recentDry: boolean): [string, Tone] {
  const b = t.buffer;
  if (b?.limited) return ['Stalls too long to cover', 'bad'];
  for (const [h, who] of [
    [t.input, 'Input'],
    [t.output, 'Speakers'],
  ] as const) {
    if (h && h.worstWorkMs > h.periodMs) return [who + " can't keep up", 'bad'];
  }
  if (recentDry) return ['Ran dry in the last minute', 'warn'];
  if (!b) return [t.input ? 'Speakers closed' : 'Input closed', undefined];
  return ['Steady at ' + ms(b.targetMs), 'ok'];
}

function Stream({ title, h, tone }: { title: string; h: StreamHealth | null; tone: 'gold' | 'red' }) {
  return (
    <div className={s.healthCard} data-accent={tone}>
      <div className={s.healthTitle}>{title}</div>
      {h ? (
        <dl className={s.healthKv}>
          <dt>Calls every</dt>
          <dd>{ms(h.periodMs)}</dd>
          <dt>Worst gap, 10 s</dt>
          <dd data-tone={h.worstGapMs > h.periodMs * 1.5 + 1 ? 'warn' : undefined}>{ms(h.worstGapMs)}</dd>
          <dt>Busiest call</dt>
          <dd data-tone={h.worstWorkMs > h.periodMs * 0.5 ? 'warn' : undefined}>{h.worstWorkMs < 0.1 ? '<0.1 ms' : ms(h.worstWorkMs)}</dd>
          <dt>Late calls</dt>
          <dd data-tone={h.late ? 'warn' : undefined}>{h.late}</dd>
          <dt>Windows glitches</dt>
          <dd data-tone={h.glitches ? 'warn' : undefined}>{h.glitches}</dd>
          <dt>Restarts</dt>
          <dd data-tone={h.restarts ? 'bad' : undefined}>{h.restarts}</dd>
        </dl>
      ) : (
        <p className={s.desc} style={{ margin: 0 }}>
          Not open.
        </p>
      )}
    </div>
  );
}

function Buffer({ b }: { b: BufferHealth | null }) {
  return (
    <div className={s.healthCard} data-accent="green">
      <div className={s.healthTitle}>Buffer</div>
      {b ? (
        <dl className={s.healthKv}>
          <dt>Holds</dt>
          <dd>{ms(b.targetMs)}</dd>
          <dt>Worst need, 30 s</dt>
          <dd>{ms(b.neededMs)}</dd>
          <dt>Margin</dt>
          <dd>{ms(b.marginMs)}</dd>
          <dt>Closest call</dt>
          <dd data-tone={b.lowestMs < 0 ? 'bad' : b.lowestMs < b.marginMs ? 'warn' : undefined}>{b.lowestMs < 0 ? 'short ' + ms(-b.lowestMs) : ms(b.lowestMs) + ' left'}</dd>
          <dt>Ran dry</dt>
          <dd data-tone={b.underruns ? 'warn' : undefined}>{b.underruns ? times(b.underruns) + ', last short ' + ms(b.lastShortMs) : 'never'}</dd>
          <dt>Clock drift</dt>
          <dd>{(b.driftPpm >= 0 ? '+' : '') + b.driftPpm.toFixed(0) + ' ppm'}</dd>
        </dl>
      ) : (
        <p className={s.desc} style={{ margin: 0 }}>
          Sized once the speakers open.
        </p>
      )}
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const SOURCE: Record<EngineEvent['source'], string> = { input: 'Input', output: 'Speakers', buffer: 'Buffer', engine: 'Engine' };

/**
 * The engine's own account of what it is doing: per-stream timing, how the buffer between the
 * guitar and the speakers sized itself, and recent events. Fed by the engine's telemetry.
 */
export function EngineHealth() {
  const { t, version } = useStore(useShallow((x) => ({ t: x.telemetry, version: x.engine.engineVersion })));
  // An engine from before telemetry never sends any: say so rather than wait forever.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(id);
  }, []);
  // When the speakers last ran dry, from the underrun count going up.
  const dry = useRef({ n: -1, at: 0 });
  const n = t?.buffer?.underruns ?? 0;
  if (n !== dry.current.n) dry.current = { n, at: dry.current.n >= 0 && n > dry.current.n ? Date.now() : dry.current.at };
  const recentDry = Date.now() - dry.current.at < 60000;

  const [status, tone]: [string, Tone] = t ? verdict(t, recentDry) : waited ? ['Update the engine to see this', 'warn'] : ['Waiting for figures', undefined];
  const events = t ? [...t.events].reverse() : [];
  const problems = t ? t.events.filter((e) => e.level !== 'info' && Date.now() - e.at < 5 * 60000).length : 0;

  return (
    <>
      <Section
        title="Engine health"
        status={status}
        tone={tone}
        desc="How the engine keeps time, live. The buffer between the guitar and the speakers measures the worst moment it has to cover, holds that plus a small margin, and shrinks again when things calm down."
      >
        {t ? (
          <div className={s.health}>
            <Stream title="Guitar input" h={t.input} tone="gold" />
            <Buffer b={t.buffer} />
            <Stream title="Speakers" h={t.output} tone="red" />
          </div>
        ) : (
          <p className={s.desc} style={{ margin: 0 }}>
            {waited ? 'This engine (' + (version || 'unknown') + ') does not report its timing. Install the latest from Download above; the installer replaces it.' : 'Shown once the engine reports in.'}
          </p>
        )}
      </Section>
      <Section
        title="Engine events"
        status={t ? (problems ? problems + (problems === 1 ? ' warning' : ' warnings') + ' in 5 min' : 'All quiet') : ''}
        tone={t ? (problems ? 'warn' : 'ok') : undefined}
        desc="What the engine did and ran into, newest first: devices opening and the modes they got, the speakers running dry, the buffer resizing, errors."
      >
        <ol className={s.events} aria-label="Engine events">
          {events.map((e) => (
            <li key={e.seq} className={s.event} data-level={e.level}>
              <span className={s.eventTime}>{clock(e.at)}</span>
              <span className={s.eventSource}>{SOURCE[e.source] ?? e.source}</span>
              <span className={s.eventText}>
                {e.text}
                {e.repeat > 1 && <span className={s.eventRepeat}>{' ×' + e.repeat}</span>}
              </span>
            </li>
          ))}
          {!events.length && <li className={s.desc}>Nothing yet.</li>}
        </ol>
      </Section>
    </>
  );
}
