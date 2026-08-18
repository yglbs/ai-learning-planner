import { NextResponse } from "next/server";
import { generatePlan, extractConcepts, generateStageProject } from "@/lib/ai";
import { parseLearningMode, parseCareerIdentity } from "@/lib/learning-types";
import { parseChallengeSettings } from "@/lib/challenge";
import { createPlan, createStage, createResource, updatePlan, getConfig, createConcept, createRelation, createStageProject } from "@/db/queries";
import { searchTavily } from "@/lib/datasource";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      goal, duration_weeks, daily_hours, skill_level, constraints,
      motivation, background, expected_outcome,
      learning_mode, career_identity,
      post_stage_review_enabled, answer_time_limit_enabled, answer_time_limit_seconds,
    } = body;

    const resolvedMode = parseLearningMode(learning_mode, "business");
    const resolvedCareer = parseCareerIdentity(career_identity);

    const generated = await generatePlan({
      goal,
      duration_weeks,
      daily_hours,
      skill_level,
      constraints,
      motivation,
      background,
      expected_outcome,
      learning_mode: resolvedMode,
      career_identity: resolvedCareer,
    });

    const planId = createPlan({
      title: generated.plan_title,
      goal_description: goal,
      duration_weeks,
      daily_hours,
      skill_level,
      user_motivation: motivation || "",
      user_background: background || "",
      expected_outcome: expected_outcome || "",
      learning_mode: resolvedMode,
      career_identity: resolvedCareer,
    });

    updatePlan(planId, {
      total_stages: generated.stages.length,
      started_at: new Date().toISOString(),
      ...parseChallengeSettings({
        post_stage_review_enabled,
        answer_time_limit_enabled,
        answer_time_limit_seconds,
      }),
    } as unknown as import("@/db/queries").LearningPlan);

    const config = getConfig();
    const useTavily = !!config.tavily_api_key;

    for (let i = 0; i < generated.stages.length; i++) {
      const stage = generated.stages[i];
      const stageId = createStage({
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

      if (i === 0) {
        try {
          if (useTavily) {
            await generateFirstStageResourcesWithSearch(stageId, stage, goal);
          } else {
            const { generateResources } = await import("@/lib/ai");
            const resources = await generateResources({
              stage_title: stage.title,
              key_topics: stage.key_topics,
              goal,
              skill_level,
            });

            for (let j = 0; j < resources.length; j++) {
              createResource({
                stage_id: stageId,
                title: resources[j].title,
                url: resources[j].url,
                source: resources[j].source,
                type: resources[j].type,
                reason: resources[j].reason,
                estimated_minutes: resources[j].estimated_minutes,
                region_tag: resources[j].region_tag,
                sort_order: j,
                search_source: "llm",
                verified: false,
              });
            }
          }
        } catch (e) {
          console.error("Failed to generate resources for first stage:", e);
        }
      }
    }

    // Background: generate concepts + projects (non-blocking errors)
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

    // Generate project for first stage
    try {
      const firstStage = generated.stages[0];
      if (firstStage) {
        const project = await generateStageProject({
          stage_title: firstStage.title,
          key_topics: firstStage.key_topics,
          core_output: firstStage.core_output || "",
          real_world_cases: firstStage.real_world_cases || [],
          goal,
          skill_level,
        });

        const stageRows = (await import("@/db/queries")).getStagesByPlan(planId);
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
    console.error("Plan generation failed:", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

async function generateFirstStageResourcesWithSearch(
  stageId: string,
  stage: { title: string; key_topics: string[] },
  goal: string
) {
  const queries = [
    `${stage.title} 教程 入门 实操`,
    `${stage.key_topics.slice(0, 3).join(" ")} tutorial beginner`,
    `${goal} ${stage.title} best practices`,
  ];

  const allResults: { title: string; url: string; content: string; score: number }[] = [];

  for (const query of queries) {
    try {
      const results = await searchTavily(query, { maxResults: 4 });
      allResults.push(...results);
    } catch {
      // skip
    }
  }

  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const sorted = unique.sort((a, b) => b.score - a.score).slice(0, 8);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    let hostname = "";
    try { hostname = new URL(r.url).hostname; } catch { /* ignore */ }

    createResource({
      stage_id: stageId,
      title: r.title,
      url: r.url,
      source: hostname,
      type: "article",
      reason: r.content.slice(0, 100),
      estimated_minutes: 30,
      region_tag: hostname.endsWith(".cn") || hostname.endsWith(".com.cn") ? "domestic" : "overseas",
      sort_order: i,
      search_source: "tavily",
      verified: true,
    });
  }
}
