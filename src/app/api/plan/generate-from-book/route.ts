import { NextResponse } from "next/server";
import { generatePlanFromBook, extractConcepts, generateStageProject } from "@/lib/ai";
import { parseLearningMode, parseCareerIdentity } from "@/lib/learning-types";
import { parseChallengeSettings } from "@/lib/challenge";
import { createPlan, createStage, updatePlan, getConfig, createConcept, createRelation, createStageProject, getStagesByPlan } from "@/db/queries";
import { PDFParse } from "pdf-parse";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const duration_weeks = parseInt(formData.get("duration_weeks") as string) || 6;
    const daily_hours = parseFloat(formData.get("daily_hours") as string) || 2;
    const skill_level = (formData.get("skill_level") as string) || "beginner";
    const motivation = formData.get("motivation") as string || "";
    const background = formData.get("background") as string || "";
    const expected_outcome = formData.get("expected_outcome") as string || "";
    const learning_mode = formData.get("learning_mode") as string | null;
    const career_identity = formData.get("career_identity") as string | null;
    const challenge = parseChallengeSettings({
      post_stage_review_enabled: formData.get("post_stage_review_enabled"),
      answer_time_limit_enabled: formData.get("answer_time_limit_enabled"),
      answer_time_limit_seconds: formData.get("answer_time_limit_seconds"),
    });

    const resolvedMode = parseLearningMode(learning_mode, "business");
    const resolvedCareer = parseCareerIdentity(career_identity);

    if (!file) {
      return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    }

    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/epub+zip",
    ];
    if (!allowedTypes.includes(file.type) && !file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      return NextResponse.json(
        { error: "仅支持 PDF、TXT、Markdown 格式的文件" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    let bookContent: string;

    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
      const textResult = await parser.getText();
      bookContent = textResult.text;
      await parser.destroy();
    } else {
      bookContent = Buffer.from(arrayBuffer).toString("utf-8");
    }

    if (!bookContent.trim()) {
      return NextResponse.json({ error: "文件内容为空，无法解析" }, { status: 400 });
    }

    const bookTitle = file.name.replace(/\.(pdf|txt|md|epub)$/i, "");

    const generated = await generatePlanFromBook({
      book_content: bookContent,
      book_title: bookTitle,
      duration_weeks,
      daily_hours,
      skill_level,
      motivation,
      background,
      expected_outcome,
      learning_mode: resolvedMode,
      career_identity: resolvedCareer,
    });

    const planId = createPlan({
      title: generated.plan_title,
      goal_description: `阅读学习《${bookTitle}》`,
      duration_weeks,
      daily_hours,
      skill_level,
      user_motivation: motivation,
      user_background: background,
      expected_outcome,
      learning_mode: resolvedMode,
      career_identity: resolvedCareer,
    });

    updatePlan(planId, {
      total_stages: generated.stages.length,
      started_at: new Date().toISOString(),
      ...challenge,
    } as unknown as import("@/db/queries").LearningPlan);

    for (let i = 0; i < generated.stages.length; i++) {
      const stage = generated.stages[i];
      createStage({
        plan_id: planId,
        order_index: i,
        title: stage.title,
        description: stage.description,
        key_topics: stage.key_topics,
        estimated_days: stage.estimated_days,
        summary_text: stage.summary_text,
        core_output: stage.core_output || "",
        real_world_cases: stage.real_world_cases || [],
        assessment_questions: stage.assessment_questions || [],
        learning_objectives: stage.learning_objectives || [],
      });
    }

    try {
      const stageData = generated.stages.map((s, i) => ({
        title: s.title,
        key_topics: s.key_topics,
        learning_objectives: s.learning_objectives || [],
        order_index: i,
      }));

      const conceptResult = await extractConcepts({
        plan_title: generated.plan_title,
        stages: stageData,
      });

      const conceptIdMap = new Map<string, string>();
      for (const c of conceptResult.concepts) {
        const stageIds = generated.stages
          .filter((_, idx) => idx === c.stage_index)
          .map((_, idx) => stageData[idx]?.title || "");
        const cid = createConcept({
          plan_id: planId,
          name: c.name,
          definition: c.definition,
          mastery_status: "untouched",
          source_stage_ids: stageIds,
        });
        conceptIdMap.set(c.name, cid);
      }

      for (const r of conceptResult.relations) {
        const fromId = conceptIdMap.get(r.from);
        const toId = conceptIdMap.get(r.to);
        if (fromId && toId) {
          createRelation({
            plan_id: planId,
            from_concept_id: fromId,
            to_concept_id: toId,
            relation_type: r.type,
            source: "ai",
          });
        }
      }
    } catch (e) {
      console.error("Concept extraction failed (non-fatal):", e);
    }

    try {
      const firstStage = generated.stages[0];
      if (firstStage) {
        const project = await generateStageProject({
          stage_title: firstStage.title,
          key_topics: firstStage.key_topics,
          core_output: firstStage.core_output || "",
          real_world_cases: firstStage.real_world_cases || [],
          goal: `阅读学习《${bookTitle}》`,
          skill_level,
        });

        const stageRows = getStagesByPlan(planId);
        if (stageRows[0]) {
          createStageProject({
            stage_id: stageRows[0].id,
            title: project.title,
            description: project.description,
            expected_output: project.expected_output,
            checklist: project.checklist,
            difficulty: project.difficulty,
            estimated_minutes: project.estimated_minutes,
          });
        }
      }
    } catch (e) {
      console.error("Project generation failed (non-fatal):", e);
    }

    return NextResponse.json({ planId, plan: generated });
  } catch (e) {
    console.error("Book plan generation failed:", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
