import { useState } from 'react';
import { useStore } from '../../../state/store';
import { Button, Chip, Fretboard, Note, Panel, Segment, Window } from '../../../ui';
import { CHROM, marksFor, RootPicker } from './shared';
import s from './Mock.module.css';
import t from './Theory.module.css';

type Qual = 'maj' | 'min' | 'maj7' | 'sus4' | 'dim';
const QUAL: Record<Qual, [string, number[], string, string]> = {
  maj: ['Major', [0, 4, 7], 'major', 'Root, major third, perfect fifth. Bright and settled.'],
  min: ['Minor', [0, 3, 7], 'minor', 'Lower the third a half step and the whole chord darkens.'],
  maj7: ['Maj7', [0, 4, 7, 11], 'major 7th', 'Adds the major seventh on top: soft, open, a little wistful.'],
  sus4: ['Sus4', [0, 5, 7], 'sus4', 'The third is replaced by the fourth. It hangs there until it falls back to the third.'],
  dim: ['Dim', [0, 3, 6], 'diminished', 'A minor third stacked on a minor third. Tense, and it wants to move.'],
};
const ROLE: Record<number, string> = { 0: 'ROOT', 3: '♭3RD', 4: '3RD', 5: '4TH', 6: '♭5TH', 7: '5TH', 11: '7TH' };
const IVN = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];
const SUBS: Record<'maj' | 'min', Array<[string, string]>> = {
  maj: [
    ['G7', 'Adds the ♭7: pulls hard toward C.'],
    ['Gsus4', 'Delays the third. Resolve it on the next strum.'],
    ['G/B', 'Same chord, B in the bass: a walking line.'],
    ['Em7', 'Shares three notes with G. Softer, minor color.'],
  ],
  min: [
    ['Am7', 'Adds the ♭7: looser, jazzier.'],
    ['C', 'The relative major shares two notes.'],
    ['Asus2', 'Open and ambiguous; neither major nor minor.'],
    ['F', 'Shares A and C. Lifts the bass a third.'],
  ],
};
type Show = 'notes' | 'intervals' | 'dots';

export default function Theory() {
  const listening = useStore((x) => x.listening);
  const [root, setRoot] = useState('C');
  const [qual, setQual] = useState<Qual>('maj');
  const [mode, setMode] = useState<Show>('notes');
  const [confirming, setConfirming] = useState(false);
  const r = CHROM.indexOf(root);
  const [, ivs, full, desc] = QUAL[qual];
  const name = root + (qual === 'maj' ? '' : qual === 'min' ? 'm' : qual);

  return (
    <div className={s.grid}>
      <Panel title="Theory lab" meta="Build a chord, hear it, then play it" minHeight={560}>
        <Window surface="glass">
          <div className={t.top}>
            <div>
              <div className={`${s.big} ${t.name}`}>{name}</div>
              <div className={t.full}>
                {root} {full} · <span className={t.formula}>{ivs.map((iv) => IVN[iv]).join(' · ')}</span>
              </div>
            </div>
            <div className={t.chips}>
              {ivs.map((iv) => (
                <Chip key={iv} size="lg" tone="on" color={iv === 0 ? '#e9a23b' : '#4db6a4'} label={`${CHROM[(r + iv) % 12]} · ${ROLE[iv]}`} />
              ))}
            </div>
          </div>
          <Fretboard frets={5} from={1} rowH={30} marks={marksFor(r, ivs, 5, ivs.filter((x) => x))} mode={mode} />
        </Window>
        <Window surface="paper" kicker="Substitutions" title={`Instead of ${name}`} titleSize={24} meta="Same job, different color" pad="14px 18px 14px" gap={8} flex="0 0 auto">
          <div className={t.subs}>
            {(SUBS[qual === 'min' ? 'min' : 'maj'] ?? SUBS.maj).map(([n, why]) => (
              <div key={n} className={t.sub}>
                <span className={t.subName}>{n}</span>
                <span>{why}</span>
              </div>
            ))}
          </div>
        </Window>
      </Panel>
      <Panel surface="ivory" title="Build" meta="Root, then quality">
        <div style={{ padding: '0 4px' }}>
          <RootPicker label="Root" value={root} onChange={setRoot} />
        </div>
        <div className={s.row}>
          <Segment label="Quality" surface="ivory" options={(Object.keys(QUAL) as Qual[]).map((id) => ({ id, label: QUAL[id][0] }))} value={qual} onChange={setQual} />
          <Segment label="Show" surface="ivory" options={(['notes', 'intervals', 'dots'] as Show[]).map((id) => ({ id, label: id }))} value={mode} onChange={setMode} />
        </div>
        <Note>
          <strong>
            {root} {full}.
          </strong>{' '}
          {desc}
        </Note>
        <div className={s.buttons}>
          <Button variant="primary" size="lg" grow>
            Hear it
          </Button>
          <Button variant="dark" size="lg" grow onClick={() => setConfirming(!confirming)}>
            Play it, I'll confirm
          </Button>
        </div>
        <div className={`${s.row} ${s.bottom}`} style={{ justifyContent: 'flex-start' }}>
          <Chip label={confirming ? (listening ? `Waiting for ${name}` : 'Listening is paused') : 'Confirmed · 2 min ago'} tone={confirming ? (listening ? 'live' : 'muted') : 'ok'} pulse={confirming} />
          <span className={t.ring}>Strum once and let it ring.</span>
        </div>
      </Panel>
    </div>
  );
}
