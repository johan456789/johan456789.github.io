import YAML, { Scalar } from 'yaml';

export interface Meta {
  title: string;
  description: string;
  tags: string[];
  date: string | null;
  draft: boolean;
  hasFrontmatter: boolean;
}

const FM_RE = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*)(\r?\n|$)/;

export interface Split {
  /** raw YAML between the fences, or null when there is no frontmatter */
  yaml: string | null;
  /** everything after the closing fence line */
  body: string;
  /** offset in the full text where the body starts (0 without frontmatter) */
  bodyStart: number;
  eol: string;
}

export function splitFrontmatter(text: string): Split {
  const m = FM_RE.exec(text);
  if (!m) return { yaml: null, body: text, bodyStart: 0, eol: '\n' };
  return { yaml: m[2], body: text.slice(m[0].length), bodyStart: m[0].length, eol: m[1].includes('\r') ? '\r\n' : '\n' };
}

function asIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString();
  return String(v);
}

export function readMeta(text: string): Meta {
  const s = splitFrontmatter(text);
  const out: Meta = { title: '', description: '', tags: [], date: null, draft: false, hasFrontmatter: s.yaml !== null };
  if (s.yaml === null) return out;
  let data: any = null;
  try {
    data = YAML.parse(s.yaml);
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object') return out;
  out.title = data.title != null ? String(data.title) : '';
  out.description = data.description != null ? String(data.description) : '';
  out.tags = Array.isArray(data.tags) ? data.tags.map(String) : typeof data.tags === 'string' ? [data.tags] : [];
  out.date = asIso(data.date);
  out.draft = data.draft === true;
  return out;
}

export type MetaPatch = Partial<Pick<Meta, 'title' | 'description' | 'tags' | 'date' | 'draft'>>;

function setScalar(doc: YAML.Document, key: string, value: string, quote: boolean) {
  const node = doc.get(key, true);
  if (node instanceof Scalar) {
    if (node.value !== value) {
      node.value = value;
      if (value === '' || (quote && node.type !== Scalar.QUOTE_SINGLE)) node.type = Scalar.QUOTE_DOUBLE;
    }
  } else {
    const sc = new Scalar(value);
    if (quote || value === '') sc.type = Scalar.QUOTE_DOUBLE;
    doc.set(key, sc);
  }
}

/** Writes changed fields into the YAML, keeping everything else (ordering, comments, unknown keys) intact. */
export function updateFrontmatter(text: string, patch: MetaPatch): string {
  const s = splitFrontmatter(text);
  const yamlText = s.yaml ?? '';
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(yamlText, { keepSourceTokens: false });
    if (doc.errors.length) return text;
    if (!YAML.isMap(doc.contents)) doc = YAML.parseDocument('');
  } catch {
    return text;
  }
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as any;

  if (patch.title !== undefined) setScalar(doc, 'title', patch.title, true);
  if (patch.description !== undefined) setScalar(doc, 'description', patch.description, true);
  if (patch.tags !== undefined) {
    const cur = doc.get('tags');
    const same = YAML.isSeq(cur) && JSON.stringify(cur.toJSON()) === JSON.stringify(patch.tags);
    if (!same) {
      const seq = doc.createNode(patch.tags) as YAML.YAMLSeq;
      if (patch.tags.length === 0) seq.flow = true;
      doc.set('tags', seq);
    }
  }
  if (patch.date !== undefined) {
    if (patch.date === null) doc.delete('date');
    else if (asIso(doc.get('date')) !== patch.date) {
      const node = doc.get('date', true);
      if (node instanceof Scalar) {
        node.value = patch.date;
        node.type = Scalar.PLAIN;
      } else doc.set('date', new Scalar(patch.date));
    }
  }
  if (patch.draft !== undefined) {
    const has = doc.has('draft');
    if (has || patch.draft) {
      if (doc.get('draft') !== patch.draft) doc.set('draft', patch.draft);
    }
  }
  const out = doc.toString({ lineWidth: 0 }).replace(/\s+$/, '');
  const eol = s.eol;
  const yamlOut = eol === '\r\n' ? out.replace(/\r?\n/g, '\r\n') : out;
  if (s.yaml === null) return `---${eol}${yamlOut}${eol}---${eol}${eol}${text}`;
  const m = FM_RE.exec(text)!;
  return `${m[1]}${yamlOut}${m[3]}${m[4]}` + text.slice(m[0].length);
}
