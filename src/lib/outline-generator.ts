import type { Stage } from "@/db/queries";
import type { LearningMode, StageOutline } from "@/lib/learning-types";
import { validateSourcePath } from "@/lib/source-selector";

const PATH_IN_TEXT_RE =
  /[`'"]?([\w./@-]+(?:\.(?:ts|tsx|js|jsx|go|py|rs|java|kt|vue|sql|yaml|yml|json|md|proto|mod|sum|toml|gradle|xml|cs|rb|php|swift|dart|sh|bash|css|html|h|hpp|c|cpp|cc)))/gi;

const CALL_CHAIN_RE =
  /(?:调用链|主路径|链路)[:：]?\s*([^\n【]+)/i;

const FILES_SECTION_RE = /【精读文件】([\s\S]*?)(?=【|$)/;
const CALL_CHAIN_SECTION_RE = /【调用链路】([\s\S]*?)(?=【|$)/;
const ARCH_SECTION_RE = /【设计取舍】([\s\S]*?)(?=【|$)/;

function extractPathsFromText(text: string, knownPaths: Set<string>): { path: string; reason: string }[] {
  const results: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PATH_IN_TEXT_RE.lastIndex = 0;
  while ((match = PATH_IN_TEXT_RE.exec(text)) !== null) {
    const p = match[1].replace(/\\/g, "/");
    if (seen.has(p)) continue;
    if (knownPaths.has(p) || (p.includes("/") && p.includes("."))) {
      seen.add(p);
      results.push({ path: p, reason: "从阶段导读/描述中提取" });
    }
  }
  return results.slice(0, 12);
}

function parseFilesSection(summaryText: string): { path: string; reason: string }[] {
  const m = summaryText.match(FILES_SECTION_RE);
  if (!m) return [];
  const block = m[1];
  const paths: { path: string; reason: string }[] = [];
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line.replace(/^[-*•\d.)]+\s*/, "");
    const pathMatch = cleaned.match(/([\w./@-]+\.\w+)/);
    if (pathMatch) {
      paths.push({ path: pathMatch[1], reason: cleaned.slice(0, 120) });
    }
  }
  return paths;
}

/** Deterministic outline from existing stage data — no LLM call. */
export function generateStageOutline(params: {
  stage: Stage;
  learningMode: LearningMode;
  sourcePath?: string;
  sourceFiles?: string[];
}): StageOutline {
  const { stage, learningMode } = params;
  const knownPaths = new Set((params.sourceFiles || []).map((p) => p.replace(/\\/g, "/")));
  const summary = stage.summary_text || "";

  let filesToRead = parseFilesSection(summary);
  if (filesToRead.length === 0) {
    filesToRead = extractPathsFromText(summary, knownPaths);
  }
  if (filesToRead.length === 0 && params.sourcePath && knownPaths.size > 0) {
    const keywords = [...stage.key_topics, ...stage.title.split(/[\s:：\-_/]+/)];
    const scored = [...knownPaths]
      .map((p) => {
        const lower = p.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
          if (kw.length >= 2 && lower.includes(kw.toLowerCase())) score += 1;
        }
        return { path: p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    filesToRead = scored.map((s) => ({ path: s.path, reason: "与阶段关键词匹配" }));
  }

  if (params.sourcePath) {
    filesToRead = filesToRead.filter((f) => {
      const check = validateSourcePath(params.sourcePath!, f.path);
      return check.valid || check.reason === "not_found";
    }).slice(0, 12);
  }

  // 业务/业务×技术：优先把 Handler、路由、server 提到前面，main 靠后
  if (learningMode === "business" || learningMode === "business_through_tech") {
    const rank = (p: string) => {
      const lower = p.toLowerCase();
      if (/(handler|controller|router|route|server\.go|server\.ts|api\/)/.test(lower)) return 0;
      if (/(service|usecase|biz)/.test(lower)) return 1;
      if (/(main\.|cmd\/)/.test(lower)) return 3;
      return 2;
    };
    filesToRead = [...filesToRead].sort((a, b) => rank(a.path) - rank(b.path));
  }

  let callChain = "";
  const chainSection = summary.match(CALL_CHAIN_SECTION_RE);
  if (chainSection) {
    callChain = chainSection[1].trim().slice(0, 1500);
  } else {
    const chainMatch = summary.match(CALL_CHAIN_RE);
    if (chainMatch) callChain = chainMatch[1].trim().slice(0, 1500);
  }

  let architectureFocus = "";
  const archSection = summary.match(ARCH_SECTION_RE);
  if (archSection) {
    architectureFocus = archSection[1].trim().slice(0, 800);
  } else if (stage.core_output) {
    architectureFocus = stage.core_output.slice(0, 800);
  }

  const objectives =
    stage.learning_objectives?.length > 0
      ? stage.learning_objectives
      : stage.key_topics.slice(0, 6);

  const scenarios =
    stage.real_world_cases?.length > 0
      ? stage.real_world_cases
      : [`在 ${stage.title} 场景下，解释核心流程并指出关键决策点`];

  const estimatedMinutes = Math.max(30, (stage.estimated_days || 1) * 60);

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    learning_mode: learningMode,
    sections: {
      objectives,
      scenarios,
      files_to_read: filesToRead,
      call_chain: callChain,
      architecture_focus: architectureFocus,
      estimated_minutes: estimatedMinutes,
      out_of_scope: ["后续阶段内容", "未在本阶段导读中出现的模块"],
    },
  };
}

export function mergeOutlineAdjustments(
  outline: StageOutline,
  patch: {
    objectives?: string[];
    scenarios?: string[];
    files_to_read?: { path: string; reason: string; symbols?: string[] }[];
    call_chain?: string;
    architecture_focus?: string;
    estimated_minutes?: number;
    out_of_scope?: string[];
    user_adjustments?: string;
  }
): StageOutline {
  return {
    ...outline,
    sections: {
      objectives: patch.objectives ?? outline.sections.objectives,
      scenarios: patch.scenarios ?? outline.sections.scenarios,
      files_to_read: patch.files_to_read ?? outline.sections.files_to_read,
      call_chain: patch.call_chain ?? outline.sections.call_chain,
      architecture_focus: patch.architecture_focus ?? outline.sections.architecture_focus,
      estimated_minutes: patch.estimated_minutes ?? outline.sections.estimated_minutes,
      out_of_scope: patch.out_of_scope ?? outline.sections.out_of_scope,
    },
    user_adjustments: patch.user_adjustments ?? outline.user_adjustments,
  };
}
