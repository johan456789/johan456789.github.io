import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import { Bold, Code, Heading, Image as ImageIcon, Italic, Link, List, ListOrdered, Quote, Redo2, SquareCode, Undo2 } from 'lucide-preact';
import { cmd } from '../cm';

/**
 * A toolbar button that keeps the editor focused (so the keyboard stays up) and still lets the bar scroll:
 * pointerdown is cancelled to prevent the focus change, the action fires on pointerup when the finger did not travel.
 */
function TBtn(props: { label: string; onAct: () => void; children: ComponentChildren; disabled?: boolean; sep?: boolean }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      class={`tb-btn ${props.sep ? 'sep' : ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) props.onAct();
      }}
      onPointerCancel={() => (start.current = null)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        // keyboard activation (Enter/Space) has no pointer events
        if (e.detail === 0) props.onAct();
      }}
    >
      {props.children}
    </button>
  );
}

export function Toolbar(props: {
  getView: () => EditorView | null;
  canUndo: boolean;
  canRedo: boolean;
  onImage: () => void;
}) {
  const run = (f: (v: EditorView) => void) => () => {
    const v = props.getView();
    if (v) f(v);
  };
  const S = 21;
  return (
    <div class="toolbar" role="toolbar" aria-label="Formatting" aria-orientation="horizontal">
      <div class="toolbar-scroll">
        <TBtn label="Bold" onAct={run(cmd.bold)}><Bold size={S} /></TBtn>
        <TBtn label="Italic" onAct={run(cmd.italic)}><Italic size={S} /></TBtn>
        <TBtn label="Heading" onAct={run(cmd.heading)}><Heading size={S} /></TBtn>
        <TBtn label="Link" onAct={run(cmd.link)}><Link size={S} /></TBtn>
        <TBtn label="Bulleted list" sep onAct={run((v) => cmd.linePrefix(v, 'bullet'))}><List size={S} /></TBtn>
        <TBtn label="Numbered list" onAct={run((v) => cmd.linePrefix(v, 'number'))}><ListOrdered size={S} /></TBtn>
        <TBtn label="Quote" onAct={run((v) => cmd.linePrefix(v, 'quote'))}><Quote size={S} /></TBtn>
        <TBtn label="Inline code" sep onAct={run(cmd.code)}><Code size={S} /></TBtn>
        <TBtn label="Code block" onAct={run(cmd.codeBlock)}><SquareCode size={S} /></TBtn>
        <TBtn label="Insert image" onAct={props.onImage}><ImageIcon size={S} /></TBtn>
        <TBtn label="Undo" sep disabled={!props.canUndo} onAct={run(cmd.undo)}><Undo2 size={S} /></TBtn>
        <TBtn label="Redo" disabled={!props.canRedo} onAct={run(cmd.redo)}><Redo2 size={S} /></TBtn>
      </div>
    </div>
  );
}
