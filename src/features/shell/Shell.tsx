import { lazy, Suspense, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, actions, type TabId } from '../../state/store';
import { linkProps, DEV } from '../../state/router';
import type { Route } from '../../state/routes';
import { engine } from '../../audio/engine';
import { tuningName } from '../../theory/music';
import { Tuner } from '../tuner/Tuner';
import { Studio } from '../studio/Studio';
import { LevelMeter } from '../gauges/Gauges';
import { Lamp, Switch, cx } from '../../ui';
import { Contained } from './Contained';
import { NotFound } from './NotFound';
import { Tutor } from './Tutor';
import s from './Shell.module.css';

const Chords = lazy(() => import('../chords/Chords').then((m) => ({ default: m.Chords })));
const Tabs = lazy(() => import('../tabs/Tabs').then((m) => ({ default: m.Tabs })));
const Pedals = lazy(() => import('../pedals/Pedals').then((m) => ({ default: m.Pedals })));
const Learn = lazy(() => import('../learn/Learn').then((m) => ({ default: m.Learn })));
// The component reference sheet is a development tool: production builds leave it out entirely.
const Design = DEV ? lazy(() => import('../design/Design').then((m) => ({ default: m.Design }))) : null;

const NAV: Array<[TabId, string]> = [
  ['tuner', 'Tuner'],
  ['chords', 'Chords'],
  ['tabs', 'Tabs'],
  ['pedals', 'Pedals'],
  ['learn', 'Learn'],
];
const VIEW_NAMES: Record<TabId, string> = { tuner: 'Tuner', chords: 'Chords', tabs: 'Tab stream', pedals: 'Pedalboard', learn: 'Learn' };

export function Shell() {
  const { route, tab, learnModule } = useStore(useShallow((x) => ({ route: x.route, tab: x.tab, learnModule: x.learnModule })));
  const main = useRef<HTMLElement>(null);

  // A new view starts at the top. (Block body: scrollTo returns a Promise in current Chrome.)
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [tab, learnModule]);

  return (
    <div className={s.app}>
      <Header />
      <div className={s.stripe} aria-hidden>
        <div className={s.sheen} />
      </div>
      <main ref={main} className={s.main} id="main">
        <MicBanner />
        {route.kind === 'design' && Design ? (
          <Suspense fallback={null}>
            <Design />
          </Suspense>
        ) : route.kind === 'notfound' ? (
          <NotFound path={route.path} />
        ) : (
          <Contained key={tab} what={'The ' + VIEW_NAMES[tab] + ' view'}>
            <Suspense fallback={null}>
              {tab === 'tuner' && <Tuner />}
              {tab === 'chords' && <Chords />}
              {tab === 'tabs' && <Tabs />}
              {tab === 'pedals' && <Pedals />}
              {tab === 'learn' && <Learn />}
            </Suspense>
          </Contained>
        )}
      </main>
      <Tutor key={route.kind === 'notfound' || route.kind === 'design' ? route.kind : tab} />
      <Studio />
    </div>
  );
}

function Header() {
  const { tab, learnModule, setup, listening, output, live, studio, lost } = useStore(
    useShallow((x) => ({
      lost: x.route.kind === 'notfound' || x.route.kind === 'design',
      tab: x.tab,
      learnModule: x.learnModule,
      setup: x.setup,
      listening: x.listening,
      output: x.output,
      live: x.engine.mic === 'live' && x.engine.running,
      studio: x.setupOpen,
    })),
  );
  const routeOf = (id: TabId): Route => (id === 'learn' ? { kind: 'learn', module: learnModule } : { kind: 'page', page: id });

  return (
    <header className={s.header}>
      <div className={s.brand}>Fretline</div>
      <nav className={s.nav} aria-label="Pages">
        {NAV.map(([id, label]) => {
          const on = !lost && tab === id;
          return (
            <a key={id} className={s.navLink} aria-current={on ? 'page' : undefined} {...linkProps(routeOf(id))}>
              <Lamp shape="bar" tone={on ? 'on' : 'off'} surface="alu" />
              {label}
            </a>
          );
        })}
      </nav>
      <div className={s.cluster}>
        <a className={cx(s.readout, s.levels)} aria-label="Levels: open Studio input" title="Guitar in and speakers out" {...linkProps({ kind: 'studio', tab: 'input' })}>
          <LevelMeter kind="in" label="In" height={6} />
          <LevelMeter kind="out" label="Out" height={6} />
        </a>
        <a className={cx(s.readout, s.tuning)} title="Tuning and capo" aria-label={`Tuning: ${tuningName(setup.offsets)}${setup.capo ? ', capo ' + setup.capo : ''}. Open Studio guitar`} {...linkProps({ kind: 'studio', tab: 'guitar' })}>
          <span className={s.tLabel}>Tuning</span>
          <span className={s.tValue}>{tuningName(setup.offsets)}</span>
          <span className={s.tSub}>{setup.capo ? `Capo ${setup.capo}` : 'A 440 Hz'}</span>
        </a>
        <div className={s.switches}>
          <Switch vertical surface="alu" tone="live" on={listening} pulse={listening && live} label="Listen" ariaLabel={listening ? 'Pause listening' : 'Resume listening'} onToggle={(v) => actions.setListening(v)} />
          <Switch vertical surface="alu" tone="on" on={output} label="Output" ariaLabel={output ? 'Turn output off' : 'Turn output on'} onToggle={(v) => actions.setOutput(v)} />
          <a className={s.studioBtn} aria-label="Studio" title="Studio: guitar, input, sound, engine" aria-current={studio ? 'page' : undefined} {...linkProps({ kind: 'studio', tab: 'guitar' })}>
            <span className={s.studioWell} data-on={studio}>
              <span />
              <span />
              <span />
            </span>
            Studio
          </a>
        </div>
      </div>
    </header>
  );
}

/** Real input states: tell the player exactly what's missing. */
function MicBanner() {
  const listening = useStore((x) => x.listening);
  const output = useStore((x) => x.output);
  const mic = useStore((x) => x.engine.mic);
  const running = useStore((x) => x.engine.running);
  if (!(listening || output)) return null;
  if (mic === 'live' && running) return null;
  const retry = () => engine.retryInput();
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
    <div className="notice" role="status">
      <span>{text}</span>
      {action && (
        <button className="notice-btn" onClick={action[1]}>
          {action[0]}
        </button>
      )}
    </div>
  );
}
