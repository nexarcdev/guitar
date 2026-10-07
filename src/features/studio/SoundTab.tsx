import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { engine } from '../../audio/engine';
import type { DeviceInfo } from '../../core/protocol';
import { actions, useStore } from '../../state/store';
import { LevelBar } from '../gauges/Gauges';
import { Options, Section } from './Section';
import s from './Studio.module.css';

const NONE: DeviceInfo[] = [];

export function SoundTab() {
  const { output, outputs, outputId, can, onEngine, delay, mlOn, ml, backend, latency } = useStore(
    useShallow((x) => ({
      output: x.output,
      outputs: x.engine.status?.outputs ?? NONE,
      outputId: x.session?.outputId ?? '',
      can: x.engine.canPickOutput,
      onEngine: x.engine.channel === 'engine',
      delay: Math.round(x.engine.status?.latency?.totalMs ?? 0),
      mlOn: x.session?.ml ?? true,
      ml: x.engine.ml,
      backend: x.engine.mlBackend,
      latency: x.latency,
    })),
  );
  const [initialLatency] = useState(latency);
  const where = backend === 'native' ? 'engine' : backend === 'webgl' ? 'GPU' : backend === 'wasm' ? 'CPU' : backend;
  const mlStatus = !mlOn ? 'Off' : ml === 'ready' ? 'On · ' + where : ml === 'loading' ? 'Loading' : ml === 'slow' ? 'Paused: too slow here' : ml === 'unavailable' ? 'Unavailable' : 'On';

  return (
    <>
      <Section
        title="Output"
        status={output ? (delay ? 'On · about ' + delay + ' ms' : 'On') : 'Off'}
        tone={output ? 'ok' : undefined}
        desc={
          onEngine
            ? 'Your guitar through the pedals to the speakers, played by Fretline Engine.'
            : 'Your guitar through the pedals to the speakers. Use headphones so the speakers don’t feed back into a microphone.'
        }
      >
        <Options
          label="Output"
          value={output}
          onChange={(v) => actions.setOutput(v)}
          options={[
            [true, 'On', 'Hear your guitar'],
            [false, 'Off', 'Listen only'],
          ]}
        />
        <LevelBar kind="out" size="large" />
        <div className={s.row}>
          <button className={s.testBtn} onClick={() => { engine.resume(); engine.reference(440); }}>
            Play a test tone
          </button>
          <span className={s.desc} style={{ margin: 0 }}>The gauge should move. If it moves and you hear nothing, the sound is muted after it leaves Fretline.</span>
        </div>
      </Section>

      {can && outputs.length > 0 && (
        <Section title="Speakers" desc="Headphones on your audio interface are usually much quicker than laptop speakers.">
          <Options
            label="Speakers"
            value={outputId}
            onChange={(id) => actions.setSession({ outputId: id })}
            options={[{ id: '', name: onEngine ? 'Windows default' : 'System default' }, ...outputs].map((d) => [d.id, d.name] as [string, string])}
          />
        </Section>
      )}

      <Section
        title="Chord detection"
        status={mlStatus}
        tone={mlOn && ml === 'ready' ? 'ok' : ml === 'slow' || ml === 'unavailable' ? 'warn' : undefined}
        desc="Full chords and exact notes in the tab stream, from a neural network. Off leaves single notes and chord names from the spectrum."
      >
        <Options
          label="Chord detection"
          value={mlOn}
          onChange={(v) => actions.setSession({ ml: v })}
          options={[
            [true, 'On', 'Full chords in the tab stream'],
            [false, 'Off', 'Lighter on older computers'],
          ]}
        />
      </Section>

      {!onEngine && (
        <Section
          title="Browser audio buffers"
          status={latency !== initialLatency ? 'Reload to apply' : ''}
          tone={latency !== initialLatency ? 'warn' : undefined}
          desc="Smaller buffers mean less delay through Output; larger ones survive a busy computer. Fretline Engine replaces this with a few milliseconds."
        >
          <Options
            label="Audio buffers"
            value={latency}
            onChange={(v) => useStore.setState({ latency: v })}
            options={[
              ['lowest', 'Lowest', 'Smallest delay'],
              ['interactive', 'Low', 'If Lowest crackles'],
              ['playback', 'Safe', 'If sound breaks up'],
            ]}
          />
          {latency !== initialLatency && (
            <div className={s.row}>
              <button className={s.testOk} onClick={() => setTimeout(() => location.reload(), 300)}>
                Reload now
              </button>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
