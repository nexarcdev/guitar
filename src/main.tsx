import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Shell } from './features/shell/Shell';
import { actions, attachEngine, hydrate, useStore } from './state/store';
import { engine } from './audio/engine';
import './styles/global.css';

async function boot() {
  await hydrate();
  attachEngine();
  // End-to-end tests drive and inspect the app through this (only with ?debug in the URL).
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __fretline: { useStore, engine, actions } });
  // Browsers keep audio suspended until a gesture; any tap or key starts it.
  const wake = () => engine.resume();
  document.addEventListener('pointerdown', wake);
  document.addEventListener('keydown', wake);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
  // Always listening by default: open the input straight away (unless the low-latency engine
  // answers first, in which case it owns the guitar).
  const s = useStore.getState();
  engine.listening = s.listening;
  if (s.nativeOn && (await engine.waitForNative(1500))) return;
  engine.start(s.deviceId);
}

boot();
// New builds install in the background; check on load, when the tab regains focus, and every
// 30 minutes, then reload into the new version (autoUpdate) so nobody is stuck on an old build.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => reg.update().catch(() => {});
    setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  },
});
