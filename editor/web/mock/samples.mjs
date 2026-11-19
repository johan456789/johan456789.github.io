const d = (s) => s;
const md = (title, description, tags, date, draft, body, ext = 'md') => {
  const fm = ['---', `title: "${title}"`, `description: "${description}"`];
  fm.push(tags.length ? 'tags:\n' + tags.map((t) => `  - ${t}`).join('\n') : 'tags: []');
  fm.push(`date: ${date}`);
  if (draft !== undefined) fm.push(`draft: ${draft}`);
  fm.push('---');
  return fm.join('\n') + '\n\n' + body;
};

export const samples = {
  'til-happy-eyeballs.mdx': md(
    'TIL: Happy Eyeballs Algorithm',
    'Happy Eyeballs races IPv6 and IPv4 connections to reduce latency and improve reliability.',
    ['til', 'network', 'algorithm'],
    '2026-01-22T22:58:11+08:00',
    false,
    `import RFC_8305_SVG from "@assets/rfc-8305.theme.svg";

When a hostname resolves to both IPv6 and IPv4 addresses, a client has to pick one. Waiting for IPv6 to time out before trying IPv4 can add seconds of delay.

{/* excerpt */}

## How it works

Happy Eyeballs (RFC 8305) starts the IPv6 attempt first, then, after a short delay of about 250 ms, starts an IPv4 attempt in parallel. Whichever connects first wins.

<RFC_8305_SVG />

- Resolve AAAA and A records at the same time
- Prefer IPv6, but do not wait for it
- Cancel the loser once a connection succeeds

> The goal is that the user never notices a broken IPv6 path.

\`\`\`sh
curl -v --connect-timeout 2 https://example.com
\`\`\`
`,
    'mdx',
  ),
  'allow-all-origins-with-a-cors-header-proxy.mdx': md(
    'Allow all origins with a CORS header proxy',
    'A tiny reverse proxy that adds permissive CORS headers so a browser app can call any API.',
    ['cors', 'proxy', 'web'],
    '2026-03-02T09:30:00+08:00',
    false,
    `import { Tabs, TabItem } from '@astrojs/starlight/components';

Browsers block cross-origin requests unless the server opts in. When you do not control the server, a small proxy can add the missing headers.

{/* excerpt */}

## The idea

<Tabs>
  <TabItem label="Node">Use a plain \`http\` server and forward the request.</TabItem>
  <TabItem label="Caddy">Add a \`header\` directive.</TabItem>
</Tabs>

1. Receive the request from the browser
2. Forward it upstream
3. Add \`Access-Control-Allow-Origin: *\` to the response
`,
    'mdx',
  ),
  'pdf-toc-gen.mdx': md(
    'Semi-automatically Generate PDF Table of Contents',
    'I found a tool that can generate table of contents for PDF files semi-automatically.',
    ['pdf', 'cli-tool', 'automation'],
    '2025-12-08T07:00:00+08:00',
    false,
    `import { Picture } from 'astro:assets';
import pdfWithToc from '@assets/pdf-with-toc.png';

I wanted to read a long PDF, but it had no table of contents. Writing one by hand is tedious, so I looked for a tool.

{/* excerpt */}

## Tool: pdf.tocgen

\`pdf.tocgen\` follows the Unix philosophy and provides a pipeline of small tools.

<Picture src={pdfWithToc} alt="A PDF with a generated table of contents" />

Run **pdftocgen** on the recipe, then pipe the result to **pdftocio**.
`,
    'mdx',
  ),
  'til-semi-linear-history.mdx': md(
    'TIL: Semi-linear history in Git',
    'Keep a clean main branch while still recording merge commits for each feature.',
    ['til', 'git'],
    '2025-11-20T21:10:00+08:00',
    false,
    `A semi-linear history rebases a feature branch onto main and then creates a merge commit, so main reads like a list of features.

{/* excerpt */}

## Steps

1. Rebase the branch on main
2. Merge with \`--no-ff\`
3. Delete the branch
`,
    'mdx',
  ),
  'book-review-collywobbles.md': md(
    'Book review: Collywobbles',
    'A short, spoiler-free review of a book that kept me up past midnight.',
    ['books', 'review'],
    '2025-06-14T20:00:00-04:00',
    false,
    `I picked this book up on a whim and finished it in two sittings.

<!-- excerpt -->

## What worked

The pacing is excellent. Chapters end just before you would put the book down.

## What did not

The middle third leans on a coincidence that I never quite bought.

**Verdict:** recommended, especially on a rainy weekend.
`,
  ),
  'why-password-managers-are-both-more-convenient-and-secure.md': md(
    'Why password managers are both more convenient and more secure',
    'Convenience and security rarely line up. Password managers are the exception.',
    ['security', 'privacy'],
    '2025-02-03T10:00:00-05:00',
    undefined,
    `Most security advice makes life harder. Password managers are different: the secure option is also the easy one.

<!-- excerpt -->

## Convenience

- Autofill is faster than typing
- One master password instead of hundreds
- Sync across every device

## Security

Unique passwords per site mean one breach does not unlock everything else.
`,
  ),
  'on-writing-slowly.md': md(
    'On writing slowly',
    '',
    ['writing'],
    '2026-04-18T08:15:00+08:00',
    true,
    `Draft thoughts about why I stopped trying to publish every week.

<!-- excerpt -->

Still to do: an example, a conclusion, and a better title.
`,
  ),
  'notes-on-tailscale-serve.mdx': md(
    'Notes on Tailscale serve',
    'Expose a local dev server over HTTPS to a phone on the tailnet.',
    ['tailscale', 'network', 'til'],
    '2026-04-30T18:40:00+08:00',
    true,
    `The short version is \`tailscale serve --bg 2531\`.

{/* excerpt */}

## Why HTTPS matters

Service workers and home-screen install both require a secure context.
`,
    'mdx',
  ),
};
