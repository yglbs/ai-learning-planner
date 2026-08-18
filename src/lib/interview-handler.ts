import { generateText } from "ai";
import { getModel } from "@/lib/llm";
import {
  getChatHistory,
  addChatMessage,
  getOrCreateInterviewSession,
  getInterviewSessionByKey,
  getInterviewTurns,
  addInterviewTurn,
  type InterviewSession,
} from "@/db/queries";
import {
  composePlanInterviewSystemPrompt,
  composeStageInterviewSystemPrompt,
} from "@/lib/prompt-composer";
import type { LearningPlan, Stage } from "@/db/queries";
import type { GroundedSourceBundle, LearningMode } from "@/lib/learning-types";
import { resolvePlanTimeLimit } from "@/lib/challenge";
import { clampAnswerSeconds, DEFAULT_COUNTDOWN_SECONDS } from "@/lib/learning-types";
import {
  serverNowIso,
  computeAnswerDeadline,
  evaluateAnswerTiming,
} from "@/lib/interview-countdown";

export { DEFAULT_COUNTDOWN_SECONDS };

export interface InterviewPostBody {
  message?: string;
  style?: string;
  countdown_enabled?: boolean;
  countdown_seconds?: number;
  fail_on_timeout?: boolean;
  /** Diagnostic only — never used for lateness authority. */
  elapsed_seconds?: number;
  session_id?: string;
}

export interface InterviewPostResult {
  role: "assistant";
  content: string;
  session_id?: string;
  turn_index?: number;
  is_late?: boolean;
  answer_deadline_at?: string | null;
  server_now?: string;
  countdown_enabled?: boolean;
  countdown_seconds?: number;
  failed_timeout?: boolean;
}

export function resolveCountdown(body: InterviewPostBody): {
  enabled: boolean;
  seconds: number;
} {
  return {
    enabled: body.countdown_enabled === true,
    seconds:
      typeof body.countdown_seconds === "number" && body.countdown_seconds > 0
        ? clampAnswerSeconds(body.countdown_seconds, DEFAULT_COUNTDOWN_SECONDS)
        : DEFAULT_COUNTDOWN_SECONDS,
  };
}

export function resolveInterviewCountdown(
  plan: Pick<LearningPlan, "answer_time_limit_enabled" | "answer_time_limit_seconds"> | null,
  body: InterviewPostBody
): { enabled: boolean; seconds: number; failOnTimeout: boolean } {
  const planLimit = plan ? resolvePlanTimeLimit(plan) : { enabled: false, seconds: DEFAULT_COUNTDOWN_SECONDS };
  if (planLimit.enabled) {
    return {
      enabled: true,
      seconds: planLimit.seconds,
      failOnTimeout: true,
    };
  }
  const requested = resolveCountdown(body);
  return {
    enabled: requested.enabled,
    seconds: requested.seconds,
    failOnTimeout: body.fail_on_timeout === true,
  };
}

async function runInterviewLlm(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[]
) {
  const model = getModel();
  const { text } = await generateText({ model, system: systemPrompt, messages });
  return text;
}

export interface InterviewExchangeParams {
  session: InterviewSession;
  userMessage: string;
  systemPrompt: string;
  legacyChatId?: string;
  clientElapsedSeconds?: number | null;
  syncLegacyChat?: boolean;
}

/** Shared user→assistant exchange with server-authoritative countdown. */
export async function runInterviewExchange(
  params: InterviewExchangeParams
): Promise<InterviewPostResult> {
  const { session, userMessage, systemPrompt, legacyChatId, clientElapsedSeconds } = params;
  const syncLegacy = params.syncLegacyChat !== false && !!legacyChatId;

  const priorTurns = getInterviewTurns(session.id);
  const userTurnIndex = priorTurns.length;
  const answeredAt = serverNowIso();
  const { isLate, answerDeadlineAt } = evaluateAnswerTiming({
    session,
    priorTurns,
    answeredAt,
  });

  addInterviewTurn({
    session_id: session.id,
    turn_index: userTurnIndex,
    role: "user",
    content: userMessage,
    is_late: isLate,
    elapsed_seconds: clientElapsedSeconds ?? null,
    answered_at: answeredAt,
  });

  if (syncLegacy && legacyChatId) {
    addChatMessage(legacyChatId, "user", userMessage);
  }

  const history = getInterviewTurns(session.id);
  const failedTimeout = isLate && session.fail_on_timeout;
  const chatMessages = history.map((t, i) => {
    let content = t.content;
    if (failedTimeout && t.role === "user" && i === history.length - 1) {
      content = `${content}\n\n[系统判定] 本题回答超时，记为失败，不得分。请简短告知候选人本题已超时失败，然后提出下一题，不要重复上一题。`;
    }
    return {
      role: t.role as "user" | "assistant",
      content,
    };
  });

  const text = await runInterviewLlm(systemPrompt, chatMessages);

  const assistantNow = Date.now();
  const nextDeadline = computeAnswerDeadline(
    session.countdown_enabled,
    session.countdown_seconds,
    assistantNow
  );

  addInterviewTurn({
    session_id: session.id,
    turn_index: userTurnIndex + 1,
    role: "assistant",
    content: text,
    answer_deadline_at: nextDeadline,
  });

  if (syncLegacy && legacyChatId) {
    addChatMessage(legacyChatId, "assistant", text);
  }

  return {
    role: "assistant",
    content: text,
    session_id: session.id,
    turn_index: userTurnIndex + 1,
    is_late: isLate,
    answer_deadline_at: nextDeadline,
    server_now: serverNowIso(),
    countdown_enabled: session.countdown_enabled,
    countdown_seconds: session.countdown_seconds,
    failed_timeout: failedTimeout,
  };
}

