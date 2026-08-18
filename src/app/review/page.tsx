"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { InterviewCountdownBar, DEFAULT_COUNTDOWN_SECONDS } from "@/components/interview-countdown";

interface ReviewSchedule {
  id: string;
  stage_id: string;
  plan_id: string;
  interval_days: number;
  scheduled_at: string;
  status: string;
  completed_at: string | null;
  score: number | null;
  created_at: string;
  review_kind?: string;
}

interface ReviewQuestion {
  question: string;
  type: "choice" | "fill" | "short_answer";
  options?: string[];
  answer: string;
}

interface StageInfo {
  id: string;
  title: string;
  key_topics: string[];
  learning_objectives: string[];
}

interface PlanInfo {
  id: string;
  title: string;
  stages: StageInfo[];
  answer_time_limit_enabled?: boolean;
  answer_time_limit_seconds?: number;
}

type TabValue = "pending" | "upcoming" | "completed";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase();
}

function isAnswerCorrect(question: ReviewQuestion, userAnswer: string) {
  const normalized = normalizeAnswer(userAnswer);
  const expected = normalizeAnswer(question.answer);
  if (!normalized) return false;
  if (question.type === "choice" || question.type === "fill") {
    return normalized === expected;
  }
  return normalized === expected || normalized.includes(expected) || expected.includes(normalized);
}

function calculateScore(questions: ReviewQuestion[], answers: Record<number, string>) {
  if (questions.length === 0) return 0;
  const correct = questions.filter((q, i) => isAnswerCorrect(q, answers[i] || "")).length;
  return Math.round((correct / questions.length) * 100);
}

function ReviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="glass-card rounded-xl p-5 space-y-3">
          <div className="h-5 bg-muted/40 rounded w-2/3" />
          <div className="h-4 bg-muted/30 rounded w-1/2" />
          <div className="h-9 bg-muted/30 rounded w-28" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ tab }: { tab: TabValue }) {
  const messages: Record<TabValue, { icon: string; text: string }> = {
    pending: { icon: "🎉", text: "暂无待复习任务，记忆状态良好！" },
    upcoming: { icon: "📅", text: "暂无即将到来的复习安排" },
    completed: { icon: "📚", text: "还没有完成的复习记录" },
  };
  const { icon, text } = messages[tab];

  return (
    <div className="glass-card rounded-xl p-12 text-center transition-all animate-in fade-in-0 duration-300">
      <div className="text-4xl mb-4">{icon}</div>
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

export default function ReviewCenterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-3 border-primary/20 border-t-primary animate-spin" />
            </div>
            <span className="text-sm text-muted-foreground animate-pulse">加载中...</span>
          </div>
        </div>
      }
    >
      <ReviewCenterContent />
    </Suspense>
  );
}

function ReviewCenterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planIdFilter = searchParams.get("plan_id");
  const stageIdFilter = searchParams.get("stage_id");
  const autoStartedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabValue>("pending");
  const [pending, setPending] = useState<ReviewSchedule[]>([]);
  const [upcoming, setUpcoming] = useState<ReviewSchedule[]>([]);
  const [completed, setCompleted] = useState<ReviewSchedule[]>([]);
  const [planCache, setPlanCache] = useState<Record<string, PlanInfo>>({});

  const [activeReview, setActiveReview] = useState<ReviewSchedule | null>(null);
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewStartTime, setReviewStartTime] = useState<number | null>(null);
  const [answerDeadlineAt, setAnswerDeadlineAt] = useState<string | null>(null);
  const loadedPlansRef = useRef<Set<string>>(new Set());
  const submittingRef = useRef(false);

  const loadPlanInfo = useCallback(async (planId: string) => {
    if (loadedPlansRef.current.has(planId)) return;
    loadedPlansRef.current.add(planId);
    try {
      const res = await fetch(`/api/plan?id=${planId}`);
      const data = await res.json();
      if (data?.plan) {
        setPlanCache((prev) => {
          if (prev[planId]) return prev;
          return {
            ...prev,
            [planId]: {
              id: data.plan.id,
              title: data.plan.title,
              answer_time_limit_enabled: !!data.plan.answer_time_limit_enabled,
              answer_time_limit_seconds: data.plan.answer_time_limit_seconds || 120,
              stages: (data.stages || []).map((s: StageInfo) => ({
                id: s.id,
                title: s.title,
                key_topics: s.key_topics || [],
                learning_objectives: s.learning_objectives || [],
              })),
            },
          };
        });
      }
    } catch {
      loadedPlansRef.current.delete(planId);
    }
  }, []);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (planIdFilter) params.set("plan_id", planIdFilter);
      if (stageIdFilter) params.set("stage_id", stageIdFilter);
      const url = params.toString() ? `/api/review?${params.toString()}` : "/api/review";
      const res = await fetch(url);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setPending(data.pending || []);
      setUpcoming(data.upcoming || []);
      setCompleted(data.completed || []);

      const allReviews = [
        ...(data.pending || []),
        ...(data.upcoming || []),
        ...(data.completed || []),
      ] as ReviewSchedule[];
      const uniquePlanIds = [...new Set(allReviews.map((r) => r.plan_id))];
      await Promise.all(uniquePlanIds.map((id) => loadPlanInfo(id)));
    } catch {
      toast.error("加载复习任务失败");
    } finally {
      setLoading(false);
    }
  }, [planIdFilter, stageIdFilter, loadPlanInfo]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    if (autoStartedRef.current || loading || !stageIdFilter) return;
    const target = pending.find(
      (r) => r.stage_id === stageIdFilter && (r.review_kind === "post_stage" || !r.review_kind)
    ) || pending.find((r) => r.stage_id === stageIdFilter);
    if (!target) return;
    autoStartedRef.current = true;
    void startReview(target);
  }, [loading, pending, stageIdFilter]);

  const getStageMeta = useCallback(
    (review: ReviewSchedule) => {
      const plan = planCache[review.plan_id];
      const stage = plan?.stages.find((s) => s.id === review.stage_id);
      return {
        planTitle: plan?.title || "加载中...",
        stageTitle: stage?.title || "加载中...",
        stage,
      };
    },
    [planCache]
  );

  const currentList = useMemo(() => {
    if (tab === "pending") return pending;
    if (tab === "upcoming") return upcoming;
    return completed;
  }, [tab, pending, upcoming, completed]);

  const activeStageMeta = activeReview ? getStageMeta(activeReview) : null;
  const currentQuestion = questions[currentQuestionIndex];
  const answeredCount = Object.values(answers).filter((a) => a?.trim()).length;
  const allAnswered = questions.length > 0 && answeredCount >= questions.length;

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else if (planIdFilter) {
      router.push(`/plan/${planIdFilter}`);
    } else {
      router.push("/");
    }
  }

  async function startReview(review: ReviewSchedule) {
    setActiveReview(review);
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setReviewing(true);
    setLoadingQuestions(true);
    setReviewStartTime(Date.now());
    const plan = planCache[review.plan_id];
    if (plan?.answer_time_limit_enabled) {
      setAnswerDeadlineAt(new Date(Date.now() + (plan.answer_time_limit_seconds || DEFAULT_COUNTDOWN_SECONDS) * 1000).toISOString());
    } else {
      setAnswerDeadlineAt(null);
    }

    await loadPlanInfo(review.plan_id);

    try {
      const res = await fetch(`/api/review/${review.id}/questions`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "加载题目失败");
      }
      const data = await res.json();
      setQuestions(data.questions || []);
    } catch (e) {
      toast.error((e as Error).message);
      setReviewing(false);
      setActiveReview(null);
    } finally {
      setLoadingQuestions(false);
    }
  }

  function closeReviewDialog() {
    if (submitting) return;
    setReviewing(false);
    setActiveReview(null);
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setReviewStartTime(null);
    setAnswerDeadlineAt(null);
  }

  async function submitReview(skipQuestions = false, timedOut = false) {
    if (!activeReview || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);

    const durationMinutes = reviewStartTime
      ? Math.max(1, Math.round((Date.now() - reviewStartTime) / 60000))
      : 0;

    const rawScore = skipQuestions || timedOut ? 0 : calculateScore(questions, answers);
    const payload = skipQuestions || timedOut
      ? {
          review_schedule_id: activeReview.id,
          questions: timedOut
            ? questions.map((q, i) => ({
                ...q,
                user_answer: answers[i] || "",
                is_correct: false,
              }))
            : [],
          score: rawScore,
          duration_minutes: durationMinutes,
          timed_out: timedOut,
        }
      : {
          review_schedule_id: activeReview.id,
          questions: questions.map((q, i) => ({
            ...q,
            user_answer: answers[i] || "",
            is_correct: isAnswerCorrect(q, answers[i] || ""),
          })),
          score: rawScore,
          duration_minutes: durationMinutes,
          timed_out: false,
        };

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "提交失败");
      }
      if (timedOut) {
        toast.error("复习超时，未通过。请重试。");
      } else if (skipQuestions) {
        toast.success("已标记完成");
      } else {
        toast.success(`复习完成，得分 ${payload.score} 分`);
      }
      closeReviewDialog();
      await fetchReviews();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function renderStatusBadge(review: ReviewSchedule) {
    if (review.status === "expired") {
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/15">
          已过期
        </Badge>
      );
    }
    if (tab === "upcoming") {
      return (
        <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
          即将到来
        </Badge>
      );
    }
    if (tab === "completed") {
      return (
        <Badge className="bg-green-500/15 text-green-400 border-green-500/20 hover:bg-green-500/15">
          已完成
        </Badge>
      );
    }
    return (
      <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/15">
        待复习
      </Badge>
    );
  }

  function renderReviewCard(review: ReviewSchedule) {
    const { planTitle, stageTitle } = getStageMeta(review);

    return (
      <Card
        key={review.id}
        className="glass-card border-border/30 transition-all hover:border-primary/20 hover:shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate">{stageTitle}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{planTitle}</p>
              </div>
            </div>
            {renderStatusBadge(review)}
            {review.review_kind === "post_stage" && (
              <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/20 hover:bg-violet-500/15">
                阶段后复习
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              间隔: {review.interval_days} 天
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {tab === "completed" && review.completed_at
                ? `完成: ${formatDate(review.completed_at)}`
                : `到期: ${formatDate(review.scheduled_at)}`}
            </span>
          </div>
          {tab === "completed" && review.score != null && (
            <div className="flex items-center gap-2">
              <Progress value={review.score} className="h-1.5 flex-1" />
              <span
                className={`text-sm font-medium ${
                  review.score >= 80
                    ? "text-green-400"
                    : review.score >= 60
                      ? "text-amber-400"
                      : "text-muted-foreground"
                }`}
              >
                {review.score} 分
              </span>
            </div>
          )}
        </CardContent>
        {tab !== "completed" && (
          <CardFooter className="border-t border-border/20 bg-transparent pt-4">
            <Button
              size="sm"
              className="rounded-lg"
              onClick={() => startReview(review)}
              disabled={tab === "upcoming"}
            >
              {tab === "upcoming" ? "尚未到期" : "开始复习"}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-radial from-primary/5 via-transparent to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-gradient-radial from-chart-2/5 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      <header className="border-b border-border/40 bg-card/40 backdrop-blur-md relative z-10 app-region-drag">
        <div className="pl-20 pr-6 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-muted-foreground hover:text-foreground app-region-no-drag"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            返回
          </Button>
          <div className="flex items-center gap-2.5 app-region-no-drag">
            <ClipboardList className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">复习中心</h1>
          </div>
          <div className="ml-auto app-region-no-drag">
            <Badge variant="outline" className="text-xs">
              待复习: {pending.length}
            </Badge>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 relative z-10 max-w-3xl mx-auto w-full">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          className="space-y-6"
        >
          <TabsList className="w-full grid grid-cols-3 bg-muted/50 app-region-no-drag">
            <TabsTrigger value="pending" className="gap-1.5">
              待复习
              {pending.length > 0 && (
                <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">
                  {pending.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="upcoming">即将到来</TabsTrigger>
            <TabsTrigger value="completed">已完成</TabsTrigger>
          </TabsList>

          {(["pending", "upcoming", "completed"] as TabValue[]).map((tabValue) => (
            <TabsContent key={tabValue} value={tabValue} className="space-y-4 mt-0">
              {loading ? (
                <ReviewSkeleton />
              ) : currentList.length === 0 && tab === tabValue ? (
                <EmptyState tab={tabValue} />
              ) : tab === tabValue ? (
                currentList.map(renderReviewCard)
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
      </main>

      <Dialog open={reviewing} onOpenChange={(open) => !open && closeReviewDialog()}>
        <DialogContent
          className="sm:max-w-lg max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur-xl border-border/40"
          showCloseButton={!submitting}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {activeReview?.review_kind === "post_stage" ? "阶段后复习" : "阶段复习"}
            </DialogTitle>
            <DialogDescription>
              {activeStageMeta?.stageTitle} · {activeStageMeta?.planTitle}
            </DialogDescription>
          </DialogHeader>

          {activeReview && answerDeadlineAt && (
            <InterviewCountdownBar
              answerDeadlineAt={answerDeadlineAt}
              serverNow={null}
              enabled
              totalSeconds={planCache[activeReview.plan_id]?.answer_time_limit_seconds || DEFAULT_COUNTDOWN_SECONDS}
              onExpire={() => { void submitReview(false, true); }}
            />
          )}

          {loadingQuestions ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">AI 正在生成复习题...</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              未能加载复习题目
            </div>
          ) : (
            <div className="space-y-5">
              {activeStageMeta?.stage && (
                <div className="glass-card rounded-lg p-4 space-y-2 text-sm">
                  <p className="font-medium text-foreground/90">阶段回顾</p>
                  {activeStageMeta.stage.key_topics.length > 0 && (
                    <p className="text-muted-foreground leading-relaxed">
                      <span className="text-foreground/70">核心知识点：</span>
                      {activeStageMeta.stage.key_topics.slice(0, 5).join("、")}
                    </p>
                  )}
                  {activeStageMeta.stage.learning_objectives.length > 0 && (
                    <p className="text-muted-foreground leading-relaxed">
                      <span className="text-foreground/70">学习目标：</span>
                      {activeStageMeta.stage.learning_objectives.slice(0, 3).join("；")}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  问题 {currentQuestionIndex + 1}/{questions.length}
                </span>
                <span>{answeredCount}/{questions.length} 已答</span>
              </div>
              <Progress
                value={((currentQuestionIndex + 1) / questions.length) * 100}
                className="h-1.5"
              />

              <div className="flex gap-1.5 flex-wrap">
                {questions.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCurrentQuestionIndex(i)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                      i === currentQuestionIndex
                        ? "bg-primary text-primary-foreground"
                        : answers[i]?.trim()
                          ? "bg-green-500/10 text-green-400 border border-green-500/20"
                          : "bg-card/50 text-muted-foreground border border-border/30"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>

              {currentQuestion && (
                <div className="glass-card rounded-lg p-5 space-y-4">
                  <div className="font-medium leading-relaxed">
                    <MarkdownRenderer content={currentQuestion.question} />
                  </div>

                  {currentQuestion.type === "choice" && currentQuestion.options ? (
                    <div className="grid gap-2">
                      {currentQuestion.options.map((option) => {
                        const selected = answers[currentQuestionIndex] === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() =>
                              setAnswers((prev) => ({
                                ...prev,
                                [currentQuestionIndex]: option,
                              }))
                            }
                            className={`text-left px-4 py-3 rounded-lg border transition-all text-sm ${
                              selected
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/40 hover:border-primary/30 hover:bg-card/50"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : currentQuestion.type === "fill" ? (
                    <Input
                      placeholder="请输入答案"
                      value={answers[currentQuestionIndex] || ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [currentQuestionIndex]: e.target.value,
                        }))
                      }
                    />
                  ) : (
                    <Textarea
                      placeholder="请用自己的话回答..."
                      rows={4}
                      value={answers[currentQuestionIndex] || ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [currentQuestionIndex]: e.target.value,
                        }))
                      }
                    />
                  )}

                  <div className="flex justify-between pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentQuestionIndex === 0}
                      onClick={() => setCurrentQuestionIndex((i) => i - 1)}
                    >
                      上一题
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentQuestionIndex >= questions.length - 1}
                      onClick={() => setCurrentQuestionIndex((i) => i + 1)}
                    >
                      下一题
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loadingQuestions && questions.length > 0 && (
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => submitReview(true)}
                className="text-muted-foreground"
              >
                仅浏览，标记完成
              </Button>
              <Button
                size="sm"
                disabled={!allAnswered || submitting}
                onClick={() => submitReview(false)}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    提交 ({calculateScore(questions, answers)} 分预估)
                  </>
                )}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
