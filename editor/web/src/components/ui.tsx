import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';

export function IconButton(props: {
  label: string;
  onClick?: (e: MouseEvent) => void;
  children: ComponentChildren;
  class?: string;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  haspopup?: boolean;
}) {
  return (
    <button
      type="button"
      class={`icon-btn ${props.class || ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      aria-expanded={props.expanded}
      aria-haspopup={props.haspopup ? 'menu' : undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ComponentChildren }[];
  label: string;
  class?: string;
}) {
  const idx = props.options.findIndex((o) => o.value === props.value);
  return (
    <div
      class={`segmented ${props.class || ''}`}
      role="radiogroup"
      aria-label={props.label}
      style={{ '--n': props.options.length, '--i': Math.max(0, idx) } as any}
    >
      <span class="seg-thumb" aria-hidden="true" />
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={props.id}
      aria-checked={props.checked}
      aria-label={props.label}
      class={`switch ${props.checked ? 'on' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="switch-knob" />
    </button>
  );
}

export function Field(props: { label: string; hint?: ComponentChildren; children: ComponentChildren; for?: string }) {
  return (
    <div class="field">
      <label class="field-label" for={props.for}>
        {props.label}
      </label>
      {props.children}
      {props.hint && <div class="field-hint">{props.hint}</div>}
    </div>
  );
}

export function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}

export function Button(props: {
  children: ComponentChildren;
  onClick?: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  class?: string;
  href?: string;
}) {
  const cls = `btn btn-${props.kind || 'secondary'} ${props.class || ''}`;
  if (props.href)
    return (
      <a class={cls} href={props.href} target="_blank" rel="noreferrer noopener">
        {props.children}
      </a>
    );
  return (
    <button type={props.type || 'button'} class={cls} onClick={props.onClick} disabled={props.disabled || props.busy}>
      {props.busy && <Spinner />}
      {props.children}
    </button>
  );
}

/* --------------------------------------------------------------- Sheet */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** do not close on backdrop / escape (e.g. while a request is running) */
  locked?: boolean;
  initialFocus?: string;
  tall?: boolean;
}) {
  const [mounted, setMounted] = useState(props.open);
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useEffect(() => {
    if (props.open) {
      prevFocus.current = document.activeElement;
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [props.open]);

  useEffect(() => {
    if (!shown) return;
    const el = ref.current;
    if (!el) return;
    const target = (props.initialFocus && el.querySelector<HTMLElement>(props.initialFocus)) || el;
    target.focus({ preventScroll: true });
    return () => {
      const p = prevFocus.current as HTMLElement | null;
      if (p && document.contains(p) && p.focus) p.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  if (!mounted) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !props.locked) {
      e.stopPropagation();
      props.onClose();
    } else if (e.key === 'Tab' && ref.current) {
      const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
    ref.current.style.transition = 'none';
  };
  const onUp = () => {
    if (!drag.current || !ref.current) return;
    const dy = drag.current.dy;
    drag.current = null;
    ref.current.style.transition = '';
    ref.current.style.transform = '';
    if (dy > 90 && !props.locked) props.onClose();
  };

  return (
    <div class={`sheet-root ${shown ? 'shown' : ''}`} onKeyDown={onKey}>
      <div class="sheet-backdrop" onClick={() => !props.locked && props.onClose()} />
      <div
        class={`sheet ${props.tall ? 'tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        ref={ref}
      >
        <div
          class="sheet-grab"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden="true"
        >
          <span class="sheet-handle" />
        </div>
        <div class="sheet-head">
          <h2>{props.title}</h2>
          <button type="button" class="icon-btn sheet-close" aria-label="Close" onClick={() => !props.locked && props.onClose()}>
            <X size={20} />
          </button>
        </div>
        <div class="sheet-body">{props.children}</div>
        {props.footer && <div class="sheet-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Menu */

export function Menu(props: {
  open: boolean;
  onClose: () => void;
  items: { label: string; icon: ComponentChildren; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const first = ref.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const bs = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || [])];
        const i = bs.indexOf(document.activeElement as HTMLElement);
        bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open]);
  if (!props.open) return null;
  return (
    <>
      <div class="menu-scrim" onClick={props.onClose} />
      <div class="menu" role="menu" ref={ref}>
        {props.items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            class={`menu-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              props.onClose();
              it.onSelect();
            }}
          >
            <span class="menu-ico">{it.icon}</span>
            <span class="menu-text">
              {it.label}
              {it.hint && <small>{it.hint}</small>}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
