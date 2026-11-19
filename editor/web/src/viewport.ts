import { useEffect, useState } from 'preact/hooks';

/** Tracks the visual viewport so the app (and the formatting toolbar) sits above the on-screen keyboard. */
export function initViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vvh', `${Math.round(h)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv?.offsetTop ?? 0)}px`);
    root.dataset.kb = window.innerHeight - h > 120 ? '1' : '0';
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  apply();
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    f();
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return m;
}

export function usePrefersReducedMotion() {
  return useMedia('(prefers-reduced-motion: reduce)');
}
