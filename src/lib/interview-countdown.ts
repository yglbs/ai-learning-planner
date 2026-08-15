import type { InterviewSession, InterviewTurn } from "@/db/queries";
import { DEFAULT_COUNTDOWN_SECONDS } from "@/lib/learning-types";

export { DEFAULT_COUNTDOWN_SECONDS };

/** ISO timestamp for server-side "now". */
export function serverNowIso(): string {
  return new Date().toISOString();
}

/** Deadline for answering the assistant question just emitted. */
export function computeAnswerDeadline(
  countdownEnabled: boolean,
  countdownSeconds: number,
  fromMs: number = Date.now()
): string | null {
  if (!countdownEnabled) return null;
  return new Date(fromMs + countdownSeconds * 1000).toISOString();
}

/**
 * Latest assistant turn with a deadline that expects a user answer next.
 * Opening user messages have no prior assistant deadline → not late.
 */
export function findActiveAnswerDeadline(turns: InterviewTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "assistant" && t.answer_deadline_at) {
      return t.answer_deadline_at;
    }
  }
  return null;
}

/** Server-authoritative lateness; client elapsed_seconds is diagnostic only. */
export function evaluateAnswerTiming(params: {
  session: InterviewSession;
  priorTurns: InterviewTurn[];
  answeredAt: string;
}): { isLate: boolean; answerDeadlineAt: string | null } {
  const deadline = findActiveAnswerDeadline(params.priorTurns);
  if (!params.session.countdown_enabled || !deadline) {
    return { isLate: false, answerDeadlineAt: deadline };
  }
  const isLate = params.answeredAt > deadline;
  return { isLate, answerDeadlineAt: deadline };
}
