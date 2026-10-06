// A small plucked-string voice for strums, reference notes and riff playback.

export interface Voice {
  stop(): void;
}

export function pluck(ac: AudioContext, freq: number, when = 0, d = 1.1, dest: AudioNode = ac.destination): Voice {
  const t = Math.max(ac.currentTime, when);
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const o2 = ac.createOscillator();
  o2.type = 'sawtooth';
  o2.frequency.value = freq;
  const g2 = ac.createGain();
  g2.gain.value = 0.25;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq * 7, t);
  f.frequency.exponentialRampToValueAtTime(freq * 1.4, t + d);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.16, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(dest);
  o.start(t); o2.start(t);
  o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
  return {
    stop() {
      try {
        const n = ac.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setTargetAtTime(0, n, 0.01);
        o.stop(n + 0.05); o2.stop(n + 0.05);
      } catch {
        /* already stopped */
      }
    },
  };
}

export function referenceTone(ac: AudioContext, freq: number) {
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.2, t + 0.02);
  g.gain.setValueAtTime(0.2, t + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + 1.85);
}
