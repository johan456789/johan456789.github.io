import type { GitInfo, PostMeta, Status } from './types';

const BASE = '/_editor/api';

export class ApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(status: number, code: string, message: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}
/** The server could not be reached (as opposed to answering with an error). */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach the editor server') {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; timeout?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (method !== 'GET') headers['X-Editor'] = '1';
  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 20000);
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body, signal: ctrl.signal, cache: 'no-store' });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    // a proxy in front of a dead server answers 502/503/504 with HTML: treat as unreachable
    if ((res.status === 502 || res.status === 503 || res.status === 504) && !data?.error) throw new NetworkError();
    throw new ApiError(res.status, data?.error || 'error', data?.message || `Request failed (${res.status})`, data);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  status: () => request<Status>('GET', '/status', { timeout: 4000 }),
  posts: () => request<{ posts: PostMeta[] }>('GET', '/posts'),
  getPost: (file: string) =>
    request<{ file: string; content: string; hash: string; mtime: number; url: string }>('GET', `/posts/${enc(file)}`),
  putPost: (file: string, content: string, baseHash: string | null, force = false) =>
    request<{ hash: string; mtime: number }>('PUT', `/posts/${enc(file)}`, {
      json: force ? { content, baseHash, force: true } : { content, baseHash },
    }),
  deletePost: (file: string, baseHash: string) =>
    request<{ ok: true }>('DELETE', `/posts/${enc(file)}`, { json: { baseHash } }),
  putAsset: (name: string, blob: Blob) =>
    request<{ name: string; path: string }>('PUT', `/assets/${enc(name)}`, {
      body: blob,
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      timeout: 90000,
    }),
  git: () => request<GitInfo>('GET', '/git'),
  commit: (message: string) => request<{ commit: string }>('POST', '/git/commit', { json: { message } }),
  publish: (message: string, title: string, slug: string) =>
    request<{ branch: string; commit: string | null; prUrl: string | null; compareUrl: string | null }>(
      'POST',
      '/git/publish',
      { json: { message, title, slug }, timeout: 120000 },
    ),
  syncMain: () => request<{ branch: string }>('POST', '/git/sync-main', { json: {} }),
};
