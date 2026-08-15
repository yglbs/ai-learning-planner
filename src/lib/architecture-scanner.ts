import path from "path";
import type { LearningPlan } from "@/db/queries";
import type { ArchitectureSnapshot } from "@/lib/learning-types";
import { validateSourcePath } from "@/lib/source-selector";
import { resolveProjectPath, shouldIncludeFile } from "@/lib/code-project";

const ENTRY_NAMES = new Set([
  "main.go", "main.py", "main.ts", "main.js", "index.ts", "index.js",
  "app.ts", "app.js", "server.ts", "server.js", "mod.rs", "manage.py",
]);

const CONFIG_NAMES = new Set([
  "package.json", "go.mod", "Cargo.toml", "docker-compose.yml", "Dockerfile",
  "tsconfig.json", "pyproject.toml",
]);

function inferKind(relativePath: string): "module" | "service" | "entry" | "config" | "data" | "other" {
  const base = path.basename(relativePath);
  const lower = relativePath.toLowerCase();
  if (ENTRY_NAMES.has(base)) return "entry";
  if (CONFIG_NAMES.has(base)) return "config";
  if (lower.includes("service") || lower.includes("handler") || lower.includes("controller")) return "service";
  if (lower.includes("model") || lower.includes("schema") || lower.includes("entity") || lower.includes("db")) return "data";
  if (lower.includes("internal/") || lower.includes("pkg/") || lower.includes("src/")) return "module";
  return "other";
}

function groupByTopSegment(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    const parts = norm.split("/");
    const key = parts.length > 1 ? parts[0] : "(root)";
    const list = groups.get(key) || [];
    list.push(norm);
    groups.set(key, list);
  }
  return groups;
}

function inferEdges(components: ArchitectureSnapshot["components"]): ArchitectureSnapshot["edges"] {
  const edges: ArchitectureSnapshot["edges"] = [];
  const entries = components.filter((c) => c.kind === "entry");
  const services = components.filter((c) => c.kind === "service" || c.kind === "module");
  const data = components.filter((c) => c.kind === "data");

  for (const entry of entries) {
    for (const svc of services.slice(0, 3)) {
      edges.push({
        from: entry.id,
        to: svc.id,
        label: "invokes",
        evidence: "inferred",
      });
    }
  }
  for (const svc of services.slice(0, 5)) {
    for (const d of data.slice(0, 2)) {
      edges.push({
        from: svc.id,
        to: d.id,
        label: "uses",
        evidence: "inferred",
      });
    }
  }
  return edges.slice(0, 20);
}

/** Deterministic architecture scan from repository file paths — no LLM. */
export function scanRepositoryArchitecture(plan: LearningPlan): ArchitectureSnapshot | null {
  if (plan.source_type !== "code" || !plan.source_path) return null;

  const root = resolveProjectPath(plan.source_path);
  const files = (plan.source_files || []).map((f) => f.replace(/\\/g, "/"));

  const verifiedPaths: string[] = [];
  for (const f of files) {
    const check = validateSourcePath(root, f);
    if (check.valid) verifiedPaths.push(check.normalized || f);
  }

  if (verifiedPaths.length === 0) {
    return {
      version: 1,
      generated_at: new Date().toISOString(),
      components: [],
      edges: [],
      source_refs: [],
      notes: "未找到可验证的源码文件",
    };
  }

  const groups = groupByTopSegment(verifiedPaths);
  const components: ArchitectureSnapshot["components"] = [];
  let idx = 0;

  for (const [segment, paths] of groups) {
    const entryPaths = paths.filter((p) => ENTRY_NAMES.has(path.basename(p)));
    const configPaths = paths.filter((p) => CONFIG_NAMES.has(path.basename(p)));
    const codePaths = paths.filter((p) => shouldIncludeFile(path.basename(p)));

    if (entryPaths.length > 0) {
      components.push({
        id: `comp_${idx++}`,
        name: `${segment} 入口`,
        kind: "entry",
        paths: entryPaths.slice(0, 5),
        evidence: "verified",
      });
    }

    const kind = inferKind(paths[0] || segment);
    if (codePaths.length > 0) {
      components.push({
        id: `comp_${idx++}`,
        name: segment === "(root)" ? "根模块" : segment,
        kind: kind === "entry" ? "module" : kind,
        paths: codePaths.slice(0, 8),
        evidence: "verified",
      });
    }

    if (configPaths.length > 0) {
      components.push({
        id: `comp_${idx++}`,
        name: `${segment} 配置`,
        kind: "config",
        paths: configPaths.slice(0, 5),
        evidence: "verified",
      });
    }
  }

  const edges = inferEdges(components);

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    components: components.slice(0, 30),
    edges,
    source_refs: verifiedPaths.slice(0, 50),
    notes: "基于仓库文件路径的结构化扫描；边关系为推断，需结合源码确认",
  };
}
