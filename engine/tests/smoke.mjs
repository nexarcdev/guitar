// End-to-end smoke test of a built engine binary on the device-free test backend, which plays a
// looping plucked phrase (A2, D3, G3, then an A major chord, then a rest, every 8 s) as the guitar.
// Usage: node smoke.mjs <path-to-fretline-engine> (needs the `ws` package)
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const bin = process.argv[2];
const port = 47899;
const dir = mkdtempSync(join(tmpdir(), 'fretline-'));
const record = join(dir, 'out.wav');
const state = join(dir, 'session.json');
let engine = null;
const start = (rec = record) => (engine = spawn(bin, ['--test', '--port', String(port), '--record', rec, '--state', state], { stdio: 'inherit' }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
  // In GitHub Actions, failures also become annotations (readable without the full log).
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=${process.argv[1].split('/').pop()}::${what.replace(/\n/g, ' ')}`);
};

async function connect(origin) {
  for (let i = 0; i < 50; i++) {
    const r = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
      // Collect before 'open': the engine answers a new client with its state at once, and that
      // frame can arrive in the same read as the handshake. A listener attached after awaiting
      // 'open' then misses it (ws flushes the leftover bytes on the next tick, ahead of the
      // await's continuation), and the restored session looks empty.
      const c = collect(ws);
      ws.on('open', () => resolve({ ws, c }));
      ws.on('error', (e) => resolve({ error: e.message }));
    });
    if (r.ws || !/ECONNREFUSED/.test(r.error)) return r;
    await sleep(100);
  }
  return { error: 'engine never started' };
}

function collect(ws) {
  const c = { status: null, state: null, ml: null, analysis: 0, clocks: [], notes: [], heard: new Set(), meters: [], levels: null };
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.type === 'status') c.status = m;
    else if (m.type === 'state') c.state = m;
    else if (m.type === 'ml') c.ml = m;
    else if (m.type === 'meters') c.meters.push(m);
    else if (m.type === 'notes') c.notes.push(...m.notes.map((n) => n.midi));
    else if (m.type === 'analysis') {
      c.analysis++;
      c.clocks.push(m.clock);
      c.levels = m.levels;
      for (const f of m.frames) if (f.stable) c.heard.add(Math.round(69 + 12 * Math.log2(f.freq / 440)));
    }
  });
  return c;
}

try {
  start();
  const evil = await connect('https://evil.example');
  check(!evil.ws && /403/.test(evil.error ?? ''), `foreign origin refused (${evil.error})`);

  let { ws, c, error } = await connect('https://nexarcdev.github.io');
  check(!!ws, `Fretline origin accepted ${error ?? ''}`);
  if (!ws) throw new Error('no connection');
  const send = (m) => ws.send(JSON.stringify(m));
  send({ type: 'hello', client: 'smoke', version: 'ci' });
  await sleep(500);
  check(c.state?.rev === 0 && c.state.pedals.length === 8, `fresh session state (rev ${c.state?.rev})`);
  check(c.ml?.status === 'ready' && c.ml.backend === 'native', `native basic-pitch ${c.ml?.status}`);

  // Detection runs in the engine: the tuner hears the phrase, basic-pitch transcribes it.
  await sleep(9000);
  check(c.analysis > 380, `analysis messages ${c.analysis} in ~9.5 s`);
  const steps = c.clocks.slice(1).map((t, i) => t - c.clocks[i]);
  check(steps.every((d) => Math.abs(d - 1024 / 48000) < 1e-9), 'listening clock advances one chunk per message');
  check([45, 50, 55].every((m) => c.heard.has(m)), `tuner heard A2 D3 G3 (${[...c.heard].sort((a, b) => a - b).join(' ')})`);
  const pcs = new Set(c.notes.map((m) => m % 12));
  check([9, 1, 4].every((pc) => pcs.has(pc)), `basic-pitch transcribed the A major chord (midi ${[...new Set(c.notes)].sort((a, b) => a - b).join(' ')})`);

  // Shared state: changes come back to everyone as a new revision, and drive the audio.
  send({ type: 'set', state: { pedals: [{ name: 'Overdrive', on: true, level: 60 }, { name: 'Delay', on: true, level: 40 }], output: true, gateDb: 15 } });
  await sleep(300);
  check(c.state.rev === 1 && c.state.output && c.state.gateDb === 15 && c.state.pedals[0].name === 'Overdrive', `state rev ${c.state.rev}, output ${c.state.output}`);
  send({ type: 'loop', cmd: 'tap', slot: 0 });
  await sleep(1000);
  send({ type: 'loop', cmd: 'tap', slot: 0 });
  await sleep(1500);
  const lm = c.meters.at(-1);
  check(lm.looper.slots[0].state === 'playing' && Math.abs(lm.looper.len / 48000 - 1) < 0.1, `loop ${lm.looper.slots[0].state}, ${(lm.looper.len / 48000).toFixed(2)} s`);
  check(c.meters.slice(-20).some((m) => m.outDb > -40), 'guitar through the pedals reaches the speakers');
  check(c.status.latency?.totalMs > 0 && c.status.latency.totalMs < 30, `latency estimate ${c.status.latency?.totalMs?.toFixed(1)} ms`);

  // The synth plays through the engine even with Output off.
  send({ type: 'set', state: { output: false } });
  send({ type: 'loop', cmd: 'clear', slot: 0 });
  await sleep(400);
  c.meters.length = 0;
  send({ type: 'play', group: 1, notes: [{ at: 0, hz: 440, dur: 1.2, voice: 'reference' }] });
  await sleep(600);
  const synthPeak = Math.max(...c.meters.map((m) => m.outDb));
  check(synthPeak > -20, `reference tone through the engine (${synthPeak.toFixed(1)} dBFS)`);
  send({ type: 'stop' });
  await sleep(200);
  c.meters.length = 0;
  await sleep(300);
  check(Math.max(...c.meters.map((m) => m.outDb)) < -60, 'stop silences the synth');

  // Recalibrate: progress shows while it measures. Manual floor applies.
  send({ type: 'recalibrate' });
  await sleep(500);
  check(c.levels?.measuring > 0 && c.levels.measuring < 1, `recalibrating (${c.levels?.measuring?.toFixed(2)})`);
  send({ type: 'set', state: { floor: { mode: 'manual', manualDb: -50 } } });
  await sleep(1500);
  check(c.levels.floorMode === 'manual' && c.levels.floorDb === -50, `manual floor ${c.levels.floorDb}`);

  // Listen off: no analysis for this client.
  send({ type: 'listen', on: false });
  await sleep(300);
  const before = c.analysis;
  await sleep(500);
  check(c.analysis === before, 'no analysis after listen off');
  ws.close();
  await sleep(1200);

  // Restart: the session survives.
  engine.kill();
  await sleep(500);
  check(existsSync(state), 'session saved to disk');
  start(join(dir, 'second.wav'));
  ({ ws, c } = await connect('http://localhost:5173'));
  await sleep(500);
  check(c.state?.gateDb === 15 && c.state.floor.mode === 'manual' && c.state.pedals[0].name === 'Overdrive', `session restored (rev ${c.state?.rev})`);
  ws.close();
  await sleep(300);
  engine.kill();
  await sleep(500);
  const wav = readFileSync(record);
  check(wav.length > 48000 * 4, `speakers recorded ${(wav.length / 4 / 48000).toFixed(1)} s`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=exception::${String(e).split('\n')[0]}`);
} finally {
  engine?.kill();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
