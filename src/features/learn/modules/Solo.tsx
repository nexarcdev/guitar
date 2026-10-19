import { useState } from 'react';
import { useStore } from '../../../state/store';
import { Button, Lamp, Panel, Readout, Switch, Window, WellButton, type LampTone } from '../../../ui';
import s from './Mock.module.css';
import o from './Solo.module.css';

/** Per bar: chord, its tones, the notes played (note, chord tone, phrase ended here), a note. */
const SOLO: Array<[string, string, Array<[string, 0 | 1, 1?]>, string]> = [
  ['Am', 'A C E', [['A', 1], ['C', 1], ['E', 1], ['G', 0], ['A', 1, 1], ['B', 0]], 'Three chord tones, ended on the root.'],
  ['F', 'F A C', [['A', 1], ['C', 1], ['D', 0], ['G', 0, 1], ['A', 1]], 'Phrase ended on G: tense over F.'],
  ['C', 'C E G', [['E', 1], ['G', 1], ['C', 1], ['D', 0], ['E', 1, 1]], 'Landed on the 3rd. Clear resolution.'],
  ['G', 'G B D', [['B', 1], ['D', 1], ['G', 1], ['A', 0], ['F#', 0, 1]], 'Ended on F#: leans back toward G.'],
];
const NOTICED: Array<[LampTone, string]> = [
  ['ok', 'Over Am you leaned on A, C and E. The phrases sit inside the chord and sound settled.'],
  ['on', 'Two of five phrases ended on a note outside the chord. Over F, the G you landed on kept the tension hanging.'],
  ['ok', 'You left room: 42% of the take is rest. The band had space to answer.'],
];
const TAKES: Array<[string, string]> = [
  ['Take 1', '0:19 · 54% chord tones'],
  ['Take 2', '0:22 · 61%'],
  ['Take 3', '0:24 · 68%'],
];

export default function Solo() {
  const listening = useStore((x) => x.listening);
  const [rec, setRec] = useState(false);
  const [backing, setBacking] = useState(true);
  const [take, setTake] = useState(2);

  return (
    <div className={s.grid}>
      <Panel title="Solo coach" lamp={listening ? 'live' : 'off'} pulse={listening} meta="Take 3 · Am F C G · 8 bars" minHeight={560}>
        <Window surface="paper" kicker="What you played" title="Take 3 over Am · F · C · G" meta="0:24 · 41 notes">
          <div className={o.bars}>
            {SOLO.map(([chord, tones, notes, note]) => (
              <div key={chord} className={o.bar}>
                <div className={o.barHead}>
                  <span className={o.chord}>{chord}</span>
                  <span className={o.tones}>{tones}</span>
                </div>
                <div className={o.notes}>
                  {notes.map(([n, ct, end], i) => (
                    <span key={i} title={ct ? `${n} · chord tone` : `${n} · outside`} className={o.note} data-tone={ct ? 'in' : 'out'} data-end={!!end}>
                      {n}
                    </span>
                  ))}
                </div>
                <div className={o.barNote}>{note}</div>
              </div>
            ))}
          </div>
          <div className={o.legend}>
            <span>
              <i className={o.keyIn} />
              CHORD TONE
            </span>
            <span>
              <i className={o.keyOut} />
              OUTSIDE THE CHORD
            </span>
            <span>
              <i className={o.keyEnd} />
              PHRASE ENDED HERE
            </span>
          </div>
        </Window>
        <div className={s.readouts}>
          <Readout label="Chord tones" value="68" unit="%" tone="ok" />
          <Readout label="Endings resolved" value="3" unit="/ 5" />
          <Readout label="Space" value="42" unit="%" sub="rests between phrases" />
          <Readout label="Rhythm" value="Medium" sub="3 note lengths used" />
        </div>
      </Panel>
      <Panel surface="ivory" title="Noticed" meta="Observations, never grades">
        <div className={s.list}>
          {NOTICED.map(([tone, text]) => (
            <div key={text} className={o.noticed}>
              <Lamp tone={tone} size={8} surface="ivory" />
              <span>{text}</span>
            </div>
          ))}
        </div>
        <div className={o.experiment}>
          <div className={o.expHead}>Try one experiment</div>
          <div className={o.expText}>
            When the band moves to <strong>F</strong>, land your phrase on an F. Listen to how the resolution changes against the chord.
          </div>
          <Button variant={rec ? 'danger' : 'primary'} onClick={() => setRec(!rec)}>
            {rec ? '● Recording take 4 · stop' : 'Record take 4'}
          </Button>
        </div>
        <div className={s.row}>
          <Switch surface="ivory" labelSide="left" label="Backing track" on={backing} onToggle={setBacking} />
          <span className={o.backing}>Am F C G · 84 BPM · folk</span>
        </div>
        <div className={`${s.list} ${s.bottom}`} style={{ gap: 6 }}>
          <div className={s.heading}>Takes</div>
          {TAKES.map(([name, meta], i) => (
            <WellButton key={name} className={`${s.pick} ${o.take}`} active={i === take} aria-pressed={i === take} onClick={() => setTake(i)}>
              <span className={s.pickName} style={{ fontSize: 15 }}>
                {name}
              </span>
              <span className={s.pickMeta}>{meta}</span>
            </WellButton>
          ))}
        </div>
      </Panel>
    </div>
  );
}
