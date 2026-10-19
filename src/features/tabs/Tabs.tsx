import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { engine } from '../../audio/engine';
import { openStrings, sameSetup, setupStr, stringLabel, STD_SETUP } from '../../theory/music';
import {
  BEATS_PER_BAR, estBeat, fmtTime, layoutLive, nowPos, plural, riffDur, spanEnd, spanFor,
  type Layout, type SaveKind, type TabNote, type TimeSig,
} from '../../theory/stream';
import type { Riff } from '../../state/db';
import { Button, Chip, Note, Panel, Segment, Well, Window, cx } from '../../ui';
import s from './Tabs.module.css';

const PPS = 130;
const LEFT = 48;
const LINE0 = 24;
const GAP = 26;
const ORIGIN = LEFT + 0.3 * PPS;
const yOf = (str: number) => LINE0 + (5 - str) * GAP;
const X = (p: number) => Math.round(ORIGIN + p * PPS);
const SAVE_OPTS: Array<[SaveKind, string]> = [[2, '2 bars'], [4, '4 bars'], [8, '8 bars'], ['phrase', 'Phrase']];
/** Staff height: six lines with a margin above and below. */
const STAFF_H = LINE0 * 2 + 5 * GAP;

export function Tabs() {
  const st = useStore(
    useShallow((x) => ({
      buf: x.buf, riffs: x.riffs, curRiff: x.curRiff, rplaying: x.rplaying, hoverSpan: x.hoverSpan, toast: x.toast,
      listening: x.listening, live: x.engine.mic === 'live' && x.engine.running, ml: x.engine.ml, setup: x.setup,
      timeSig: x.timeSig, gapBeats: x.gapBeats, settingsOpen: x.streamSettingsOpen,
    })),
  );
  const { buf, riffs, curRiff, rplaying, hoverSpan, toast, listening: L, live, ml, setup, timeSig, gapBeats } = st;
  const riff = curRiff ? riffs.find((r) => r.id === curRiff) ?? null : null;
  const isRiff = !!riff;
  const isLive = !isRiff;
  const notes: TabNote[] = isRiff ? riff.notes : buf;

  const beat = estBeat(buf);
  const bpm = Math.round(60 / beat);
  const barSec = beat * (BEATS_PER_BAR[timeSig] ?? 4);
  const gapSec = Math.max(1.2, beat * gapBeats);

  const layout: Layout = useMemo(
    () =>
      isLive
        ? layoutLive(notes, gapSec)
        : { pos: notes.map((n) => n.t), divs: [], segStart: 0, lastPos: notes.length ? notes[notes.length - 1].t : 0, lastT: 0 },
    [notes, gapSec, isLive],
  );

  const [vpW, setVpW] = useState(600);
  const [resting, setResting] = useState(false);
  const vpRef = useRef<HTMLDivElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const brRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const mode: 'live' | 'play' | 'scroll' = isLive && L ? 'live' : isRiff && rplaying ? 'play' : 'scroll';
  const hasNotes = notes.length > 0;
  const clock = engine.clock();
  const restNow = isLive && hasNotes && clock - layout.lastT > gapSec;
  const divs = restNow ? [...layout.divs, layout.lastPos + gapSec / 2] : layout.divs;
  const span = isLive ? nowPos(layout, hasNotes, clock, gapSec) : riffDur(notes);
  const innerW = mode === 'scroll' ? Math.max(vpW, ORIGIN + (span + 0.6) * PPS + 40) : vpW;
  const phraseStart = hasNotes && isLive ? layout.pos[layout.segStart] - 0.25 : 0;

  const br = isLive && hoverSpan != null ? spanFor(layout, hoverSpan, spanEnd(layout, hasNotes, clock, gapSec), barSec) : null;
  const showBracket = !!br && br.idx.length > 0;

  // Latest values for the animation loop, which runs outside React.
  const m = useRef({ mode, hasNotes, layout, gapSec, barSec, hoverSpan, phraseStart, vpW, resting, dur: riffDur(notes) });
  m.current = { mode, hasNotes, layout, gapSec, barSec, hoverSpan: showBracket ? hoverSpan : null, phraseStart, vpW, resting, dur: riffDur(notes) };

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = trackRef.current;
      const c = m.current;
      if (!el) return;
      let tx = 0;
      if (c.mode === 'live') {
        const now = engine.clock();
        const d = c.hasNotes ? now - c.layout.lastT : 0;
        const rest = c.hasNotes && d > c.gapSec;
        if (rest !== c.resting) setResting(rest);
        const np = nowPos(c.layout, c.hasNotes, now, c.gapSec);
        tx = c.vpW - 48 - ORIGIN - np * PPS;
        const b = brRef.current;
        if (b && c.hoverSpan != null) {
          const end = rest ? c.layout.lastPos + 0.35 : np;
          const start = c.hoverSpan === 'phrase' ? c.phraseStart : Math.max(c.phraseStart, end - c.hoverSpan * c.barSec);
          b.style.left = (ORIGIN + start * PPS).toFixed(1) + 'px';
          b.style.width = Math.max(8, (end - start) * PPS).toFixed(1) + 'px';
        }
      } else if (c.mode === 'play') {
        const t = actions.playhead();
        tx = c.vpW * 0.3 - ORIGIN - t * PPS;
        if (timeRef.current) timeRef.current.textContent = fmtTime(Math.max(0, t)) + ' / ' + fmtTime(c.dur);
      }
      el.style.transform = 'translateX(' + tx.toFixed(1) + 'px)';
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.clientWidth && setVpW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Paused: land on the latest notes. Live/playing: the track is transformed, so reset scroll.
  useEffect(() => {
    const sc = scRef.current;
    if (!sc) return;
    if (mode === 'scroll' && isLive) requestAnimationFrame(() => (sc.scrollLeft = sc.scrollWidth));
    else sc.scrollLeft = 0;
  }, [mode, isLive]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), Math.max(0, toast.until - performance.now()));
    return () => clearTimeout(t);
  }, [toast]);

  // Notes only re-render when the list changes. ML replacements of notes already on screen don't re-flash.
  const prevNotes = useRef<TabNote[]>([]);
  useEffect(() => {
    prevNotes.current = notes;
  }, [notes]);
  const noteEls = useMemo(() => {
    const prev = prevNotes.current;
    const seen = new Set(prev);
    const dim = ml === 'ready';
    return notes.map((n, i) => {
      const fresh = mode === 'live' && !seen.has(n) && (n.p || !prev.some((q) => Math.abs(q.t - n.t) < 0.15));
      return (
        <div
          key={n.t + ':' + n.s + ':' + (n.p ? 'p' : 'm')}
          className={cx(s.note, fresh && s.noteLive, n.p && dim && s.noteGuess)}
          style={{ left: X(layout.pos[i]), top: yOf(n.s) }}
        >
          {n.f}
        </div>
      );
    });
  }, [notes, layout, mode, ml]);

  const saveSpan = (k: SaveKind) => {
    const sp = spanFor(layout, k, spanEnd(layout, hasNotes, engine.clock(), gapSec), barSec);
    if (!sp || !sp.idx.length) return;
    actions.saveRiff(sp.idx.map((i) => notes[i]), k === 'phrase' ? 'whole phrase' : plural(sp.bars, 'bar'), sp.idx.length);
  };

  const T = openStrings(setup.offsets);
  const rs = riff ? riff.setup ?? STD_SETUP : null;
  const mismatch = !!rs && !sameSetup(rs, setup);
  const canSave = isLive && buf.length > 0;
  const chipTone = isRiff ? (rplaying ? 'on' : 'muted') : L && live ? 'live' : 'muted';
  const chipText = isRiff ? (rplaying ? fmtTime(actions.playhead()) + ' / ' + fmtTime(riffDur(notes)) : fmtTime(riffDur(notes))) : !L ? 'PAUSED' : live ? 'LIVE' : 'NO INPUT';
  const mlNote =
    ml === 'loading' ? ' · Loading chord detection'
    : ml === 'slow' ? ' · This device can’t run chord detection in real time, so single notes only'
    : ml === 'unavailable' ? ' · Chord detection isn’t available in this browser, so single notes only'
    : '';

  const title = isRiff ? riff.name : L ? 'Everything you play' : hasNotes ? 'Paused, scroll back through it' : 'Paused';
  const meta = isRiff
    ? plural(riff.notes.length, 'note') + ' · ' + fmtTime(riffDur(riff.notes))
    : buf.length
      ? '~' + bpm + ' BPM · ' + timeSig + ' · ' + plural(buf.length, 'note') + ' kept'
      : timeSig + ' · last 60 s';

  return (
    <div className={s.page}>
      <Panel
        title={isRiff ? 'Saved riff' : 'Rolling riff · last 60 s'}
        lamp={isLive ? (L && live ? 'live' : 'off') : rplaying ? 'on' : 'off'}
        pulse={isLive && L && live}
        minHeight={560}
        meta={
          <>
            {canSave && (
              <div className={s.save} role="group" aria-label="Save">
                <span className={s.saveLabel}>Save</span>
                {SAVE_OPTS.map(([k, label]) => (
                  <button
                    key={label}
                    className={s.saveBtn}
                    aria-label={'Save the last ' + label.toLowerCase()}
                    onClick={() => saveSpan(k)}
                    onPointerEnter={() => useStore.setState({ hoverSpan: k })}
                    onPointerLeave={() => useStore.setState({ hoverSpan: null })}
                    onFocus={() => useStore.setState({ hoverSpan: k })}
                    onBlur={() => useStore.setState({ hoverSpan: null })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <Chip tone={chipTone} pulse={isLive && L && live} label={<span ref={timeRef}>{chipText}</span>} />
            {isLive && <StreamSettings timeSig={timeSig} gapBeats={gapBeats} open={st.settingsOpen} />}
          </>
        }
      >
        {mismatch && rs && (
          <div className={s.notice}>
            <span>{'Recorded in ' + setupStr(rs) + '. Your guitar is in ' + setupStr(setup) + '.'}</span>
            <Button variant="primary" size="sm" onClick={() => actions.saveSetup({ offsets: rs.offsets, capo: rs.capo })}>
              Set my guitar up like this
            </Button>
          </div>
        )}
        <Window surface="paper" title={title} titleSize={26} meta={meta}>
          <div ref={vpRef} className={s.vp} style={{ height: STAFF_H }}>
            {T.map((_, i) => (
              <div key={i} className={s.line} style={{ top: yOf(i) }} />
            ))}
            <div className={s.labels}>
              {T.map((x, i) => (
                <div key={i} className={s.label} style={{ top: yOf(i) }}>
                  {stringLabel(x.note, i)}
                </div>
              ))}
            </div>
            {((isLive && L) || (isRiff && rplaying)) && <div className={s.nowLine} style={{ left: isLive ? vpW - 48 : Math.round(vpW * 0.3) }} />}
            <div ref={scRef} className={s.scroller} style={{ overflowX: mode === 'scroll' ? 'auto' : 'hidden' }}>
              <div ref={trackRef} className={s.track} style={{ width: Math.round(innerW) }}>
                {divs.map((p, i) => (
                  <div key={i} className={s.divider} style={{ left: X(p) }} />
                ))}
                {showBracket && br && (
                  <div ref={brRef} className={s.bracket} style={{ left: X(br.start), width: Math.max(8, Math.round((br.end - br.start) * PPS)) }}>
                    <div className={s.bracketLabel}>{(hoverSpan === 'phrase' ? 'Whole phrase' : plural(br.bars, 'bar')) + ' · ' + plural(br.idx.length, 'note')}</div>
                  </div>
                )}
                {noteEls}
              </div>
            </div>
            {toast && <div className={s.toast}>{toast.text}</div>}
            {!hasNotes && (
              <div className={s.empty}>
                <div className={s.emptyMsg}>
                  {!L
                    ? 'Listening is paused. Resume in the top bar to keep capturing.'
                    : live
                      ? 'Just play. Every note lands here as you play it, and the last minute is always kept.'
                      : 'Waiting for your guitar. Once the microphone is on, every note lands here.'}
                </div>
              </div>
            )}
          </div>
          <div className={s.foot}>
            {isLive ? (
              <>
                <div className={s.footText}>
                  <div className={s.takeTitle}>{resting && L ? 'Resting · stream paused' : L ? 'Always recording' : 'Listening paused'}</div>
                  <div className={s.takeInfo}>
                    {(buf.length ? 'Hover or focus a save button to see which bars it keeps' : 'Keeps the last minute of whatever you play · stop for a few beats and the stream pauses') + mlNote}
                  </div>
                </div>
                <Button variant="paper" size="sm" disabled={!canSave} onClick={() => useStore.setState({ buf: [], hoverSpan: null })}>
                  Clear
                </Button>
              </>
            ) : (
              riff && (
                <>
                  <button className={s.bigPlay} data-on={rplaying} aria-label={rplaying ? 'Pause' : 'Play'} onClick={actions.togglePlay}>
                    {rplaying ? '❚❚' : '▶'}
                  </button>
                  <div className={s.footText}>
                    <div className={s.takeTitle}>{plural(riff.notes.length, 'note') + ' · ' + fmtTime(riffDur(riff.notes))}</div>
                    <div className={s.takeInfo}>{'Saved ' + dateLabel(riff)}</div>
                  </div>
                  <Button variant="paper" size="sm" onClick={actions.closeRiff}>
                    ● Back to live
                  </Button>
                </>
              )
            )}
          </div>
        </Window>
      </Panel>
      <RiffList />
    </div>
  );
}

const dateLabel = (r: Riff) => new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function StreamSettings({ timeSig, gapBeats, open }: { timeSig: TimeSig; gapBeats: number; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) useStore.setState({ streamSettingsOpen: false });
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && useStore.setState({ streamSettingsOpen: false });
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant="dark" size="sm" icon className={s.gear} aria-label="Stream settings" aria-expanded={open} onClick={() => useStore.setState({ streamSettingsOpen: !open })}>
        ⚙
      </Button>
      {open && (
        <div className={s.pop} role="dialog" aria-label="Stream settings">
          <div className={s.popRow}>
            <div className={s.popLabel}>Time signature</div>
            <Segment label="Time signature" options={['4/4', '3/4', '6/8'] as const} value={timeSig} onChange={(t) => useStore.setState({ timeSig: t })} />
          </div>
          <div className={s.popRow}>
            <div className={s.popLabel}>Pause after</div>
            <div className={s.stepper}>
              <Button variant="dark" size="sm" icon aria-label="Fewer beats" disabled={gapBeats <= 1} onClick={() => useStore.setState({ gapBeats: gapBeats - 1 })}>
                −
              </Button>
              <span className={s.stepValue}>{plural(gapBeats, 'beat')}</span>
              <Button variant="dark" size="sm" icon aria-label="More beats" disabled={gapBeats >= 8} onClick={() => useStore.setState({ gapBeats: gapBeats + 1 })}>
                +
              </Button>
            </div>
            <div className={s.popNote}>Stop playing for this many beats of rest and the stream pauses with a divider. Saves never cross a divider.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RiffList() {
  const { riffs, riffTab, curRiff, rplaying } = useStore(useShallow((x) => ({ riffs: x.riffs, riffTab: x.riffTab, curRiff: x.curRiff, rplaying: x.rplaying })));
  const fileRef = useRef<HTMLInputElement>(null);
  const saved = useMemo(() => riffs.filter((r) => !r.deletedAt).sort((a, b) => b.ts - a.ts), [riffs]);
  const deleted = useMemo(() => riffs.filter((r) => r.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!), [riffs]);
  const onDeleted = riffTab === 'deleted';
  const rows = onDeleted ? deleted : saved;

  const meta = (r: Riff) =>
    plural(r.notes.length, 'note') + ' · ' + fmtTime(riffDur(r.notes)) + ' · ' + dateLabel(r) +
    (r.setup && !sameSetup(r.setup, STD_SETUP) ? ' · ' + setupStr(r.setup) : '');

  return (
    <Panel surface="ivory" aria-label="Riffs" minHeight={560}>
      <div className={s.listHead}>
        <Segment
          label="Riffs"
          surface="ivory"
          options={[
            { id: 'saved', label: 'Saved', n: saved.length },
            { id: 'deleted', label: 'Deleted', n: deleted.length },
          ]}
          value={riffTab}
          onChange={(id) => useStore.setState({ riffTab: id })}
        />
        <div className={s.listActions}>
          {onDeleted ? (
            <Button variant="danger" size="sm" disabled={deleted.length === 0} onClick={actions.emptyDeleted}>
              Empty deleted
            </Button>
          ) : (
            <>
              <Button variant="cream" size="sm" onClick={() => fileRef.current?.click()}>
                Import
              </Button>
              <Button variant="cream" size="sm" disabled={saved.length === 0} onClick={actions.exportRiffs}>
                Export
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) actions.importRiffs(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      </div>
      {rows.length === 0 && (
        <Note>{onDeleted ? 'Nothing deleted. Removed riffs wait here until you empty the list.' : 'Nothing saved yet. Play something, then tap a save button above the stream.'}</Note>
      )}
      <div className={s.rows}>
        {rows.map((r) => {
          const active = r.id === curRiff;
          const pl = active && rplaying;
          const d = riffDur(r.notes);
          const dots = r.notes.slice(0, 80).map((n, i) => (
            <span key={i} className={s.stripDot} style={{ left: Math.min(97, (n.t / Math.max(d, 0.1)) * 96 + 1) + '%', top: 1 + (5 - n.s) * 5 }} />
          ));
          if (onDeleted)
            return (
              <Well key={r.id} className={cx(s.row, s.deleted)}>
                <div className={s.deletedName}>
                  <div className={s.rowName}>{r.name}</div>
                  <div className={s.meta}>{meta(r)}</div>
                </div>
                <div className={s.strip}>{dots}</div>
                <div className={s.rowActions}>
                  <Button variant="cream" size="sm" onClick={() => actions.restoreRiff(r.id)}>
                    Restore
                  </Button>
                  <Button variant="danger" size="sm" icon aria-label="Delete forever" title="Delete forever" onClick={() => actions.forgetRiff(r.id)}>
                    ✕
                  </Button>
                </div>
              </Well>
            );
          return (
            <Well
              key={r.id}
              className={s.row}
              active={active}
              role="button"
              tabIndex={0}
              aria-label={'Open ' + r.name}
              aria-current={active || undefined}
              onClick={() => !active && actions.openRiff(r.id, false)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                  e.preventDefault();
                  if (!active) actions.openRiff(r.id, false);
                }
              }}
            >
              <button
                className={s.rowPlay}
                data-on={pl}
                aria-label={pl ? 'Pause' : 'Play ' + r.name}
                onClick={(e) => {
                  e.stopPropagation();
                  if (active) actions.togglePlay();
                  else actions.openRiff(r.id, true);
                }}
              >
                {pl ? '❚❚' : '▶'}
              </button>
              <div style={{ minWidth: 0 }}>
                <input
                  key={r.name}
                  className={s.name}
                  data-active={active}
                  type="text"
                  defaultValue={r.name}
                  aria-label="Riff name"
                  title="Click to rename"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.currentTarget.value = r.name;
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={(e) => e.target.value !== r.name && actions.renameRiff(r.id, e.target.value)}
                />
                <div className={s.meta}>{meta(r)}</div>
              </div>
              <div className={s.strip}>{dots}</div>
              <button
                className={s.x}
                aria-label="Delete riff"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.deleteRiff(r.id);
                }}
              >
                ✕
              </button>
            </Well>
          );
        })}
      </div>
      <Note className={s.help}>
        <strong>Saving a span</strong> keeps those bars as a riff. Hover a save button to see which bars it takes; saves never cross a rest divider.
      </Note>
    </Panel>
  );
}
