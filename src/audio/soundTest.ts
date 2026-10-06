// A step-by-step output test that runs on the player's own machine. Each step builds a fresh,
// minimal audio setup independent of the app's engine, plays a tone, and asks whether it sounded
// clean. Where the tone first breaks up tells us what's wrong:
//   1. mic closed                         → output device / browser itself
//   2. mic open, unused                   → the input device conflicts with output at the OS/driver level
//   3. mic flowing through Web Audio      → live input + output in one audio graph (clock/buffer issue)
//   4. same as 3 with large buffers       → whether bigger buffers ride over it

export type StepId = 'closed' | 'open' | 'graph' | 'graphSafe';

export interface Step {
  id: StepId;
  title: string;
  detail: string;
}

export const STEPS: Step[] = [
  { id: 'closed', title: 'Tone with the microphone closed', detail: 'The baseline: nothing else running.' },
  { id: 'open', title: 'Tone with your guitar input open', detail: 'The input is open but not used for anything.' },
  { id: 'graph', title: 'Tone with your guitar flowing through', detail: 'Like the app: live input and output together.' },
  { id: 'graphSafe', title: 'Same, with larger audio buffers', detail: 'Slightly more delay, more robust on busy systems.' },
];

export type Verdict = 'clear' | 'bad';

export async function playStep(id: StepId, deviceId: string): Promise<() => void> {
  const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new C({ latencyHint: id === 'graphSafe' ? 'playback' : 'interactive' });
  await ac.resume().catch(() => {});
  let stream: MediaStream | null = null;
  if (id !== 'closed') {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (id === 'graph' || id === 'graphSafe') {
      // Pull the live input through the graph without making it audible.
      const src = ac.createMediaStreamSource(stream);
      const mute = ac.createGain();
      mute.gain.value = 0;
      src.connect(mute);
      mute.connect(ac.destination);
    }
  }
  // A steady tone with a gentle pulse makes dropouts easy to hear.
  const t = ac.currentTime + 0.15;
  const o = ac.createOscillator();
  o.frequency.value = 440;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.03);
  g.gain.setValueAtTime(0.18, t + 2.4);
  g.gain.linearRampToValueAtTime(0, t + 2.5);
  o.connect(g);
  g.connect(ac.destination);
  o.start(t);
  o.stop(t + 2.55);
  return () => {
    stream?.getTracks().forEach((tr) => tr.stop());
    ac.close().catch(() => {});
  };
}

export type Diagnosis =
  | { kind: 'outside'; text: string }
  | { kind: 'safe'; text: string }
  | { kind: 'device'; text: string }
  | { kind: 'load'; text: string };

export function diagnose(r: Partial<Record<StepId, Verdict>>): Diagnosis | null {
  if (r.closed === 'bad')
    return { kind: 'outside', text: 'The tone breaks up even with nothing else running, so the problem is outside Fretline: check the output device and volume mixer for Chrome.' };
  if (!r.closed || !r.open) return null;
  // With the input open but unused, nothing flows through Fretline: buffers can't be the cause.
  if (r.open === 'bad')
    return {
      kind: 'device',
      text: 'Just opening your guitar input breaks the sound, before Fretline uses it at all. The usual cause is noise reduction on the input device: it puts the sound driver into a voice-call mode that cuts off steady sounds like a held note.',
    };
  if (r.graph === 'bad') {
    if (!r.graphSafe) return null;
    if (r.graphSafe === 'clear')
      return { kind: 'safe', text: 'Larger audio buffers fix it on this computer. Fretline will use them, which adds roughly 50 ms of delay through Output.' };
    return {
      kind: 'device',
      text: 'Opening your guitar input breaks Chrome’s audio output on this computer, even outside Fretline. The usual cause is noise reduction on the input device: it puts the sound driver into a voice-call mode that cuts off steady sounds like a held note.',
    };
  }
  if (!r.graph) return null;
  return { kind: 'load', text: 'Live input and output work fine together, so Fretline’s own processing was the problem. This version does much less work; if it still breaks up, turn Chord detection off.' };
}
