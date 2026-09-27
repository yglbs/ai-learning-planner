/** Pull a JSON value out of a model reply that may include fences, prose, or a cut-off ending. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const candidates = [...fencedBlocks(cleaned), ...objectSlices(cleaned)];

  let best: unknown;
  let bestLength = 0;
  let lastError: unknown;
  for (const candidate of candidates) {
    for (const variant of variants(candidate)) {
      try {
        const value = JSON.parse(variant);
        if (value && typeof value === "object" && variant.length >= bestLength) {
          best = value;
          bestLength = variant.length;
        }
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (best !== undefined) return best;
  throw lastError instanceof Error ? lastError : new Error("不是可解析的 JSON");
}

function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/gi;
  for (const match of text.matchAll(pattern)) {
    blocks.push(match[1].trim());
  }
  return blocks.reverse();
}

function objectSlices(text: string): string[] {
  const found: string[] = [];
  let lastUnclosed = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const end = matchingBrace(text, i);
    if (end > i) {
      found.push(text.slice(i, end + 1));
      i = end;
    } else {
      lastUnclosed = i;
    }
  }
  if (lastUnclosed !== -1) found.push(text.slice(lastUnclosed));
  return found.reverse();
}

function matchingBrace(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function variants(candidate: string): string[] {
  const trimmed = candidate.trim();
  const withoutTrailingComma = trimmed.replace(/,\s*([}\]])/g, "$1");
  return [...new Set([trimmed, withoutTrailingComma, closeTruncatedJson(withoutTrailingComma)])];
}

/** Finish a JSON object that stopped mid-string or mid-structure. */
export function closeTruncatedJson(text: string): string {
  let out = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    out += char;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
  }
  if (escaped) out += "\\";
  if (inString) out += "\"";
  out = out.replace(/,\s*$/, "");
  while (stack.length > 0) out += stack.pop();
  return out;
}
