// History API routing. The URL is the source of truth for where you are: every view, Learn module
// and Studio tab has a real path under the app's base, and the store follows it.

import type { MouseEvent } from 'react';
import { actions } from './store';
import { learnEnabled, parsePath, pathOf, resolve, sameRoute, titleOf, type LearnModule, type PageId, type Route, type StudioTab } from './routes';

const BASE = import.meta.env.BASE_URL;
export const LEARN_ENABLED: readonly LearnModule[] = learnEnabled(import.meta.env.VITE_LEARN_MODULES);
export const DEV = import.meta.env.DEV;

/** History entries this tab created, so leaving the Studio can step back instead of piling up. */
interface Entry {
  fl: number;
}

export const hrefOf = (r: Route) => BASE + pathOf(r);

function fromLocation(): { route: Route; canonical: boolean } {
  const path = decodeURI(location.pathname);
  const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\/+/, '');
  const route = resolve(parsePath(rel), LEARN_ENABLED, DEV);
  // Trailing slashes, a bare base, /learn and /studio all rewrite to one canonical path.
  return { route, canonical: route.kind === 'notfound' || rel === pathOf(route) };
}

function depth(): number {
  return (history.state as Entry | null)?.fl ?? 0;
}

function apply(route: Route) {
  document.title = titleOf(route);
  actions.applyRoute(route);
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const r = resolve(route, LEARN_ENABLED, DEV);
  const cur = fromLocation().route;
  if (sameRoute(r, cur) && !opts.replace) return;
  const url = hrefOf(r) + location.search;
  if (opts.replace) history.replaceState({ fl: depth() } satisfies Entry, '', url);
  else history.pushState({ fl: depth() + 1 } satisfies Entry, '', url);
  apply(r);
}

export const go = {
  page: (page: PageId) => navigate({ kind: 'page', page }),
  learn: (module: LearnModule) => navigate({ kind: 'learn', module }),
  studio: (tab: StudioTab) => navigate({ kind: 'studio', tab }),
};

/**
 * Leaves the Studio: back to wherever you opened it from, or, arriving on a Studio link from
 * outside, to the page underneath (replacing, so Back doesn't reopen it).
 */
export function closeStudio(under: Route) {
  if (depth() > 0) history.back();
  else navigate(under, { replace: true });
}

/**
 * Props for a real link to a route: middle-click, copy link and open-in-new-tab all work;
 * a plain click navigates in place.
 */
export function linkProps(route: Route, after?: () => void) {
  return {
    href: hrefOf(resolve(route, LEARN_ENABLED, DEV)),
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(route);
      after?.();
    },
  };
}

/** Reads the URL into the store and follows Back and Forward from then on. */
export function initRouter() {
  const { route, canonical } = fromLocation();
  if (!canonical) history.replaceState({ fl: depth() } satisfies Entry, '', hrefOf(route) + location.search);
  else if (history.state == null) history.replaceState({ fl: 0 } satisfies Entry, '');
  apply(route);
  window.addEventListener('popstate', () => {
    const next = fromLocation();
    if (!next.canonical) history.replaceState(history.state, '', hrefOf(next.route) + location.search);
    apply(next.route);
  });
}

/** The route of the view under the Studio. */
export function tabRoute(s: { tab: PageId | 'learn'; learnModule: LearnModule }): Route {
  return s.tab === 'learn' ? { kind: 'learn', module: s.learnModule } : { kind: 'page', page: s.tab };
}
