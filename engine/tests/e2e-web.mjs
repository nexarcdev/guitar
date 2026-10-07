// End to end: the real Fretline web app in headless Chromium, switched to the engine through the
// Settings UI, with the engine on its device-free test backend (a looping plucked phrase:
// A2, D3, G3, then an A major chord, every 6 s).
//
// Usage: node e2e-web.mjs <fretline-engine binary> <app url, e.g. http://localhost:4180/>
// Needs Playwright (PLAYWRIGHT_MODULE overrides where it is imported from).
import { spawn } from 'node:child_process';

const [bin, appUrl] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

let engine = null;
const startEngine = () => {
  engine = spawn(bin, ['--test'], { stdio: ['ignore', 'ignore', 'inherit'] });
};
const stopEngine = async () => {
  engine?.kill();
  engine = null;
  await sleep(300);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  // The engine panel is offered on Windows.
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/ERR_CONNECTION_REFUSED|WebSocket connection/.test(m.text()) && errors.push(m.text()));

const app = (fn, arg) => page.evaluate(fn, arg);
const state = () => app(() => {
  if (!window.__fretline) return { booting: true, looper: { slots: [{}] } };
  const { useStore, engine } = window.__fretline;
  const s = useStore.getState();
  return {
    native: s.engine.native, mic: s.engine.mic, st: s.engine.nativeStatus, looper: s.looper, freq: s.freq, voiced: s.voiced,
    buf: s.buf.length, clock: engine.clock(), micOpen: engine.diagnostics().micOpen, outDb: engine.outputDb(), delay: engine.delayMs(),
  };
});
const waitFor = async (pred, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state();
    if (pred(s)) return s;
    await sleep(100);
  }
  return state();
};

try {
  startEngine();
  await page.goto(appUrl + '?debug');
  await page.mouse.click(5, 5);
  let s = await waitFor((x) => x.mic === 'live', 8000);
  check(s.mic === 'live' && s.native === 'off', `browser mic first (${s.mic}, engine ${s.native})`);

  await page.getByRole('button', { name: 'Settings', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: "I've installed it, connect" }).click();
  s = await waitFor((x) => x.native === 'connected' && x.st?.input, 5000);
  check(s.native === 'connected', `connected through Settings (${s.native})`);
  check(s.st?.input?.mode === 'test' && s.st.input.rate === 48000, `engine input ${s.st?.input?.name} at ${s.st?.input?.rate}`);
  check(!s.micOpen, 'browser mic released');
  await page.getByText('LOW-LATENCY ENGINE').scrollIntoViewIfNeeded();
  const panel = await page.getByLabel('Where the delay comes from').innerText().catch(() => '');
  check(/Input/.test(panel) && /Buffer/.test(panel) && /Output/.test(panel), 'Settings shows the engine latency breakdown');
  await page.getByRole('button', { name: 'Done' }).click();

  // Analysis runs on the engine's stream: the tuner and the tab stream hear the phrase.
  const heard = new Set();
  const c0 = s.clock;
  const t0 = Date.now();
  while (Date.now() - t0 < 7000) {
    const x = await state();
    if (x.voiced && x.freq > 0) heard.add(Math.round(69 + 12 * Math.log2(x.freq / 440)));
    await sleep(80);
  }
  s = await state();
  const notes = [...heard].sort((a, b) => a - b);
  check([45, 50, 55].every((m) => notes.includes(m)), `tuner heard A2 D3 G3 (midi ${notes.join(' ')})`);
  check(s.buf > 0, `tab stream has ${s.buf} notes`);
  check(s.clock - c0 > 6 && s.clock - c0 < 8, `listening clock advanced ${(s.clock - c0).toFixed(2)} s in 7 s`);

  // Output, pedals and the looper live in the engine now.
  await app(() => window.__fretline.actions.setOutput(true));
  await app(() => {
    const { useStore } = window.__fretline;
    useStore.setState({ pedals: useStore.getState().pedals.map((p) => (p.name === 'Delay' ? { ...p, on: true } : p)) });
  });
  s = await waitFor((x) => x.st?.outputOn && x.outDb > -40, 3000);
  check(s.st?.outputOn === true, 'engine Output on');
  check(s.outDb > -40, `engine output level ${typeof s.outDb === 'number' ? s.outDb.toFixed(1) : s.outDb} dBFS`);
  check(s.delay > 0 && s.delay < 30, `delay through Output ${s.delay} ms`);
  await app(() => window.__fretline.engine.loop('tap', 0));
  await sleep(1500);
  await app(() => window.__fretline.engine.loop('tap', 0));
  s = await waitFor((x) => x.looper.slots[0].state === 'playing', 2000);
  check(s.looper.slots[0].state === 'playing', `loop 1 ${s.looper.slots[0].state}`);
  check(Math.abs(s.looper.len / 48000 - 1.5) < 0.25, `loop length ${(s.looper.len / 48000).toFixed(2)} s`);

  // Listening off with Output off: the engine lets go of the input and the clock stops.
  await app(() => window.__fretline.actions.setOutput(false));
  await app(() => window.__fretline.actions.setListening(false));
  s = await waitFor((x) => !x.st?.input, 3000);
  check(!s.st?.input && s.mic === 'idle', `input closed while not needed (${s.mic})`);
  const frozen = s.clock;
  await sleep(1000);
  s = await state();
  check(Math.abs(s.clock - frozen) < 0.01, 'clock paused with Listening');
  await app(() => window.__fretline.actions.setListening(true));
  s = await waitFor((x) => x.st?.input && x.clock > frozen + 0.2, 4000);
  check(s.clock > frozen && s.clock - frozen < 2, `clock resumed without a jump (+${(s.clock - frozen).toFixed(2)} s)`);

  // Engine quits: the browser takes the guitar back, and the clock never runs backwards.
  const before = s.clock;
  await stopEngine();
  s = await waitFor((x) => x.native !== 'connected' && x.mic === 'live' && x.micOpen, 6000);
  check(s.native !== 'connected' && s.micOpen, `fell back to the browser mic (${s.native}, ${s.mic})`);
  await sleep(1000);
  s = await state();
  check(s.clock >= before, `clock monotonic across fallback (${before.toFixed(2)} → ${s.clock.toFixed(2)})`);

  // Engine back: reconnects on its own.
  startEngine();
  s = await waitFor((x) => x.native === 'connected' && x.st?.input && !x.micOpen, 8000);
  check(s.native === 'connected' && !s.micOpen, `reconnected automatically (${s.native})`);

  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  await stopEngine();
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
