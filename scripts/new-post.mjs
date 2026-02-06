#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_EXTENSIONS = new Set(["md", "mdx"]);

function slugify(title) {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function usage() {
  console.error('Usage: node scripts/new-post.mjs <md|mdx> "Post Title"');
}

function main() {
  const [extArg, ...titleParts] = process.argv.slice(2);
  const ext = (extArg || "").toLowerCase();
  const title = titleParts.join(" ").trim();

  if (!VALID_EXTENSIONS.has(ext)) {
    console.error('Error: extension must be "md" or "mdx".');
    usage();
    process.exit(1);
  }

  if (!title) {
    console.error("Error: title is required.");
    usage();
    process.exit(1);
  }

  const slug = slugify(title);
  if (!slug) {
    console.error("Error: title produced an empty slug.");
    process.exit(1);
  }

  const excerpt = ext === "mdx" ? "{/* excerpt */}" : "<!-- excerpt -->";

const frontmatter = `---
title: "${title}"
description: ""
excerpt: ""
tags: []
date: ${new Date().toISOString()}
draft: true
---

${excerpt}
`;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const blogDir = path.join(repoRoot, "src", "content", "docs", "blog");
  const filePath = path.join(blogDir, `${slug}.${ext}`);

  fs.mkdirSync(blogDir, { recursive: true });

  if (fs.existsSync(filePath)) {
    console.error(`Error: file already exists: ${filePath}`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, frontmatter, { encoding: "utf8" });
  console.log(`Created ${filePath}`);
}

main();
