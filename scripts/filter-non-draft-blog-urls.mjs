#!/usr/bin/env node
import fs from "node:fs";
import { parse } from "yaml";

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function extractFrontmatter(content) {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : "";
}

function isDraftPost(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const frontmatter = extractFrontmatter(source);

  if (!frontmatter) {
    return false;
  }

  let data;
  try {
    data = parse(frontmatter) ?? {};
  } catch (error) {
    console.warn(`Skipping draft check for malformed frontmatter in ${filePath}`);
    return false;
  }

  const draft = data.draft;
  return draft === true || (typeof draft === "string" && draft.trim().toLowerCase() === "true");
}

const files = readStdin()
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const urls = new Set();
for (const file of files) {
  if (isDraftPost(file)) {
    continue;
  }

  urls.add(file.replace(/^src\/content\/docs/, "").replace(/\.(md|mdx)$/, "/"));
}

process.stdout.write(Array.from(urls).sort().join("\n"));
