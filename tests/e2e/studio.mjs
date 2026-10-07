// The Studio in a real browser (web channel, fake microphone): guided calibration, the threshold
// gauge, follow/fixed noise floor, and that controls don't move when their status text changes.
// Usage: node tests/e2e/studio.mjs <app url> (needs Playwright; PLAYWRIGHT_MODULE / CHROMIUM override)
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [appUrl] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
let lastOk = 'start';
let currentPage = null;
const check = (ok, what) => {
  if (ok) lastOk = what;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=studio.mjs::${what}`);
};

/** 7 s of quiet hiss (strings muted), then a pluck every 1.5 s for 6 s; loops every 13 s. */
function guitarWav(path) {
  const sr = 48000;
  const out = new Float32Array(sr * 13);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 0.0003;
  for (let k = 0; k < 4; k++) {
    const f = [110, 146.83, 196, 110][k];
    const n = Math.round(sr / f);
    const line = Float32Array.from({ length: n }, () => rnd() * 0.3);
    const s0 = Math.round((7 + k * 1.5) * sr);
    for (let i = 0; i < sr * 1.4 && s0 + i < out.length; i++) {
      const j = i % n;
      const v = line[j];
      line[j] = 0.994 * 0.5 * (line[j] + line[(j + 1) % n]);
      out[s0 + i] += v;
    }
  }
  const data = Buffer.alloc(out.length * 2 * 8);
  for (let r = 0; r < 8; r++) for (let i = 0; i < out.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i])) * 32767), (r * out.length + i) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

const wav = join(mkdtempSync(join(tmpdir(), 'fretline-studio-')), 'guitar.wav');
guitarWav(wav);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const app = async (page, fn, arg) => page.evaluate(fn, arg);
const level = (page) => app(page, () => window.__fretline.engine.levels.inDb);

try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
    // No service worker: its auto-update reload would restart the page mid-test.
    const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
    currentPage = page;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(appUrl + '?debug');
    await page.mouse.click(5, 300);
    await page.waitForFunction(() => window.__fretline?.useStore.getState().engine.mic === 'live', null, { timeout: 15000 });

    // Header controls keep their place when the listening status changes.
    const box = async (loc) => (await loc.boundingBox()) ?? {};
    const outputChip = page.getByRole('button', { name: /Turn output (on|off)/ });
    const before = await box(outputChip);
    await page.getByRole('button', { name: 'Pause listening' }).click();
    await sleep(300);
    const after = await box(outputChip);
    await page.getByRole('button', { name: 'Resume listening' }).click();
    check(before.x === after.x && before.y === after.y, `${name}: Output chip stays put when listening changes`);

    await page.getByRole('button', { name: 'Studio', exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('tab', { name: 'Input' }).filter({ visible: true }).first().click();
    check(await page.getByRole('slider', { name: 'Playing threshold' }).isVisible(), `${name}: input gauge with threshold handle`);

    if (name === 'desktop') {
      // Gauge follows the live level.
      const seen = new Set();
      // One full loop of the fake guitar: quiet, then plucks.
      for (let i = 0; i < 70; i++) {
        seen.add(Math.round((await level(page)) / 10));
        await sleep(200);
      }
      check(seen.size >= 2, `live input level moves (${[...seen].map((x) => x * 10).join(' ')} dB)`);

      // Keyboard drag of the threshold: following the noise, it changes the gate margin.
      const st0 = await app(page, () => window.__fretline.useStore.getState().session);
      const handle = page.getByRole('slider', { name: 'Playing threshold' });
      await handle.focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await sleep(400);
      const st1 = await app(page, () => window.__fretline.useStore.getState().session);
      check(st1.gateDb === Math.min(30, st0.gateDb + 4) && st1.floor.mode === 'auto', `four arrow presses raise the threshold 4 dB (gate ${st0.gateDb} → ${st1.gateDb} dB)`);

      await page.getByRole('button', { name: /^Fixed/ }).click();
      await sleep(300);
      const st2 = await app(page, () => window.__fretline.useStore.getState().session);
      check(st2.floor.mode === 'manual', 'Fixed keeps the floor where it is');
      await page.getByRole('button', { name: /^Follow noise/ }).click();
      await sleep(300);

      // Guided calibration: wait for the quiet part of the loop (a loud pluck, then quiet).
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      check(await page.getByText('Mute your strings').isVisible(), 'calibration asks to mute the strings first and waits');
      await sleep(3500);
      check(await page.getByText('Mute your strings').isVisible(), 'nothing runs ahead without the player');
      // Wait for the plucks, then for a full second of quiet: the start of the muted part.
      let loud = false;
      let quietSince = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const l = await level(page);
        if (l > -40) {
          loud = true;
          quietSince = 0;
        } else if (loud && l < -70) {
          quietSince ||= Date.now();
          if (Date.now() - quietSince > 1000) break;
        } else quietSince = 0;
        await sleep(50);
      }
      await page.getByRole('button', { name: 'Ready', exact: true }).click();
      check(await page.getByText('Measuring the silence').isVisible(), 'measuring with a countdown');
      await page.getByRole('button', { name: 'Listen', exact: true }).waitFor({ timeout: 5000 });
      check(true, 'silence measured, now asks for a note');
      await page.getByRole('button', { name: 'Listen', exact: true }).click();
      await page.getByText(/All set|Set, but/).waitFor({ timeout: 20000 }).catch(async (e) => {
        console.log('wizard:', (await page.locator('[aria-live=polite]', { hasText: '1 Silence' }).innerText()).replace(/\n/g, ' | '));
        if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
        throw e;
      });
      const result = await page.locator('[aria-live=polite]', { hasText: '1 Silence' }).innerText();
      check(/dB apart/.test(result), 'calibration result: ' + result.split('\n').filter((l) => /All set|Set, but|dB apart/.test(l)).join(' | '));
      const st3 = await app(page, () => window.__fretline.useStore.getState().session);
      check(st3.gateDb >= 6 && st3.gateDb <= 30, `calibrated gate ${st3.gateDb} dB`);
    }

    // Status text that changes must not move the controls (Sound → Chord detection).
    await page.getByRole('tab', { name: 'Sound' }).filter({ visible: true }).first().click();
    const offBtn = page.getByRole('group', { name: 'Chord detection' }).getByRole('button', { name: /^Off/ });
    await offBtn.scrollIntoViewIfNeeded();
    const b0 = await box(offBtn);
    await offBtn.click();
    await sleep(400);
    const b1 = await box(offBtn);
    await page.getByRole('group', { name: 'Chord detection' }).getByRole('button', { name: /^On/ }).click();
    await sleep(400);
    const b2 = await box(offBtn);
    check(b0.y === b1.y && b1.y === b2.y && b0.x === b1.x, `${name}: chord detection buttons stay put as the status changes`);

    // Every tab opens; Done closes.
    for (const t of ['Guitar', 'Engine', 'Diagnostics']) {
      await page.getByRole('tab', { name: t }).filter({ visible: true }).first().click();
      await sleep(200);
    }
    await page.getByRole('button', { name: 'Done' }).click();
    check(!(await page.getByRole('dialog', { name: 'Studio' }).isVisible()), `${name}: Done closes the Studio`);
    await page.close();
  }
  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
  const waiting = (String(e).match(/waiting for [^\n]*/) ?? [''])[0];
  const state = await currentPage?.evaluate(() => {
    const s = window.__fretline?.useStore.getState();
    return s ? `mic ${s.engine.mic}, running ${s.engine.running}, listening ${s.listening}, studio ${s.setupOpen ? s.studioTab : 'closed'}, loaded ${Math.round(performance.now() / 1000)} s ago, in ${Math.round(window.__fretline.engine.levels.inDb)} dB` : 'no app';
  }).catch(() => 'page gone');
  const why = [...new Set(String(e).split('\n').filter((l) => /intercepts|not stable|outside|not visible|disabled|detached/.test(l)).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()))].slice(-2).join(' / ');
  const msg = `${String(e).split('\n')[0]} | after: ${lastOk} | ${waiting} | ${why} | ${state}`;
  console.log(msg);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=exception::${msg.replace(/\x1b\[[0-9;]*m/g, '')}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
