// End to end: the real Fretline web app in headless Chromium, first on its web channel (the core
// in WebAssembly, fed by a fake microphone), then on the engine channel (the native engine on its
// device-free test backend), switching back and forth the way a player would. Both "guitars" play
// the same looping phrase: A2, D3, G3, then an A major chord, every 6 s.
//
// Usage: node e2e-web.mjs <fretline-engine binary> <app url, e.g. http://localhost:4180/>
// Needs Playwright (PLAYWRIGHT_MODULE overrides where it is imported from; CHROMIUM the browser).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [bin, appUrl] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

/** The engine test backend's phrase, as a WAV for Chromium's fake microphone. */
function phraseWav(path) {
  const sr = 48000;
  const out = new Float32Array(sr * 6);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [at, fs] of [[0, [110]], [1.5, [146.83]], [3, [196]], [4.5, [110, 138.59, 164.81, 220]]]) {
    for (const f of fs) {
      const n = Math.round(sr / f);
      const line = Float32Array.from({ length: n }, () => rnd() * 0.25);
      const s0 = Math.round(at * sr);
      for (let i = 0; i < Math.min(sr * 1.45, out.length - s0); i++) {
        const j = i % n;
        const v = line[j];
        line[j] = 0.996 * 0.5 * (line[j] + line[(j + 1) % n]);
        out[s0 + i] += v;
      }
    }
  }
  const reps = 20;
  const data = Buffer.alloc(out.length * reps * 2);
  for (let r = 0; r < reps; r++) for (let i = 0; i < out.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] + rnd() * 0.0003)) * 32767), (r * out.length + i) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

const dir = mkdtempSync(join(tmpdir(), 'fretline-e2e-'));
const wav = join(dir, 'phrase.wav');
phraseWav(wav);
const state = join(dir, 'session.json');

let engine = null;
const startEngine = () => (engine = spawn(bin, ['--test', '--state', state], { stdio: ['ignore', 'ignore', 'inherit'] }));
const stopEngine = async () => {
  engine?.kill();
  engine = null;
  await sleep(300);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  // The engine panel is offered on Windows.
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/ERR_CONNECTION_REFUSED|WebSocket connection|WebGL/.test(m.text()) && errors.push(m.text()));

const app = (fn, arg) => page.evaluate(fn, arg);
const snap = () =>
  app(() => {
    if (!window.__fretline) return null;
    const { useStore, engine } = window.__fretline;
    const s = useStore.getState();
    return {
      channel: s.engine.channel, conn: s.engine.engine, mic: s.engine.mic, ml: s.engine.ml, backend: s.engine.mlBackend, st: s.engine.status, session: s.session,
      looper: s.looper, levels: s.levels, freq: s.freq, voiced: s.voiced, notes: s.buf.filter((n) => !n.p).map((n) => n.m), clock: engine.clock(), outDb: engine.outputDb(),
      micOpen: engine.diagnostics()?.micOpen, pedals: s.pedals,
    };
  });
const waitFor = async (pred, ms) => {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < ms) {
    s = await snap();
    if (s && pred(s)) return s;
    await sleep(100);
  }
  return s ?? {};
};
/** Listens for `ms`: stable tuner pitches from the analysis stream, and the transcribed notes. */
async function listen(ms) {
  await app(() => {
    const w = window;
    w.__heard = new Set();
    w.__off?.();
    w.__off = w.__fretline.engine.on('analysis', (a) => a.frames.forEach((f) => f.stable && w.__heard.add(Math.round(69 + 12 * Math.log2(f.freq / 440)))));
  });
  await sleep(ms);
  const tuner = new Set(await app(() => [...window.__heard]));
  const s = await snap();
  return { tuner, ml: new Set(s.notes) };
}
const call = (path, ...args) => app(([p, a]) => { const [o, m] = p.split('.'); return window.__fretline[o][m](...a); }, [path, args]);

