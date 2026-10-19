import type { CSSProperties } from 'react';
import { TONE, cx, type Tone } from './tone';
import s from './Lamp.module.css';

export type LampTone = Tone | 'off';
export type LampSurface = 'dark' | 'well' | 'alu' | 'ivory';

const OFF: Record<LampSurface, string> = { dark: '#3a302a', well: '#15110f', alu: '#8f8679', ivory: '#b9a98a' };

export interface LampProps {
  tone?: LampTone;
  /** A round indicator or a page bar (header nav, Learn module strip). */
  shape?: 'dot' | 'bar';
  /** Dot diameter, or bar thickness. */
  size?: number;
  /** Bar length. */
  length?: number;
  pulse?: boolean;
  /** What the lamp is set into: sets the unlit colour. */
  surface?: LampSurface;
  /** Overrides the tone colour (still lit unless tone is off). */
  color?: string;
  glow?: boolean;
  /** Accessible name; without one the lamp is decorative. */
  label?: string;
  className?: string;
}

/** The one indicator light. Lit lamps glow in their tone; unlit ones sink into the surface. */
export function Lamp({ tone = 'on', shape = 'dot', size, length = 30, pulse, surface = 'dark', color, glow = true, label, className }: LampProps) {
  const bar = shape === 'bar';
  const d = size ?? (bar ? 4 : 7);
  const lit = tone !== 'off';
  const style = {
    width: bar ? length : d,
    height: d,
    borderRadius: bar ? 2 : d / 2,
    '--c': lit ? (color || TONE[tone as Tone]) : OFF[surface],
    '--g': `${Math.max(6, d + 2)}px`,
  } as CSSProperties;
  return (
    <span
      className={cx(s.lamp, bar && s.bar, lit && s.lit, lit && !glow && s.noGlow, surface === 'alu' && s.alu, lit && pulse && s.pulse, className)}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
