import fs from "fs";
import path from "path";

export const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".output",
  "__pycache__", ".pytest_cache", ".mypy_cache", ".tox",
  "vendor", ".idea", ".vscode", ".cursor", ".workflow",
  "coverage", ".nyc_output", ".cache", ".turbo", ".vercel",
  ".svn", ".hg", "target", "bin", "obj", ".gradle",
  "Pods", ".dart_tool", ".pub-cache",
]);

export const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte",
  ".py", ".pyx", ".pyi",
  ".go",
  ".java", ".kt", ".kts", ".scala",
  ".rs",
  ".c", ".cpp", ".cc", ".h", ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift", ".m", ".mm",
  ".dart",
  ".lua",
  ".sh", ".bash", ".zsh",
  ".sql",
  ".proto",
  ".graphql", ".gql",
  ".yaml", ".yml", ".toml",
  ".wxml", ".wxss",
]);

export const CONFIG_FILES = new Set([
  "package.json", "tsconfig.json", "go.mod", "go.sum",
  "Cargo.toml", "pom.xml", "build.gradle", "Makefile",
  "Dockerfile", "docker-compose.yml", "requirements.txt",
  "pyproject.toml", "setup.py", "Gemfile",
  "pubspec.yaml", ".env.example", "app.json", "project.config.json",
  "README.md", "readme.md", "README",
]);

const ENTRY_FILE_BONUS = [
  "main.go", "main.py", "main.ts", "main.js", "main.rs",
  "index.ts", "index.js", "index.tsx", "app.ts", "app.js",
  "app.tsx", "server.ts", "server.js", "mod.rs", "lib.rs",
  "App.tsx", "App.vue", "manage.py", "wsgi.py", "asgi.py",
];

export const MAX_FILE_SIZE = 30_000;
export const MAX_TOTAL_CHARS = 120_000;

export interface FileEntry {
  relativePath: string;
  content: string;
  size: number;
}

export function resolveProjectPath(projectPath: string): string {
  return projectPath.replace(/^~(?=$|\/|\\)/, process.env.HOME || "");
}

export function shouldIncludeFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return CODE_EXTENSIONS.has(ext) || CONFIG_FILES.has(name);
}

function entryPriority(relativePath: string): number {
  const base = path.basename(relativePath);
  if (ENTRY_FILE_BONUS.includes(base)) return 0;
  if (CONFIG_FILES.has(base)) return 1;
  if (relativePath.split(/[\\/]/).length <= 2) return 2;
  return 3;
}

export function walkDir(
  dirPath: string,
  basePath: string,
  files: FileEntry[],
  totalChars: { count: number },
  maxChars: number = MAX_TOTAL_CHARS
) {
  if (totalChars.count >= maxChars) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  const sortedEntries = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    const pa = entryPriority(path.relative(basePath, path.join(dirPath, a.name)));
    const pb = entryPriority(path.relative(basePath, path.join(dirPath, b.name)));
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sortedEntries) {
    if (totalChars.count >= maxChars) break;

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walkDir(path.join(dirPath, entry.name), basePath, files, totalChars, maxChars);
    } else if (entry.isFile() && shouldIncludeFile(entry.name)) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

        const content = fs.readFileSync(fullPath, "utf-8");
        if (totalChars.count + content.length > maxChars) {
          const remaining = maxChars - totalChars.count;
          if (remaining > 500) {
            files.push({
              relativePath,
              content: content.slice(0, remaining) + "\n// [truncated]",
              size: stat.size,
            });
            totalChars.count = maxChars;
          }
          break;
        }

        files.push({ relativePath, content, size: stat.size });
        totalChars.count += content.length;
      } catch {
        // skip unreadable files
      }
    }
  }
}

export function buildFileTree(
  dirPath: string,
  basePath: string,
  prefix: string = "",
  depth: number = 0,
  maxDepth: number = 4
): string {
  if (depth > maxDepth) return prefix + "...\n";

  let result = "";
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }

  const filtered = entries
    .filter((e) => {
      if (e.isDirectory()) return !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".");
      return shouldIncludeFile(e.name);
    })
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.isDirectory()) {
      result += prefix + connector + entry.name + "/\n";
      result += buildFileTree(
        path.join(dirPath, entry.name),
        basePath,
        prefix + childPrefix,
        depth + 1,
        maxDepth
      );
    } else {
      result += prefix + connector + entry.name + "\n";
    }
  }
  return result;
}

export function countProjectFiles(dirPath: string): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;

  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        dirs += 1;
        walk(path.join(current, entry.name));
      } else if (entry.isFile() && shouldIncludeFile(entry.name)) {
        files += 1;
      }
    }
  }

  walk(dirPath);
  return { files, dirs };
}

/** Relative paths of readable source files, without loading file contents. */
export function listProjectSourceFiles(dirPath: string, maxFiles = 3000): string[] {
  const files: string[] = [];

  function walk(current: string) {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (files.length >= maxFiles) return;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(path.join(current, entry.name));
      } else if (entry.isFile() && shouldIncludeFile(entry.name)) {
        files.push(path.relative(dirPath, path.join(current, entry.name)).replace(/\\/g, "/"));
      }
    }
  }

  walk(dirPath);
  return files;
}

/** Pick stage-relevant source files and return truncated snippets for teaching. */
export function loadStageCodeContext(params: {
  sourcePath: string;
  filePaths: string[];
  stageTitle: string;
  keyTopics: string[];
  maxChars?: number;
}): string {
  const maxChars = params.maxChars ?? 14000;
  const sourcePath = resolveProjectPath(params.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    return "";
  }

  const keywords = [
    ...params.keyTopics,
    ...params.stageTitle.split(/[\s:：\-_/]+/),
  ]
    .map((k) => k.toLowerCase())
    .filter((k) => k.length >= 2);

  const scored = params.filePaths.map((relativePath) => {
    const lower = relativePath.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score += 3;
    }
    score += Math.max(0, 3 - entryPriority(relativePath));
    return { relativePath, score };
  });

  scored.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));

  const selected = scored.filter((s) => s.score > 0).slice(0, 8);
  const fallback = selected.length > 0 ? selected : scored.slice(0, 5);

  let used = 0;
  const chunks: string[] = [];

  for (const item of fallback) {
    if (used >= maxChars) break;
    const fullPath = path.join(sourcePath, item.relativePath);
    try {
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      const budget = Math.min(MAX_FILE_SIZE, maxChars - used);
      const sliced = content.length > budget
        ? content.slice(0, budget) + "\n// [truncated]"
        : content;
      chunks.push(`=== ${item.relativePath} ===\n${sliced}`);
      used += sliced.length;
    } catch {
      // skip
    }
  }

  return chunks.join("\n\n");
}
