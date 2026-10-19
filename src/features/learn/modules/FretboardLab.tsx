import { useEffect, useState } from 'react';
import { Button, Fretboard, Note, Panel, Readout, Segment, Switch, Window, type FretMark } from '../../../ui';
import { CHROM, marksFor, noteAt, RootPicker } from './shared';
import s from './Mock.module.css';

type Scale = 'pent' | 'major' | 'blues' | 'dorian';
const SCALES: Record<Scale, [string, number[], string]> = {
  pent: ['Pentatonic', [0, 3, 5, 7, 10], 'minor pentatonic'],
  major: ['Major', [0, 2, 4, 5, 7, 9, 11], 'major'],
  blues: ['Blues', [0, 3, 5, 6, 7, 10], 'blues'],
  dorian: ['Dorian', [0, 2, 3, 5, 7, 9, 10], 'dorian'],
};
/** Quiz targets: string, fret, note, string name. */
const TARGETS: Array<[number, number, string, string]> = [
  [1, 3, 'C', 'A'],
  [2, 5, 'G', 'D'],
  [0, 8, 'C', 'low E'],
  [3, 7, 'D', 'G'],
  [4, 1, 'C', 'B'],
];
type Show = 'notes' | 'intervals' | 'dots';

export default function FretboardLab() {
  const [root, setRoot] = useState('A');
  const [scale, setScale] = useState<Scale>('pent');
  const [mode, setMode] = useState<Show>('notes');
  const [quiz, setQuiz] = useState(false);
  const [q, setQ] = useState(0);
  const [pick, setPick] = useState<{ s: number; f: number; ok: boolean } | null>(null);
  const [streak, setStreak] = useState(7);
  const target = TARGETS[q % TARGETS.length];
  const [, ivs, full] = SCALES[scale];
  const r = CHROM.indexOf(root);

  // A right answer moves on after a moment.
  useEffect(() => {
    if (!pick?.ok) return;
    const t = setTimeout(() => {
      setQ((x) => x + 1);
      setPick(null);
    }, 700);
    return () => {
      clearTimeout(t);
    };
  }, [pick]);

  const marks: FretMark[] = quiz ? (pick ? [{ s: pick.s, f: pick.f, tone: pick.ok ? 'heard' : 'dim', note: noteAt(pick.s, pick.f) }] : []) : marksFor(r, ivs, 12, [3, 4, 7]);
  const tap = (st: number, f: number) => {
    if (!quiz) return;
    const ok = st === target[0] && f === target[1];
    setPick({ s: st, f, ok });
    setStreak(ok ? streak + 1 : 0);
  };

  return (
    <div className={s.stack}>
      <Panel title="Fretboard" lamp={quiz ? 'live' : undefined} pulse={quiz} meta={quiz ? 'Quiz · tap the note I name' : `${root} ${full} · 12 frets`} flex="0 0 auto">
        <Window surface="glass">
          <Fretboard frets={12} from={1} rowH={34} marks={marks} mode={mode} onTap={quiz ? tap : undefined} />
        </Window>
        <div className={s.readouts}>
          {quiz ? (
            <>
              <Readout label="Find" value={target[2]} sub={`on the ${target[3]} string`} tone="on" />
              <Readout label="Last pick" value={pick ? (pick.ok ? 'RIGHT' : noteAt(pick.s, pick.f)) : '·'} sub={pick ? (pick.ok ? 'next one coming' : 'not quite') : 'tap a fret'} />
              <Readout label="Streak" value={streak} unit="in a row" tone="ok" />
              <Readout label="Best" value="14" />
            </>
          ) : (
            <>
              <Readout label="Key" value={root} sub={full} tone="on" />
              <Readout label="Notes" value={ivs.map((iv) => CHROM[(r + iv) % 12]).join(' ')} sub={`${ivs.length} notes`} size="sm" />
              <Readout label="Chord tones" value="3" unit="lit teal" tone="ok" />
              <Readout label="Positions" value="5" unit="boxes" />
            </>
          )}
        </div>
      </Panel>
      <Panel surface="ivory" title="Explore" meta="Amber is the root · teal are chord tones · ivory fills the scale">
        <div className={s.grid} style={{ gap: '14px 22px', padding: '0 4px', alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
          <div className={s.list} style={{ padding: 0 }}>
            <div className={s.heading}>Key</div>
            <RootPicker label="Key" value={root} onChange={setRoot} />
          </div>
          <div className={s.list} style={{ padding: 0 }}>
            <div className={s.heading}>Scale and display</div>
            <Segment label="Scale" surface="ivory" options={(Object.keys(SCALES) as Scale[]).map((id) => ({ id, label: SCALES[id][0] }))} value={scale} onChange={setScale} />
            <div className={s.row} style={{ padding: 0 }}>
              <Segment label="Show" surface="ivory" options={(['notes', 'intervals', 'dots'] as Show[]).map((id) => ({ id, label: id }))} value={mode} onChange={setMode} />
              <Switch
                surface="ivory"
                tone="live"
                labelSide="left"
                label="Quiz me"
                on={quiz}
                onToggle={(v) => {
                  setQuiz(v);
                  setPick(null);
                }}
              />
            </div>
          </div>
          <div className={s.list} style={{ padding: 0 }}>
            <div className={s.heading}>In context</div>
            <Note>
              Over <strong>Am</strong>, the A feels at rest. Over <strong>F</strong>, that same A is the 3rd and leans forward. Play the scale while the band holds each chord and listen for the difference.
            </Note>
            <div className={s.buttons}>
              <Button variant="primary" grow>
                Play the scale
              </Button>
              <Button variant="dark">Band holds Am</Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
