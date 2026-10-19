import { cx } from './tone';
import s from './Segment.module.css';

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** A count shown after the label (e.g. saved riffs). */
  n?: number;
  disabled?: boolean;
}

export interface SegmentProps<T extends string> {
  options: ReadonlyArray<T | SegmentOption<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the group. */
  label: string;
  surface?: 'dark' | 'ivory';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** The one picker: a recessed track with an amber lit choice. */
export function Segment<T extends string>({ options, value, onChange, label, surface = 'dark', size = 'sm', className }: SegmentProps<T>) {
  const opts = options.map((o) => (typeof o === 'string' ? { id: o, label: o } : o)) as SegmentOption<T>[];
  return (
    <div role="group" aria-label={label} className={cx(s.track, surface === 'ivory' && s.ivory, s[size], className)}>
      {opts.map((o) => (
        <button key={o.id} type="button" className={s.opt} aria-pressed={o.id === value} disabled={o.disabled} onClick={() => onChange(o.id)}>
          {o.label}
          {o.n != null && <span className={s.n}>{o.n}</span>}
        </button>
      ))}
    </div>
  );
}
