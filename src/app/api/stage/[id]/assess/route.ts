import { NextResponse } from "next/server";
import {
  getStage,
  createAssessment,
  updateStage,
  createMasteryProfile,
  getPlan,
  getAssessmentsByStage,
  getChatHistory,
  type Stage,
} from "@/db/queries";
import { assessLearning, analyzeMastery, regenerateAssessmentQuestions } from "@/lib/ai";
import type { AssessmentQuestionInput } from "@/lib/ai";
import { markAssessmentCheckpoint } from "@/lib/teach-chat-handler";
import { completeStageAndUnlockNext } from "@/lib/stage-complete";
import { crossValidateAssessment } from "@/lib/cross-validate";
import { isOverTimeLimit, resolvePlanTimeLimit } from "@/lib/challenge";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stage = getStage(id);
  if (!stage) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  if (stage.status !== "active" && stage.status !== "completed") {
    return NextResponse.json({ error: "该阶段尚未解锁" }, { status: 400 });
  }

  let body: {
    skip?: boolean;
    input_text?: string;
    answers?: { question: string; answer: string }[];
    structured_answers?: AssessmentQuestionInput[];
    timed_out?: boolean;
    elapsed_seconds?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  if (body.skip === true) {
    if (stage.status !== "active") {
      return NextResponse.json({ error: "当前阶段已完成，无需跳过检测" }, { status: 400 });
    }

    try {
      const assessmentId = createAssessment({
        stage_id: id,
        type: "skipped",
        input_text: "[skipped]",
        score_overall: 0,
        score_coverage: 0,
        score_depth: 0,
        score_accuracy: 0,
        passed: true,
        feedback: "你选择跳过本阶段检测，直接进入下一阶段学习。",
        missing_topics: [],
        suggestions: [],
        per_question_results: [],
      });

      const complete = await completeStageAndUnlockNext(stage);
      markAssessmentCheckpoint(id, true, true);

      return NextResponse.json({
        assessmentId,
        skipped: true,
        passed: true,
        hasNext: complete.hasNext,
        post_review_available: complete.postReviewAvailable,
        post_review_id: complete.postReviewId,
        score_overall: 0,
        score_coverage: 0,
        score_depth: 0,
        score_accuracy: 0,
        feedback: complete.postReviewAvailable
          ? "你选择跳过本阶段检测。可选做本阶段复习巩固，下一阶段已可继续。"
          : "你选择跳过本阶段检测，直接进入下一阶段学习。",
        missing_topics: [],
        suggestions: [],
        per_question_results: [],
      });
    } catch (e) {
      console.error("Skip assessment failed:", e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const { input_text, answers, structured_answers } = body;

  const hasStructured = (structured_answers?.length ?? 0) > 0;
  const hasAnswers = (answers?.length ?? 0) > 0;

  let combinedText: string;
  if (hasStructured) {
    combinedText = (structured_answers as AssessmentQuestionInput[])
      .map((q: AssessmentQuestionInput, i: number) => `问题${i + 1} [${q.type}]: ${q.question}\n回答: ${q.user_answer}`)
      .join("\n\n");
  } else if (hasAnswers) {
    combinedText = answers!.map((a: { question: string; answer: string }, i: number) => `问题${i + 1}: ${a.question}\n回答: ${a.answer}`).join("\n\n");
  } else {
    combinedText = input_text || "";
  }

  const plan = getPlan(stage.plan_id);
  const timeLimit = plan ? resolvePlanTimeLimit(plan) : { enabled: false, seconds: 120 };
  const timedOut = isOverTimeLimit({
    enabled: timeLimit.enabled,
    limitSeconds: timeLimit.seconds,
    elapsedSeconds: body.elapsed_seconds,
    timedOut: body.timed_out === true,
  });

  if (timedOut) {
    const assessmentId = createAssessment({
      stage_id: id,
      type: hasStructured ? "structured" : hasAnswers ? "qa" : "text",
      input_text: combinedText || "[timed_out]",
      score_overall: 0,
      score_coverage: 0,
      score_depth: 0,
      score_accuracy: 0,
      passed: false,
      feedback: `答题超时（限时 ${timeLimit.seconds} 秒），本次检测失败。请在时限内完成作答后重试。`,
      missing_topics: stage.key_topics,
      suggestions: [],
      per_question_results: [],
      timed_out: true,
      elapsed_seconds: body.elapsed_seconds ?? timeLimit.seconds,
    });
    return NextResponse.json({
      assessmentId,
      passed: false,
      timed_out: true,
      score_overall: 0,
      score_coverage: 0,
      score_depth: 0,
      score_accuracy: 0,
      feedback: `答题超时（限时 ${timeLimit.seconds} 秒），本次检测失败。`,
      missing_topics: stage.key_topics,
      suggestions: [],
      per_question_results: [],
    });
  }

  if (!combinedText || combinedText.trim().length < 20) {
    return NextResponse.json(
      { error: "请完整回答所有问题" },
      { status: 400 }
    );
  }

  try {
    const assessParams = {
      stage_title: stage.title,
      key_topics: stage.key_topics,
      learning_objectives: stage.learning_objectives || [],
      user_input: combinedText,
      questions: stage.assessment_questions || [],
      structured_questions: hasStructured ? structured_answers : undefined,
      answers: hasAnswers ? answers : undefined,
    };

    const primary = await assessLearning(assessParams);
    const cross = await crossValidateAssessment(primary, assessParams);
    const result = cross.final;

    const enrichedPerQuestion = (result.per_question_results || []).map((pqr, i) => {
      const sq = hasStructured ? (structured_answers as AssessmentQuestionInput[])[i] : undefined;
      return {
        ...pqr,
        user_answer: sq?.user_answer || "",
        correct_answer: sq?.correct_answer || "",
        question_type: sq?.type || "",
      };
    });

    const assessmentId = createAssessment({
      stage_id: id,
      type: hasStructured ? "structured" : hasAnswers ? "qa" : "text",
      input_text: combinedText,
      score_overall: result.score_overall,
      score_coverage: result.score_coverage,
      score_depth: result.score_depth,
      score_accuracy: result.score_accuracy,
      passed: result.passed,
      feedback: result.feedback,
      missing_topics: result.missing_topics,
      suggestions: result.suggestions,
      per_question_results: enrichedPerQuestion,
      validator_score_overall: cross.validator?.score_overall ?? null,
      validator_passed: cross.validator?.passed ?? null,
      validator_feedback: cross.validator?.feedback || cross.validator_error || "",
      cross_check_agreed: cross.validator ? cross.agreed : null,
      elapsed_seconds: body.elapsed_seconds ?? null,
    });

    try {
      const previousAssessments = getAssessmentsByStage(id);
      const masteryResult = await analyzeMastery({
        stage_title: stage.title,
        key_topics: stage.key_topics,
        score_overall: result.score_overall,
        score_coverage: result.score_coverage,
        score_depth: result.score_depth,
        missing_topics: result.missing_topics,
        attempt_number: previousAssessments.length,
        previous_levels: [],
      });

      createMasteryProfile({
        stage_id: id,
        plan_id: stage.plan_id,
        overall_level: masteryResult.overall_level,
        weak_topics: masteryResult.weak_topics,
        assessment_id: assessmentId,
      });
    } catch (e) {
      console.error("Mastery analysis failed (non-fatal):", e);
    }

    let complete: Awaited<ReturnType<typeof completeStageAndUnlockNext>> | null = null;
    if (result.passed) {
      markAssessmentCheckpoint(id, true, false);
      complete = await completeStageAndUnlockNext(stage);
    }

    return NextResponse.json({
      assessmentId,
      ...result,
      per_question_results: enrichedPerQuestion,
      cross_check_agreed: cross.validator ? cross.agreed : null,
      validator_score_overall: cross.validator?.score_overall ?? null,
      validator_passed: cross.validator?.passed ?? null,
      post_review_available: complete?.postReviewAvailable ?? false,
      post_review_id: complete?.postReviewId ?? null,
      hasNext: complete?.hasNext ?? false,
    });
  } catch (e) {
    console.error("Assessment failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stage = getStage(id);
  if (!stage) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  try {
    const chatHistory = getChatHistory(id);
    const chatMessages = chatHistory.map((m) => ({ role: m.role, content: m.content }));

    const questions = await regenerateAssessmentQuestions({
      stage_title: stage.title,
      key_topics: stage.key_topics,
      learning_objectives: stage.learning_objectives || [],
      stage_description: stage.description || "",
      summary_text: stage.summary_text || "",
      chat_history: chatMessages.length > 0 ? chatMessages : undefined,
    });

    updateStage(id, { assessment_questions: questions } as unknown as Stage);

    return NextResponse.json({ assessment_questions: questions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
