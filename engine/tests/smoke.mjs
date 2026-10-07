// End-to-end smoke test of a built engine binary on the device-free test backend.
// Usage: node smoke.mjs <path-to-fretline-engine> (needs the `ws` package)
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const bin = process.argv[2];
const port = 47899;
const record = join(mkdtempSync(join(tmpdir(), 'fretline-')), 'out.wav');
const engine = spawn(bin, ['--test', '--port', String(port), '--record', record], { stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function connect(origin) {
  for (let i = 0; i < 50; i++) {
    const r = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
      ws.on('open', () => resolve({ ws }));
      ws.on('error', (e) => resolve({ error: e.message }));
    });
    if (r.ws || !/ECONNREFUSED/.test(r.error)) return r;
    await sleep(100);
  }
  return { error: 'engine never started' };
}

try {
  const evil = await connect('https://evil.example');
  check(!evil.ws && /403/.test(evil.error ?? ''), `foreign origin refused (${evil.error})`);

  const { ws, error } = await connect('https://nexarcdev.github.io');
  check(!!ws, `Fretline origin accepted ${error ?? ''}`);
  if (!ws) throw new Error('no connection');

  let status = null;
  let meters = 0;
  let frames = 0;
  let gaps = 0;
  let rate = 0;
  let lastT0 = -1;
  let lastMeters = null;
  ws.on('message', (data, binary) => {
    if (binary) {
      const b = Buffer.from(data);
      if (b.toString('latin1', 0, 4) !== 'FLA1') return gaps++;
      rate = b.readUInt32LE(4);
      const t0 = b.readDoubleLE(8);
      if (lastT0 >= 0 && t0 !== lastT0 + (b.length - 16) / 4) gaps++;
      lastT0 = t0;
      frames++;
    } else {
      const m = JSON.parse(data.toString());
      if (m.type === 'status') status = m;
      if (m.type === 'meters') (meters++, (lastMeters = m));
    }
  });
  const send = (m) => ws.send(JSON.stringify(m));
  send({ type: 'hello', client: 'smoke', version: 'ci' });
  send({ type: 'pedals', pedals: [{ name: 'Overdrive', on: true, level: 60 }, { name: 'Delay', on: true, level: 40 }] });
  send({ type: 'output', on: true });
  const floor = setInterval(() => send({ type: 'floor', floorDb: -70, openDb: 12 }), 300);
  send({ type: 'loop', cmd: 'tap', slot: 0 });
  await sleep(1000);
  send({ type: 'loop', cmd: 'tap', slot: 0 });
  await sleep(2000);
  clearInterval(floor);

  const expected = Math.floor((3 * 48000) / 1024);
  check(frames >= expected * 0.8, `analysis frames ${frames} of ~${expected}`);
  check(gaps === 0, `listening clock has no gaps (${gaps})`);
  check(rate === 48000, `frame rate ${rate}`);
  check(meters >= 60, `meters at ~30 Hz (${meters} in 3 s)`);
  check(!!status?.input && !!status?.output, 'status reports both streams');
  check(status?.outputOn === true, 'status reports Output on');
  check(status?.latency?.totalMs > 0 && status.latency.totalMs < 30, `latency estimate ${status?.latency?.totalMs?.toFixed(1)} ms`);
  check(lastMeters?.slots?.[0]?.state === 'playing', `loop slot 1 playing (${lastMeters?.slots?.[0]?.state})`);
  check(lastMeters?.looperLen > 40000 && lastMeters.looperLen < 56000, `loop length ${lastMeters?.looperLen} ≈ 1 s`);
  check(lastMeters?.outDb > -40, `output level ${lastMeters?.outDb?.toFixed(1)} dBFS`);

  send({ type: 'output', on: false });
  send({ type: 'listen', on: false });
  await sleep(500);
  const before = frames;
  await sleep(500);
  check(frames === before, 'no analysis frames after listen off');
  ws.close();
  await sleep(500);

  engine.kill();
  await sleep(500);
  const wav = readFileSync(record);
  const data = wav.indexOf('data');
  const n = (wav.length - data - 8) / 4;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(wav.readFloatLE(data + 8 + i * 4)));
  check(n > 48000 * 2 && peak > 0.05 && peak <= 1, `speakers got ${(n / 48000).toFixed(1)} s, peak ${peak.toFixed(2)}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  engine.kill();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
