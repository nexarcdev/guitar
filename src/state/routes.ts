// Every URL the app answers, as data. Pure (no DOM, no Vite env): the build imports it to write
// a page for each route, so GitHub Pages serves deep links with a 200.

export const PAGES = ['tuner', 'chords', 'tabs', 'pedals'] as const;
export type PageId = (typeof PAGES)[number];

export const STUDIO_TABS = ['guitar', 'input', 'sound', 'engine', 'diagnostics'] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

export const LEARN_MODULES = ['today', 'lesson', 'changes', 'rhythm', 'theory', 'fretboard', 'ear', 'band', 'solo', 'journey'] as const;
export type LearnModule = (typeof LEARN_MODULES)[number];

export type Route =
  | { kind: 'page'; page: PageId }
  | { kind: 'learn'; module: LearnModule }
  | { kind: 'studio'; tab: StudioTab }
  /** The component reference sheet (dev builds only). */
  | { kind: 'design' }
  | { kind: 'notfound'; path: string };

/**
 * Which Learn modules are built into this bundle. Lesson always is; the rest stay hidden until
 * they're real. `spec` is "all" or a comma list ("today,rhythm"), from VITE_LEARN_MODULES.
 */
export function learnEnabled(spec: string | undefined): LearnModule[] {
  const want = new Set((spec ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  return LEARN_MODULES.filter((m) => m === 'lesson' || want.has('all') || want.has(m));
}

const is = <T extends string>(list: readonly T[], v: string | undefined): v is T => v != null && (list as readonly string[]).includes(v);

/** Parses a path relative to the app's base ("learn/lesson", no leading slash). */
export function parsePath(rel: string): Route {
  const parts = rel.split('/').filter(Boolean);
  const [a, b, ...more] = parts;
  if (more.length) return { kind: 'notfound', path: rel };
  if (!a) return { kind: 'page', page: 'tuner' };
  if (is(PAGES, a) && !b) return { kind: 'page', page: a };
  if (a === 'learn') {
    if (!b) return { kind: 'learn', module: 'lesson' };
    if (is(LEARN_MODULES, b)) return { kind: 'learn', module: b };
  }
  if (a === 'studio') {
    if (!b) return { kind: 'studio', tab: 'input' };
    if (is(STUDIO_TABS, b)) return { kind: 'studio', tab: b };
  }
  if (a === 'design' && !b) return { kind: 'design' };
  return { kind: 'notfound', path: rel };
}

/** The canonical path for a route, relative to the base. */
export function pathOf(r: Route): string {
  switch (r.kind) {
    case 'page':
      return r.page;
    case 'learn':
      return `learn/${r.module}`;
    case 'studio':
      return `studio/${r.tab}`;
    case 'design':
      return 'design';
    case 'notfound':
      return r.path;
  }
}

/**
 * Resolves a parsed route against what this build has: a hidden Learn module falls back to the
 * lesson, and the reference sheet exists only in development.
 */
export function resolve(r: Route, enabled: readonly LearnModule[], dev: boolean): Route {
  if (r.kind === 'learn' && !enabled.includes(r.module)) return { kind: 'learn', module: 'lesson' };
  if (r.kind === 'design' && !dev) return { kind: 'notfound', path: 'design' };
  return r;
}

export const sameRoute = (a: Route, b: Route) => pathOf(a) === pathOf(b) && a.kind === b.kind;

/** Paths the production build writes a page for (each gets `<path>.html`). */
export function staticPaths(enabled: readonly LearnModule[]): string[] {
  return [...PAGES, 'learn', ...enabled.map((m) => `learn/${m}`), 'studio', ...STUDIO_TABS.map((t) => `studio/${t}`)];
}

const TITLES: Record<PageId, string> = { tuner: 'Tuner', chords: 'Chords', tabs: 'Tab stream', pedals: 'Pedalboard' };
const LEARN_TITLES: Record<LearnModule, string> = {
  today: 'Today',
  lesson: 'Lesson',
  changes: 'Chord changes',
  rhythm: 'Rhythm',
  theory: 'Theory lab',
  fretboard: 'Fretboard',
  ear: 'Ear training',
  band: 'Backing band',
  solo: 'Solo coach',
  journey: 'Journey',
};
const STUDIO_TITLES: Record<StudioTab, string> = { guitar: 'Your guitar', input: 'Input', sound: 'Sound', engine: 'Engine', diagnostics: 'Diagnostics' };

/** The document title for a route. */
export function titleOf(r: Route): string {
  const t =
    r.kind === 'page' ? TITLES[r.page] : r.kind === 'learn' ? `${LEARN_TITLES[r.module]} · Learn` : r.kind === 'studio' ? `${STUDIO_TITLES[r.tab]} · Studio` : r.kind === 'design' ? 'Components' : 'Not found';
  return `${t} · Fretline`;
}

export { LEARN_TITLES, STUDIO_TITLES };
