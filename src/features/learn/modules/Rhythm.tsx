import { useState } from 'react';
import { useStore } from '../../../state/store';
import { BeatStrip, Button, Chip, Knob, Lamp, Panel, Readout, Segment, Switch, Window, WellButton, type BeatStep } from '../../../ui';
import { useTick } from './shared';
import s from './Mock.module.css';

const PATS: Array<[string, string, '' | 'now' | 'done']> = [
  ['Quarter strums', 'D D D D', 'done'],
  ['Eighths', 'D U D U D U D U', 'done'],
  ['Down-up with rests', 'D - D U - U D U', 'now'],
  ['Sixteenths', 'D U D U · · ·', ''],
  ['Syncopated', 'D - U - U D - U', ''],
];
const STROKES = ['D-D-D-D-', 'DUDUDUDU', 'D-DU-UDU', 'DUDUDUDU', 'D-U-UD-U'];
const HITS = [4, null, -12, 18, null, 31, -6, 58, 2, null, -9, 22, null, 27, -3, 44];
const SUB = { '1/4': 1, '1/8': 2, '1/16': 4 } as const;
type Sub = keyof typeof SUB;

export default function Rhythm() {
  const listening = useStore((x) => x.listening);
  const [pat, setPat] = useState(2);
  const [sub, setSub] = useState<Sub>('1/8');
  const [click, setClick] = useState(true);
  const [accent, setAccent] = useState(false);
  const cur = useTick(357) % 16;
  const steps: BeatStep[] = Array.from({ length: 16 }, (_, i) => {
    const stroke = STROKES[pat][i % 8] as BeatStep['stroke'];
    return { stroke, hit: stroke === '-' || i >= cur ? null : HITS[i] };
  });

  return (
    <div className={s.grid}>
      <Panel title="Rhythm coach" lamp={listening ? 'live' : 'off'} pulse={listening} meta="Down-up with rests · bar 3 of 8" minHeight={560}>
        <Window surface="glass" minHeight={200} title={PATS[pat][0]} titleSize={26} meta={sub === '1/16' ? 'Count 1 e & a' : sub === '1/8' ? 'Count 1 & 2 &' : 'Count 1 2 3 4'}>
          <BeatStrip steps={steps} current={cur} sub={SUB[sub]} />
        </Window>
        <div className={s.readouts}>
          <Readout label="Tempo" value="84" unit="BPM" tone="on" />
          <Readout label="On time" value="78" unit="%" tone="ok" />
          <Readout label="Tendency" value="+12" unit="ms" sub="a touch late" />
          <Readout label="Clean bars" value="6" unit="in a row" />
        </div>
        <div className={s.copy}>Strokes within 20 ms of the click show teal. You've been landing the up-strokes late; that's where the swing knob helps once the eighths are steady.</div>
      </Panel>
      <Panel surface="ivory" title="Pattern" meta={PATS[pat][1]}>
        <div className={s.row}>
          <Segment label="Subdivision" surface="ivory" options={['1/4', '1/8', '1/16'] as Sub[]} value={sub} onChange={setSub} />
          <Chip label="Level 3 of 6" tone="on" size="sm" />
        </div>
        <div className={s.list}>
          {PATS.map(([name, strokes, st], i) => (
            <WellButton key={name} className={s.pick} active={i === pat} aria-pressed={i === pat} onClick={() => setPat(i)}>
              <Lamp tone={st === 'done' ? 'ok' : st === 'now' ? 'on' : 'off'} size={9} surface="well" />
              <span className={s.pickName} style={{ fontSize: 17 }}>
                {name}
              </span>
              <span className={s.pickMeta} style={{ fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.18em' }}>
                {strokes}
              </span>
            </WellButton>
          ))}
        </div>
        <div className={s.controls}>
          <Knob label="Tempo · 84" value={42} size={72} cap="cream" color="#d9902a" labelColor="#6b5636" />
          <Knob label="Swing · 0%" value={0} size={72} cap="cream" color="#1f8c7c" labelColor="#6b5636" />
          <Switch surface="ivory" label="Click" on={click} onToggle={setClick} />
          <Switch surface="ivory" label="Accent 1" on={accent} onToggle={setAccent} />
        </div>
        <div className={`${s.buttons} ${s.bottom}`}>
          <Button variant="primary" size="lg" grow>
            Start · 4 count
          </Button>
          <Button variant="dark" size="lg">
            With drums
          </Button>
        </div>
      </Panel>
    </div>
  );
}
