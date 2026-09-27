import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { IGNORED_DIRS, resolveProjectPath, shouldIncludeFile } from "@/lib/code-project";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".xml", ".html", ".css", ".scss",
]);

const SKIP_FILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.lock",
]);

export function dataDir(): string {
  return (
    process.env.APP_DATA_DIR ||
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data")
  );
}

export function isSensitiveFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) {
    return !lower.endsWith(".example");
  }
  return (
    lower.includes("id_rsa")
    || lower.endsWith(".pem")
    || lower.endsWith(".key")
    || lower === "credentials.json"
    || lower === "secrets.json"
  );
}

export function isIgnoredDirName(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith(".");
}

export function canSearchFile(name: string): boolean {
  if (isSensitiveFileName(name) || SKIP_FILE_NAMES.has(name)) return false;
  const ext = path.extname(name).toLowerCase();
  return shouldIncludeFile(name) || TEXT_EXTENSIONS.has(ext);
}

function escapesRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
  } catch {
    // Keep the resolved path when realpath is unavailable.
  }
  return resolved;
}

/** Resolve a relative path and refuse traversal, symlinks that leave the root, and missing parents. */
export function resolveInsideRoot(root: string, relativePath: string): string {
  const base = canonicalRoot(root);
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!cleaned || cleaned === ".") return base;
  if (cleaned.includes("\0") || cleaned.split("/").some((part) => part === "..")) {
    throw new Error("路径不允许超出材料目录");
  }

  const candidate = path.resolve(base, cleaned);
  if (escapesRoot(base, candidate)) {
    throw new Error("路径不允许超出材料目录");
  }

  if (path.relative(base, candidate).split(/[\\/]/).some((part) => isSensitiveFileName(part))) {
    throw new Error("不能读取敏感文件");
  }

  const parent = path.dirname(candidate);
  try {
    if (fs.existsSync(parent)) {
      const realParent = fs.realpathSync(parent);
      if (escapesRoot(base, realParent)) {
        throw new Error("路径不允许超出材料目录");
      }
    }
    if (fs.existsSync(candidate)) {
      const real = fs.realpathSync(candidate);
      if (escapesRoot(base, real)) {
        throw new Error("路径不允许超出材料目录");
      }
      return real;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("路径")) throw error;
    if (error instanceof Error && error.message.startsWith("不能")) throw error;
    throw new Error("无法访问该路径");
  }

  return candidate;
}

export function readableSourceRoot(plan: {
  source_type?: string | null;
  source_path?: string | null;
} | null): string | null {
  if (!plan?.source_path) return null;
  if (plan.source_type !== "code" && plan.source_type !== "book") return null;
  const resolved = path.resolve(resolveProjectPath(plan.source_path));
  if (!fs.existsSync(resolved)) return null;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return null;
    return fs.realpathSync(resolved);
  } catch {
    return null;
  }
}

export function saveBookText(title: string, text: string): { root: string; relativeFile: string } {
  const root = path.join(dataDir(), "books", randomUUID());
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "book.txt"), text, "utf-8");
  fs.writeFileSync(
    path.join(root, "meta.json"),
    JSON.stringify({ title }, null, 2),
    "utf-8"
  );
  return { root, relativeFile: "book.txt" };
}

export function removeSourceDir(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
}

/** Book uploads live under data/books. Code plans point at the user's repo and must not be removed. */
export function isManagedBookDir(sourcePath: string): boolean {
  if (!sourcePath.trim()) return false;
  const booksRoot = path.resolve(dataDir(), "books");
  const rootReal = fs.existsSync(booksRoot) ? fs.realpathSync(booksRoot) : booksRoot;
  let resolved = path.resolve(sourcePath);
  try {
    if (fs.existsSync(resolved)) resolved = fs.realpathSync(resolved);
  } catch {
    return false;
  }
  return resolved === rootReal || resolved.startsWith(rootReal + path.sep);
}
