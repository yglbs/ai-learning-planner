import fs from "fs";
import path from "path";
import { resolveProjectPath, MAX_FILE_SIZE, shouldIncludeFile } from "@/lib/code-project";
import type { GroundedSourceBundle, GroundedSourceFile, StageOutline } from "@/lib/learning-types";

const PATH_LIKE_RE =
  /(?:^|[\s「『"'(（\[])([\w./@-]+(?:\.(?:ts|tsx|js|jsx|go|py|rs|java|kt|vue|sql|yaml|yml|json|md|proto|graphql|gql|toml|mod|sum|gradle|xml|cs|rb|php|swift|dart|sh|bash|zsh|wxml|wxss|css|scss|less|html|h|hpp|c|cpp|cc)))(?=[\s」』"'):：,，。]|$)/gi;

/** Canonical project root; follows symlinked roots, blocks escape via file checks. */
export function resolveCanonicalSourceRoot(sourceRoot: string): string {
  const resolved = path.resolve(resolveProjectPath(sourceRoot));
  try {
    if (fs.existsSync(resolved)) {
      return fs.realpathSync(resolved);
    }
  } catch {
    // use resolved path
  }
  return resolved;
}

export interface SourceSelectorOptions {
  sourceRoot: string;
  allFilePaths: string[];
  outline?: StageOutline | null;
  summaryText?: string;
  keywords?: string[];
  maxFiles?: number;
  maxChars?: number;
}

/** Resolve and validate a relative path stays within sourceRoot (no traversal/symlink escape). */
export function validateSourcePath(sourceRoot: string, relativePath: string): {
  valid: boolean;
  resolved: string | null;
  normalized: string | null;
  reason?: string;
} {
  const root = resolveCanonicalSourceRoot(sourceRoot);
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..")) {
    return { valid: false, resolved: null, normalized: null, reason: "invalid_path" };
  }

  const candidate = path.resolve(root, cleaned);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { valid: false, resolved: null, normalized: null, reason: "path_escape" };
  }

  try {
    if (!fs.existsSync(candidate)) {
      return { valid: false, resolved: null, normalized: relative.replace(/\\/g, "/"), reason: "not_found" };
    }
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile()) {
      return { valid: false, resolved: null, normalized: relative.replace(/\\/g, "/"), reason: "not_file" };
    }
    const real = fs.realpathSync(candidate);
    const realRelative = path.relative(root, real);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return { valid: false, resolved: null, normalized: relative.replace(/\\/g, "/"), reason: "symlink_escape" };
    }
    return { valid: true, resolved: real, normalized: relative.replace(/\\/g, "/") };
  } catch {
    return { valid: false, resolved: null, normalized: relative.replace(/\\/g, "/"), reason: "read_error" };
  }
}

function parsePathsFromSummary(summaryText: string, knownPaths: Set<string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PATH_LIKE_RE.lastIndex = 0;
  while ((match = PATH_LIKE_RE.exec(summaryText)) !== null) {
    const raw = match[1].replace(/\\/g, "/");
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (knownPaths.has(raw) || raw.includes("/") || raw.includes(".")) {
      found.push(raw);
    }
  }
  return found;
}

function scoreByKeywords(relativePath: string, keywords: string[]): number {
  const lower = relativePath.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.length >= 2 && lower.includes(k)) score += 3;
  }
  return score;
}

function readFileContent(resolvedPath: string, budget: number): { content: string; truncated: boolean } {
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const limit = Math.min(MAX_FILE_SIZE, budget);
  if (raw.length > limit) {
    return { content: raw.slice(0, limit) + "\n// [truncated]", truncated: true };
  }
  return { content: raw, truncated: false };
}

/** Deterministic source selection: outline files → summary paths → keyword fallback. */
export function selectGroundedSources(options: SourceSelectorOptions): GroundedSourceBundle {
  const maxFiles = options.maxFiles ?? 8;
  const maxChars = options.maxChars ?? 14000;
  const root = resolveCanonicalSourceRoot(options.sourceRoot);
  const knownSet = new Set(options.allFilePaths.map((p) => p.replace(/\\/g, "/")));

  type Candidate = { path: string; priority: number; source: GroundedSourceFile["source"] };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (p: string, priority: number, source: GroundedSourceFile["source"]) => {
    const norm = p.replace(/\\/g, "/");
    if (seen.has(norm)) return;
    seen.add(norm);
    candidates.push({ path: norm, priority, source });
  };

  if (options.outline?.sections.files_to_read) {
    for (const f of options.outline.sections.files_to_read) {
      addCandidate(f.path, 0, "outline");
    }
  }

  if (options.summaryText) {
    for (const p of parsePathsFromSummary(options.summaryText, knownSet)) {
      addCandidate(p, 1, "summary_path");
    }
  }

  const keywords = options.keywords ?? [];
  if (keywords.length > 0) {
    const scored = options.allFilePaths
      .map((p) => ({ path: p.replace(/\\/g, "/"), score: scoreByKeywords(p, keywords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    for (const item of scored) {
      addCandidate(item.path, 2, "keyword");
    }
  }

  // Deterministic fallback when no scored/outline candidates
  if (candidates.length === 0 && options.allFilePaths.length > 0) {
    const fallback = [...options.allFilePaths]
      .map((p) => p.replace(/\\/g, "/"))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 5);
    for (const p of fallback) {
      addCandidate(p, 3, "keyword");
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));

  const files: GroundedSourceFile[] = [];
  const missing_paths: string[] = [];
  let total_chars = 0;
  let capped = false;

  for (const cand of candidates) {
    if (files.length >= maxFiles || total_chars >= maxChars) {
      capped = true;
      break;
    }

    const check = validateSourcePath(options.sourceRoot, cand.path);
    if (!check.valid || !check.resolved) {
      if (check.reason === "not_found" || check.reason === "read_error") {
        missing_paths.push(cand.path);
      }
      continue;
    }

    if (!shouldIncludeFile(path.basename(check.resolved))) {
      continue;
    }

    const budget = maxChars - total_chars;
    if (budget <= 200) {
      capped = true;
      break;
    }

    try {
      const { content, truncated } = readFileContent(check.resolved, budget);
      files.push({
        path: check.normalized || cand.path,
        content,
        truncated,
        source: cand.source,
        char_count: content.length,
      });
      total_chars += content.length;
    } catch {
      missing_paths.push(cand.path);
    }
  }

  return { files, missing_paths, total_chars, capped };
}

/** Legacy wrapper: returns concatenated context string for existing callers. */
export function groundedSourcesToContext(bundle: GroundedSourceBundle): string {
  return bundle.files
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join("\n\n");
}

export function loadStageCodeContextFromBundle(params: {
  sourcePath: string;
  filePaths: string[];
  stageTitle: string;
  keyTopics: string[];
  outline?: StageOutline | null;
  summaryText?: string;
  maxChars?: number;
}): string {
  const bundle = selectGroundedSources({
    sourceRoot: params.sourcePath,
    allFilePaths: params.filePaths,
    outline: params.outline,
    summaryText: params.summaryText,
    keywords: [...params.keyTopics, ...params.stageTitle.split(/[\s:：\-_/]+/)],
    maxChars: params.maxChars ?? 14000,
  });
  return groundedSourcesToContext(bundle);
}
