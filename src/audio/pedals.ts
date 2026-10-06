// Effect pedal DSP. Every pedal is a node pair with a dry and a wet path so bypass is click-free.

export type PedalName = 'Compressor' | 'Overdrive' | 'Distortion' | 'Fuzz' | 'Chorus' | 'Phaser' | 'Delay' | 'Reverb';

export interface Pedal {
  name: PedalName;
  type: string;
  level: number;
  on: boolean;
}

export const DEFAULT_PEDALS: Pedal[] = (
  [
    ['Compressor', 'DYNAMICS', 55], ['Overdrive', 'GAIN', 62], ['Distortion', 'GAIN', 70], ['Fuzz', 'GAIN', 48],
    ['Chorus', 'MOD', 40], ['Phaser', 'MOD', 35], ['Delay', 'TIME', 45], ['Reverb', 'SPACE', 58],
  ] as const
).map(([name, type, level]) => ({ name, type, level, on: name === 'Overdrive' || name === 'Delay' }));

export interface FxNode {
  i: GainNode;
  o: GainNode;
  dry: GainNode;
  wet: GainNode;
  set: (level: number) => void;
  /** Wet mix for parallel effects; null for effects that replace the signal when on. */
  mix: ((level: number) => number) | null;
}

function shapeCurve(name: PedalName, l: number) {
  const n = 1024;
  const c = new Float32Array(n);
  const k = name === 'Overdrive' ? 1 + l * 0.12 : 4 + l * 0.6;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = name === 'Fuzz' ? Math.sign(x) * (1 - Math.exp(-Math.abs(x) * (3 + l * 0.4))) : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

/** Exponentially decaying stereo noise: a smooth, colourless room. */
function impulse(ac: BaseAudioContext, sec: number) {
  const len = Math.floor(ac.sampleRate * sec);
  const b = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return b;
}

export function makeFx(ac: AudioContext, name: PedalName): FxNode {
  const i = ac.createGain(), o = ac.createGain(), dry = ac.createGain(), wet = ac.createGain();
  i.connect(dry);
  dry.connect(o);
  wet.connect(o);
  const n: FxNode = { i, o, dry, wet, mix: null, set: () => {} };
  if (name === 'Compressor') {
    const c = ac.createDynamicsCompressor();
    c.attack.value = 0.005;
    c.release.value = 0.15;
    const mk = ac.createGain();
    i.connect(c); c.connect(mk); mk.connect(wet);
    n.set = (l) => { c.threshold.value = -10 - l * 0.4; c.ratio.value = 2 + l * 0.1; mk.gain.value = 1 + l * 0.02; };
  } else if (name === 'Overdrive' || name === 'Distortion' || name === 'Fuzz') {
    const ws = ac.createWaveShaper(), tone = ac.createBiquadFilter(), post = ac.createGain();
    ws.oversample = '2x';
    tone.type = 'lowpass';
    tone.frequency.value = name === 'Fuzz' ? 3000 : name === 'Distortion' ? 4500 : 5500;
    post.gain.value = name === 'Overdrive' ? 0.6 : 0.32;
    i.connect(ws); ws.connect(tone); tone.connect(post); post.connect(wet);
    let last = -1;
    n.set = (l) => { if (l !== last) { last = l; ws.curve = shapeCurve(name, l); } };
  } else if (name === 'Chorus') {
    const d = ac.createDelay(0.05);
    d.delayTime.value = 0.015;
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 0.8;
    lfo.connect(lg); lg.connect(d.delayTime); lfo.start();
    i.connect(d); d.connect(wet);
    n.set = (l) => { lg.gain.value = 0.0005 + l * 0.00006; };
    n.mix = () => 0.5;
  } else if (name === 'Phaser') {
    let prev: AudioNode = i;
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.connect(lg); lfo.start();
    for (let k = 0; k < 4; k++) {
      const ap = ac.createBiquadFilter();
      ap.type = 'allpass'; ap.frequency.value = 700; ap.Q.value = 0.6;
      lg.connect(ap.frequency); prev.connect(ap); prev = ap;
    }
    prev.connect(wet);
    n.set = (l) => { lg.gain.value = 200 + l * 6; lfo.frequency.value = 0.2 + l * 0.03; };
    n.mix = () => 0.6;
  } else if (name === 'Delay') {
    const d = ac.createDelay(2), fb = ac.createGain(), f = ac.createBiquadFilter();
    d.delayTime.value = 0.32;
    f.type = 'lowpass'; f.frequency.value = 3500;
    i.connect(d); d.connect(f); f.connect(fb); fb.connect(d); f.connect(wet);
    n.set = (l) => { fb.gain.value = 0.2 + l * 0.004; };
    n.mix = (l) => (l / 100) * 0.7;
  } else if (name === 'Reverb') {
    const cv = ac.createConvolver();
    cv.buffer = impulse(ac, 2);
    i.connect(cv); cv.connect(wet);
    n.mix = (l) => l / 100;
  }
  return n;
}
