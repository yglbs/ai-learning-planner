import { NextResponse } from "next/server";
import {
  deleteInterviewSessionByKey,
  getInterviewSessionByKey,
  getOrCreateInterviewSession,
} from "@/db/queries";
import {
  getMultiInterviewSessionKey,
  getInterviewHistory,
  resolveInterviewCountdown,
  runInterviewExchange,
} from "@/lib/interview-handler";
import { serverNowIso } from "@/lib/interview-countdown";
import { composeMultiPlanInterviewSystemPrompt } from "@/lib/prompt-composer";
import { buildMultiPlanContexts } from "@/lib/multi-plan-context";
import { getPlan } from "@/db/queries";
import { parseLearningMode, type LearningMode } from "@/lib/learning-types";
import { z } from "zod";

const MULTI_PLAN_MIN = 2;
const MULTI_PLAN_MAX = 5;

const createSchema = z.object({
  plan_ids: z.array(z.string().uuid()).min(MULTI_PLAN_MIN).max(MULTI_PLAN_MAX),
  style: z.string().max(32).default("standard"),
  countdown_enabled: z.boolean().optional(),
  countdown_seconds: z.number().int().min(10).max(3600).optional(),
  fail_on_timeout: z.boolean().optional(),
  message: z.string().max(5000).optional(),
});

const continueSchema = z.object({
  session_key: z.string().min(1).max(512),
  message: z.string().min(1).max(5000),
  style: z.string().max(32).optional(),
  countdown_enabled: z.boolean().optional(),
  countdown_seconds: z.number().int().min(10).max(3600).optional(),
  fail_on_timeout: z.boolean().optional(),
  elapsed_seconds: z.number().optional(),
});

