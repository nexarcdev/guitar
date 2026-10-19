import { useState } from 'react';
import { Button, Lamp, Note, Panel, Readout, Segment, Switch, Window, WellButton, type LampTone } from '../../../ui';
import s from './Mock.module.css';
import e from './Ear.module.css';

const INTERVALS: Array<[string, string]> = [
  ['m2', '1 fret'],
  ['M2', '2 frets'],
  ['m3', '3 frets'],
  ['M3', '4 frets'],
  ['P4', '5 frets'],
  ['TT', '6 frets'],
  ['P5', '7 frets'],
  ['m6', '8 frets'],
  ['M6', '9 frets'],
  ['m7', '10 frets'],
  ['M7', '11 frets'],
  ['P8', 'octave'],
];
const ANSWERS = ['P5', 'M3', 'P4', 'm7'];
type Mode = 'int' | 'chord' | 'prog';

export default function Ear() {
  const [q, setQ] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [streak, setStreak] = useState(7);
  const [hist, setHist] = useState<LampTone[]>(['ok', 'ok', 'live', 'ok', 'ok', 'ok', 'ok']);
  const [mode, setMode] = useState<Mode>('int');
  const [byGuitar, setByGuitar] = useState(false);
  const answer = ANSWERS[q % ANSWERS.length];
  const done = pick != null;
  const ok = pick === answer;
  const color = done ? (ok ? '#4db6a4' : '#d4442c') : '#e9a23b';
  const next = () => {
    setQ(q + 1);
    setPick(null);
  };
  const choose = (name: string) => {
    if (done) return;
    setPick(name);
    setStreak(name === answer ? streak + 1 : 0);
    setHist([...hist, name === answer ? 'ok' : 'live']);
  };

  return (
    <div className={s.grid}>
      <Panel title="Ear training" lamp="on" meta="Intervals · ascending · level 3" minHeight={560}>
        <Window surface="glass" minHeight={280}>
          <div className={s.center}>
            <div className={s.caps} style={{ fontSize: 13 }}>
              {done ? (ok ? 'That was a' : 'It was a') : 'Which interval?'}
            </div>
            <div className={`${s.big} ${e.shown}`} style={{ color, textShadow: `0 0 30px ${color}73` }}>
              {done ? answer : '?'}
            </div>
            <div className={e.sub}>{done ? (ok ? 'Perfect fifth: seven frets, or the power chord shape.' : `You picked ${pick}. Play both on one string and count the frets.`) : 'Two notes, low then high. Press play to hear them again.'}</div>
            <button className={e.play} aria-label="Play it again">
              ▶
            </button>
          </div>
          <div className={s.lamps}>
            {Array.from({ length: 10 }, (_, i) => (
              <Lamp key={i} tone={hist[i] ?? 'off'} size={9} surface="well" />
            ))}
            <span className={s.small}>THIS ROUND</span>
          </div>
        </Window>
        <div className={s.readouts}>
          <Readout label="Streak" value={streak} tone="ok" />
          <Readout label="Today" value={12 + hist.slice(7).filter((x) => x === 'ok').length} unit="/ 15" />
          <Readout label="Level" value="3" sub="ascending, one octave" />
        </div>
      </Panel>
      <Panel surface="ivory" title="Answer" meta="Tap it, or play it on your guitar">
        <div className={s.row}>
          <Segment
            label="Mode"
            surface="ivory"
            options={[
              { id: 'int', label: 'Intervals' },
              { id: 'chord', label: 'Chords' },
              { id: 'prog', label: 'Progressions' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <div className={e.opts}>
          {INTERVALS.map(([name, sub]) => {
            const reveal = done && name === answer;
            const edge = reveal ? '#4db6a4' : pick === name ? '#d4442c' : undefined;
            return (
              <WellButton key={name} className={e.opt} edge={edge} aria-pressed={pick === name} onClick={() => choose(name)}>
                <span className={e.optName} style={{ color: edge }}>
                  {name}
                </span>
                <span className={s.pickSub}>{sub}</span>
              </WellButton>
            );
          })}
        </div>
        <Note className={e.guitar}>
          <span>
            <strong>Answer by playing.</strong> Fretline hears the two notes and checks the distance between them.
          </span>
          <Switch surface="ivory" tone="live" labelSide="left" label="Guitar" on={byGuitar} onToggle={setByGuitar} />
        </Note>
        <div className={`${s.buttons} ${s.bottom}`}>
          <Button variant="primary" size="lg" grow onClick={next}>
            {done ? 'Next' : "I don't know"}
          </Button>
          <Button variant="dark" size="lg" onClick={next}>
            Skip
          </Button>
        </div>
      </Panel>
    </div>
  );
}
