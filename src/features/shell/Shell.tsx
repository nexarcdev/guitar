import { lazy, Suspense } from 'react';
import { useStore, actions, type TabId } from '../../state/store';
import { engine } from '../../audio/engine';
import { setupStr } from '../../theory/music';
import { Tuner } from '../tuner/Tuner';
import { SetupSheet } from '../setup/SetupSheet';
import s from './Shell.module.css';

const Chords = lazy(() => import('../chords/Chords').then((m) => ({ default: m.Chords })));
const Tabs = lazy(() => import('../tabs/Tabs').then((m) => ({ default: m.Tabs })));
const Pedals = lazy(() => import('../pedals/Pedals').then((m) => ({ default: m.Pedals })));

const NAV: Array<[TabId, string, string]> = [
  ['tuner', 'Tuner', '◎'],
  ['chords', 'Chords', '⌗'],
  ['tabs', 'Tabs', '≣'],
  ['pedals', 'Pedals', '▣'],
];
const TITLES: Record<TabId, string> = { tuner: 'Tuner', chords: 'Chord identifier', tabs: 'Tab stream', pedals: 'Pedalboard' };

export function Shell() {
  const tab = useStore((x) => x.tab);
  const setup = useStore((x) => x.setup);
  const listening = useStore((x) => x.listening);
  const output = useStore((x) => x.output);
  const mic = useStore((x) => x.engine.mic);
  const running = useStore((x) => x.engine.running);
  const live = mic === 'live' && running;

  const listenText = !listening ? 'Paused' : live ? 'Listening' : mic === 'live' ? 'Tap to start' : mic === 'starting' ? 'Starting' : 'No input';

  return (
    <div className={s.app}>
      <nav className={s.rail} aria-label="Sections">
        <div className={s.brand}>
          <div className={s.logo} />
          <div className={s.wordmark}>FRETLINE</div>
        </div>
        {NAV.map(([id, label, icon]) => (
          <button key={id} className={s.navBtn} aria-label={label} aria-current={tab === id ? 'page' : undefined} onClick={() => actions.selectTab(id)}>
            <span className={s.navIcon} aria-hidden>{icon}</span>
            <span className={s.navLabel}>{label}</span>
          </button>
        ))}
      </nav>
      <main className={s.main}>
        <header className={s.header}>
          <div className={s.titleWrap}>
            <div className={s.mobileLogo} />
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div className="kicker">FRETLINE</div>
              <h1 className={s.title}>{TITLES[tab]}</h1>
            </div>
          </div>
          <div className={s.chips}>
            <button className={s.setupChip} onClick={() => useStore.setState({ setupOpen: true })}>
              <span style={{ fontSize: 15, lineHeight: 1 }} aria-hidden>♩</span>
              {setupStr(setup)}
            </button>
            <button
              className={`${s.chip} ${listening && live ? s.chipLive : ''}`}
              aria-label={listening ? 'Pause listening' : 'Resume listening'}
              aria-pressed={listening}
              onClick={() => actions.setListening(!listening)}
            >
              <span className={`${s.dot} ${listening && live ? s.dotLive : ''}`} />
              {listenText}
            </button>
            <button
              className={`${s.chip} ${output ? s.chipOn : ''}`}
              aria-label={output ? 'Turn output off' : 'Turn output on'}
              aria-pressed={output}
              onClick={() => actions.setOutput(!output)}
            >
              <span className={`${s.square} ${output ? s.squareOn : ''}`} />
              {output ? 'Output on' : 'Output off'}
            </button>
          </div>
        </header>
        <MicBanner />
        <Suspense fallback={null}>
          {tab === 'tuner' && <Tuner />}
          {tab === 'chords' && <Chords />}
          {tab === 'tabs' && <Tabs />}
          {tab === 'pedals' && <Pedals />}
        </Suspense>
      </main>
      <SetupSheet />
      <nav className={s.bottomNav} aria-label="Sections">
        {NAV.map(([id, label, icon]) => (
          <button key={id} className={s.bottomBtn} aria-current={tab === id ? 'page' : undefined} onClick={() => actions.selectTab(id)}>
            <span className={s.navIcon} aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Real input states replace the old demo guitar: tell the player exactly what's missing. */
function MicBanner() {
  const listening = useStore((x) => x.listening);
  const output = useStore((x) => x.output);
  const mic = useStore((x) => x.engine.mic);
  const running = useStore((x) => x.engine.running);
  const deviceId = useStore((x) => x.deviceId);
  if (!(listening || output)) return null;
  if (mic === 'live' && running) return null;
  const retry = () => engine.start(deviceId);
  let text: string;
  let action: [string, () => void] | null = ['Try again', retry];
  switch (mic) {
    case 'insecure':
      text = 'Fretline needs a secure (https) connection to use your microphone.';
      action = null;
      break;
    case 'denied':
      text = 'Microphone access is blocked. Allow it for this site in your browser’s settings, then try again.';
      break;
    case 'nodevice':
      text = 'No microphone or audio interface found. Plug one in, then try again.';
      break;
    case 'error':
      text = 'The microphone couldn’t start. Close other apps that might be using it, then try again.';
      break;
    case 'live':
      text = 'Your browser waits for a tap before it plays or listens to audio.';
      action = ['Start audio', () => engine.resume()];
      break;
    default:
      text = 'Fretline listens through your microphone or audio interface. Allow access when your browser asks.';
      action = mic === 'starting' ? null : ['Allow microphone', retry];
  }
  return (
    <div className={`notice ${s.banner}`} role="status">
      <span>{text}</span>
      {action && (
        <button className="notice-btn" onClick={action[1]}>
          {action[0]}
        </button>
      )}
    </div>
  );
}
