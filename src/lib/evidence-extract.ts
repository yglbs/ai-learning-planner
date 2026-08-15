import type { GroundedSourceBundle } from "@/lib/learning-types";

/** Paths from the grounded bundle that are explicitly mentioned in generated text. */
export function extractCitedSourcePaths(
  conclusion: string,
  bundle: GroundedSourceBundle | null | undefined
): string[] {
  if (!bundle?.files.length || !conclusion.trim()) return [];

  const cited: string[] = [];
  const seen = new Set<string>();
  const lower = conclusion.toLowerCase();

  for (const file of bundle.files) {
    const norm = file.path.replace(/\\/g, "/");
    const base = norm.split("/").pop() || norm;
    const variants = [norm, base].filter((v) => v.length >= 3);

    for (const v of variants) {
      if (seen.has(norm)) break;
      if (lower.includes(v.toLowerCase())) {
        seen.add(norm);
        cited.push(norm);
        break;
      }
    }
  }

  return cited;
}
