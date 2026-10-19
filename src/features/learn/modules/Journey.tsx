import { linkProps } from '../../../state/router';
import { Button, Note, Panel, Readout, SkillRing, Window } from '../../../ui';
import s from './Mock.module.css';
import j from './Journey.module.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Twelve weeks of sample practice, 0 to 3 per day; the last week stops at today. */
const WEEKS = Array.from({ length: 12 }, (_, w) =>
  Array.from({ length: 7 }, (_, d) => {
    const k = w * 7 + d;
    const v = (k * 37 + 11) % 13;
    const lvl = v < 4 ? 0 : v < 8 ? 1 : v < 11 ? 2 : 3;
    return { lvl: w < 2 && lvl > 1 ? 1 : lvl, today: w === 11 && d === 3, future: w === 11 && d > 3, title: `${DAYS[d]} · ${lvl * 12} min` };
  }),
);
const DISCOVERIES = [
  ['OCT 6', 'You found Am, F, C, G by ear. All four live in C major; the solo coach now uses it as your backing track.'],
  ['OCT 2', 'You added delay to the board. Dotted-eighth delay is waiting in Theory when you want it.'],
  ['SEP 24', 'First clean F barre. Lesson 5 unlocked itself.'],
];
const SKILLS: Array<[string, number, string]> = [
  ['Open chords', 72, '#1f8c7c'],
  ['Chord changes', 58, '#d9902a'],
  ['Rhythm', 76, '#1f8c7c'],
  ['Fretboard', 35, '#c8431f'],
  ['Improvisation', 42, '#d9902a'],
  ['Ear', 64, '#d9902a'],
];
const ALPHA = [0.08, 0.3, 0.6, 1];

export default function Journey() {
  return (
    <div className={s.grid}>
      <Panel title="Your journey" meta="34 sessions since September 1" minHeight={560}>
        <Window surface="paper" kicker="Practice" title="Twelve weeks" meta="12 day streak">
          <div className={j.heat}>
            {WEEKS.map((w, i) => (
              <div key={i} className={j.week}>
                {w.map((d, k) => (
                  <span key={k} title={d.title} className={j.day} data-today={d.today} style={{ background: d.future ? 'transparent' : `rgba(43,29,16,${ALPHA[d.lvl]})`, boxShadow: d.future ? 'inset 0 0 0 1px rgba(58,42,26,0.25)' : undefined }} />
                ))}
              </div>
            ))}
          </div>
          <div className={j.months}>
            <span>JULY</span>
            <span>AUGUST</span>
            <span>SEPTEMBER</span>
            <span>OCTOBER</span>
          </div>
          <div className={j.discoveries}>
            <div className={s.paperCaps}>Discoveries</div>
            {DISCOVERIES.map(([date, text]) => (
              <div key={date} className={j.discovery}>
                <span className={j.date}>{date}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </Window>
      </Panel>
      <Panel surface="ivory" title="Skills" meta="Six independent dimensions, not one level">
        <div className={j.skills}>
          {SKILLS.map(([label, score, color]) => (
            <SkillRing key={label} label={label} score={score} size={84} color={color} labelColor="#6b5636" />
          ))}
        </div>
        <div className={s.readouts}>
          <Readout label="Sessions" value="34" surface="ivory" />
          <Readout label="Practiced" value="11:40" unit="h" surface="ivory" />
          <Readout label="Weakest" value="Fretboard" surface="ivory" tone="live" />
        </div>
        <Note className={`${s.bottom} ${j.next}`}>
          <span className={s.heading} style={{ fontSize: 11 }}>
            Suggested next practice
          </span>
          <span className={j.nextText}>Five minutes finding notes on the A and D strings, then back to the G to C change at 72. Skip ahead any time; nothing here is locked.</span>
          <div className={s.buttons} style={{ gap: 8 }}>
            <Button variant="cream" size="sm" {...linkProps({ kind: 'learn', module: 'today' })}>
              Make it today's plan
            </Button>
            <Button variant="cream" size="sm" {...linkProps({ kind: 'learn', module: 'fretboard' })}>
              Open fretboard
            </Button>
          </div>
        </Note>
      </Panel>
    </div>
  );
}
