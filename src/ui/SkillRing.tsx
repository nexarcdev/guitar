import type { CSSProperties, ReactNode } from 'react';
import s from './SkillRing.module.css';

export interface SkillRingProps {
  /** 0 to 100. */
  score: number;
  label?: ReactNode;
  /** Defaults to a word for the score band. */
  grade?: string;
  size?: number;
  color?: string;
  /** On ivory use the panel's body ink (#6b5636). */
  labelColor?: string;
}

export const gradeFor = (score: number) => (score >= 90 ? 'Solid' : score >= 70 ? 'Steady' : score >= 40 ? 'Getting there' : 'New');

/** A skill score: a lit arc around a dark dial. */
export function SkillRing({ score, label, grade, size = 96, color = '#4db6a4', labelColor }: SkillRingProps) {
  const v = Math.max(0, Math.min(100, Math.round(score)));
  const deg = v * 3.6;
  const style = {
    width: size,
    height: size,
    background: `conic-gradient(${color} 0deg ${deg}deg, rgba(255,255,255,0.08) ${deg}deg 360deg)`,
    boxShadow: `0 0 ${Math.round(size / 5)}px ${color}44`,
  } as CSSProperties;
  const g = grade ?? gradeFor(v);
  return (
    <div className={s.wrap} role="img" aria-label={`${typeof label === 'string' ? label + ': ' : ''}${v} of 100, ${g}`}>
      <div className={s.ring} style={style}>
        <div className={s.dial} style={{ inset: Math.round(size / 11) }} />
        <div className={s.center}>
          <div className={s.num} style={{ fontSize: Math.round(size / 3) }}>
            {v}
          </div>
          <div className={s.grade} style={{ color, fontSize: g.length > 8 && size <= 96 ? 8 : undefined, letterSpacing: g.length > 8 && size <= 96 ? '0.1em' : undefined }}>
            {g}
          </div>
        </div>
      </div>
      {label != null && (
        <div className={s.label} style={{ maxWidth: size, color: labelColor }}>
          {label}
        </div>
      )}
    </div>
  );
}
