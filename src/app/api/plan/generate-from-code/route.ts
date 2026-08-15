import { NextResponse } from "next/server";
import { generatePlanFromCode, extractConcepts, generateStageProject } from "@/lib/ai";
import { parseLearningMode, parseCareerIdentity } from "@/lib/learning-types";
import {
  createPlan, createStage, updatePlan,
  createConcept, createRelation, createStageProject, getStagesByPlan,
} from "@/db/queries";
import fs from "fs";
import path from "path";
import {
  buildFileTree,
  countProjectFiles,
  resolveProjectPath,
  walkDir,
} from "@/lib/code-project";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      project_path,
      duration_weeks = 4,
      daily_hours = 2,
      skill_level = "beginner",
      motivation = "",
      background = "",
      expected_outcome = "",
      learning_mode,
      career_identity,
    } = body;

    const resolvedMode = parseLearningMode(learning_mode, "business_through_tech");
    const resolvedCareer = parseCareerIdentity(career_identity);

    if (!project_path?.trim()) {
      return NextResponse.json({ error: "请输入项目路径" }, { status: 400 });
    }

    const resolvedPath = resolveProjectPath(project_path.trim());

    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: "项目路径不存在" }, { status: 400 });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "请提供一个目录路径" }, { status: 400 });
    }

    const projectName = path.basename(resolvedPath);
    const fileTree = buildFileTree(resolvedPath, resolvedPath);
    const counts = countProjectFiles(resolvedPath);

    if (!fileTree.trim() || counts.files === 0) {
      return NextResponse.json({ error: "项目中未找到可识别的源代码文件" }, { status: 400 });
    }

    if (body.validate_only) {
      return NextResponse.json({
        valid: true,
        project_name: projectName,
        file_count: counts.files,
        dir_count: counts.dirs,
        preview_tree: fileTree.split("\n").slice(0, 40).join("\n"),
      });
    }

    const files: { relativePath: string; content: string; size: number }[] = [];
    const totalChars = { count: 0 };
    walkDir(resolvedPath, resolvedPath, files, totalChars);

    if (files.length === 0) {
      return NextResponse.json({ error: "项目中未找到可读取的源代码文件" }, { status: 400 });
    }

    const codeContent = files.map((f) =>
      `=== ${f.relativePath} ===\n${f.content}`
    ).join("\n\n");

    const generated = await generatePlanFromCode({
      code_content: codeContent,
      project_name: projectName,
      file_tree: fileTree,
      duration_weeks,
      daily_hours,
      skill_level,
      motivation,
      background,
      expected_outcome,
      learning_mode: resolvedMode,
      career_identity: resolvedCareer,
    });

    const goalDesc = `深入学习项目「${projectName}」的代码实现（源码路径: ${resolvedPath}）`;

    const planId = createPlan({
      title: generated.plan_title,
      goal_description: goalDesc,
      duration_weeks,
      daily_hours,
      skill_level,
      user_motivation: motivation,
      user_background: background,
      expected_outcome,
      source_type: "code",
      source_path: resolvedPath,
      source_file_tree: fileTree,
      source_files: files.map((f) => f.relativePath),
      learning_mode: resolvedMode,
      career_identity: resolvedCareer,
    });

    updatePlan(planId, {
      total_stages: generated.stages.length,
      started_at: new Date().toISOString(),
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
          goal: goalDesc,
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

    return NextResponse.json({
      planId,
      plan: generated,
      stats: { files_read: files.length, total_chars: totalChars.count },
    });
  } catch (e) {
    console.error("Code plan generation failed:", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
