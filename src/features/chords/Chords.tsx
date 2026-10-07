import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { absFret, fretMidi, identifyFrets, noteName, openStrings, ord, pcOf, stringLabel, tuningName } from '../../theory/music';
import { COMMON } from '../../theory/common';
import s from './Chords.module.css';

export function Chords() {
  const st = useStore(
    useShallow((x) => ({
      setup: x.setup, frets: x.frets, baseFret: x.baseFret, heard: x.heard, progression: x.progression, locked: x.locked,
      listening: x.listening, live: x.engine.mic === 'live' && x.engine.running,
    })),
  );
  const { setup, frets, baseFret, heard, progression, locked, listening, live } = st;
  const T = openStrings(setup.offsets);
  const hearing = listening && live;

  const ch = identifyFrets(frets, baseFret, setup);
  let chordSub = ch.sub;
  if (setup.capo && ch.root != null) {
    const open = identifyFrets(frets, baseFret, { ...setup, capo: 0 });
    if (open.root != null && open.name !== ch.name) chordSub = 'played as ' + open.name + ' · ' + ch.sub;
  }

  const verdict = locked ? heard?.verdict ?? null : null;
  const marks = verdict?.strings ?? null;
  const ok = verdict?.status === 'exact' || verdict?.status === 'sameName';
  const bad = verdict?.status === 'different';
  const played: Array<{ i: number; pc: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const f = frets[i];
    if (f >= 0) played.push({ i, pc: pcOf(fretMidi(i, absFret(f, baseFret), setup)) });
  }

  const kicker = !listening ? 'PAUSED' : !live ? 'NO INPUT' : locked ? 'PLAY ' + ch.name.toUpperCase() : 'FOLLOWING';
  const sub = !listening
    ? 'Resume listening'
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
                : verdict?.fixes.length
                  ? verdict.fixes.join(' · ')
                  : ''
        : heard
          ? heard.name.sub
          : '';

  const tn = tuningName(setup.offsets);
  const showFretNote = setup.capo > 0 || tn !== 'Standard';
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
            {locked ? ch.name : heard ? heard.name.name : '·'}
          </div>
          <div className={`${s.sub} ${bad ? s.subBad : ok ? s.subOk : ''}`}>{sub}</div>
          {locked && bad && heard && !heard.quiet && heard.name.root != null && (
            <button className={s.heardLine} onClick={actions.followHeard}>
              Heard: {heard.name.name}
            </button>
          )}
          <div className={s.pills}>
            {locked
              ? played.map((p) => (
                  <span key={p.i} className={`${s.pill} ${marks ? (marks[p.i] === 'ok' ? s.pillHeard : s.pillWait) : ''}`}>
                    {noteName(p.pc, setup.offsets)}
                  </span>
                ))
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
        {progression.length > 0 && (
          <div className={s.section}>
            <div className={`kicker ${s.sectionKicker}`}>PROGRESSION</div>
            <div className={s.wrap}>
              {progression.map((h, i, a) => (
                <button key={h.id} className={s.histBtn} data-last={i === a.length - 1} onClick={() => actions.setTarget(h.voicing.frets, h.voicing.baseFret)}>
                  {h.name.name}
                  {h.count > 1 ? ' ×' + h.count : ''}
                </button>
              ))}
              <button className="btn-ghost" onClick={actions.clearProgression}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={s.col}>
        <div className={s.shapeHead}>
          <div className="kicker">CHORD</div>
          <div className={s.shapeName}>
            <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--gold-hi)' }}>{ch.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>{chordSub}</span>
          </div>
          <button className={s.lock} aria-pressed={locked} title={locked ? 'Locked: strums are judged against this chord' : 'Following what you play'} onClick={() => actions.lock(!locked)}>
            {locked ? '🔒' : '🔓'}
          </button>
        </div>
        <div className={s.fretRow}>
          <button className={s.chev} style={{ justifySelf: 'start' }} aria-label="Lower frets" disabled={baseFret <= 1} onClick={() => actions.setBaseFret(baseFret - 1)}>
            ‹
          </button>
          {[0, 1, 2, 3, 4].map((k) => (
            <div key={k} className={s.fretNum}>
              {baseFret + k}
            </div>
          ))}
          <button className={s.chev} style={{ justifySelf: 'end' }} aria-label="Higher frets" disabled={baseFret >= 12} onClick={() => actions.setBaseFret(baseFret + 1)}>
            ›
          </button>
        </div>
        <div className={s.board}>
          {[5, 4, 3, 2, 1, 0].map((i) => {
            const f = frets[i];
            const h = marks?.[i] === 'ok';
            const w = marks?.[i] === 'wrongOpen';
            const nutColor = w ? 'var(--red)' : f === -1 ? 'var(--muted-2)' : h ? 'var(--green)' : f === 0 ? 'var(--gold)' : 'var(--muted)';
            return (
              <div key={i} className={s.string} data-heard={h} data-wrong={w}>
                <button
                  className={s.nut}
                  style={{ color: nutColor }}
                  aria-label={stringLabel(T[i].note, i) + ' string: ' + (f === -1 ? 'muted' : f === 0 ? 'open' : 'fretted') + '. Toggle open or muted'}
                  onClick={() => actions.toggleNut(i)}
                >
                  <span className={s.nutLabel}>{stringLabel(T[i].note, i)}</span>
                  <span style={{ textAlign: 'center' }}>{f === -1 ? '✕' : f === 0 ? '○' : ''}</span>
                </button>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={s.cell} aria-label={'Fret ' + (baseFret + n - 1) + ' on ' + stringLabel(T[i].note, i)} aria-pressed={f === n} onClick={() => actions.setFret(i, n)}>
                    <span className={s.fdot} data-on={f === n} />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        {showFretNote && <div className={s.fretNote}>{fretNote}</div>}
        <div className={s.btns}>
          <button className="btn-gold" onClick={() => actions.strum()}>
            Strum
          </button>
          <button className="btn-ghost" onClick={() => actions.setTarget([-1, -1, -1, -1, -1, -1], 1)}>
            Clear
          </button>
        </div>
        <div className={s.presets}>
          <div className={`kicker ${s.sectionKicker}`}>COMMON CHORDS</div>
          <div className={s.wrap}>
            {COMMON.map((c) => {
              const r = identifyFrets(c.frets, 1, setup);
              const nm = r.root != null ? r.name : '?';
              return (
                <button key={c.label} className={s.preset} onClick={() => actions.setTarget(c.frets, 1)}>
                  <span>{nm}</span>
                  {nm !== c.label && <span className={s.presetSub}>played as {c.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
