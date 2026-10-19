import { useState } from 'react';
import { linkProps } from '../../../state/router';
import { Button, Note, Panel, Readout, SkillRing, Switch, Window } from '../../../ui';
import s from './Mock.module.css';
import t from './Today.module.css';

const STEPS: Array<[string, string, string, '' | 'now' | 'done']> = [
  ['Tune up', 'All six strings, 440', '1 MIN', 'done'],
  ['G to C, without the pause', '3 minutes at 72 BPM, auto tempo', '3 MIN', 'now'],
  ['One idea: sus4', 'Why Csus4 wants to fall back to C', '4 MIN', ''],
  ['Jam over G Em C D', 'Folk band, 96 BPM, you lead', '6 MIN', ''],
];

export default function Today() {
  const [remind, setRemind] = useState(true);
  return (
    <div className={s.grid}>
      <Panel title="Today's session" lamp="ok" meta="15 min · 4 steps · 1 done" minHeight={560}>
        <Window surface="paper" kicker="Thursday, October 9" title="Warm up, fix one change, learn one idea, jam" meta="15 min">
          <div className={t.steps}>
            {STEPS.map(([title, sub, meta, st], i) => (
              <div key={title} className={`${s.paperRow} ${t.step}`} data-state={st || 'todo'}>
                <span className={t.num}>{st === 'done' ? '✓' : i + 1}</span>
                <div>
                  <div className={t.title}>{title}</div>
                  <div className={t.sub}>{sub}</div>
                </div>
                <span className={t.meta}>{st === 'done' ? 'DONE' : st === 'now' ? 'NOW · ' + meta : meta}</span>
              </div>
            ))}
          </div>
          <div className={`${s.paperNote} ${s.bottom}`}>
            <span className={s.paperCaps} style={{ display: 'block', marginBottom: 4 }}>
              From your tutor
            </span>
            Last time you kept pausing on the change from G to C. We'll drill that for three minutes, then use both chords in a progression and improvise over it.
          </div>
          <div style={{ position: 'relative' }}>
            <div className={t.progLabels}>
              <span>Session</span>
              <span>1 of 4 done · 11 min left</span>
            </div>
            <div className={s.paperBar}>
              <div className={s.paperFill} style={{ width: '25%' }} />
              <div className={s.paperHead} style={{ left: '25%' }} />
            </div>
          </div>
        </Window>
      </Panel>
      <Panel surface="ivory" title="Start here" meta="Picks up where you left off">
        <div className={s.readouts}>
          <Readout label="Streak" value="12" unit="days" surface="ivory" tone="on" />
          <Readout label="This week" value="2:10" unit="h" surface="ivory" />
          <Readout label="Last session" value="Yesterday" surface="ivory" />
        </div>
        <div className={s.controls}>
          <SkillRing label="Chord changes" score={58} size={88} color="#d9902a" labelColor="#6b5636" />
          <SkillRing label="Fretboard" score={35} size={88} color="#c8431f" labelColor="#6b5636" />
          <SkillRing label="Timing" score={81} size={88} color="#1f8c7c" labelColor="#6b5636" />
        </div>
        <div className={s.buttons}>
          <Button variant="primary" size="lg" grow {...linkProps({ kind: 'learn', module: 'changes' })}>
            Continue session
          </Button>
          <Button variant="dark" size="lg" {...linkProps({ kind: 'learn', module: 'band' })}>
            Just jam
          </Button>
        </div>
        <Note className={`${s.bottom} ${t.remind}`}>
          <span>
            <strong>Daily reminder</strong> at 6 PM. Sessions stay on this device and export whenever you like.
          </span>
          <Switch surface="ivory" labelSide="left" label="Remind" on={remind} onToggle={setRemind} />
        </Note>
      </Panel>
    </div>
  );
}
