import type { CSSProperties, ReactNode } from 'react';
import { Lamp } from './Lamp';
import { TONE, cx, type Tone } from './tone';
import s from './Chip.module.css';

export interface ChipProps {
  label: ReactNode;
  tone?: Tone | 'muted';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  /** Overrides the tone colour. */
  color?: string;
  /** Announce changes (a status chip). */
  live?: boolean;
  className?: string;
}

const SIZE = { sm: [26, 10, 12, 6], md: [30, 12, 13, 7], lg: [34, 14, 16, 7] } as const;

/** A fixed one-line status: lamp plus caps. Lives on dark glass or a dark well. */
export function Chip({ label, tone = 'ok', size = 'md', pulse, color, live, className }: ChipProps) {
  const muted = tone === 'muted';
  const c = color || (muted ? '#b8a994' : TONE[tone]);
  const [h, px, fs, lamp] = SIZE[size];
  return (
    <span
      className={cx(s.chip, muted && s.muted, className)}
      style={{ height: h, padding: `0 ${px}px`, fontSize: fs, '--c': c } as CSSProperties}
      {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}
    >
      <Lamp tone={muted ? 'off' : 'on'} color={muted ? undefined : c} size={lamp} surface="well" pulse={pulse} />
      <span className={s.text}>{label}</span>
    </span>
  );
}
