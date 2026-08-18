import { assessLearning, type AssessmentQuestionInput, type AssessmentResult } from "@/lib/ai";
import { getValidatorConnection, getValidatorModel } from "@/lib/llm";

export interface CrossValidateResult {
  validator: AssessmentResult | null;
  agreed: boolean;
  final: AssessmentResult;
  validator_error?: string;
}

export async function crossValidateAssessment(
  primary: AssessmentResult,
  assessParams: {
    stage_title: string;
    key_topics: string[];
    learning_objectives: string[];
    user_input: string;
    questions?: string[];
    structured_questions?: AssessmentQuestionInput[];
    answers?: { question: string; answer: string }[];
  }
): Promise<CrossValidateResult> {
  const connection = getValidatorConnection();
  const validatorModel = getValidatorModel();
  if (!connection || !validatorModel) {
    return { validator: null, agreed: true, final: primary };
  }

  try {
    const validator = await assessLearning({
      ...assessParams,
      model: validatorModel,
      structuredFallbackProvider: connection.llm_provider,
    });
    const agreed = validator.passed === primary.passed;
    const passed = primary.passed && validator.passed;
    const final: AssessmentResult = {
      ...primary,
      score_overall: Math.min(primary.score_overall, validator.score_overall),
      score_coverage: Math.min(primary.score_coverage, validator.score_coverage),
      score_depth: Math.min(primary.score_depth, validator.score_depth),
      score_accuracy: Math.min(primary.score_accuracy, validator.score_accuracy),
      passed,
      feedback: agreed
        ? `${primary.feedback}\n\n【交叉验证】验证模型同意主模型结论（验证分 ${Math.round(validator.score_overall)}）。`
        : `${primary.feedback}\n\n【交叉验证】验证模型与主模型结论不一致。验证分 ${Math.round(validator.score_overall)}，${validator.passed ? "判定通过" : "判定未通过"}。已按更严格结果计分。\n验证模型反馈：${validator.feedback}`,
    };
    return { validator, agreed, final };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[cross-validate] validator assessment failed:", err);
    return {
      validator: null,
      agreed: true,
      final: primary,
      validator_error: err.message,
    };
  }
}
