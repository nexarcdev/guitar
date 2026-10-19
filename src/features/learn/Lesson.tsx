import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChordChart, Knob, Lamp, Panel, Segment, SkillRing, Switch, Window, Button, Note, cx } from '../../ui';
import { BPM_MAX, BPM_MIN, LESSON, loadSkills, position, setBpm, skillsOf, start, statsOf, stop, tick } from './lesson';
import { useLearn } from './state';
import s from './Lesson.module.css';

const N = LESSON.chords.length;
const STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'];

/** Lesson 4: play G, Em, C, D along with the click; the paper follows and scores each change. */
export function Lesson() {
  const { view, bpm, countIn, playing, bar, beat, results, skills } = useLearn(
    useShallow((x) => ({ view: x.view, bpm: x.bpm, countIn: x.countIn, playing: x.playing, bar: x.bar, beat: x.beat, results: x.results, skills: x.skills })),
  );
  const progHead = useRef<HTMLDivElement>(null);
  const tabHead = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSkills();
  }, []);
  // Leaving the lesson stops the click (and keeps the run's scores).
  useEffect(() => {
    return () => {
      stop(true);
    };
  }, []);

  // The playheads move every frame through refs; bar and beat change in state once a beat.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      tick();
      const pos = position();
      const inPass = ((pos % N) + N) % N;
      const show = pos >= 0 ? '1' : '0';
      for (const el of [progHead.current, tabHead.current]) {
        if (!el) continue;
        el.style.opacity = show;
        el.style.left = (inPass / N) * 100 + '%';
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing]);

  const counting = playing && bar < 0;
  const now = bar >= 0 ? bar % N : 0;
  const next = (now + 1) % N;
  const pass = bar >= 0 ? Math.floor(bar / N) : 0;
  const passStart = pass * N;
  const stats = statsOf(results, playing ? Math.max(0, bar) : results.length ? Math.max(...results.map((r) => r.bar)) + 1 : 0, bpm);
  const live = playing || results.length > 0;
  const shown = skillsOf(results, bpm) ?? skills ?? { openChords: 0, changes: 0, timing: 0 };
  const win = (60 / bpm) * 250;

  const meta = counting ? `Count-in · ${bpm} BPM` : playing ? `Pass ${pass + 1} of ${LESSON.passes} · bar ${now + 1} of ${N}` : results.length ? 'Stopped' : 'Ready';

  /** Beat dots for bar i of the pass on screen. */
  const dots = (i: number) => {
    const g = passStart + i;
    const r = results.find((x) => x.bar === g);
    const changeTone = g === 0 ? 'dotPlayed' : r?.ok && r.offsetMs != null && Math.abs(r.offsetMs) <= win ? 'dotPlayed' : 'dotLate';
    return [0, 1, 2, 3].map((b) => {
      if (!playing || bar < 0 || g > bar) return 'dotIdle';
      if (g === bar && b === beat) return 'dotNow';
      if (g === bar && b > beat) return 'dotIdle';
      return b === 0 ? changeTone : 'dotPlayed';
    });
  };

  return (
    <div className={s.grid}>
      <Panel title={LESSON.title} lamp={playing ? 'live' : 'off'} pulse={playing} meta={meta} minHeight={560}>
        <Window surface="paper" gap={16}>
          <div className={s.head}>
            <div>
              <div className={s.kicker}>{LESSON.part}</div>
              <div className={s.title}>{LESSON.chords.map((c) => c.name).join(' · ')}</div>
            </div>
            <div className={s.meta}>
              Key of {LESSON.key} · {LESSON.meter} · {bpm} BPM
            </div>
          </div>

          {view === 'charts' ? (
            <div className={s.charts}>
              {LESSON.chords.map((c, i) => {
                const tag = i === now ? 'Now' : i === next ? 'Next' : '';
                return (
                  <div key={c.name} className={cx(s.chart, i === now && s.now, i === next && s.next)}>
                    <ChordChart chord={c.name} sub={c.sub} frets={c.frets} fingers={c.fingers} width={112} flat />
                    <span className={s.tag} aria-hidden={!tag}>
                      {tag}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <TabView now={playing && bar >= 0 ? now : -1} beat={beat} headRef={tabHead} playing={playing} />
          )}

          <div className={s.progress}>
            <div className={s.progLabels}>
              <span>
                Progression · bar {now + 1} of {N}
              </span>
              <span>
                Changes landed: <span className={s.ok}>{stats.onTime}</span> / {stats.changes} on time
              </span>
            </div>
            <div className={s.bars}>
              {LESSON.chords.map((c, i) => (
                <div key={c.name} className={cx(s.bar, playing && bar >= 0 && i === now && s.barNow, playing && passStart + i < bar && s.barDone)}>
                  <span className={s.barName}>{c.name}</span>
                  <span className={s.beats}>
                    {dots(i).map((d, b) => (
                      <span key={b} className={cx(s.dot, s[d])} />
                    ))}
                  </span>
                </div>
              ))}
              <div ref={progHead} className={s.playhead} style={{ opacity: playing ? undefined : 0 }} />
            </div>
          </div>
        </Window>
      </Panel>

      <div className={s.side}>
        <Panel surface="ivory" title="Your skills" meta={live ? 'Updated as you play' : skills ? 'From your last run' : 'Play along to score'} flex="0 0 auto">
          <div className={s.rings}>
            <SkillRing label="Open chords" score={shown.openChords} size={88} color="#1f8c7c" labelColor="#6b5636" />
            <SkillRing label="Chord changes" score={shown.changes} size={88} color="#d9902a" labelColor="#6b5636" />
            <SkillRing label="Timing" score={shown.timing} size={88} color="#1f8c7c" labelColor="#6b5636" />
          </div>
        </Panel>
        <Panel surface="ivory" title="Play along">
          <div className={s.row}>
            <Segment
              label="View"
              surface="ivory"
              options={[
                { id: 'charts', label: 'Charts' },
                { id: 'tab', label: 'Tab' },
              ]}
              value={view}
              onChange={(v) => useLearn.setState({ view: v })}
            />
            <Switch surface="ivory" labelSide="left" label="Count-in" on={countIn} onToggle={(v) => useLearn.setState({ countIn: v })} />
          </div>
          <div className={s.knobs}>
            <Knob label={`Tempo · ${bpm}`} ariaLabel="Tempo" valueText={`${bpm} BPM`} value={bpm} min={BPM_MIN} max={BPM_MAX} onChange={setBpm} size={78} cap="cream" color="#d9902a" labelColor="#6b5636" />
          </div>
          <div className={s.buttons}>
            <Button variant={playing ? 'danger' : 'primary'} size="lg" grow onClick={() => (playing ? stop(true) : start())}>
              <Lamp tone="on" color={playing ? '#fff3ee' : '#1c1612'} size={10} pulse={playing} glow={false} />
              {playing ? 'Stop' : 'Play along'}
            </Button>
            <Button variant="dark" size="lg" disabled={bpm <= BPM_MIN} onClick={() => setBpm(bpm - 8)}>
              Slower
            </Button>
          </div>
          <Note className={s.upNext}>
            <div className={s.upNextHead}>Up next</div>
            {LESSON.next.map((x, i) => (
              <div key={x.title} className={s.nextRow}>
                <span className={cx(s.nextDot, i === 0 && s.nextFirst)} />
                <span className={i === 0 ? s.nextTitle : undefined}>{x.title}</span>
                <span className={s.nextMeta}>{x.meta}</span>
              </div>
            ))}
          </Note>
        </Panel>
      </div>
    </div>
  );
}

/** The progression as tab: each chord held for a bar, strummed on every beat. */
function TabView({ now, beat, headRef, playing }: { now: number; beat: number; headRef: React.RefObject<HTMLDivElement | null>; playing: boolean }) {
  return (
    <div className={s.tab}>
      <div className={s.tabHeads}>
        <span />
        {LESSON.chords.map((c, i) => (
          <div key={c.name} className={s.tabHead}>
            <span className={cx(s.tabName, i === now && s.tabNameNow)}>{c.name}</span>
            <span className={s.tabTag}>{i === now ? 'NOW' : now >= 0 && i === (now + 1) % N ? 'NEXT' : ''}</span>
          </div>
        ))}
      </div>
      <div className={s.staff}>
        <div className={s.strings}>
          {STRINGS.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
        <div className={s.cols}>
          {LESSON.chords.flatMap((c, i) =>
            [0, 1, 2, 3].map((b) => {
              const isNow = i === now && b === beat;
              const played = now >= 0 && (i < now || (i === now && b < beat));
              return (
                <div key={`${i}-${b}`} className={cx(s.col, b === 0 && s.colBar, isNow && s.colNow)}>
                  {[5, 4, 3, 2, 1, 0].map((str) => {
                    const f = c.frets[str];
                    return (
                      <div key={str} className={s.cell}>
                        <span className={cx(s.fret, b !== 0 && !isNow && s.fretFaint, isNow && s.fretNow, played && s.fretPlayed)}>{f < 0 ? '×' : f}</span>
                      </div>
                    );
                  })}
                  <span className={cx(s.strum, played && s.strumPlayed, isNow && s.strumNow)}>↓</span>
                </div>
              );
            }),
          )}
          <div ref={headRef} className={s.tabPlayhead} style={{ opacity: playing ? undefined : 0 }} />
        </div>
      </div>
    </div>
  );
}
