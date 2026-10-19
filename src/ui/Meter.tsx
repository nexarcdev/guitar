import { useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from './tone';
import s from './Meter.module.css';

export const METER_MIN_DB = -96;
/** The hot zone: the top 6 dB. */
export const METER_HOT_DB = -6;
export const meterPos = (db: number) => Math.max(0, Math.min(1, (db - METER_MIN_DB) / -METER_MIN_DB));

/** One frame of a meter. Live meters get these every animation frame through the handle. */
export interface MeterFrame {
  value: number;
  peak?: number;
  /** Playing threshold: teal below, amber above. Null for an output meter. */
  threshold?: number | null;
  /** Noise floor marker. */
  floor?: number | null;
  /** False draws the meter switched off. */
  live: boolean;
  /** The LED: lit when the gate is open. Defaults to "above the threshold". */
  open?: boolean;
}

export interface MeterHandle {
  draw(f: MeterFrame): void;
}

export interface MeterProps extends Partial<MeterFrame> {
  label: ReactNode;
  height?: number;
  /** Below the threshold. */
  quiet?: string;
  /** Threshold to the hot zone. */
  color?: string;
  /** The top 6 dB. */
  hot?: string;
  /** Show the noise floor marker. */
  showFloor?: boolean;
  /** Draw from frames through `handle` instead of props. */
  handle?: Ref<MeterHandle>;
  /** Pointer and keyboard handlers for the track (an editable threshold). */
  trackProps?: HTMLAttributes<HTMLDivElement>;
  /** Overlays on the track (a draggable threshold handle). */
  children?: ReactNode;
  /** A dB scale under the track. */
  scale?: number[];
  className?: string;
}

/**
 * The one level meter: segmented bar, teal below the threshold, amber above, cherry in the top
 * 6 dB, with a glow in the colour of the zone the level is in and a peak hold.
 */
export function Meter({ label, height = 18, quiet = '#4db6a4', color = '#e9a23b', hot = '#d4442c', showFloor, handle, trackProps, children, scale, className, ...frame }: MeterProps) {
  const fill = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const thr = useRef<HTMLDivElement>(null);
  const floor = useRef<HTMLDivElement>(null);
  const led = useRef<HTMLSpanElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const bandsFor = useRef<number | null | undefined>(undefined);

  const draw = (f: MeterFrame) => {
    const th = f.threshold ?? null;
    if (th !== bandsFor.current && fill.current && dim.current) {
      bandsFor.current = th;
      const t = th == null ? 0 : meterPos(th) * 100;
      const h = meterPos(METER_HOT_DB) * 100;
      const bg = `linear-gradient(to right, ${quiet} 0%, ${quiet} ${t}%, ${color} ${t}%, ${color} ${h}%, ${hot} ${h}%, ${hot} 100%)`;
      fill.current.style.background = bg;
      dim.current.style.background = bg;
    }
    const v = f.live ? f.value : -120;
    if (fill.current) {
      fill.current.style.clipPath = `inset(0 ${(1 - meterPos(v)) * 100}% 0 0)`;
      const zone = v > METER_HOT_DB ? hot : v > (th ?? -60) ? color : quiet;
      fill.current.style.filter = `drop-shadow(0 0 6px ${zone})`;
    }
    if (peak.current) {
      const p = f.peak ?? v;
      peak.current.style.left = meterPos(p) * 100 + '%';
      peak.current.style.opacity = f.live && p > METER_MIN_DB ? '1' : '0';
    }
    if (thr.current) {
      thr.current.style.opacity = th == null ? '0' : '1';
      if (th != null) thr.current.style.left = meterPos(th) * 100 + '%';
    }
    if (floor.current) {
      const fl = f.floor;
      floor.current.style.opacity = fl == null ? '0' : '1';
      if (fl != null) floor.current.style.left = meterPos(fl) * 100 + '%';
    }
    if (led.current) {
      const open = f.open ?? (f.live && (th != null ? v > th : v > -60));
      led.current.dataset.on = String(open);
    }
    if (readout.current) readout.current.textContent = f.live ? (v <= -90 ? '−∞' : Math.round(v) + ' dB') : 'off';
  };

  useImperativeHandle(handle, () => ({ draw }));

  // Static meters (no handle) draw from their props.
  useLayoutEffect(() => {
    if (handle) return;
    draw({ value: frame.value ?? -120, peak: frame.peak, threshold: frame.threshold, floor: frame.floor, live: frame.live ?? true, open: frame.open });
  });

  return (
    <div className={cx(s.meter, className)}>
      <div className={s.head}>
        <span ref={led} className={s.led} data-on="false" style={{ '--quiet': quiet } as React.CSSProperties} />
        <span className={s.label}>{label}</span>
        <span ref={readout} className={s.readout}>
          off
        </span>
      </div>
      <div className={s.track} style={{ height }} {...trackProps}>
        <div ref={dim} className={s.dim} />
        <div ref={fill} className={s.fill} />
        <div ref={peak} className={s.peak} />
        {showFloor && <div ref={floor} className={s.floor} title="Noise floor" />}
        <div ref={thr} className={s.thr} style={{ background: color }} />
        {children}
      </div>
      {scale && (
        <div className={s.scale} aria-hidden>
          {scale.map((d) => (
            <span key={d} style={{ left: meterPos(d) * 100 + '%' }}>
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
