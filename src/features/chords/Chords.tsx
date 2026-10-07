// One Chords screen with two states. Following: each strum snaps the board to the voicing that
// was played and names it. Locked: the board is the target, and each strum is judged against it
// by the pitches it sounded. Any tap on the board, a progression chord, a common chord or an
// alternate sets the target and locks; the padlock or the "Heard" line unlocks.

import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { identifyFrets, noteName, openStrings, ord, pcOf, tuningName } from '../../theory/music';
import { toVoicing, voicingMidis } from '../../theory/common';
import { Fretboard } from './Fretboard';
import { Progression } from './Progression';
import { Alternates } from './Alternates';
import { CommonChords } from './CommonChords';
import s from './Chords.module.css';

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

  // The chord on the board: the target while locked, what was played while following.
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

  const kicker = !listening ? 'PAUSED' : !live ? 'NO INPUT' : locked ? 'PLAY ' + board.name.toUpperCase() : 'FOLLOWING';
  const sub = !listening
    ? 'Resume listening to hear chords'
    : !live
      ? 'Waiting for your guitar'
      : locked
        ? !heard
          ? ''
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

  const tn = tuningName(setup.offsets);
  const fretNote = (setup.capo ? 'Fret numbers count from the capo on the ' + ord(setup.capo) + ' fret. ' : '') + (tn !== 'Standard' ? 'Strings tuned ' + T.map((x) => x.note).join(' ') + '.' : '');

  return (
    <div className={s.grid}>
      <div className={s.col}>
        <div className={`kicker ${s.hearKicker}`}>
          <span className={s.dot} data-live={hearing} />
          {kicker}
        </div>
        <div className={s.panel} data-dim={!hearing} data-ok={ok} data-bad={bad} aria-live="polite">
          <div className={`${s.big} ${!locked ? s.gradient : ''}`} style={locked ? { color: bad ? 'var(--red)' : ok ? 'var(--green)' : 'var(--ink)', transition: 'color .3s' } : undefined}>
            {locked ? board.name : heard ? heard.name.name : '·'}
          </div>
          <div className={`${s.sub} ${bad ? s.subBad : ok ? s.subOk : ''}`}>{sub}</div>
          {locked && bad && heard && !heard.quiet && heard.name.root != null && heard.name.name !== board.name && (
            <button className={s.heardLine} onClick={actions.followHeard} title="Follow what you played instead">
              Heard: {heard.name.name}
            </button>
          )}
          <div className={s.pills}>
            {locked
              ? targetTones.map((p) => {
                  const present = verdict ? verdict.present.some((m) => pcOf(m) === p) : false;
                  return (
                    <span key={p} className={`${s.pill} ${verdict ? (present ? s.pillHeard : s.pillWait) : p === board.root ? s.pillRoot : ''}`}>
                      {noteName(p, setup.offsets)}
                    </span>
                  );
                })
              : heard?.name.notes.map((p) => (
                  <span key={p} className={`${s.pill} ${p === heard.name.root ? s.pillRoot : ''}`}>
                    {noteName(p, setup.offsets)}
                  </span>
                ))}
            {verdict?.strayNotes.map((m) => (
              <span key={'s' + m} className={`${s.pill} ${verdict.status === 'different' ? s.pillWrong : ''}`}>
                {noteName(pcOf(m), setup.offsets)}
              </span>
            ))}
          </div>
        </div>
        <Progression />
      </div>

      <div className={s.col}>
        <div className={s.head}>
          <div className="kicker">CHORD</div>
          <div className={s.headName}>
            <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--gold-hi)' }}>{board.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>{boardSub}</span>
          </div>
          <button className={s.lock} aria-pressed={locked} aria-label={locked ? 'Locked: strums are judged against this chord. Tap to follow what you play' : 'Following what you play. Tap to lock this chord as the target'} title={locked ? 'Locked on this chord' : 'Following what you play'} onClick={() => actions.lock(!locked)}>
            <LockIcon locked={locked} />
          </button>
        </div>
        <Fretboard frets={frets} baseFret={baseFret} setup={setup} marks={verdict?.strings ?? null} onNut={actions.toggleNut} onFret={actions.setFret} onBase={actions.setBaseFret} />
        {fretNote && <div className={s.fretNote}>{fretNote}</div>}
        <div className={s.btns}>
          <button className="btn-gold" onClick={() => actions.strum(toVoicing(frets, baseFret, setup))}>
            Strum
          </button>
          <button className="btn-ghost" onClick={() => actions.setTarget([-1, -1, -1, -1, -1, -1], 1)}>
            Clear
          </button>
        </div>
        <Alternates name={board} />
        <CommonChords />
      </div>
    </div>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" />
      {locked ? (
        <path d="M5 7V5.2a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path d="M5 7V5.2a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}