function planBlocksFromContext(
  blocks: ReturnType<typeof buildMultiPlanContexts>["blocks"]
) {
  return blocks.map((b) => ({
    title: b.title,
    goal: b.goal,
    stagesSummary: b.stagesSummary,
    isCodePlan: b.isCodePlan,
    verifiedSourcePaths: b.verifiedSourcePaths,
    codeContext: b.codeContext,
  }));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionKey = url.searchParams.get("session_key");
    const planIdsParam = url.searchParams.get("plan_ids");
    const style = url.searchParams.get("style") || "standard";

    if (sessionKey) {
      const history = getInterviewHistory(sessionKey);
      const session = getInterviewSessionByKey(sessionKey);
      return NextResponse.json({
        session_key: sessionKey,
        history,
        countdown_enabled: session?.countdown_enabled ?? false,
        countdown_seconds: session?.countdown_seconds ?? 120,
        server_now: serverNowIso(),
      });
    }

    if (planIdsParam) {
      const planIds = planIdsParam.split(",").filter(Boolean);
      if (planIds.length < MULTI_PLAN_MIN || planIds.length > MULTI_PLAN_MAX) {
        return NextResponse.json({ error: `请选择 ${MULTI_PLAN_MIN}-${MULTI_PLAN_MAX} 个计划` }, { status: 400 });
      }
      const key = getMultiInterviewSessionKey(planIds, style);
      return NextResponse.json({
        session_key: key,
        history: getInterviewHistory(key),
        server_now: serverNowIso(),
      });
    }

    return NextResponse.json({ error: "请提供 session_key 或 plan_ids" }, { status: 400 });
  } catch (e) {
    console.error("[interview/multi] GET failed:", e);
    return NextResponse.json({ error: "获取多计划面试失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const continueParsed = continueSchema.safeParse(body);
    if (continueParsed.success && continueParsed.data.session_key.startsWith("multi_interview_")) {
      return handleMultiContinue(continueParsed.data);
    }

    const createParsed = createSchema.safeParse(body);
    if (!createParsed.success) {
      return NextResponse.json({ error: "请求无效" }, { status: 400 });
    }

    const { plan_ids, style, countdown_enabled, countdown_seconds, fail_on_timeout, message } = createParsed.data;
    const { blocks, missingPlanIds } = buildMultiPlanContexts(plan_ids);

    if (missingPlanIds.length > 0) {
      return NextResponse.json({ error: "部分计划不存在" }, { status: 404 });
    }

    const sessionKey = getMultiInterviewSessionKey(plan_ids, style);
    // Multi-plan interview has no single plan switch — honor the page toggle.
    const countdown = resolveInterviewCountdown(null, { countdown_enabled, countdown_seconds, fail_on_timeout });

    const session = getOrCreateInterviewSession({
      session_key: sessionKey,
      scope_type: "multi",
      plan_ids,
      style,
      countdown_enabled: countdown.enabled,
      countdown_seconds: countdown.seconds,
      fail_on_timeout: countdown.failOnTimeout,
    });

    const planPromptBlocks = planBlocksFromContext(blocks);
    const learningModes: LearningMode[] = plan_ids.map((pid) =>
      parseLearningMode(getPlan(pid)?.learning_mode, "business")
    );
    const systemPrompt = composeMultiPlanInterviewSystemPrompt({
      plans: planPromptBlocks,
      style,
      learningModes,
    });

    const userMessage = message?.trim() || "开始跨计划综合面试";

    const result = await runInterviewExchange({
      session,
      userMessage,
      systemPrompt,
      syncLegacyChat: false,
      clientElapsedSeconds: null,
    });

    return NextResponse.json({
      session_key: sessionKey,
      plan_ids,
      ...result,
    });
  } catch (e) {
    console.error("[interview/multi] POST failed:", e);
    return NextResponse.json({ error: (e as Error).message || "多计划面试失败" }, { status: 500 });
  }
}

async function handleMultiContinue(data: z.infer<typeof continueSchema>) {
  const existing = getInterviewSessionByKey(data.session_key);
  if (!existing) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const planIds = existing.plan_ids;
  if (planIds.length < MULTI_PLAN_MIN) {
    return NextResponse.json({ error: "无效的多计划会话" }, { status: 400 });
  }

  const { blocks, missingPlanIds } = buildMultiPlanContexts(planIds);
  if (missingPlanIds.length > 0) {
    return NextResponse.json({ error: "会话关联的计划已失效" }, { status: 404 });
  }

  const style = data.style || existing.style;
  const countdown = resolveInterviewCountdown(null, {
    countdown_enabled: data.countdown_enabled,
    countdown_seconds: data.countdown_seconds,
    fail_on_timeout: data.fail_on_timeout,
  });
  const session = getOrCreateInterviewSession({
    session_key: data.session_key,
    scope_type: "multi",
    plan_ids: planIds,
    style,
    countdown_enabled: countdown.enabled,
    countdown_seconds: countdown.seconds,
    fail_on_timeout: countdown.failOnTimeout,
  });

  const planPromptBlocks = planBlocksFromContext(blocks);

  const learningModes: LearningMode[] = planIds.map((pid) =>
    parseLearningMode(getPlan(pid)?.learning_mode, "business")
  );
  const systemPrompt = composeMultiPlanInterviewSystemPrompt({
    plans: planPromptBlocks,
    style,
    learningModes,
  });

  const result = await runInterviewExchange({
    session,
    userMessage: data.message,
    systemPrompt,
    syncLegacyChat: false,
    clientElapsedSeconds: data.elapsed_seconds ?? null,
  });

  return NextResponse.json({
    session_key: data.session_key,
    ...result,
  });
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionKey = url.searchParams.get("session_key");
    if (!sessionKey) {
      return NextResponse.json({ error: "请提供 session_key" }, { status: 400 });
    }
    deleteInterviewSessionByKey(sessionKey);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[interview/multi] DELETE failed:", e);
    return NextResponse.json({ error: "删除会话失败" }, { status: 500 });
  }
}
