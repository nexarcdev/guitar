import type { CSSProperties, ReactNode } from 'react';
import { cx } from './tone';
import s from './Window.module.css';

export interface WindowProps {
  /** Glass for live readings; paper (aged manila) for charts, tab and lessons. */
  surface?: 'glass' | 'paper';
  kicker?: ReactNode;
  title?: ReactNode;
  titleSize?: number;
  meta?: ReactNode;
  pad?: string;
  gap?: number;
  minHeight?: number | string;
  flex?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** A reading surface set into a dark panel. */
export function Window({ surface = 'glass', kicker, title, titleSize = 28, meta, pad, gap = 14, minHeight, flex, className, style, children }: WindowProps) {
  const paper = surface === 'paper';
  return (
    <div className={cx(s.window, paper ? s.paper : s.glass, className)} style={{ padding: pad, gap, minHeight, flex, ...style }}>
      {paper && <div className={s.grain} aria-hidden />}
      {(title != null || meta != null || kicker != null) && (
        <div className={s.head}>
          <div className={s.titles}>
            {kicker != null && <div className={s.kicker}>{kicker}</div>}
            {title != null && (
              <div className={s.title} style={{ fontSize: titleSize }}>
                {title}
              </div>
            )}
          </div>
          {meta != null && <div className={s.meta}>{meta}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
