import { EditorState, EditorSelection, type ChangeSpec, Compartment } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, type DecorationSet, keymap, placeholder, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { splitFrontmatter } from './frontmatter';

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-h tok-h1' },
  { tag: t.heading2, class: 'tok-h tok-h2' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], class: 'tok-h tok-h3' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.emphasis, class: 'tok-em' },
  { tag: t.strikethrough, class: 'tok-strike' },
  { tag: t.link, class: 'tok-link' },
  { tag: t.url, class: 'tok-url' },
  { tag: t.monospace, class: 'tok-code' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: t.processingInstruction, class: 'tok-mark' },
  { tag: t.contentSeparator, class: 'tok-mark' },
  { tag: [t.comment, t.meta], class: 'tok-comment' },
  { tag: [t.angleBracket, t.tagName, t.attributeName], class: 'tok-tag' },
]);

/** Marks the YAML frontmatter lines so CSS can quiet them down. */
function fmDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const text = doc.sliceString(0, Math.min(doc.length, 6000));
  const s = splitFrontmatter(text);
  if (s.yaml === null) return Decoration.none;
  const lastLine = doc.lineAt(Math.max(0, s.bodyStart - 1)).number;
  const out = [];
  for (let n = 1; n <= lastLine; n++) {
    const line = doc.line(n);
    const edge = n === 1 || n === lastLine;
    out.push(Decoration.line({ class: edge ? (n === lastLine ? 'cm-fm cm-fm-edge cm-fm-last' : 'cm-fm cm-fm-edge') : 'cm-fm' }).range(line.from));
  }
  return Decoration.set(out);
}

const fmPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = fmDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = fmDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export interface EditorHandle {
  view: EditorView;
  getText(): string;
  setText(text: string): void;
  destroy(): void;
}

export interface EditorCallbacks {
  onChange(text: string): void;
  onState(s: { canUndo: boolean; canRedo: boolean }): void;
}

const readOnly = new Compartment();

export function createEditor(parent: HTMLElement, initial: string, cb: EditorCallbacks): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        fmPlugin,
        placeholder('Start writing…'),
        readOnly.of([]),
        EditorView.contentAttributes.of({
          spellcheck: 'true',
          autocorrect: 'on',
          autocapitalize: 'sentences',
          enterkeyhint: 'enter',
          'aria-label': 'Post text',
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.onChange(u.state.doc.toString());
          if (u.docChanged || u.transactions.length) {
            cb.onState({ canUndo: undoDepth(u.state) > 0, canRedo: redoDepth(u.state) > 0 });
          }
        }),
      ],
    }),
  });
  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(text: string) {
      const cur = view.state.doc.toString();
      if (cur === text) return;
      // replace only the differing middle so the selection and scroll stay put where possible
      let a = 0;
      const max = Math.min(cur.length, text.length);
      while (a < max && cur.charCodeAt(a) === text.charCodeAt(a)) a++;
      let b = 0;
      while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
      view.dispatch({
        changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) },
        annotations: [],
      });
    },
    destroy: () => view.destroy(),
  };
}

/* ------------------------------------------------------------- commands */

type V = EditorView;

function wrapSelection(view: V, open: string, close = open) {
  const { state } = view;
  const tr = state.changeByRange((r) => {
    const before = state.sliceDoc(Math.max(0, r.from - open.length), r.from);
    const after = state.sliceDoc(r.to, r.to + close.length);
    if (r.from >= open.length && before === open && after === close) {
      return {
        changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }],
        range: EditorSelection.range(r.from - open.length, r.to - open.length),
      };
    }
    const inner = state.sliceDoc(r.from, r.to);
    if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
      return {
        changes: [{ from: r.from, to: r.from + open.length }, { from: r.to - close.length, to: r.to }],
        range: EditorSelection.range(r.from, r.to - open.length - close.length),
      };
    }
    return {
      changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }],
      range: EditorSelection.range(r.from + open.length, r.to + open.length),
    };
  });
  view.dispatch(state.update(tr, { userEvent: 'input.format', scrollIntoView: true }));
  view.focus();
}