/** Stage-scoped interview. */
export async function handleStageInterviewPost(params: {
  stage: Stage;
  plan: LearningPlan;
  body: InterviewPostBody;
  learningMode: LearningMode;
  sourceBundle?: GroundedSourceBundle | null;
  legacyChatId: string;
}): Promise<InterviewPostResult> {
  const { stage, plan, body, learningMode, sourceBundle, legacyChatId } = params;
  const message = body.message?.trim();
  if (!message) throw new Error("消息不能为空");

  const style = body.style || "standard";
  const countdown = resolveInterviewCountdown(plan, body);

  const session = getOrCreateInterviewSession({
    session_key: legacyChatId,
    scope_type: "stage",
    plan_id: plan.id,
    stage_id: stage.id,
    style,
    countdown_enabled: countdown.enabled,
    countdown_seconds: countdown.seconds,
    fail_on_timeout: countdown.failOnTimeout,
  });

  const systemPrompt = composeStageInterviewSystemPrompt({
    plan,
    stage,
    learningMode,
    style,
    sourceBundle,
  });

  return runInterviewExchange({
    session,
    userMessage: message,
    systemPrompt,
    legacyChatId,
    clientElapsedSeconds: body.elapsed_seconds ?? null,
  });
}

/** Plan-scoped interview. */
export async function handlePlanInterviewPost(params: {
  plan: LearningPlan;
  stagesSummary: string;
  body: InterviewPostBody;
  learningMode: LearningMode;
  legacyChatId: string;
}): Promise<InterviewPostResult> {
  const { plan, stagesSummary, body, learningMode, legacyChatId } = params;
  const message = body.message?.trim();
  if (!message) throw new Error("消息不能为空");

  const style = body.style || "standard";
  const countdown = resolveInterviewCountdown(plan, body);

  const session = getOrCreateInterviewSession({
    session_key: legacyChatId,
    scope_type: "plan",
    plan_id: plan.id,
    style,
    countdown_enabled: countdown.enabled,
    countdown_seconds: countdown.seconds,
    fail_on_timeout: countdown.failOnTimeout,
  });

  const systemPrompt = composePlanInterviewSystemPrompt({
    plan,
    stagesSummary,
    learningMode,
    style,
  });

  return runInterviewExchange({
    session,
    userMessage: message,
    systemPrompt,
    legacyChatId,
    clientElapsedSeconds: body.elapsed_seconds ?? null,
  });
}

/** GET history: prefer interview_turn, fallback to teaching_chat. */
export function getInterviewHistory(sessionKey: string) {
  const session = getInterviewSessionByKey(sessionKey);
  if (session) {
    const turns = getInterviewTurns(session.id);
    if (turns.length > 0) {
      return turns.map((t) => ({
        id: t.id,
        stage_id: sessionKey,
        role: t.role,
        content: t.content,
        created_at: t.created_at,
        is_late: t.is_late,
        elapsed_seconds: t.elapsed_seconds,
        answer_deadline_at: t.answer_deadline_at,
        answered_at: t.answered_at,
      }));
    }
  }
  return getChatHistory(sessionKey);
}

export function getStageInterviewChatId(stageId: string, style: string) {
  return `stage_interview_${stageId}_${style}`;
}

export function getPlanInterviewChatId(planId: string, style: string) {
  return `interview_${planId}_${style}`;
}

export function getMultiInterviewSessionKey(planIds: string[], style: string) {
  const sorted = [...planIds].sort().join("_");
  return `multi_interview_${sorted}_${style}`;
}

export { getOrCreateInterviewSession, getInterviewSessionByKey, getInterviewTurns };
