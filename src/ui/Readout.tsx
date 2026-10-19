import type { ReactNode, Ref } from 'react';
import { TONE, cx, type Tone } from './tone';
import s from './Readout.module.css';

export interface ReadoutProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: Tone | 'ink' | 'muted';
  size?: 'sm' | 'md' | 'lg';
  /** What the well is set into (sets the rim highlight). */
  surface?: 'dark' | 'ivory' | 'alu';
  align?: 'left' | 'center';
  color?: string;
  className?: string;
  /** For values written every frame (the text node of the value). */
  valueRef?: Ref<HTMLSpanElement>;
}

const INK = { ink: '#efe4c8', muted: '#b8a994' };

/** A number in a recessed black well. */
export function Readout({ label, value, unit, sub, tone = 'ink', size = 'md', surface = 'dark', align = 'left', color, className, valueRef }: ReadoutProps) {
  const c = color || (tone === 'ink' || tone === 'muted' ? INK[tone] : TONE[tone]);
  return (
    <div className={cx(s.well, s[size], s[surface], align === 'center' && s.center, className)}>
      <span className={s.label}>{label}</span>
      <span className={s.value} style={{ color: c }}>
        <span ref={valueRef}>{value}</span>
        {unit != null && unit !== '' && <span className={s.unit}>{unit}</span>}
      </span>
      {sub != null && sub !== '' && <span className={s.sub}>{sub}</span>}
    </div>
  );
}