export const cmd = {
  bold: (v: V) => wrapSelection(v, '**'),
  italic: (v: V) => wrapSelection(v, '*'),
  code: (v: V) => wrapSelection(v, '`'),
  undo: (v: V) => {
    undo(v);
    v.focus();
  },
  redo: (v: V) => {
    redo(v);
    v.focus();
  },

  heading(v: V) {
    const { state } = v;
    const changes: ChangeSpec[] = [];
    const seen = new Set<number>();
    for (const r of state.selection.ranges) {
      const first = state.doc.lineAt(r.from).number;
      const last = state.doc.lineAt(r.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = state.doc.line(n);
        const m = /^(#{1,6})\s+/.exec(line.text);
        const level = m ? m[1].length : 0;
        const next = level === 0 ? 2 : level >= 4 ? 0 : level + 1;
        const prefix = next ? '#'.repeat(next) + ' ' : '';
        changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix });
      }
    }
    v.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
    v.focus();
  },

  link(v: V) {
    const { state } = v;
    const r = state.selection.main;
    const sel = state.sliceDoc(r.from, r.to);
    const isUrl = /^https?:\/\/\S+$/.test(sel);
    if (isUrl) {
      v.dispatch({ changes: { from: r.from, to: r.to, insert: `[](${sel})` }, selection: { anchor: r.from + 1 }, userEvent: 'input.format' });
    } else if (sel) {
      const insert = `[${sel}](url)`;
      const urlFrom = r.from + sel.length + 3;
      v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: urlFrom, head: urlFrom + 3 }, userEvent: 'input.format' });
    } else {
      v.dispatch({ changes: { from: r.from, insert: '[](url)' }, selection: { anchor: r.from + 1 }, userEvent: 'input.format' });
    }
    v.focus();
  },

  linePrefix(v: V, kind: 'bullet' | 'number' | 'quote') {
    const { state } = v;
    const from = state.doc.lineAt(state.selection.main.from).number;
    const to = state.doc.lineAt(state.selection.main.to).number;
    const re = kind === 'bullet' ? /^(\s*)[-*+]\s+/ : kind === 'number' ? /^(\s*)\d+[.)]\s+/ : /^(\s*)>\s?/;
    const lines = [];
    for (let n = from; n <= to; n++) lines.push(state.doc.line(n));
    const allHave = lines.every((l) => re.test(l.text) || l.text.trim() === '');
    const changes: ChangeSpec[] = [];
    let i = 1;
    for (const l of lines) {
      const m = re.exec(l.text);
      if (allHave && lines.some((x) => x.text.trim())) {
        if (m) changes.push({ from: l.from + m[1].length, to: l.from + m[0].length });
      } else {
        if (l.text.trim() === '' && lines.length > 1) continue;
        const prefix = kind === 'bullet' ? '- ' : kind === 'number' ? `${i++}. ` : '> ';
        // switching between list kinds replaces the old marker
        const other = /^(\s*)([-*+]|\d+[.)]|>)\s+/.exec(l.text);
        if (m) continue;
        if (other && kind !== 'quote') changes.push({ from: l.from + other[1].length, to: l.from + other[0].length, insert: prefix });
        else changes.push({ from: l.from + (/^\s*/.exec(l.text)![0].length), insert: prefix });
      }
    }
    v.dispatch({ changes, userEvent: 'input.format', scrollIntoView: true });
    v.focus();
  },

  codeBlock(v: V) {
    const { state } = v;
    const r = state.selection.main;
    const fromLine = state.doc.lineAt(r.from);
    const toLine = state.doc.lineAt(r.to);
    if (r.empty && fromLine.text.trim() === '') {
      const insert = '```\n\n```';
      v.dispatch({ changes: { from: fromLine.from, to: fromLine.to, insert }, selection: { anchor: fromLine.from + 4 }, userEvent: 'input.format' });
    } else {
      const block = state.sliceDoc(fromLine.from, toLine.to);
      const insert = '```\n' + block + '\n```';
      v.dispatch({ changes: { from: fromLine.from, to: toLine.to, insert }, selection: { anchor: fromLine.from + 3 }, userEvent: 'input.format' });
    }
    v.focus();
  },

  /** Inserts the image markdown with the cursor placed in the alt text. */
  image(v: V, name: string) {
    const r = v.state.selection.main;
    const line = v.state.doc.lineAt(r.from);
    const lead = r.from > line.from && line.text.slice(0, r.from - line.from).trim() ? '\n\n' : '';
    const md = `![](../../../assets/${name})`;
    const insert = lead + md + '\n';
    v.dispatch({
      changes: { from: r.from, to: r.to, insert },
      selection: { anchor: r.from + lead.length + 2 },
      userEvent: 'input.image',
      scrollIntoView: true,
    });
    v.focus();
  },
};

/** Put the caret on the first line after the frontmatter and scroll it to the top. */
export function focusBody(h: EditorHandle) {
  const pos = splitFrontmatter(h.getText()).bodyStart;
  h.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) });
  h.view.focus();
}

export function scrollToBody(h: EditorHandle) {
  const text = h.getText();
  const s = splitFrontmatter(text);
  if (!s.yaml) return;
  const lead = /^\s*/.exec(s.body)![0].length;
  h.view.dispatch({ effects: EditorView.scrollIntoView(s.bodyStart + lead, { y: 'start', yMargin: 10 }) });
}
