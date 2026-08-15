import { NextResponse } from "next/server";
import { getStage, createAssessment, updateStage, unlockNextStage, checkPlanCompletion, createMasteryProfile, createReviewSchedulesForStage, getPlan, getAssessmentsByStage, getChatHistory } from "@/db/queries";
import { assessLearning, analyzeMastery, generateStageProject, regenerateAssessmentQuestions } from "@/lib/ai";
import type { AssessmentQuestionInput } from "@/lib/ai";
import type { Stage } from "@/db/queries";
import { markAssessmentCheckpoint } from "@/lib/teach-chat-handler";

async function completeStageAndUnlockNext(stage: Stage) {
  updateStage(stage.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
  } as unknown as Stage);

  try {
    const plan = getPlan(stage.plan_id);
    if (plan && plan.review_enabled !== false) {
      const preset = (plan as unknown as Record<string, unknown>).review_interval_preset as string || "standard";
      createReviewSchedulesForStage(stage.id, stage.plan_id, preset);
    }
  } catch (e) {
    console.error("Review schedule creation failed (non-fatal):", e);
  }

  const hasNext = unlockNextStage(stage.plan_id, stage.order_index);
  if (hasNext) {
    try {
      const { getStagesByPlan, getProjectByStage, createStageProject } = await import("@/db/queries");
      const stages = getStagesByPlan(stage.plan_id);
      const nextStage = stages.find(s => s.order_index === stage.order_index + 1);
      if (nextStage && !getProjectByStage(nextStage.id)) {
        const plan = getPlan(stage.plan_id);
        const project = await generateStageProject({
          stage_title: nextStage.title,
          key_topics: nextStage.key_topics,
          core_output: nextStage.core_output || "",
          real_world_cases: nextStage.real_world_cases || [],
          goal: plan?.goal_description || "",
          skill_level: plan?.skill_level || "beginner",
        });
        createStageProject({
          stage_id: nextStage.id,
          title: project.title,
          description: project.description,
          expected_output: project.expected_output,
          checklist: project.checklist,
          difficulty: project.difficulty,
          estimated_minutes: project.estimated_minutes,
        });
      }
    } catch (e) {
      console.error("Next stage project generation failed (non-fatal):", e);
    }
  } else {
    checkPlanCompletion(stage.plan_id);
  }

  return hasNext;
}

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

  const body = await request.json();

  // Skip assessment: mark stage complete and unlock next without grading
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

      const hasNext = await completeStageAndUnlockNext(stage);
      markAssessmentCheckpoint(id, true, true);

      return NextResponse.json({
        assessmentId,
        skipped: true,
        passed: true,
        hasNext,
        score_overall: 0,
        score_coverage: 0,
        score_depth: 0,
        score_accuracy: 0,
        feedback: "你选择跳过本阶段检测，直接进入下一阶段学习。",
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

  const hasStructured = structured_answers?.length > 0;
  const hasAnswers = answers?.length > 0;

  let combinedText: string;
  if (hasStructured) {
    combinedText = (structured_answers as AssessmentQuestionInput[])
      .map((q: AssessmentQuestionInput, i: number) => `问题${i + 1} [${q.type}]: ${q.question}\n回答: ${q.user_answer}`)
      .join("\n\n");
  } else if (hasAnswers) {
    combinedText = answers.map((a: { question: string; answer: string }, i: number) => `问题${i + 1}: ${a.question}\n回答: ${a.answer}`).join("\n\n");
  } else {
    combinedText = input_text || "";
  }

  if (!combinedText || combinedText.trim().length < 20) {
    return NextResponse.json(
      { error: "请完整回答所有问题" },
      { status: 400 }
    );
  }

  try {
    const result = await assessLearning({
      stage_title: stage.title,
      key_topics: stage.key_topics,
      learning_objectives: stage.learning_objectives || [],
      user_input: combinedText,
      questions: stage.assessment_questions || [],
      structured_questions: hasStructured ? structured_answers : undefined,
      answers: hasAnswers ? answers : undefined,
    });

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
    });

    // Create mastery profile (non-blocking)
    try {
      const previousAssessments = getAssessmentsByStage(id);
      const previousLevels: string[] = [];
      const masteryResult = await analyzeMastery({
        stage_title: stage.title,
        key_topics: stage.key_topics,
        score_overall: result.score_overall,
        score_coverage: result.score_coverage,
        score_depth: result.score_depth,
        missing_topics: result.missing_topics,
        attempt_number: previousAssessments.length,
        previous_levels: previousLevels,
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

    if (result.passed) {
      markAssessmentCheckpoint(id, true, false);
      await completeStageAndUnlockNext(stage);
    }

    return NextResponse.json({
      assessmentId,
      ...result,
      per_question_results: enrichedPerQuestion,
    });
  } catch (e) {
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
    const chatMessages = chatHistory.map(m => ({ role: m.role, content: m.content }));

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
