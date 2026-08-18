"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { InterviewCountdownBar, DEFAULT_COUNTDOWN_SECONDS } from "@/components/interview-countdown";

interface StructuredQuestion {
  type: "choice" | "fill" | "true_false" | "short_answer";
  question: string;
  options?: string[];
  correct_answer?: string;
}

interface StageData {
  id: string;
  title: string;
  key_topics: string[];
  order_index: number;
  status: string;
  assessment_questions?: (string | StructuredQuestion)[];
}

interface PerQuestionResult {
  question_index: number;
  question_text: string;
  is_correct: boolean;
  score: number;
  feedback: string;
  user_answer?: string;
  correct_answer?: string;
  question_type?: string;
}

interface HistoricalAssessment {
  id: string;
  stage_id: string;
  type?: string;
  score_overall: number;
  score_coverage: number;
  score_depth: number;
  score_accuracy: number;
  passed: boolean;
  feedback: string;
  missing_topics: string[];
  suggestions: (string | Suggestion)[];
  per_question_results: PerQuestionResult[];
  attempt_number: number;
  created_at: string;
}

interface Suggestion {
  title: string;
  url: string;
  description: string;
}

interface AssessmentResult {
  score_overall: number;
  score_coverage: number;
  score_depth: number;
  score_accuracy: number;
  passed: boolean;
  feedback: string;
  missing_topics: string[];
  suggestions: (string | Suggestion)[];
  per_question_results?: PerQuestionResult[];
  timed_out?: boolean;
  post_review_available?: boolean;
  post_review_id?: string | null;
  cross_check_agreed?: boolean | null;
  validator_score_overall?: number | null;
  validator_passed?: boolean | null;
}

type ViewState = "questions" | "assessing" | "result" | "history";

function normalizeQuestion(q: string | StructuredQuestion): StructuredQuestion {
  if (typeof q === "string") {
    return { type: "short_answer", question: q };
  }
  return q;
}

function normalizeSuggestion(s: string | Suggestion): Suggestion {
  if (typeof s === "string") {
    const urlMatch = s.match(/https?:\/\/[^\s)]+/);
    return {
      title: s.replace(/https?:\/\/[^\s)]+/g, "").trim(),
      url: urlMatch?.[0] || "",
      description: s,
    };
  }
  return s;
}

