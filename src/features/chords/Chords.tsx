// One Chords screen with two modes. Identify (following): each strum snaps the board to the
// voicing that was played and names it. Confirm (locked): the board is the target, and each strum
// is judged against it by the pitches it sounded. Any tap on the board, a progression chord, a
// common chord or an alternate sets the target and confirms; the "Heard" line goes back to
// following what you play.

import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { identifyFrets, noteName, openStrings, ord, pcOf, stringLabel, tuningName } from '../../theory/music';
import { toVoicing, voicingMidis } from '../../theory/common';
import { Button, Chip, Fretboard, Note, Panel, Segment, Well, Window, type FretMark } from '../../ui';
import { Progression } from './Progression';
import { Alternates } from './Alternates';
import { CommonChords } from './CommonChords';
import s from './Chords.module.css';

type Mode = 'identify' | 'confirm';
const MODES = [
  { id: 'identify' as const, label: 'Identify' },
  { id: 'confirm' as const, label: 'Confirm' },
];

export function Chords() {
  const st = useStore(
    useShallow((x) => ({
      setup: x.setup, frets: x.frets, baseFret: x.baseFret, heard: x.heard, locked: x.locked,
      listening: x.listening, live: x.engine.mic === 'live' && x.engine.running,
    })),
  );
  const { setup, frets, baseFret, heard, locked, listening, live } = st;
  const T = openStrings(setup.offsets);
  const hearing = listening && live;

  // The chord on the board: the target while confirming, what was played while identifying.
  const board = identifyFrets(frets, baseFret, setup);
  let boardSub = board.sub;
  if (setup.capo && board.root != null) {
    const open = identifyFrets(frets, baseFret, { ...setup, capo: 0 });
    if (open.root != null && open.name !== board.name) boardSub = 'played as ' + open.name + ' · ' + board.sub;
  }

  const verdict = locked ? heard?.verdict ?? null : null;
  const ok = verdict?.status === 'exact' || verdict?.status === 'sameName';
  const bad = verdict?.status === 'different';
  const targetTones = voicingMidis(frets, baseFret, setup).map(pcOf).filter((p, i, a) => a.indexOf(p) === i);

  const kicker = !listening ? 'Paused · last heard' : !live ? 'No input' : locked ? 'Confirming' : 'Hearing';
  const sub = !listening
    ? 'Resume listening to hear chords'
    : !live
      ? 'Waiting for your guitar'
      : locked
        ? !heard
          ? 'Play ' + board.name + ' and every string is checked'
          : heard.quiet
            ? 'Too quiet to judge'
            : verdict?.status === 'exact'
              ? 'Confirmed'
              : verdict?.status === 'sameName'
                ? 'Confirmed, ' + heard.name.name + ', different voicing'
                : verdict?.fixes.join(' · ') ?? ''
        : heard
          ? heard.name.sub
          : 'Strum a chord';
  const big = locked ? board.name : heard ? heard.name.name : '';
  // Long names (G7(no5), Cmaj7/B) step down so they stay on one line.
  const n = big.length;
  const maxPx = n <= 2 ? 200 : n <= 3 ? 170 : n <= 5 ? 120 : Math.max(56, Math.round(560 / n));
  const bigSize = `clamp(${Math.round(maxPx * 0.6)}px, ${(maxPx / 11).toFixed(1)}vw, ${maxPx}px)`;
  const tone = locked ? (bad ? 'bad' : ok ? 'ok' : 'target') : heard ? 'heard' : 'idle';

  const tn = tuningName(setup.offsets);
  const fretNote = (setup.capo ? 'Fret numbers count from the capo on the ' + ord(setup.capo) + ' fret. ' : '') + (tn !== 'Standard' ? 'Strings tuned ' + T.map((x) => x.note).join(' ') + '.' : '');

  // The board as marks: fretted strings get a dot, open ones a ring; a verdict lights the strings
  // that sounded in teal.
  const sm = verdict?.strings ?? null;
  const marks: FretMark[] = [];
  frets.forEach((f, i) => {
    const heardString = sm?.[i] === 'ok';
    if (f > 0) marks.push({ s: i, f: baseFret + f - 1, tone: heardString ? 'heard' : 'root' });
    else if (f === 0) marks.push({ s: i, f: 0, tone: heardString ? 'heard' : 'scale' });
  });
  const muted = frets.map((f, i) => (f === -1 ? i : -1)).filter((i) => i >= 0);

  return (
    <div className={s.grid}>
      <Panel
        title={kicker}
        lamp={hearing ? 'live' : 'off'}
        pulse={hearing}
        className={s.reading}
        meta={<Segment<Mode> label="Mode" options={MODES} value={locked ? 'confirm' : 'identify'} onChange={(m) => actions.lock(m === 'confirm')} />}
      >
        <Window surface="glass" pad="0" gap={0} className={s.glass}>
          <div className={s.hearing} data-dim={!hearing} aria-live="polite">
            <div className={s.big} data-tone={tone} style={{ fontSize: bigSize }}>
              {big}
            </div>
            <div className={s.sub} data-tone={tone}>
              {sub}
            </div>
            {locked && bad && heard && !heard.quiet && heard.name.root != null && heard.name.name !== board.name && (
              <Button variant="dark" size="sm" onClick={actions.followHeard} title="Follow what you played instead">
                Heard: {heard.name.name}
              </Button>
            )}
            <div className={s.pills}>
              {locked
                ? targetTones.map((p) => {
                    const present = verdict ? verdict.present.some((m) => pcOf(m) === p) : false;
                    return <Chip key={p} size="lg" label={noteName(p, setup.offsets)} tone={p === board.root && !verdict ? 'on' : verdict ? (present ? 'ok' : 'muted') : 'muted'} />;
                  })
                : heard?.name.notes.map((p) => <Chip key={p} size="lg" label={noteName(p, setup.offsets)} tone={p === heard.name.root ? 'on' : 'ok'} />)}
              {verdict?.strayNotes.map((m) => <Chip key={'s' + m} size="lg" label={noteName(pcOf(m), setup.offsets)} tone={verdict.status === 'different' ? 'live' : 'muted'} />)}
            </div>
          </div>
          <Progression />
        </Window>
      </Panel>

      <Panel
        surface="ivory"
        title="Shape"
        meta={
          <div className={s.shapeMeta}>
            <span className={s.shapeName}>{board.name}</span> · {boardSub || 'Tap frets to build a chord'}
          </div>
        }
      >
        <div className={s.fretRow}>
          <Button variant="cream" size="sm" icon aria-label="Lower frets" disabled={baseFret <= 1} onClick={() => actions.setBaseFret(baseFret - 1)}>
            ‹
          </Button>
          {[0, 1, 2, 3, 4].map((k) => (
            <div key={k} className={s.fretNum}>
              {baseFret + k}
            </div>
          ))}
          <Button variant="cream" size="sm" icon aria-label="Higher frets" className={s.up} disabled={baseFret >= 12} onClick={() => actions.setBaseFret(baseFret + 1)}>
            ›
          </Button>
        </div>
        <Well className={s.board}>
          <Fretboard
            surface="well"
            frets={5}
            from={baseFret}
            rowH={46}
            marks={marks}
            muted={muted}
            numbers={false}
            tuning={T.map((x, i) => stringLabel(x.note, i))}
            onTap={(i, f) => {
              if (f === 0) actions.toggleNut(i);
              else actions.setFret(i, f - baseFret + 1);
            }}
          />
        </Well>
        {fretNote && <Note>{fretNote}</Note>}
        <div className={s.btns}>
          <Button variant="primary" grow onClick={() => actions.strum(toVoicing(frets, baseFret, setup))}>
            Strum
          </Button>
          <Button variant="dark" onClick={() => actions.setTarget([-1, -1, -1, -1, -1, -1], 1)}>
            Clear
          </Button>
        </div>
        <Alternates name={board} />
        <CommonChords />
      </Panel>
    </div>
  );
}
