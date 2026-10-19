import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useStore } from '../../state/store';
import { LEARN_ENABLED, linkProps } from '../../state/router';
import { LEARN_MODULES, type LearnModule } from '../../state/routes';
import { Chip, Lamp } from '../../ui';
import { Lesson } from './Lesson';
import s from './Learn.module.css';

const LABELS: Record<LearnModule, string> = {
  today: 'Today',
  lesson: 'Lesson',
  changes: 'Changes',
  rhythm: 'Rhythm',
  theory: 'Theory',
  fretboard: 'Fretboard',
  ear: 'Ear',
  band: 'Band',
  solo: 'Solo',
  journey: 'Journey',
};

// Modules still in development are previews built from sample data. Each loads only when this
// build switches it on (VITE_LEARN_MODULES); otherwise its code is never requested.
const on = (m: LearnModule) => LEARN_ENABLED.includes(m);
const PREVIEWS: Partial<Record<LearnModule, LazyExoticComponent<ComponentType>>> = {
  ...(__LEARN_TODAY__ && { today: lazy(() => import('./modules/Today')) }),
  ...(__LEARN_CHANGES__ && { changes: lazy(() => import('./modules/Changes')) }),
  ...(__LEARN_RHYTHM__ && { rhythm: lazy(() => import('./modules/Rhythm')) }),
  ...(__LEARN_THEORY__ && { theory: lazy(() => import('./modules/Theory')) }),
  ...(__LEARN_FRETBOARD__ && { fretboard: lazy(() => import('./modules/FretboardLab')) }),
  ...(__LEARN_EAR__ && { ear: lazy(() => import('./modules/Ear')) }),
  ...(__LEARN_BAND__ && { band: lazy(() => import('./modules/Band')) }),
  ...(__LEARN_SOLO__ && { solo: lazy(() => import('./modules/Solo')) }),
  ...(__LEARN_JOURNEY__ && { journey: lazy(() => import('./modules/Journey')) }),
};

export function Learn() {
  const current = useStore((x) => x.learnModule);
  const hidden = LEARN_MODULES.length - LEARN_ENABLED.length;
  const Preview = current === 'lesson' ? null : PREVIEWS[current];

  return (
    <div className={s.learn}>
      <nav className={s.strip} aria-label="Learn modules">
        {LEARN_MODULES.filter(on).map((m) => {
          const active = m === current;
          return (
            <a key={m} className={s.mod} aria-current={active ? 'page' : undefined} {...linkProps({ kind: 'learn', module: m })}>
              <Lamp shape="bar" length={24} tone={active ? 'on' : 'off'} surface="well" />
              {LABELS[m]}
            </a>
          );
        })}
        {hidden > 0 && (
          <span className={s.hidden}>
            {hidden} more in development
          </span>
        )}
      </nav>
      {Preview && (
        <div className={s.previewRow}>
          <Chip tone="muted" size="sm" label="Preview · sample data" />
        </div>
      )}
      {current === 'lesson' ? (
        <Lesson />
      ) : Preview ? (
        <Suspense fallback={null}>
          <Preview />
        </Suspense>
      ) : null}
    </div>
  );
}
