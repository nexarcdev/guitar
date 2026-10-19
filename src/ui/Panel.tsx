import type { CSSProperties, ReactNode } from 'react';
import { Lamp, type LampTone } from './Lamp';
import { cx } from './tone';
import s from './Panel.module.css';

export interface PanelProps {
  /** Dark panels hold things you read (glass, paper); ivory panels hold controls. */
  surface?: 'dark' | 'ivory';
  title?: ReactNode;
  /** Right side of the title row: a short static note, or controls (a Segment, a Switch). */
  meta?: ReactNode;
  /** A status lamp before the title. */
  lamp?: LampTone;
  pulse?: boolean;
  minHeight?: number | string;
  flex?: string;
  className?: string;
  children?: ReactNode;
  /** Landmark label when the title isn't plain text. */
  'aria-label'?: string;
}

/** The one frame: a screwed-down plate with an engraved title row. */
export function Panel({ surface = 'dark', title, meta, lamp, pulse, minHeight, flex, className, children, ...rest }: PanelProps) {
  const ivory = surface === 'ivory';
  const style: CSSProperties = { minHeight, flex };
  return (
    <section className={cx(s.panel, ivory ? s.ivory : s.dark, className)} style={style} aria-label={rest['aria-label'] ?? (typeof title === 'string' ? title : undefined)}>
      <Screws surface={surface} />
      {(title != null || meta != null) && (
        <div className={s.head}>
          <h2 className={s.title}>
            {lamp && <Lamp tone={lamp} pulse={pulse} surface={ivory ? 'ivory' : 'dark'} />}
            {title}
          </h2>
          {meta != null && (typeof meta === 'string' ? <div className={s.meta}>{meta}</div> : <div className={s.controls}>{meta}</div>)}
        </div>
      )}
      {children}
    </section>
  );
}

/** Four screws, one per corner. */
export function Screws({ surface = 'dark', inset = 8, size = 9 }: { surface?: 'dark' | 'ivory'; inset?: number; size?: number }) {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
        <Screw key={k} surface={surface} size={size} style={{ [k[0] === 't' ? 'top' : 'bottom']: inset, [k[1] === 'l' ? 'left' : 'right']: inset }} />
      ))}
    </>
  );
}

/** Steel on dark plates, bone on ivory (and cream pedal enclosures). */
export function Screw({ surface = 'dark', size = 9, style }: { surface?: 'dark' | 'ivory'; size?: number; style?: CSSProperties }) {
  return <span aria-hidden className={cx(s.screw, surface === 'ivory' ? s.bone : s.steel)} style={{ width: size, height: size, ...style }} />;
}
