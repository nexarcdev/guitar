import type { ReactNode } from 'react';
import { Chip, Panel, WellButton, cx } from '../../ui';
import s from './Studio.module.css';

export type Tone = 'ok' | 'warn' | 'bad' | undefined;

const CHIP_TONE = { ok: 'ok', warn: 'on', bad: 'live' } as const;

/**
 * Every Studio section has the same shape: title, a one-line status chip that never wraps (so a
 * changing status can't push the controls around), a static description, then the controls.
 * Ivory sections hold settings you touch; dark ones hold meters and readings.
 */
export function Section({ title, status, tone, desc, children, surface = 'ivory' }: { title: string; status?: ReactNode; tone?: Tone; desc?: ReactNode; children?: ReactNode; surface?: 'ivory' | 'dark' }) {
  const has = status != null && status !== '';
  return (
    <Panel surface={surface} aria-label={title} className={cx(s.section, surface === 'ivory' && s.ivory)}>
      <div className={s.head}>
        <h2 className={s.title}>{title}</h2>
        <span className={s.status} aria-hidden={!has} title={typeof status === 'string' ? status : undefined}>
          {has && <Chip size="sm" tone={tone ? CHIP_TONE[tone] : 'muted'} label={status} />}
        </span>
      </div>
      {desc && <p className={s.desc}>{desc}</p>}
      {children}
    </Panel>
  );
}

/** A grid of option wells (one pressed). */
export function Options<T extends string | number | boolean>({ value, options, onChange, label, narrow }: { value: T; options: Array<[T, string, string?]>; onChange: (v: T) => void; label: string; narrow?: boolean }) {
  return (
    <div className={cx(s.options, narrow && s.narrow)} role="group" aria-label={label}>
      {options.map(([v, name, sub]) => (
        <WellButton key={String(v)} className={s.opt} active={value === v} aria-pressed={value === v} onClick={() => onChange(v)}>
          <span className={s.optName} title={name}>
            {name}
          </span>
          {sub && <span className={s.optSub}>{sub}</span>}
        </WellButton>
      ))}
    </div>
  );
}

/** A warning line inside a section (an error the channel reported). */
export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className={s.warn} role="alert">
      {children}
    </div>
  );
}
