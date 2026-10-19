// The Studio: everything about your guitar, your audio and how Fretline listens, full screen.
// An aluminum tab rail on the left (a strip across the top on phones), sections on the right.

import { useEffect, useRef } from 'react';
import { useStore, type StudioTab } from '../../state/store';
import { closeStudio, navigate, tabRoute } from '../../state/router';
import { tuningName } from '../../theory/music';
import { Button, Lamp } from '../../ui';
import { GuitarTab } from './GuitarTab';
import { InputTab } from './InputTab';
import { SoundTab } from './SoundTab';
import { EngineTab } from './EngineTab';
import { BUILT, DiagnosticsTab } from './DiagnosticsTab';
import { Contained } from '../shell/Contained';
import s from './Studio.module.css';

const TABS: Array<[StudioTab, string]> = [
  ['guitar', 'Guitar'],
  ['input', 'Input'],
  ['sound', 'Sound'],
  ['engine', 'Engine'],
  ['diagnostics', 'Diagnostics'],
];
const TITLES: Record<StudioTab, string> = { guitar: 'Your guitar', input: 'Input', sound: 'Sound', engine: 'Low-latency engine', diagnostics: 'Diagnostics' };

export function Studio() {
  const open = useStore((x) => x.setupOpen);
  const tab = useStore((x) => x.studioTab);
  const setup = useStore((x) => x.setup);
  const top = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const close = () => closeStudio(tabRoute(useStore.getState()));

  useEffect(() => {
    if (!open) return;
    top.current?.querySelector<HTMLButtonElement>('[data-done]')?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  // Braces matter: scrollTo returns a Promise in current Chrome, and React would call it as the cleanup.
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [tab]);

  if (!open) return null;
  const select = (t: StudioTab) => navigate({ kind: 'studio', tab: t }, { replace: true });

  return (
    <div className={s.studio} role="dialog" aria-modal="true" aria-label="Studio">
      <nav className={s.rail} role="tablist" aria-label="Studio sections" aria-orientation="vertical">
        <div className={s.railTitle}>Studio</div>
        <div className={s.railSub}>{tuningName(setup.offsets) + ' · A440 · ' + (setup.capo ? 'capo ' + setup.capo : 'no capo')}</div>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={'studio-tab-' + id} aria-selected={tab === id} aria-controls="studio-panel" className={s.tab} onClick={() => select(id)}>
            <Lamp shape="bar" length={4} size={22} tone={tab === id ? 'on' : 'off'} surface="alu" />
            {label}
          </button>
        ))}
        <div className={s.railFoot}>{'Fretline ' + __APP_VERSION__ + ' · built ' + BUILT}</div>
      </nav>
      <div className={s.body}>
        <div ref={top} className={s.top}>
          <div className={s.topTitles}>
            <div className={s.kicker}>Studio</div>
            <div className={s.heading}>{TITLES[tab]}</div>
          </div>
          <Button data-done variant="primary" className={s.done} onClick={close}>
            Done
          </Button>
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
      </div>
    </div>
  );
}
