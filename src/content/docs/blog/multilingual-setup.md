---
title: "Make the blog multilingual (zh-TW)"
description: "Notes on enabling Starlight i18n and adding Traditional Chinese content."
tags:
  - blog
  - i18n
date: 2026-01-19T02:06:26Z
draft: true
---

## Goal

Add Traditional Chinese (zh-TW) support to the Starlight + starlight-blog setup.

## 1) Configure locales in Starlight

Edit `astro.config.mjs` and add `defaultLocale` and `locales` under the `starlight(...)` config:

```js
starlight({
  // ...
  defaultLocale: 'root',
  locales: {
    root: { label: 'English', lang: 'en' },
    'zh-tw': { label: '繁體中文', lang: 'zh-TW' },
  },
})
```

Notes:
- `root` keeps English at the site root (`/`).
- `zh-tw` content will live under `/zh-tw/`.
- The language switcher appears automatically when more than one locale is configured.

## 2) Add localized content folders

Create a locale folder for Traditional Chinese:

```
src/content/docs/zh-tw/
```

For blog posts, mirror the blog folder:

```
src/content/docs/zh-tw/blog/
```

Each localized post should have the same filename as its English version so URLs stay aligned:

```
src/content/docs/blog/first-post.md
src/content/docs/zh-tw/blog/first-post.md
```

## 3) Translate metadata and body

In each `zh-tw` post, translate:
- `title`
- `description`
- tags (optional, but keep them consistent if used for filtering)
- content body

Keep frontmatter fields the same shape to avoid schema issues.

## 4) Optional: localized titles/descriptions

If you want different site titles or descriptions per locale, add them inside the `locales` entries in `astro.config.mjs` (Starlight supports per-locale metadata).

## 5) Verify the build

Run:

```
pnpm dev
```

Check:
- English pages at `/`
- Traditional Chinese pages at `/zh-tw/`
- Language switcher in the header

## Example checklist

- [ ] Add `defaultLocale` and `locales` to `astro.config.mjs`
- [ ] Create `src/content/docs/zh-tw/`
- [ ] Create `src/content/docs/zh-tw/blog/`
- [ ] Translate at least one blog post
- [ ] Confirm `/zh-tw/` routes and language switcher
