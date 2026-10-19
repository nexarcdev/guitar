import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cx } from './tone';
import s from './Knob.module.css';

export interface KnobProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Makes the knob a slider: drag up/down, arrow keys (Shift for 10 steps). */
  onChange?: (v: number) => void;
  label?: ReactNode;
  /** Accessible name (defaults to the label when it is text). */
  ariaLabel?: string;
  /** Spoken value, e.g. "440 Hz". */
  valueText?: string;
  size?: number;
  /** Arc colour. On ivory use the darker accents (#d9902a, #1f8c7c). */
  color?: string;
  /** Black on dark plates, cream on ivory, chrome for pedal faces. */
  cap?: 'black' | 'cream' | 'chrome';
  /** Off: the arc goes grey and stops glowing. */
  on?: boolean;
  labelColor?: string;
  className?: string;
}

const SWEEP = 270;

/**
 * The one knob. Only the knurl and pointer turn; the cap's highlight and shadow stay put, so it
 * reads as a turn rather than a tilt.
 */
export function Knob({ value, min = 0, max = 100, step = 1, onChange, label, ariaLabel, valueText, size = 84, color = '#e9a23b', cap = 'black', on = true, labelColor, className }: KnobProps) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const fill = frac * SWEEP;
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const style = {
    width: size,
    height: size,
    '--arc': `conic-gradient(from 225deg, ${on ? color : 'rgba(255,255,255,0.3)'} 0deg ${fill}deg, rgba(255,255,255,0.16) ${fill}deg ${SWEEP}deg, transparent ${SWEEP}deg 360deg)`,
    '--glow': on ? `0 0 ${Math.round(size / 5)}px ${color}55` : 'none',
    '--cap': `${Math.round(size * 0.6)}px`,
    '--deg': `${-135 + frac * SWEEP}deg`,
  } as CSSProperties;
  const name = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  const interactive = !!onChange;
  // Full travel is about 140 px of drag, whatever the range.
  const perPx = (max - min) / 140;
  return (
    <div className={cx(s.knob, className)}>
      <div
        className={cx(s.ring, interactive && s.interactive)}
        style={style}
        {...(interactive
          ? {
              role: 'slider',
              tabIndex: 0,
              'aria-label': name,
              'aria-valuemin': min,
              'aria-valuemax': max,
              'aria-valuenow': value,
              'aria-valuetext': valueText,
              onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { y: e.clientY, v: value };
              },
              onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
                const d = drag.current;
                if (!d) return;
                const v = clamp(d.v + (d.y - e.clientY) * perPx);
                if (v !== value) onChange(v);
              },
              onPointerUp: () => {
                drag.current = null;
              },
              onPointerCancel: () => {
                drag.current = null;
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                const n = e.shiftKey ? 10 : 1;
                const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? n : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -n : 0;
                if (e.key === 'Home') onChange(min);
                else if (e.key === 'End') onChange(max);
                else if (d) onChange(clamp(value + d * step));
                else return;
                e.preventDefault();
              },
            }
          : { 'aria-hidden': true })}
      >
        <div className={s.arc} />
        <div className={s.halo} />
        <div className={cx(s.cap, s[cap])}>
          <div className={s.turn}>
            <div className={s.pointer} />
          </div>
          <div className={s.shine} />
        </div>
      </div>
      {label != null && label !== '' && (
        <div className={s.label} style={labelColor ? { color: labelColor } : undefined}>
          {label}
        </div>
      )}
    </div>
  );
}
