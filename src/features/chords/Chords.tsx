import { useShallow } from 'zustand/react/shallow';
import { useStore, actions } from '../../state/store';
import { engine } from '../../audio/engine';
import {
  absFret, fretMidi, identifyShape, noteName, openStrings, ord, pcOf, PRESETS, stringLabel, tuningName,
  type Shape,
} from '../../theory/music';
import s from './Chords.module.css';

export function Chords() {
  const st = useStore(
    useShallow((x) => ({
      setup: x.setup, frets: x.frets, baseFret: x.baseFret, heard: x.heard, history: x.history, chordMode: x.chordMode,
      chroma: x.chroma, mlRecent: x.mlRecent, listening: x.listening, live: x.engine.mic === 'live' && x.engine.running,
    })),
  );
  const { setup, frets, baseFret, heard, history, chordMode, chroma, mlRecent, listening, live } = st;
  const T = openStrings(setup.offsets);
  const confirm = chordMode === 'confirm';
  const hearing = listening && live;
  const setFrets = (f: Shape) => useStore.setState({ frets: f });

  const ch = identifyShape(frets, baseFret, setup);
  let chordSub = ch.sub;
  if (setup.capo && ch.root != null) {
    const shape = identifyShape(frets, baseFret, { ...setup, capo: 0 });
    if (shape.root != null && shape.name !== ch.name) chordSub = shape.name + ' shape · ' + ch.sub;
  }

  // Confirm: a string counts as heard when its pitch class is in the chroma, or when the ML pass
  // heard that exact pitch (octave-accurate) in the last couple of seconds.
  const clock = engine.clock();
  const played: Array<{ i: number; pc: number; midi: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const f = frets[i];
    if (f >= 0) {
      const midi = fretMidi(i, absFret(f, baseFret), setup);
      played.push({ i, pc: pcOf(midi), midi });
    }
  }
  const heardSet = new Set(
    hearing
      ? played.filter((p) => (chroma[p.pc] ?? 0) > 0.25 || mlRecent.some((m) => m.midi === p.midi && clock - m.t < 2.5)).map((p) => p.i)
      : [],
  );
  const nHeard = heardSet.size;
  const allHeard = played.length > 0 && nHeard === played.length;

  const kicker = !listening
    ? 'PAUSED' + (confirm ? '' : ' · LAST HEARD')
    : !live ? 'NO INPUT' : confirm ? 'CONFIRMING' : 'HEARING';
  const confirmSub = !played.length
    ? 'Set a shape on the right to confirm it'
    : !listening ? 'Resume listening to confirm'
    : !live ? 'Waiting for your guitar'
    : allHeard ? '✓ Confirmed · all ' + played.length + ' strings heard'
    : nHeard ? nHeard + ' of ' + played.length + ' strings heard'
    : 'Play ' + ch.name + ', waiting for ' + played.length + ' strings';

  const tn = tuningName(setup.offsets);
  const showFretNote = setup.capo > 0 || tn !== 'Standard';
  const fretNote = (setup.capo ? 'Fret numbers count from the capo on the ' + ord(setup.capo) + ' fret. ' : '') + (tn !== 'Standard' ? 'Strings tuned ' + T.map((x) => x.note).join(' ') + '.' : '');

  return (
    <>
      <div className={`segmented ${s.modes}`} role="group" aria-label="Mode">
        {([['identify', 'Identify'], ['confirm', 'Confirm']] as const).map(([id, label]) => (
          <button key={id} className={s.modeBtn} aria-pressed={chordMode === id} onClick={() => useStore.setState({ chordMode: id, chroma: [] })}>
            {label}
          </button>
        ))}
      </div>
      <div className={s.grid}>
        <div className={s.col}>
          <div className={`kicker ${s.hearKicker}`}>
            <span className={s.dot} data-live={hearing} />
            {kicker}
          </div>
          {!confirm ? (
            <div className={s.panel} data-dim={!hearing} aria-live="polite">
              <div className={`${s.big} ${s.gradient}`}>{heard ? heard.name : '·'}</div>
              <div className={s.sub}>
                {heard ? heard.sub : listening ? 'Strum a chord and it shows up here' : 'Resume listening to identify chords'}
              </div>
              <div className={s.pills}>
                {heard?.notes.map((p) => (
                  <span key={p} className={`${s.pill} ${p === heard.root ? s.pillRoot : ''}`}>
                    {noteName(p, setup.offsets)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className={s.panel} data-dim={!hearing} data-ok={allHeard} aria-live="polite">
                <div className={s.big} style={{ color: allHeard ? 'var(--green)' : played.length ? 'var(--ink)' : 'var(--muted)', transition: 'color .3s' }}>
                  {ch.name}
                </div>
                <div className={`${s.sub} ${allHeard ? s.subOk : ''}`}>{confirmSub}</div>
                <div className={s.pills}>
                  {played.map((p) => (
                    <span key={p.i} className={`${s.pill} ${heardSet.has(p.i) ? s.pillHeard : s.pillWait}`}>
                      {noteName(p.pc, setup.offsets)}
                    </span>
                  ))}
                </div>
              </div>
              <div className={s.help}>Set the shape on the right, then play it. Each string lights green as it's heard.</div>
            </>
          )}
          {history.length > 0 && (
            <div className={s.section}>
              <div className={`kicker ${s.sectionKicker}`}>PROGRESSION · TAP ONE TO SEE ITS SHAPE</div>
              <div className={s.wrap}>
                {[...history].reverse().map((h, i, a) => (
                  <button
                    key={i}
                    className={s.histBtn}
                    data-last={i === a.length - 1}
                    data-shape={!!h.frets}
                    onClick={() => h.frets && useStore.setState({ frets: [...h.frets] as unknown as Shape, baseFret: 1 })}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={s.col}>
          <div className={s.shapeHead}>
            <div className="kicker">SHAPE</div>
            <div className={s.shapeName}>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--gold-hi)' }}>{ch.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>{chordSub}</span>
            </div>
          </div>
          <div className={s.fretRow}>
            <button className={s.chev} style={{ justifySelf: 'start' }} aria-label="Lower frets" disabled={baseFret <= 1} onClick={() => useStore.setState({ baseFret: Math.max(1, baseFret - 1) })}>
              ‹
            </button>
            {[0, 1, 2, 3, 4].map((k) => (
              <div key={k} className={s.fretNum}>
                {baseFret + k}
              </div>
            ))}
            <button className={s.chev} style={{ justifySelf: 'end' }} aria-label="Higher frets" disabled={baseFret >= 12} onClick={() => useStore.setState({ baseFret: Math.min(12, baseFret + 1) })}>
              ›
            </button>
          </div>
          <div className={s.board}>
            {[5, 4, 3, 2, 1, 0].map((i) => {
              const f = frets[i];
              const h = confirm && heardSet.has(i);
              const nutColor = f === -1 ? 'var(--red)' : h ? 'var(--green)' : f === 0 ? 'var(--gold)' : 'var(--muted)';
              return (
                <div key={i} className={s.string} data-heard={h}>
                  <button
                    className={s.nut}
                    style={{ color: nutColor }}
                    aria-label={stringLabel(T[i].note, i) + ' string: ' + (f === -1 ? 'muted' : f === 0 ? 'open' : 'fretted') + '. Toggle open or muted'}
                    onClick={() => {
                      const fr = [...frets] as number[];
                      fr[i] = f === -1 ? 0 : -1;
                      setFrets(fr as unknown as Shape);
                    }}
                  >
                    <span className={s.nutLabel}>{stringLabel(T[i].note, i)}</span>
                    <span style={{ textAlign: 'center' }}>{f === -1 ? '✕' : f === 0 ? '○' : ''}</span>
                  </button>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={s.cell}
                      aria-label={'Fret ' + (baseFret + n - 1) + ' on ' + stringLabel(T[i].note, i)}
                      aria-pressed={f === n}
                      onClick={() => {
                        const fr = [...frets] as number[];
                        fr[i] = f === n ? 0 : n;
                        setFrets(fr as unknown as Shape);
                      }}
                    >
                      <span className={s.fdot} data-on={f === n} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          {showFretNote && <div className={s.fretNote}>{fretNote}</div>}
          <div className={s.btns}>
            <button className="btn-gold" onClick={actions.strum}>
              Strum
            </button>
            <button className="btn-ghost" onClick={() => setFrets([-1, -1, -1, -1, -1, -1])}>
              Clear
            </button>
          </div>
          <div className={s.presets}>
            <div className={`kicker ${s.sectionKicker}`}>COMMON SHAPES</div>
            <div className={s.wrap}>
              {Object.keys(PRESETS).map((name) => {
                const r = identifyShape(PRESETS[name], 1, setup);
                const nm = r.root != null ? r.name : '?';
                return (
                  <button key={name} className={s.preset} onClick={() => useStore.setState({ frets: [...PRESETS[name]] as unknown as Shape, baseFret: 1 })}>
                    <span>{nm}</span>
                    {nm !== name && <span className={s.presetSub}>{name} shape</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
