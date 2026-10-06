import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { Shell } from './features/shell/Shell';
import { attachEngine, hydrate, useStore } from './state/store';
import { engine } from './audio/engine';
import './styles/global.css';

async function boot() {
  await hydrate();
  attachEngine();
  // Browsers keep audio suspended until a gesture; any tap or key starts it.
  const wake = () => engine.resume();
  document.addEventListener('pointerdown', wake);
  document.addEventListener('keydown', wake);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
  // Always listening by default: open the input straight away.
  const s = useStore.getState();
  engine.listening = s.listening;
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
