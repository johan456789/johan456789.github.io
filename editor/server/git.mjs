// git/gh helpers. Everything goes through execFile (never a shell string),
// with cwd = the repo root.
import { execFile } from "node:child_process";

// Directories the editor is allowed to stage/commit (repo-relative, trailing /).
export const EDITOR_DIRS = ["src/content/docs/blog/", "src/assets/"];

// Error with a machine-readable code and the HTTP status the API should use.
export class GitError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// A publish failure that names the step that went wrong.
export class PublishError extends Error {
  constructor(step, cause, extra = {}) {
    super(errText(cause));
    this.step = step;
    this.extra = extra;
  }
}

export function errText(e) {
  return (e?.stderr || e?.stdout || e?.message || String(e)).toString().trim() || "unknown error";
}

function run(file, args, { cwd, timeout = 60_000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, timeout, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

// Never prompt for credentials or open an editor; keep output stable.
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", LC_ALL: "C" };
const GH_ENV = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" };

// --literal-pathspecs: file names are data, never globs or magic pathspecs.
export function git(repoRoot, args, opts = {}) {
  return run("git", ["--literal-pathspecs", ...args], { cwd: repoRoot, env: GIT_ENV, ...opts });
}

export function ghBinary(opt) {
  return opt || process.env.EDITOR_GH_BIN || "gh";
}

export async function currentBranch(repoRoot) {
  try {
    const { stdout } = await git(repoRoot, ["symbolic-ref", "--short", "-q", "HEAD"]);
    return stdout.trim() || null; // null = detached HEAD
  } catch {
    return null;
  }
}

export async function defaultBranch(repoRoot) {
  try {
    const { stdout } = await git(repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    const m = /^origin\/(.+)$/.exec(stdout.trim());
    if (m) return m[1];
  } catch {
    /* origin/HEAD not set */
  }
  return "main";
}

export async function remoteUrl(repoRoot) {
  try {
    const { stdout } = await git(repoRoot, ["remote", "get-url", "origin"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function classify(x, y) {
  if (x === "?" || x === "A" || y === "A") return "new";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

// One `git status --porcelain` call -> [{ path, status }].
// -uall lists untracked files individually (a wholly untracked dir would otherwise collapse to "dir/").
export async function getStatus(repoRoot) {
  const { stdout } = await git(repoRoot, ["status", "--porcelain=v1", "-z", "-uall"]);
  const parts = stdout.split("\0");
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const x = p[0];
    const y = p[1];
    if (x === "R" || x === "C") i++; // next token is the rename source
    entries.push({ path: p.slice(3), status: classify(x, y), untracked: x === "?" });
  }
  return entries;
}

export const inEditorDirs = (p) => EDITOR_DIRS.some((d) => p.startsWith(d));

async function aheadBehind(repoRoot, def) {
  try {
    const { stdout } = await git(repoRoot, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
    return { ahead, behind };
  } catch {
    /* no upstream */
  }
  try {
    // Unpushed branch: report how far it is ahead of the default branch.
    const { stdout } = await git(repoRoot, ["rev-list", "--count", `origin/${def}..HEAD`]);
    return { ahead: Number(stdout.trim()) || 0, behind: 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export async function getGitInfo(repoRoot) {
  const [branch, def, url, entries] = await Promise.all([
    currentBranch(repoRoot),
    defaultBranch(repoRoot),
    remoteUrl(repoRoot),
    getStatus(repoRoot),
  ]);
  const { ahead, behind } = await aheadBehind(repoRoot, def);
  const changes = entries.filter((e) => inEditorDirs(e.path)).map(({ path, status }) => ({ path, status }));
  return {
    branch: branch || "HEAD",
    defaultBranch: def,
    hasRemote: url !== null,
    ahead,
    behind,
    changes,
    otherChanges: entries.length - changes.length,
  };
}

// Validates a client-supplied repo-relative path; returns it without a trailing "/".
export function validateEditorPath(p) {
  const bad = () => new GitError("bad_path", `Path not allowed: ${String(p).slice(0, 200)}`, 400);
  if (typeof p !== "string" || !p || p.includes("\0") || p.includes("\\") || p.startsWith("/")) throw bad();
  const trimmed = p.endsWith("/") ? p.slice(0, -1) : p;
  if (trimmed.split("/").some((s) => s === "" || s === "." || s === "..")) throw bad();
  if (!EDITOR_DIRS.some((d) => p.startsWith(d))) throw bad();
  return trimmed;
}

// Stage and commit only the given paths (default: all editor changes).
export async function commitEditorChanges(repoRoot, { message, paths }) {
  let list;
  if (paths == null) {
    const entries = await getStatus(repoRoot);
    list = entries.filter((e) => inEditorDirs(e.path)).map((e) => e.path.replace(/\/$/, ""));
  } else {
    list = paths.map(validateEditorPath); // an empty array commits nothing
  }
  const nothing = () => new GitError("nothing_to_commit", "Nothing to commit.", 409);
  if (!list.length) throw nothing();

  await git(repoRoot, ["add", "-A", "--", ...list]);
  let dirty = false;
  try {
    await git(repoRoot, ["diff", "--cached", "--quiet", "--", ...list]);
  } catch (e) {
    if (e.code === 1) dirty = true;
    else throw e;
  }
  if (!dirty) throw nothing();

  // `-- paths` commits only those paths, even if other things are staged.
  await git(repoRoot, ["commit", "-m", message, "--", ...list]);
  const { stdout } = await git(repoRoot, ["rev-parse", "--short", "HEAD"]);
  return stdout.trim();
}

// Builds a GitHub compare URL from an origin URL, or null for non-GitHub remotes.
export function compareUrlFor(origin, base, branch) {
  if (!origin) return null;
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      origin.trim(),
    );
  if (!m) return null;
  const enc = (s) => s.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${m[1]}/${m[2]}/compare/${enc(base)}...${enc(branch)}?expand=1`;
}

// Returns the PR url, or null when gh is not installed.
async function findOrCreatePr(repoRoot, { ghBin, branch, base, title }) {
  const opts = { cwd: repoRoot, env: GH_ENV, timeout: 60_000 };
  try {
    const list = await run(
      ghBin,
      ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"],
      opts,
    );
    const existing = JSON.parse(list.stdout || "[]")[0]?.url;
    if (existing) return existing;
    const created = await run(
      ghBin,
      ["pr", "create", "--title", title, "--body", "", "--base", base, "--head", branch],
      opts,
    );
    const urls = created.stdout.split(/\s+/).filter((s) => /^https?:\/\//.test(s));
    return urls.at(-1) ?? null;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

export async function publish(repoRoot, { message, title, slug, ghBin }) {
  const def = await defaultBranch(repoRoot);
  let branch = await currentBranch(repoRoot);

  // Validate before touching anything.
  if (branch === def) {
    if (!slug) throw new GitError("slug_required", "A slug is required to publish from the default branch.", 400);
    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      throw new GitError("bad_name", "Invalid slug.", 400);
    }
  }

  // 1. branch
  if (branch === def) {
    const target = `post/${slug}`;
    try {
      await git(repoRoot, ["switch", "-c", target]); // fails if it already exists
    } catch (e) {
      throw new PublishError("branch", e);
    }
    branch = target;
  } else if (branch === null) {
    throw new PublishError("branch", new Error("HEAD is detached; switch to a branch first."));
  }

  // 2. commit (skipped when there is nothing to commit)
  let commit = null;
  try {
    commit = await commitEditorChanges(repoRoot, { message });
  } catch (e) {
    if (!(e instanceof GitError && e.code === "nothing_to_commit")) throw new PublishError("commit", e);
  }

  // 3. push
  try {
    await git(repoRoot, ["push", "-u", "origin", branch], { timeout: 120_000 });
  } catch (e) {
    throw new PublishError("push", e);
  }

  // 4. pull request (best effort when gh exists)
  const compareUrl = compareUrlFor(await remoteUrl(repoRoot), def, branch);
  let prUrl = null;
  try {
    prUrl = await findOrCreatePr(repoRoot, {
      ghBin: ghBinary(ghBin),
      branch,
      base: def,
      title: (title || message).split("\n")[0],
    });
  } catch (e) {
    throw new PublishError("pr", e, { branch, compareUrl });
  }
  return { branch, commit, prUrl, compareUrl };
}

export async function syncMain(repoRoot) {
  const entries = await getStatus(repoRoot);
  // Tracked changes, or untracked files the editor owns, block the switch.
  // Unrelated untracked files do not (git leaves them alone).
  if (entries.some((e) => !e.untracked || inEditorDirs(e.path))) {
    throw new GitError("dirty", "There are uncommitted changes.", 409);
  }
  const def = await defaultBranch(repoRoot);
  try {
    await git(repoRoot, ["switch", def]);
    await git(repoRoot, ["pull", "--ff-only"], { timeout: 120_000 });
  } catch (e) {
    throw new GitError("sync_failed", errText(e), 500);
  }
  return def;
}
