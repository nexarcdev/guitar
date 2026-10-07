import type { ReactNode } from 'react';
import s from './Studio.module.css';

export type Tone = 'ok' | 'warn' | 'bad' | undefined;

/**
 * Every Studio section has the same shape: title, a one-line status chip that never wraps (so a
 * changing status can't push the controls around), a static description, then the controls.
 */
export function Section({ title, status, tone, desc, children, id }: { title: string; status?: ReactNode; tone?: Tone; desc?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section className={s.section} aria-labelledby={id}>
      <div className={s.sectionHead}>
        <h2 id={id} className={s.sectionTitle} style={{ margin: 0 }}>
          {title}
        </h2>
        {status != null && status !== '' && (
          <span className={s.chip} data-tone={tone} title={typeof status === 'string' ? status : undefined}>
            {status}
          </span>
        )}
      </div>
      {desc && <p className={s.desc}>{desc}</p>}
      {children}
    </section>
  );
}

/** A row of option buttons (one pressed). */
export function Options<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: Array<[T, string, string?]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className={s.tunings} role="group" aria-label={label}>
      {options.map(([v, name, sub]) => (
        <button key={String(v)} className={s.opt} aria-pressed={value === v} onClick={() => onChange(v)}>
          <span className={s.optName} title={name}>{name}</span>
          {sub && <span className={s.optSub}>{sub}</span>}
        </button>
      ))}
    </div>
  );
}
