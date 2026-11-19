import { useEffect, useState } from 'preact/hooks';

export type Route = { name: 'home' } | { name: 'edit'; file: string };

export function parseHash(h: string): Route {
  const m = /^#\/edit\/([^/?]+)/.exec(h);
  if (m) return { name: 'edit', file: decodeURIComponent(m[1]) };
  return { name: 'home' };
}

let internalDepth = 0;

export function go(hash: string, replace = false) {
  if (replace) location.replace(hash);
  else {
    internalDepth++;
    location.hash = hash;
  }
}

export function goBack() {
  if (internalDepth > 0) {
    internalDepth--;
    history.back();
  } else location.replace('#/');
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const f = () => setR(parseHash(location.hash));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

/** Files that were just created: the editor puts the caret in the body when it opens them. */
export const focusOnOpen = new Set<string>();
