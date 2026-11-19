export interface PostMeta {
  file: string;
  slug: string;
  ext: 'md' | 'mdx';
  title: string;
  description: string;
  date: string | null;
  tags: string[];
  draft: boolean;
  hash: string;
  mtime: number;
  git: 'clean' | 'modified' | 'new';
  url: string;
}

export interface Status {
  ok: boolean;
  astro: 'ready' | 'starting' | 'down';
  branch: string;
  defaultBranch: string;
}

export interface GitInfo {
  branch: string;
  defaultBranch: string;
  hasRemote: boolean;
  ahead: number;
  behind: number;
  changes: { path: string; status: 'modified' | 'new' | 'deleted' }[];
  otherChanges: number;
}

export interface DocRecord {
  file: string;
  content: string;
  /** last server hash this content descends from; null for posts never uploaded */
  baseHash: string | null;
  dirty: boolean;
  localUpdatedAt: number;
  isNew: boolean;
  url?: string;
  conflict?: { content: string | null; hash: string | null; kind: 'conflict' | 'exists' } | null;
}

export interface OutboxItem {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  createdAt: number;
}

export type DocStatus = 'saved' | 'saving' | 'pending' | 'conflict';
