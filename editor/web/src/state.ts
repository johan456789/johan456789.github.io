import { useEffect, useRef, useState } from 'preact/hooks';

/** Tiny observable store: no dependency, plain objects, shallow-merge updates. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p) if (!Object.is(state[k], p[k])) changed = true;
      if (!changed) return;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export function useStore<T extends object, R>(s: ReturnType<typeof createStore<T>>, select: (v: T) => R): R {
  const [, force] = useState(0);
  const sel = useRef(select);
  sel.current = select;
  const last = useRef<R>(select(s.get()));
  useEffect(() => {
    return s.subscribe(() => {
      const next = sel.current(s.get());
      if (!Object.is(next, last.current)) {
        last.current = next;
        force((n) => n + 1);
      }
    });
  }, [s]);
  const cur = select(s.get());
  last.current = cur;
  return cur;
}
