import { useState } from 'react';
import { useStore } from '../../../state/store';
import { Button, Knob, Lamp, Note, Panel, Readout, Switch, Window, WellButton } from '../../../ui';
import { useTick } from './shared';
import s from './Mock.module.css';
import c from './Changes.module.css';

const PAIRS: Array<[string, string, number]> = [
  ['G', 'C', 8],
  ['C', 'D', 6],
  ['Em', 'C', 9],
  ['D', 'G', 4],
];
const ATTEMPTS = [540, 610, 480, 720, 590, 880, 560, 620, 510, 690];
const zone = (ms: number) => (ms < 700 ? '#4db6a4' : ms < 800 ? '#e9a23b' : '#d4442c');

export default function Changes() {
  const listening = useStore((x) => x.listening);
  const [pair, setPair] = useState(0);
  const [running, setRunning] = useState(true);
  const [autoTempo, setAutoTempo] = useState(true);
  const [click, setClick] = useState(true);
  const tick = useTick(833, running);
  const beat = tick % 4;
  const [from, to, clean] = PAIRS[pair];

  return (
    <div className={s.grid}>
      <Panel title="Chord changes" lamp={listening ? 'live' : 'off'} pulse={listening} meta={running ? `Set 3 · change ${(Math.floor(tick / 4) % 10) + 1} of 10` : 'Ready'} minHeight={560}>
        <Window surface="glass" minHeight={250}>
          <div className={c.pair}>
            <div>
              <div className={s.caps}>Current</div>
              <div className={`${s.big} ${c.from}`}>{from}</div>
            </div>
            <div className={c.arrow}>→</div>
            <div>
              <div className={s.caps}>Next</div>
              <div className={`${s.big} ${c.to}`}>{to}</div>
            </div>
          </div>
          <div className={s.lamps}>
            {[0, 1, 2, 3].map((b) => (
              <Lamp key={b} tone={running && b <= beat ? (b === 3 ? 'live' : 'on') : 'off'} size={12} surface="well" />
            ))}
            <span className={c.hint}>{running ? (beat === 3 ? 'CHANGE' : 'hold') : 'press start'}</span>
          </div>
        </Window>
        <div className={s.readouts}>
          <Readout label="Tempo" value="72" unit="BPM" tone="on" />
          <Readout label="Clean" value={clean} unit="/ 10" tone="ok" />
          <Readout label="Avg change" value="620" unit="ms" />
          <Readout label="Accuracy" value="80" unit="%" />
        </div>
        <Window surface="glass" pad="12px 16px 10px" gap={8} flex="0 0 auto">
          <div className={c.attLabels}>
            <span>LAST 10 CHANGES · TIME TO SETTLE</span>
            <span>UNDER 700 MS COUNTS AS CLEAN</span>
          </div>
          <div className={c.attempts}>
            {ATTEMPTS.map((ms, i) => (
              <span key={i} title={`${ms} ms`} style={{ height: `${Math.round(ms / 10)}%`, background: zone(ms), boxShadow: `0 0 8px ${zone(ms)}66` }} />
            ))}
          </div>
        </Window>
      </Panel>
      <Panel surface="ivory" title="Pairs" meta="Tap a pair to drill it">
        <div className={c.pairs}>
          {PAIRS.map(([a, b, n], i) => (
            <WellButton key={a + b} className={s.pick} active={i === pair} aria-pressed={i === pair} onClick={() => setPair(i)}>
              <Lamp tone={n >= 9 ? 'ok' : n >= 6 ? 'on' : 'live'} size={10} surface="well" />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span className={s.pickName}>
                  {a} → {b}
                </span>
                <span className={s.pickSub}>{n} of 10 clean</span>
              </span>
            </WellButton>
          ))}
        </div>
        <div className={s.controls}>
          <Knob label="Tempo · 72" value={36} size={78} cap="cream" color="#d9902a" labelColor="#6b5636" />
          <Switch surface="ivory" label="Auto tempo" on={autoTempo} onToggle={setAutoTempo} />
          <Switch surface="ivory" label="Click" on={click} onToggle={setClick} />
        </div>
        <div className={s.buttons}>
          <Button variant={running ? 'danger' : 'primary'} size="lg" grow onClick={() => setRunning(!running)}>
            {running ? 'Stop · 2:14' : 'Start changes'}
          </Button>
          <Button variant="dark" size="lg">
            Other fingering
          </Button>
        </div>
        <Note className={s.bottom}>
          <strong>Stay at 72</strong> until 9 of 10 land clean. Fingers 1 and 2 keep their shape between G and C: move them together, one string over, and place finger 3 last.
        </Note>
      </Panel>
    </div>
  );
}