export default function AssessPage() {
  const router = useRouter();
  const params = useParams();
  const planId = params.id as string;
  const stageId = params.sid as string;

  const [stage, setStage] = useState<StageData | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [viewState, setViewState] = useState<ViewState>("questions");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [historyList, setHistoryList] = useState<HistoricalAssessment[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<HistoricalAssessment | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [timeLimitEnabled, setTimeLimitEnabled] = useState(false);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(DEFAULT_COUNTDOWN_SECONDS);
  const [answerDeadlineAt, setAnswerDeadlineAt] = useState<string | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const submittingRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const [planRes, historyRes] = await Promise.all([
        fetch(`/api/plan?id=${planId}`),
        fetch(`/api/stage/${stageId}/assessments`),
      ]);
      const data = await planRes.json();
      if (historyRes.ok) {
        const histData = await historyRes.json();
        setHistoryList(Array.isArray(histData) ? histData : []);
      }
      if (data?.stages) {
        const found = data.stages.find((s: StageData) => s.id === stageId);
        setStage(found || null);
        if (data.plan?.answer_time_limit_enabled) {
          setTimeLimitEnabled(true);
          setTimeLimitSeconds(data.plan.answer_time_limit_seconds || DEFAULT_COUNTDOWN_SECONDS);
        }
        if (found && (found.status === "active" || found.status === "completed")) {
          setRegenerating(true);
          try {
            const regenRes = await fetch(`/api/stage/${stageId}/assess`, { method: "PATCH" });
            if (regenRes.ok) {
              const regenData = await regenRes.json();
              if (regenData.assessment_questions) {
                setStage({ ...found, assessment_questions: regenData.assessment_questions });
              }
            }
          } catch { /* use original questions as fallback */ }
          setRegenerating(false);
        }
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [planId, stageId]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/stage/${stageId}/assess`, { method: "PATCH" });
      if (!res.ok) throw new Error("重新出题失败");
      const data = await res.json();
      if (data.assessment_questions && stage) {
        setStage({ ...stage, assessment_questions: data.assessment_questions });
        setAnswers({});
        setCurrentQIndex(0);
        toast.success("已重新生成检测题");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (viewState !== "questions" || !timeLimitEnabled) {
      setAnswerDeadlineAt(null);
      return;
    }
    const start = Date.now();
    setStartedAtMs(start);
    setAnswerDeadlineAt(new Date(start + timeLimitSeconds * 1000).toISOString());
  }, [viewState, timeLimitEnabled, timeLimitSeconds]);

  const rawQuestions = stage?.assessment_questions?.length
    ? stage.assessment_questions
    : stage?.key_topics.map((t) => `请解释你对「${t}」的理解，以及它在实际项目中是如何被使用的？`) || [];

  const questions: StructuredQuestion[] = rawQuestions.map(normalizeQuestion);
  const currentQ = questions[currentQIndex];
  const answeredCount = Object.values(answers).filter((a) => a?.trim()).length;
  const allAnswered = answeredCount >= questions.length;

  async function handleSubmit(timedOut = false) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const structuredAnswers = questions.map((q, i) => ({
      type: q.type,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      user_answer: answers[i] || "",
    }));

    setViewState("assessing");

    try {
      const elapsedSeconds = startedAtMs ? Math.round((Date.now() - startedAtMs) / 1000) : undefined;
      const res = await fetch(`/api/stage/${stageId}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structured_answers: structuredAnswers,
          timed_out: timedOut,
          elapsed_seconds: elapsedSeconds,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "评估失败");
      }

      const data = await res.json();
      setResult(data);
      setViewState("result");
    } catch (e) {
      toast.error((e as Error).message);
      setViewState("questions");
      submittingRef.current = false;
    }
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      const res = await fetch(`/api/stage/${stageId}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "跳过失败");
      }

      const data = await res.json();
      toast.success(
        data.hasNext ? "已跳过检测，下一阶段已解锁" : "已跳过检测，全部阶段已完成"
      );
      router.push(`/plan/${planId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setSkipConfirm(false);
    } finally {
      setSkipping(false);
    }
  }

  if (loading || regenerating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-3 border-primary/20 border-t-primary animate-spin" />
          </div>
          <span className="text-sm text-muted-foreground animate-pulse">
            {regenerating ? "AI 正在出题..." : "加载中..."}
          </span>
        </div>
      </div>
    );
  }

  if (!stage) {
    router.push(`/plan/${planId}`);
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-sm text-muted-foreground animate-pulse">跳转中...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-gradient-radial from-primary/5 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      <header className="border-b border-border/40 px-6 py-4 bg-card/40 backdrop-blur-md relative z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/plan/${planId}/stage/${stageId}`)}
            className="text-muted-foreground hover:text-foreground"
          >
            ← 返回
          </Button>
          <h1 className="text-lg font-semibold">
            阶段 {stage.order_index + 1} 检测
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {historyList.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => {
                  setSelectedHistory(null);
                  setViewState(viewState === "history" ? "questions" : "history");
                }}
              >
                {viewState === "history" ? "← 返回答题" : `📋 历史记录 (${historyList.length})`}
              </Button>
            )}
            {viewState === "questions" && (
              <>
                {timeLimitEnabled && (
                  <InterviewCountdownBar
                    answerDeadlineAt={answerDeadlineAt}
                    serverNow={null}
                    enabled
                    totalSeconds={timeLimitSeconds}
                    onExpire={() => { void handleSubmit(true); }}
                  />
                )}
                <span className="text-xs text-muted-foreground">
                  {answeredCount}/{questions.length} 已答
                </span>
                <Progress value={(answeredCount / questions.length) * 100} className="w-20 h-1.5" />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 relative z-10">
        <div className="max-w-3xl mx-auto space-y-6">
          {viewState === "questions" && (
            <>
              <div className="glass-card rounded-xl p-5">
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-xl">💡</span>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">回答以下检测题</h3>
                    <p className="text-sm text-muted-foreground">
                      包含选择题、判断题、填空题和简答题，展示你的学习成果
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {stage.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        onClick={() => setSkipConfirm(true)}
                        disabled={skipping}
                      >
                        ⏭ 跳过检测
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={handleRegenerate}
                      disabled={regenerating}
                    >
                      {regenerating ? "⏳ 出题中..." : "🔄 重新出题"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {questions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentQIndex(i)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                        i === currentQIndex
                          ? "bg-primary text-primary-foreground"
                          : answers[i]?.trim()
                            ? "bg-green-500/10 text-green-400 border border-green-500/20"
                            : "bg-card/50 text-muted-foreground border border-border/30"
                      }`}
                      title={questionTypeLabel(q.type)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>

              {currentQ && (
                <div className="glass-card rounded-xl p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                      {currentQIndex + 1}
                    </div>
                    <div className="flex-1">
                      <Badge variant="outline" className="text-[10px] mb-2 font-normal">
                        {questionTypeLabel(currentQ.type)}
                      </Badge>
                      <div className="text-base font-medium leading-relaxed">
                        <MarkdownRenderer content={currentQ.question} />
                      </div>
                    </div>
                  </div>

                  <QuestionInput
                    question={currentQ}
                    value={answers[currentQIndex] || ""}
                    onChange={(val) => setAnswers({ ...answers, [currentQIndex]: val })}
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {currentQ.type === "short_answer"
                        ? `${(answers[currentQIndex] || "").length} 字`
                        : answers[currentQIndex]?.trim() ? "✓ 已答" : "未答"}
                    </span>
                    <div className="flex gap-2">
                      {currentQIndex > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCurrentQIndex(currentQIndex - 1)}
                        >
                          ← 上一题
                        </Button>
                      )}
                      {currentQIndex < questions.length - 1 ? (
                        <Button
                          size="sm"
                          onClick={() => setCurrentQIndex(currentQIndex + 1)}
                          disabled={!answers[currentQIndex]?.trim()}
                        >
                          下一题 →
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleSubmit(false)}
                          disabled={!allAnswered}
                          className="glow-primary"
                        >
                          提交全部答案
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {allAnswered && (
                <Button
                  className="w-full h-12 text-base font-medium rounded-xl glow-primary"
                  onClick={() => handleSubmit(false)}
                >
                  提交检测 ({answeredCount}/{questions.length} 题已答)
                </Button>
              )}
            </>
          )}

          {viewState === "assessing" && (
            <div className="flex flex-col items-center justify-center py-24 space-y-10">
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-3 border-primary/15 border-t-primary animate-spin" />
                <div className="absolute inset-3 rounded-full bg-gradient-to-br from-primary/10 to-transparent animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-3xl">🧪</span>
                </div>
              </div>
              <div className="text-center space-y-4">
                <h2 className="text-2xl font-bold gradient-text">AI 正在评估你的回答</h2>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  逐题分析你的理解深度和准确性
                </p>
                <div className="flex items-center justify-center gap-2 pt-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full bg-primary animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {viewState === "history" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">📋 检测历史</h2>
              {selectedHistory ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedHistory(null)}>← 返回列表</Button>
                    <span className="text-sm text-muted-foreground">
                      第 {selectedHistory.attempt_number} 次检测 · {new Date(selectedHistory.created_at).toLocaleString("zh-CN")}
                    </span>
                    <Badge className={selectedHistory.passed ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}>
                      {selectedHistory.passed ? "通过" : "未通过"} · {Math.round(selectedHistory.score_overall)} 分
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <ScoreBar label="知识覆盖" score={selectedHistory.score_coverage} threshold={80} />
                    <ScoreBar label="理解深度" score={selectedHistory.score_depth} />
                    <ScoreBar label="表达准确" score={selectedHistory.score_accuracy} />
                  </div>
                  {selectedHistory.per_question_results?.length > 0 && (
                    <PerQuestionDetail results={selectedHistory.per_question_results} />
                  )}
                  <div className="glass-card rounded-xl p-6 space-y-3">
                    <h3 className="font-semibold flex items-center gap-2"><span>💬</span> 总体反馈</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{selectedHistory.feedback}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {historyList.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setSelectedHistory(h)}
                      className="w-full text-left glass-card rounded-xl p-4 hover:border-primary/30 transition-all border border-border/20"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{h.type === "skipped" ? "⏭" : h.passed ? "✅" : "❌"}</span>
                          <div>
                            <div className="text-sm font-medium">
                              {h.type === "skipped" ? `第 ${h.attempt_number} 次 · 跳过检测` : `第 ${h.attempt_number} 次检测`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(h.created_at).toLocaleString("zh-CN")}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          {h.type === "skipped" ? (
                            <div className="text-sm text-muted-foreground">已跳过</div>
                          ) : (
                            <>
                              <div className={`text-lg font-bold ${h.score_overall >= 70 ? "text-green-400" : "text-amber-400"}`}>
                                {Math.round(h.score_overall)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">综合评分</div>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                  <Button
                    className="w-full h-12 rounded-xl glow-primary font-medium mt-4"
                    onClick={() => setViewState("questions")}
                  >
                    开始新的检测
                  </Button>
                </div>
              )}
            </div>
          )}

          {viewState === "result" && result && (
            <div className="space-y-6">
              {/* Overall Score Card */}
              <div className={`glass-card rounded-xl overflow-hidden ${
                result.passed ? "border-green-500/30" : "border-amber-500/30"
              }`}>
                <div className={`h-1 ${result.passed ? "bg-gradient-to-r from-green-500 to-emerald-400" : "bg-gradient-to-r from-amber-500 to-orange-400"}`} />
                <div className="p-6 space-y-6">
                  <div className="text-center pb-2">
                    <div className="text-5xl mb-3">
                      {result.passed ? "🎉" : "💪"}
                    </div>
                    <h2 className="text-2xl font-bold gradient-text">
                      {result.timed_out ? "答题超时，未通过" : result.passed ? "恭喜通过！" : "继续加油！"}
                    </h2>
                    <p className="text-muted-foreground mt-1">
                      综合评分: <span className="text-primary font-semibold">{Math.round(result.score_overall)}</span> / 100
                    </p>
                    {result.cross_check_agreed != null && (
                      <p className="text-xs mt-2 text-muted-foreground">
                        交叉验证：{result.cross_check_agreed ? "两个模型结论一致" : "两个模型结论不一致，已按更严格结果计分"}
                        {result.validator_score_overall != null ? `（验证分 ${Math.round(result.validator_score_overall)}）` : ""}
                      </p>
                    )}
                    {result.post_review_available && result.passed && (
                      <p className="text-xs mt-2 text-muted-foreground">可选：去做一轮本阶段复习巩固，不影响继续往下学。</p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <ScoreBar label="知识覆盖" score={result.score_coverage} threshold={80} />
                    <ScoreBar label="理解深度" score={result.score_depth} />
                    <ScoreBar label="表达准确" score={result.score_accuracy} />
                  </div>
                </div>
              </div>

              {/* Per-Question Results with answers */}
              {result.per_question_results && result.per_question_results.length > 0 && (
                <PerQuestionDetail results={result.per_question_results} />
              )}

              {/* Overall Feedback */}
              <div className="glass-card rounded-xl p-6 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <span>💬</span> 总体反馈
                </h3>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  <MarkdownRenderer content={result.feedback} />
                </div>

                {!result.passed && result.missing_topics.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <span>⚠️</span> 需要加强的知识点
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {result.missing_topics.map((topic) => (
                        <Badge key={topic} className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Suggestions with clickable links */}
              {result.suggestions && result.suggestions.length > 0 && (
                <div className="glass-card rounded-xl p-6 space-y-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <span>📎</span> 推荐学习资料
                  </h3>
                  <div className="space-y-2">
                    {result.suggestions.map((rawSuggestion, i) => {
                      const suggestion = normalizeSuggestion(rawSuggestion);
                      return (
                        <div
                          key={i}
                          className="p-3.5 rounded-xl bg-background/30 border border-border/20 hover:border-primary/30 transition-colors"
                        >
                          {suggestion.url ? (
                            <a
                              href={suggestion.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-2 group"
                            >
                              <span className="text-primary mt-0.5 shrink-0">🔗</span>
                              <div className="min-w-0">
                                <span className="text-sm font-medium text-primary group-hover:underline">
                                  {suggestion.title || suggestion.url}
                                </span>
                                {suggestion.description && suggestion.description !== suggestion.title && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {suggestion.description}
                                  </p>
                                )}
                              </div>
                              <span className="text-muted-foreground/50 text-xs shrink-0 mt-0.5">↗</span>
                            </a>
                          ) : (
                            <div className="flex items-start gap-2">
                              <span className="text-muted-foreground mt-0.5 shrink-0">📄</span>
                              <span className="text-sm text-muted-foreground">
                                {suggestion.description || suggestion.title}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 flex-wrap">
                <Button
                  variant="outline"
                  className="h-12 rounded-xl border-border/50 px-6"
                  onClick={() => router.push(result.passed ? `/plan/${planId}` : `/plan/${planId}/stage/${stageId}`)}
                >
                  {result.passed ? "← 返回关卡地图" : "← 回去复习"}
                </Button>
                {result.passed && result.post_review_available && (
                  <Button
                    variant="outline"
                    className="h-12 rounded-xl border-border/50 px-6"
                    onClick={() => router.push(`/review?plan_id=${planId}&stage_id=${stageId}`)}
                  >
                    可选阶段复习
                  </Button>
                )}
                <Button
                  className="flex-1 h-12 rounded-xl glow-primary font-medium"
                  onClick={async () => {
                    submittingRef.current = false;
                    setRegenerating(true);
                    try {
                      const regenRes = await fetch(`/api/stage/${stageId}/assess`, { method: "PATCH" });
                      if (regenRes.ok) {
                        const regenData = await regenRes.json();
                        if (regenData.assessment_questions && stage) {
                          setStage({ ...stage, assessment_questions: regenData.assessment_questions });
                        }
                      }
                    } catch { /* fallback */ }
                    setRegenerating(false);
                    setViewState("questions");
                    setResult(null);
                    setAnswers({});
                    setCurrentQIndex(0);
                    const hRes = await fetch(`/api/stage/${stageId}/assessments`);
                    if (hRes.ok) setHistoryList(await hRes.json());
                  }}
                >
                  再次检测
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {skipConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">跳过本阶段检测？</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              跳过后将直接完成本阶段并解锁下一阶段，不会进行 AI 评分。你可以之后通过「再次检测」补做。
            </p>
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 h-11 rounded-xl"
                onClick={() => setSkipConfirm(false)}
                disabled={skipping}
              >
                取消
              </Button>
              <Button
                className="flex-1 h-11 rounded-xl"
                onClick={handleSkip}
                disabled={skipping}
              >
                {skipping ? "处理中..." : "确认跳过"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PerQuestionDetail({ results }: { results: PerQuestionResult[] }) {
  return (
    <div className="glass-card rounded-xl p-6 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <span>📝</span> 逐题评估
      </h3>
      <div className="space-y-3">
        {results.map((pqr, i) => (
          <div
            key={i}
            className={`p-4 rounded-xl border ${
              pqr.is_correct
                ? "bg-green-500/5 border-green-500/20"
                : "bg-red-500/5 border-red-500/20"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                pqr.is_correct ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
              }`}>
                {pqr.is_correct ? "✓" : "✗"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">第 {pqr.question_index + 1} 题</span>
                  {pqr.question_type && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {questionTypeLabel(pqr.question_type)}
                    </Badge>
                  )}
                  <span className={`text-xs font-medium ${
                    pqr.score >= 80 ? "text-green-400" : pqr.score >= 60 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {Math.round(pqr.score)} 分
                  </span>
                </div>
                <p className="text-sm text-foreground/80 mb-3">
                  <MarkdownRenderer content={pqr.question_text} />
                </p>

                {pqr.user_answer && (
                  <div className="mb-2 p-3 rounded-lg bg-background/40 border border-border/20">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">你的回答</div>
                    <div className="text-sm text-foreground/70">
                      <MarkdownRenderer content={pqr.user_answer} />
                    </div>
                  </div>
                )}

                {pqr.correct_answer && !pqr.is_correct && (
                  <div className="mb-2 p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                    <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1">参考答案</div>
                    <div className="text-sm text-green-300/80">
                      <MarkdownRenderer content={pqr.correct_answer} />
                    </div>
                  </div>
                )}

                <div className="text-sm text-muted-foreground leading-relaxed">
                  <MarkdownRenderer content={pqr.feedback} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function questionTypeLabel(type: string): string {
  switch (type) {
    case "choice": return "选择题";
    case "fill": return "填空题";
    case "true_false": return "判断题";
    case "short_answer": return "简答题";
    default: return "题目";
  }
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: StructuredQuestion;
  value: string;
  onChange: (val: string) => void;
}) {
  if (question.type === "choice" && question.options?.length) {
    return (
      <div className="space-y-2">
        {question.options.map((opt, i) => {
          const label = String.fromCharCode(65 + i);
          const isSelected = value === opt;
          return (
            <button
              key={i}
              onClick={() => onChange(opt)}
              className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                isSelected
                  ? "bg-primary/10 border-primary/40 text-foreground"
                  : "bg-background/30 border-border/30 text-muted-foreground hover:border-border/60"
              }`}
            >
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                isSelected ? "bg-primary text-primary-foreground" : "bg-card/80 border border-border/50"
              }`}>
                {label}
              </span>
              <span className="text-sm pt-0.5"><MarkdownRenderer content={opt} /></span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === "true_false") {
    return (
      <div className="flex gap-3">
        {["对", "错"].map((opt) => {
          const isSelected = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`flex-1 p-4 rounded-xl border text-center font-medium transition-all ${
                isSelected
                  ? "bg-primary/10 border-primary/40 text-foreground"
                  : "bg-background/30 border-border/30 text-muted-foreground hover:border-border/60"
              }`}
            >
              <span className="text-2xl mb-1 block">{opt === "对" ? "✅" : "❌"}</span>
              <span className="text-sm">{opt}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === "fill") {
    return (
      <Input
        placeholder="填写答案..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 rounded-xl bg-background/50 border-border/40 text-base"
      />
    );
  }

  return (
    <Textarea
      placeholder="写下你的理解..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-[200px] resize-y rounded-xl bg-background/50 border-border/40"
    />
  );
}

function ScoreBar({
  label,
  score,
  threshold,
}: {
  label: string;
  score: number;
  threshold?: number;
}) {
  const rounded = Math.round(score);
  const isLow = threshold ? rounded < threshold : rounded < 70;

  return (
    <div className="text-center space-y-2.5 p-3 rounded-xl bg-background/20 border border-border/20">
      <div className="text-3xl font-bold">
        <span className={isLow ? "text-amber-400" : "text-green-400"}>
          {rounded}
        </span>
      </div>
      <Progress value={rounded} className="h-1.5" />
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