try {
  // ---------------- web channel
  await page.goto(appUrl + '?debug');
  await page.mouse.click(5, 5);
  let s = await waitFor((x) => x.mic === 'live' && x.ml === 'ready', 20000);
  check(s.channel === 'web' && s.mic === 'live', `web channel live (${s.channel}, ${s.mic})`);
  check(s.ml === 'ready', `browser basic-pitch ${s.ml} on ${s.backend}`);
  let h = await listen(8000);
  check([45, 50, 55].every((m) => h.tuner.has(m)), `web: tuner heard A2 D3 G3 (${[...h.tuner].sort((a, b) => a - b).join(' ')})`);
  check([45, 49, 52].every((m) => h.ml.has(m)), `web: basic-pitch transcribed the A major chord (${[...h.ml].sort((a, b) => a - b).join(' ')})`);

  await call('actions.setOutput', true);
  s = await waitFor((x) => x.outDb > -40, 3000);
  check(s.session.output && s.outDb > -40, `web: Output through the core's pedals (${s.outDb.toFixed(1)} dBFS)`);
  await call('engine.loop', 'tap', 0);
  await sleep(1500);
  await call('engine.loop', 'tap', 0);
  s = await waitFor((x) => x.looper.slots[0].state === 'playing', 2000);
  check(s.looper.slots[0].state === 'playing' && Math.abs(s.looper.len / s.looper.rate - 1.5) < 0.2, `web: loop ${s.looper.slots[0].state}, ${(s.looper.len / s.looper.rate).toFixed(2)} s`);
  await call('engine.loop', 'clear', 0);
  await call('actions.setOutput', false);
  await sleep(300);
  await call('engine.reference', 440);
  s = await waitFor((x) => x.outDb > -25, 1500);
  check(s.outDb > -25, `web: reference tone from the core synth (${s.outDb.toFixed(1)} dBFS)`);

  // Noise floor controls (Settings UI).
  await page.getByRole('button', { name: 'Settings', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Recalibrate' }).click();
  s = await waitFor((x) => x.levels.measuring != null, 1500);
  check(s.levels.measuring != null, `web: recalibrating (${s.levels.measuring?.toFixed(2)})`);
  await page.getByRole('button', { name: 'Manual You set the level' }).click();
  await page.getByRole('slider', { name: 'Noise floor' }).fill('-45');
  s = await waitFor((x) => x.levels.floorMode === 'manual' && x.levels.floorDb === -45, 2000);
  check(s.session.floor.mode === 'manual' && s.levels.floorDb === -45, `web: manual floor ${s.levels.floorDb} dB`);
  await page.getByRole('button', { name: 'Auto Follows your setup' }).click();
  // A board change made on the web channel, newer than anything the engine has.
  await call('actions.setPedal', 0, { on: true, level: 77 });
  await sleep(300);
  const webClock = (await snap()).clock;

  // ---------------- engine channel
  startEngine();
  await page.getByRole('button', { name: "I've installed it, connect" }).click();
  s = await waitFor((x) => x.channel === 'engine' && x.mic === 'live' && x.micOpen === false, 8000);
  check(s.channel === 'engine' && s.st?.kind === 'engine', `switched to the engine (${s.channel})`);
  check(s.micOpen === false, 'browser mic released');
  s = await waitFor((x) => x.session?.pedals?.[0]?.level === 77, 3000);
  check(s.session?.pedals[0].name === 'Compressor' && s.session.pedals[0].on && s.session.pedals[0].level === 77, 'newest edit wins: the engine adopted the web board change');
  check(s.ml === 'ready' && s.backend === 'native', `engine basic-pitch ${s.ml} on ${s.backend}`);
  h = await listen(8000);
  check([45, 50, 55].every((m) => h.tuner.has(m)), `engine: tuner heard A2 D3 G3 (${[...h.tuner].sort((a, b) => a - b).join(' ')})`);
  check([45, 49, 52].every((m) => h.ml.has(m)), `engine: basic-pitch transcribed the A major chord (${[...h.ml].sort((a, b) => a - b).join(' ')})`);
  s = await snap();
  check(s.clock > webClock, `listening clock continued across the switch (${webClock.toFixed(2)} → ${s.clock.toFixed(2)})`);

  await call('actions.setOutput', true);
  s = await waitFor((x) => x.outDb > -40, 3000);
  check(s.outDb > -40, `engine: Output through the pedals (${s.outDb.toFixed(1)} dBFS)`);
  check(s.st.latency?.totalMs > 0 && s.st.latency.totalMs < 30, `engine: delay ${s.st.latency?.totalMs.toFixed(1)} ms`);
  await call('actions.setOutput', false);
  await sleep(500);
  await call('engine.pluck', 196, 0, 1.2);
  s = await waitFor((x) => x.outDb > -30, 1500);
  check(s.outDb > -30, `engine: pluck from the engine synth (${s.outDb.toFixed(1)} dBFS)`);
  await call('actions.setSession', { gateDb: 18 });
  await sleep(300);

  // Listening off with Output off: the engine lets go of the input and the clock stops.
  await call('actions.setListening', false);
  s = await waitFor((x) => !x.st?.input, 3000);
  check(!s.st?.input && s.mic === 'idle', `engine: input closed while not needed (${s.mic})`);
  const frozen = s.clock;
  await sleep(1000);
  check(Math.abs((await snap()).clock - frozen) < 0.01, 'clock paused with Listening');
  await call('actions.setListening', true);
  s = await waitFor((x) => x.st?.input && x.clock > frozen + 0.2, 4000);
  check(s.clock > frozen && s.clock - frozen < 2, `clock resumed without a jump (+${(s.clock - frozen).toFixed(2)} s)`);

  // ---------------- engine quits: back to the web channel
  const before = s.clock;
  await stopEngine();
  s = await waitFor((x) => x.channel === 'web' && x.mic === 'live' && x.micOpen, 8000);
  check(s.channel === 'web' && s.micOpen, `fell back to the web channel (${s.channel}, ${s.mic})`);
  s = await waitFor((x) => x.session?.gateDb === 18, 2000);
  check(s.session?.gateDb === 18, 'newest edit wins: the gate set on the engine carried back to the web channel');
  await sleep(1500);
  s = await snap();
  check(s.clock >= before, `clock monotonic across the fallback (${before.toFixed(2)} → ${s.clock.toFixed(2)})`);

  // ---------------- engine back
  startEngine();
  s = await waitFor((x) => x.channel === 'engine' && x.micOpen === false, 10000);
  check(s.channel === 'engine', `reconnected automatically (${s.channel})`);
  check(s.session?.gateDb === 18 && s.session.pedals[0].level === 77, 'engine kept its saved session across restart');

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
