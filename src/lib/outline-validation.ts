import path from "path";
import { shouldIncludeFile } from "@/lib/code-project";
import { validateSourcePath } from "@/lib/source-selector";
import type { StageOutline } from "@/lib/learning-types";

export interface OutlineFileValidationError {
  path: string;
  reason: string;
}

export function validateOutlineFiles(
  outline: StageOutline,
  sourcePath: string | undefined,
  requireExisting: boolean
): { valid: boolean; errors: OutlineFileValidationError[] } {
  if (!sourcePath || outline.sections.files_to_read.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors: OutlineFileValidationError[] = [];

  for (const f of outline.sections.files_to_read) {
    const check = validateSourcePath(sourcePath, f.path);
    if (check.reason === "invalid_path" || check.reason === "path_escape" || check.reason === "symlink_escape") {
      errors.push({ path: f.path, reason: check.reason });
      continue;
    }
    if (check.reason === "not_file") {
      errors.push({ path: f.path, reason: "not_file" });
      continue;
    }
    if (requireExisting && (check.reason === "not_found" || !check.valid)) {
      errors.push({ path: f.path, reason: "not_found" });
      continue;
    }
    if (check.valid && check.resolved && !shouldIncludeFile(path.basename(check.resolved))) {
      errors.push({ path: f.path, reason: "not_code_file" });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function outlineFileErrorMessage(errors: OutlineFileValidationError[]): string {
  if (errors.length === 0) return "大纲文件路径无效";
  const sample = errors.slice(0, 3).map((e) => e.path).join("、");
  return `大纲文件路径无效（${sample}${errors.length > 3 ? " 等" : ""}）`;
}
