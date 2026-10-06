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
registerSW({ immediate: true });
