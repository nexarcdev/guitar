// The Studio: everything about your guitar, your audio and how Fretline listens, full screen.
// Desktop: a tab rail on the left. Mobile: a top bar with Done and a bottom tab bar.

import { useEffect, useRef } from 'react';
import { useStore, type StudioTab } from '../../state/store';
import { setupStr } from '../../theory/music';
import { GuitarTab } from './GuitarTab';
import { InputTab } from './InputTab';
import { SoundTab } from './SoundTab';
import { EngineTab } from './EngineTab';
import { BUILT, DiagnosticsTab } from './DiagnosticsTab';
import { Contained } from '../shell/Contained';
import s from './Studio.module.css';

const TABS: Array<[StudioTab, string, string]> = [
  ['guitar', 'Guitar', '♩'],
  ['input', 'Input', '◐'],
  ['sound', 'Sound', '♫'],
  ['engine', 'Engine', '⚡'],
  ['diagnostics', 'Diagnostics', 'ⓘ'],
];
const TITLES: Record<StudioTab, string> = { guitar: 'Your guitar', input: 'Input', sound: 'Sound', engine: 'Low-latency engine', diagnostics: 'Diagnostics' };

export function Studio() {
  const open = useStore((x) => x.setupOpen);
  const tab = useStore((x) => x.studioTab);
  const setup = useStore((x) => x.setup);
  const done = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const close = () => useStore.setState({ setupOpen: false });

  useEffect(() => {
    if (!open) return;
    done.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  // Braces matter: scrollTo returns a Promise in current Chrome, and React would call it as the cleanup.
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [tab]);

  if (!open) return null;
  const select = (t: StudioTab) => useStore.setState({ studioTab: t });
  const tabs = (
    <>
      {TABS.map(([id, label, icon]) => (
        <button key={id} role="tab" id={'studio-tab-' + id} aria-selected={tab === id} aria-controls="studio-panel" className={s.tabBtn} onClick={() => select(id)}>
          <span className={s.tabIcon} aria-hidden>
            {icon}
          </span>
          {label}
        </button>
      ))}
    </>
  );

  return (
    <div className={s.studio} role="dialog" aria-modal="true" aria-label="Studio">
      <nav className={s.side} role="tablist" aria-label="Studio sections" aria-orientation="vertical">
        <div className={s.sideTitle}>Studio</div>
        <div className={s.sideSub}>{setupStr(setup)}</div>
        {tabs}
        <div style={{ marginTop: 'auto', padding: '0 10px', fontSize: 11, color: 'var(--muted-2)' }}>{'Fretline ' + __APP_VERSION__ + ' · ' + BUILT}</div>
      </nav>
      <div className={s.body}>
        <div className={s.topBar}>
          <div style={{ minWidth: 0 }}>
            <div className={s.topSub}>STUDIO</div>
            <div className={s.topTitle}>{TITLES[tab]}</div>
          </div>
          <button ref={done} className={s.done} onClick={close}>
            Done
          </button>
        </div>
        <div ref={content} className={s.content} id="studio-panel" role="tabpanel" aria-labelledby={'studio-tab-' + tab}>
          <div className={s.inner}>
            <Contained key={tab} what={'The ' + TABS.find((t) => t[0] === tab)![1] + ' tab'}>
              {tab === 'guitar' && <GuitarTab />}
              {tab === 'input' && <InputTab />}
              {tab === 'sound' && <SoundTab />}
              {tab === 'engine' && <EngineTab />}
              {tab === 'diagnostics' && <DiagnosticsTab />}
            </Contained>
          </div>
        </div>
        <nav className={s.bottomTabs} role="tablist" aria-label="Studio sections">
          {tabs}
        </nav>
      </div>
    </div>
  );
}
