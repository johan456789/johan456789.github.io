export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function newPostContent(title: string, ext: 'md' | 'mdx'): string {
  const excerpt = ext === 'mdx' ? '{/* excerpt */}' : '<!-- excerpt -->';
  const safe = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `---\ntitle: "${safe}"\ndescription: ""\nexcerpt: ""\ntags: []\ndate: ${new Date().toISOString()}\ndraft: true\n---\n\n\n${excerpt}\n`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string | null): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (isNaN(+d)) return 'No date';
  const now = new Date();
  const days = Math.floor((+now - +d) / 86400000);
  if (days < 0) return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ', ' + d.getFullYear()}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date-time with the local UTC offset, e.g. 2026-01-22T22:58:11+08:00 */
export function toLocalIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

/** value for <input type="datetime-local"> */
export function toInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(+d) ? null : toLocalIso(d);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
