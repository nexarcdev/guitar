import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx } from './tone';
import s from './Well.module.css';

interface WellProps {
  /** Amber edge: the selected well in a list. */
  active?: boolean;
  /** Edge colour override (e.g. teal for a tuned string). */
  edge?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A dark satin well set into an ivory panel. Changing information on an ivory face always sits
 * in one of these (strings, riffs, the fretboard, settings options).
 */
export function Well({ active, edge, className, children, ...rest }: WellProps & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(s.well, active && s.active, className)} style={edge ? { '--edge': edge } as React.CSSProperties : undefined} {...rest}>
      {children}
    </div>
  );
}

/** A well you press. */
export function WellButton({ active, edge, className, children, ...rest }: WellProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx(s.well, s.button, active && s.active, className)} style={edge ? { '--edge': edge } as React.CSSProperties : undefined} {...rest}>
      {children}
    </button>
  );
}

/** Static help text pressed into an ivory face. Never status: that goes in a Chip. */
export function Note({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cx(s.note, className)}>{children}</div>;
}
