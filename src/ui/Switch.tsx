import type { ReactNode } from 'react';
import { Lamp } from './Lamp';
import { cx, type Tone } from './tone';
import s from './Switch.module.css';

export interface SwitchProps {
  on: boolean;
  onToggle: (on: boolean) => void;
  label?: ReactNode;
  /** Accessible name when it differs from the visible label (e.g. "Pause listening"). */
  ariaLabel?: string;
  /** A vertical amp-style rocker instead of a horizontal slide. */
  vertical?: boolean;
  /** What the switch is mounted on: sets the track and label colours. */
  surface?: 'dark' | 'ivory' | 'alu';
  /** The colour the lamp lights when on. */
  tone?: Tone;
  labelSide?: 'below' | 'left' | 'right' | 'none';
  pulse?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The one switch. A cream cap slides in a recessed track; when on, the lamp shows in the end
 * the cap uncovered. Off, the lamp sits under where the cap was and stays dark.
 */
export function Switch({ on, onToggle, label, ariaLabel, vertical, surface = 'dark', tone = 'on', labelSide = 'below', pulse, disabled, className }: SwitchProps) {
  const name = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  const text = labelSide !== 'none' && label != null ? <span className={s.text}>{label}</span> : null;
  return (
    <button
      type="button"
      className={cx(s.switch, s[surface], vertical ? s.vertical : s.horizontal, labelSide === 'left' || labelSide === 'right' ? s.row : s.col, className)}
      aria-pressed={on}
      aria-label={name}
      disabled={disabled}
      onClick={() => onToggle(!on)}
    >
      {labelSide === 'left' && text}
      <span className={s.track} data-on={on}>
        <span className={s.lamp}>
          <Lamp tone={on ? tone : 'off'} size={6} surface="well" pulse={pulse} />
        </span>
        <span className={s.cap} />
      </span>
      {labelSide !== 'left' && text}
    </button>
  );
}
