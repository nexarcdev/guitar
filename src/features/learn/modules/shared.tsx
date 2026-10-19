// Helpers shared by the Learn previews.
import { useEffect, useState } from 'react';
import { WellButton, type FretMark } from '../../../ui';
import s from './Mock.module.css';

export const CHROM = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Open-string pitch classes, low E first. */
const OPEN = [4, 9, 2, 7, 11, 4];
const IVN = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

export const noteAt = (str: number, f: number) => CHROM[(OPEN[str] + f) % 12];

/** Every fret (0 to `frets`) whose note is in the set, toned root, chord tone or scale tone. */
export function marksFor(root: number, ivs: readonly number[], frets: number, chordIvs: readonly number[]): FretMark[] {
  const out: FretMark[] = [];
  for (let st = 0; st < 6; st++)
    for (let f = 0; f <= frets; f++) {
      const iv = (OPEN[st] + f - root + 24) % 12;
      if (ivs.includes(iv)) out.push({ s: st, f, tone: iv === 0 ? 'root' : chordIvs.includes(iv) ? 'chord' : 'scale', note: CHROM[(OPEN[st] + f) % 12], iv: IVN[iv] });
    }
  return out;
}

/** A counter that steps every `ms` while running (the previews' stand-in for a real clock). */
export function useTick(ms: number, running = true) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => {
      clearInterval(t);
    };
  }, [ms, running]);
  return n;
}

/** Twelve root keys in dark wells. */
export function RootPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className={s.roots} role="group" aria-label={label}>
      {CHROM.map((n) => (
        <WellButton key={n} className={s.root} active={n === value} aria-pressed={n === value} onClick={() => onChange(n)}>
          {n}
        </WellButton>
      ))}
    </div>
  );
}
