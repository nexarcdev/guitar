// A small read-only chord diagram: strings vertical, frets horizontal, the way chord charts are
// printed. Marks paint a verdict onto it the same way the big board does: green for a string that
// sounded, red for one ringing open that should not.

import type { Frets } from '../../theory/music';
import type { StringMark } from '../../theory/verdict';
import type { Barre } from '../../theory/voicings';

export interface ChordDiagramProps {
  frets: Frets;
  baseFret: number;
  marks?: ReadonlyArray<StringMark> | null;
  barre?: Barre | null;
  /** Accessible name, e.g. "C, open position". Omit inside a card that carries its own label. */
  label?: string;
  className?: string;
}

const W = 64;
const STRING_X0 = 11;
const STRING_GAP = 9;
const TOP = 11;
const ROW = 13;

export function ChordDiagram({ frets, baseFret, marks, barre, label, className }: ChordDiagramProps) {
  const rows = Math.max(4, ...frets.filter((f) => f > 0));
  const H = TOP + rows * ROW + 3;
  const x = (i: number) => STRING_X0 + i * STRING_GAP;
  const y = (f: number) => TOP + (f - 0.5) * ROW;
  const color = (i: number) => {
    const m = marks?.[i];
    return m === 'ok' ? 'var(--green)' : m === 'wrongOpen' ? 'var(--red)' : 'var(--gold)';
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {/* strings */}
      {frets.map((_, i) => (
        <line key={'s' + i} x1={x(i)} y1={TOP} x2={x(i)} y2={TOP + rows * ROW} stroke="currentColor" strokeOpacity={marks?.[i] === 'missing' ? 0.25 : 0.45} strokeWidth={0.9} />
      ))}
      {/* frets */}
      {Array.from({ length: rows + 1 }, (_, k) => (
        <line key={'f' + k} x1={x(0)} y1={TOP + k * ROW} x2={x(5)} y2={TOP + k * ROW} stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.8} />
      ))}
      {/* nut, or the base fret number */}
      {baseFret === 1 ? (
        <line x1={x(0) - 0.5} y1={TOP} x2={x(5) + 0.5} y2={TOP} stroke="var(--gold)" strokeWidth={2.4} />
      ) : (
        <text x={x(0) - 4} y={y(1) + 3} fontSize={7.5} fontWeight={600} fill="currentColor" fillOpacity={0.75} textAnchor="end">
          {baseFret}
        </text>
      )}
      {barre && <rect x={x(barre.from) - 3.4} y={y(barre.fret - baseFret + 1) - 3.2} width={x(barre.to) - x(barre.from) + 6.8} height={6.4} rx={3.2} fill="var(--gold)" fillOpacity={0.55} />}
      {frets.map((f, i) => {
        if (f > 0) return <circle key={'d' + i} cx={x(i)} cy={y(f)} r={3.6} fill={color(i)} opacity={marks?.[i] === 'missing' ? 0.45 : 1} />;
        if (f === 0) return <circle key={'o' + i} cx={x(i)} cy={TOP - 5.5} r={2.6} fill="none" stroke={color(i)} strokeWidth={1.2} opacity={marks?.[i] === 'missing' ? 0.45 : 1} />;
        return (
          <g key={'x' + i} stroke={marks?.[i] === 'wrongOpen' ? 'var(--red)' : 'currentColor'} strokeOpacity={marks?.[i] === 'wrongOpen' ? 1 : 0.5} strokeWidth={1.2}>
            <line x1={x(i) - 2.4} y1={TOP - 7.9} x2={x(i) + 2.4} y2={TOP - 3.1} />
            <line x1={x(i) + 2.4} y1={TOP - 7.9} x2={x(i) - 2.4} y2={TOP - 3.1} />
          </g>
        );
      })}
    </svg>
  );
}
