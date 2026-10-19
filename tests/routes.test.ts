import { describe, expect, it } from 'vitest';
import { learnEnabled, parsePath, pathOf, resolve, staticPaths, titleOf, LEARN_MODULES, PAGES, STUDIO_TABS } from '../src/state/routes';

describe('routes', () => {
  it('round-trips every canonical path', () => {
    const all = [...PAGES, ...LEARN_MODULES.map((m) => `learn/${m}`), ...STUDIO_TABS.map((t) => `studio/${t}`), 'design'];
    for (const p of all) expect(pathOf(parsePath(p))).toBe(p);
  });

  it('maps the bare base and section roots to a canonical route', () => {
    expect(parsePath('')).toEqual({ kind: 'page', page: 'tuner' });
    expect(parsePath('learn')).toEqual({ kind: 'learn', module: 'lesson' });
    expect(parsePath('studio')).toEqual({ kind: 'studio', tab: 'input' });
  });

  it('ignores trailing and doubled slashes', () => {
    expect(parsePath('chords/')).toEqual({ kind: 'page', page: 'chords' });
    expect(parsePath('learn//lesson/')).toEqual({ kind: 'learn', module: 'lesson' });
  });

  it('reports unknown paths as not found', () => {
    for (const p of ['nope', 'tuner/extra', 'learn/nope', 'studio/nope', 'learn/lesson/1', 'Tuner']) expect(parsePath(p).kind).toBe('notfound');
  });

  it('builds only the lesson unless asked', () => {
    expect(learnEnabled(undefined)).toEqual(['lesson']);
    expect(learnEnabled('')).toEqual(['lesson']);
    expect(learnEnabled('rhythm, TODAY')).toEqual(['today', 'lesson', 'rhythm']);
    expect(learnEnabled('all')).toEqual([...LEARN_MODULES]);
  });

  it('sends hidden modules to the lesson and hides the design sheet in production', () => {
    expect(resolve({ kind: 'learn', module: 'rhythm' }, ['lesson'], false)).toEqual({ kind: 'learn', module: 'lesson' });
    expect(resolve({ kind: 'learn', module: 'rhythm' }, ['lesson', 'rhythm'], false)).toEqual({ kind: 'learn', module: 'rhythm' });
    expect(resolve({ kind: 'design' }, ['lesson'], false).kind).toBe('notfound');
    expect(resolve({ kind: 'design' }, ['lesson'], true).kind).toBe('design');
  });

  it('writes a page for every route the build serves, and none for hidden modules', () => {
    const paths = staticPaths(['lesson']);
    expect(paths).toContain('tuner');
    expect(paths).toContain('learn/lesson');
    expect(paths).toContain('studio/diagnostics');
    expect(paths).not.toContain('learn/rhythm');
    expect(paths).not.toContain('design');
  });

  it('titles each route', () => {
    expect(titleOf({ kind: 'page', page: 'tabs' })).toBe('Tab stream · Fretline');
    expect(titleOf({ kind: 'studio', tab: 'input' })).toBe('Input · Studio · Fretline');
  });
});
