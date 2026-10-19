import { useShallow } from 'zustand/react/shallow';
import { engine } from '../../audio/engine';
import { ENGINE_DOWNLOAD } from '../../audio/engineChannel';
import { actions, useStore } from '../../state/store';
import { Button, Note } from '../../ui';
import { Options, Section, Warn } from './Section';
import { Breakdown } from './DiagnosticsTab';
import { EngineHealth } from './EngineHealth';
import s from './Studio.module.css';

/**
 * Fretline Engine: Chrome on Windows can't get under ~50 ms from string to speaker, so the
 * guitar, pedals, looper and sounds can move to a small native app that plays in a few
 * milliseconds and listens with the same core.
 */
export function EngineTab() {
  const { on, conn, version, st, onEngine, exIn, exOut } = useStore(
    useShallow((x) => ({
      on: x.engineOn,
      conn: x.engine.engine,
      version: x.engine.engineVersion,
      st: x.engine.status,
      onEngine: x.engine.channel === 'engine',
      exIn: x.session?.exclusiveInput ?? true,
      exOut: x.session?.exclusiveOutput ?? false,
    })),
  );
  const set = (engineOn: boolean) => useStore.setState({ engineOn });
  const status = !on ? 'Not in use' : onEngine ? 'Connected · ' + version : conn === 'outdated' ? 'Needs an update' : 'Looking for it';
  const tone = !on ? undefined : onEngine ? (st?.error ? 'bad' : 'ok') : conn === 'outdated' ? 'bad' : 'warn';

  return (
    <>
      <Section
        title="Fretline Engine"
        status={status}
        tone={tone}
        desc="A small Windows app that plays your guitar, pedals, looper and Fretline's sounds a few milliseconds from the strings, and does the listening too. Without it, the browser adds about 40 ms."
      >
        {!on && (
          <>
            <div className={s.row}>
              <Button variant="tutor" className={s.download} href={ENGINE_DOWNLOAD}>
                Download for Windows
              </Button>
              <Button variant="cream" size="sm" className={s.tall} onClick={() => set(true)}>
                I've installed it, connect
              </Button>
            </div>
            <Note>
              <div>
                The installer isn't code-signed yet. If Windows SmartScreen warns, choose <b>More info</b>, then <b>Run anyway</b>.
              </div>
              <div style={{ marginTop: 6 }}>
                When Chrome asks to let this site connect to devices on your network, choose <b>Allow</b>: that's how Fretline reaches the engine on
                this computer. Nothing leaves your machine.
              </div>
            </Note>
          </>
        )}
        {on && !onEngine && (
          <>
            <p className={s.desc}>
              {conn === 'outdated'
                ? 'The engine on this computer (' + (version || 'unknown') + ') is from an older Fretline. Install the latest one; the installer replaces it.'
                : 'Start Fretline Engine from the Start menu; it sits in the notification area. Until then, Fretline uses the browser’s audio.'}
            </p>
            {conn === 'absent' && (
              <p className={s.desc}>
                Engine running but still not found? Click the icon left of the address bar, open <b>Site settings</b>, and allow <b>Local network access</b>.
              </p>
            )}
            <div className={s.row}>
              <Button variant="tutor" className={s.download} href={ENGINE_DOWNLOAD}>
                Download
              </Button>
              <Button variant="cream" size="sm" className={s.tall} onClick={() => engine.retryEngine()}>
                Try again
              </Button>
              <button type="button" className={s.link} onClick={() => set(false)}>
                Stop using the engine
              </button>
            </div>
          </>
        )}
        {onEngine && (
          <>
            {st?.error && <Warn>{st.error}</Warn>}
            <Breakdown />
            <div className={s.row}>
              <button type="button" className={s.link} onClick={() => set(false)}>
                Stop using the engine
              </button>
            </div>
          </>
        )}
      </Section>

      {onEngine && (
        <>
          <Section title="Guitar input mode" desc="Exclusive gives the engine the input to itself: shortest path, and Windows input effects can't touch the guitar.">
            <Options
              label="Guitar input mode"
              value={exIn}
              onChange={(v) => actions.setSession({ exclusiveInput: v })}
              options={[
                [true, 'Exclusive', 'Recommended'],
                [false, 'Shared', 'If another app needs this input too'],
              ]}
            />
          </Section>
          <Section title="Speakers mode" desc="Exclusive is the lowest delay, but other apps go quiet while Fretline plays.">
            <Options
              label="Speakers mode"
              value={exOut}
              onChange={(v) => actions.setSession({ exclusiveOutput: v })}
              options={[
                [false, 'Shared', 'Other apps keep playing'],
                [true, 'Exclusive', 'Lowest delay'],
              ]}
            />
          </Section>
          <EngineHealth />
        </>
      )}
    </>
  );
}
