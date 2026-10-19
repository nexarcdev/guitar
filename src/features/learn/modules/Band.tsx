import { useState } from 'react';
import { Button, Knob, Lamp, Note, Panel, Readout, Segment, Switch, Window, Well } from '../../../ui';
import { useTick } from './shared';
import s from './Mock.module.css';
import b from './Band.module.css';

const PROG = ['G', 'Em', 'C', 'D'];
const LANE = {
  drums: [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0],
  bass: [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0],
  keys: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
};
type Part = keyof typeof LANE;
type Genre = 'blues' | 'folk' | 'rock' | 'jazz';

export default function Band() {
  const [playing, setPlaying] = useState(true);
  const [parts, setParts] = useState<Record<Part, boolean>>({ drums: true, bass: true, keys: false });
  const [genre, setGenre] = useState<Genre>('folk');
  const tick = useTick(625, playing);
  const step = playing ? tick % 16 : -1;
  const bar = Math.floor(Math.max(0, step) / 4);
  const set = (k: Part) => (v: boolean) => setParts({ ...parts, [k]: v });

  return (
    <div className={s.grid}>
      <Panel title="Backing band" lamp={playing ? 'live' : 'off'} pulse={playing} meta={`${genre[0].toUpperCase() + genre.slice(1)} · G · 96 BPM`} minHeight={560}>
        <Window surface="glass">
          <div className={b.bars}>
            {PROG.map((name, i) => {
              const now = playing && i === bar;
              return (
                <div key={name} className={b.bar} data-now={now}>
                  <span className={b.name}>{name}</span>
                  <span className={b.beats}>
                    {[0, 1, 2, 3].map((k) => (
                      <Lamp key={k} tone={now && k <= step % 4 ? 'on' : 'off'} size={7} surface="well" glow={false} />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={b.lanes}>
            {(['drums', 'bass', 'keys'] as Part[]).map((id) => {
              const on = parts[id];
              return (
                <div key={id} className={b.lane} style={{ opacity: on ? 1 : 0.4 }}>
                  <div className={b.laneName} style={{ color: on ? undefined : 'var(--ink-3)' }}>
                    <Lamp tone={on && playing ? 'on' : 'off'} size={7} surface="well" />
                    {id}
                  </div>
                  <div className={b.steps}>
                    {LANE[id].map((v, i) => (
                      <span key={i} style={{ background: i === step ? (v ? '#e9a23b' : 'rgba(233,162,59,0.25)') : v ? (on ? 'rgba(239,228,200,0.55)' : 'rgba(239,228,200,0.18)') : 'rgba(239,228,200,0.06)' }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Window>
        <div className={s.readouts}>
          <Readout label="Bar" value={bar + 1} unit="/ 4" tone="on" />
          <Readout label="Tempo" value="96" unit="BPM" />
          <Readout label="Key" value="G" unit="major" />
          <Readout label="Pass" value="3" sub="grows on pass 4" />
        </div>
      </Panel>
      <Panel surface="ivory" title="The band" meta="Grows a part when you land the changes">
        <div style={{ padding: '0 4px' }}>
          <Segment label="Genre" surface="ivory" options={(['blues', 'folk', 'rock', 'jazz'] as Genre[]).map((id) => ({ id, label: id }))} value={genre} onChange={setGenre} />
        </div>
        <div className={b.prog}>
          {PROG.map((name, i) => (
            <Well key={name} active={playing && i === bar} data-on={playing && i === bar} className={b.chord}>
              {name}
            </Well>
          ))}
        </div>
        <div className={s.controls}>
          <Knob label="Tempo · 96" value={48} size={72} cap="cream" color="#d9902a" labelColor="#6b5636" />
          <Knob label="Busy · 40%" value={40} size={72} cap="cream" color="#1f8c7c" labelColor="#6b5636" />
          <Switch surface="ivory" label="Drums" on={parts.drums} onToggle={set('drums')} />
          <Switch surface="ivory" label="Bass" on={parts.bass} onToggle={set('bass')} />
          <Switch surface="ivory" label="Keys" on={parts.keys} onToggle={set('keys')} />
        </div>
        <div className={s.buttons}>
          <Button variant={playing ? 'danger' : 'primary'} size="lg" grow onClick={() => setPlaying(!playing)}>
            {playing ? 'Stop' : 'Play'}
          </Button>
          <Button variant="dark" size="lg">
            12-bar blues
          </Button>
        </div>
        <Note className={s.bottom}>
          <strong>Nothing licensed.</strong> Drums and bass are generated from the key, tempo and feel you set, so every track is yours to record over.
        </Note>
      </Panel>
    </div>
  );
}
