import { useSyncExternalStore } from 'react';

const sub = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

/** Same breakpoints as the design: phone < 700 px, tablet 700–1023 px, desktop ≥ 1024 px. */
export function useViewport() {
  const w = useSyncExternalStore(sub, () => window.innerWidth, () => 1200);
  return { width: w, isMobile: w < 700, isTablet: w >= 700 && w < 1024 };
}
