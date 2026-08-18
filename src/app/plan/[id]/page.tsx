"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  LearnerAvatarPicker,
  TeachBackgroundPicker,
  TeachChatBackdrop,
  TutorAvatarPicker,
  useKeywordHighlight,
  useLearnerAvatar,
  useTeachBackground,
  useTutorAvatar,
} from "@/components/teach-chat";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { StageOutlineGate } from "@/components/stage-outline-gate";
import { StageProgressPanel } from "@/components/stage-progress-panel";
import { StageScenariosPanel } from "@/components/stage-scenarios-panel";
import { LearningModeSwitcher } from "@/components/learning-mode-switcher";
import type { LearningMode, OutlineStatus } from "@/lib/learning-types";
import { defaultLearningMode, DEFAULT_COUNTDOWN_SECONDS } from "@/lib/learning-types";

interface Plan {
  id: string;
  title: string;
  goal_description: string;
  status: string;
  total_stages: number;
  current_stage_index: number;
  duration_weeks: number;
  daily_hours: number;
  learning_mode?: LearningMode;
  career_identity?: string;
  source_type?: string;
  source_path?: string | null;
  post_stage_review_enabled?: boolean;
  answer_time_limit_enabled?: boolean;
  answer_time_limit_seconds?: number;
}

interface PlanSummary {
  id: string;
  title: string;
  status: string;
  total_stages: number;
}

interface Stage {
  id: string;
  plan_id: string;
  order_index: number;
  title: string;
  description: string;
  key_topics: string[];
  estimated_days: number;
  status: string;
  resource_completion_rate: number;
  core_output?: string;
  real_world_cases?: string[];
  summary_text?: string;
  outline_status?: OutlineStatus;
  outline_confirmed_at?: string | null;
  post_review_status?: string;
}

interface Resource {
  id: string;
  title: string;
  url: string;
  source: string;
  type: string;
  reason: string;
  estimated_minutes: number;
  region_tag: string;
  is_completed: boolean;
  search_source?: string;
  verified?: boolean;
}

interface ChatMsg {
  role: string;
  content: string;
}

interface StageProject {
  id: string;
  stage_id: string;
  title: string;
  description: string;
  expected_output: string;
  checklist: { item: string; completed: boolean }[];
  output_notes: string;
  difficulty: string;
  estimated_minutes: number;
  status: string;
}

type RightPanel = "learn" | "outline" | "progress" | "scenarios" | "resources" | "project" | "info" | "notes" | "assessments";

interface AssessmentRecord {
  id: string;
  type?: string;
  score_overall: number;
  score_coverage: number;
  score_depth: number;
  score_accuracy: number;
  passed: boolean;
  feedback: string;
  missing_topics: string[];
  suggestions: (string | { title: string; url: string; description: string })[];
  per_question_results: {
    question_index: number;
    question_text: string;
    is_correct: boolean;
    score: number;
    feedback: string;
  }[];
  attempt_number: number;
  created_at: string;
}

export default function PlanDashboard() {
  const router = useRouter();
  const params = useParams();
  const planId = params.id as string;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [allPlans, setAllPlans] = useState<PlanSummary[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingResources, setLoadingResources] = useState(false);
  const [generatingResources, setGeneratingResources] = useState(false);

  const [rightPanel, setRightPanel] = useState<RightPanel>("learn");
  const [project, setProject] = useState<StageProject | null>(null);
  const [dueReviewCount, setDueReviewCount] = useState(0);
  const [assessmentHistory, setAssessmentHistory] = useState<AssessmentRecord[]>([]);
  const [expandedAssessmentId, setExpandedAssessmentId] = useState<string | null>(null);
  const [skippingAssess, setSkippingAssess] = useState(false);

  const [outlineStatus, setOutlineStatus] = useState<OutlineStatus | null>(null);
  const [stageProgressPercent, setStageProgressPercent] = useState(0);

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatLoadedFor, setChatLoadedFor] = useState<string | null>(null);
  const [stageNote, setStageNote] = useState({ ai_summary: "", user_notes: "" });
  const [savingNotes, setSavingNotes] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { avatarId, selectAvatar } = useTutorAvatar();
  const { avatarId: learnerAvatarId, selectAvatar: selectLearnerAvatar } = useLearnerAvatar();
  const { keywordHighlight } = useKeywordHighlight();
  const {
    bgId,
    customUrl,
    selectBackground,
    setCustomBackground,
    clearCustomBackground,
  } = useTeachBackground();

  const loadData = useCallback(async () => {
    try {
      const [planRes, allPlansRes] = await Promise.all([
        fetch(`/api/plan?id=${planId}`),
        fetch("/api/plan?all=true"),
      ]);
      const data = await planRes.json();
      const allPlansData = await allPlansRes.json();
      setAllPlans(Array.isArray(allPlansData) ? allPlansData : []);

      if (data?.plan) {
        setPlan(data.plan);
        setStages(data.stages);
        const active = data.stages.find((s: Stage) => s.status === "active");
        if (active) setSelectedStageId(active.id);
        else if (data.stages.length > 0) setSelectedStageId(data.stages[0].id);
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    function handleFocus() {
      loadData();
      if (selectedStageId) {
        fetch(`/api/stage/${selectedStageId}/assessments`)
          .then((r) => r.json())
          .then((d) => setAssessmentHistory(Array.isArray(d) ? d : []))
          .catch(() => {});
      }
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadData, selectedStageId]);

  useEffect(() => {
    if (!selectedStageId) return;
    setLoadingResources(true);
    setOutlineStatus(null);
    setChatLoadedFor(null);
    setStageProgressPercent(0);

    fetch(`/api/stage/${selectedStageId}/outline`)
      .then((r) => r.json())
      .then((d) => {
        setOutlineStatus((d.outline_status as OutlineStatus) || "pending");
        const stage = stages.find((s) => s.id === selectedStageId);
        if (stage && d.outline_status) {
          setStages((prev) =>
            prev.map((s) =>
              s.id === selectedStageId
                ? { ...s, outline_status: d.outline_status, outline_confirmed_at: d.outline_confirmed_at }
                : s
            )
          );
        }
      })
      .catch(() => setOutlineStatus("pending"));

    fetch(`/api/stage/${selectedStageId}/progress`)
      .then((r) => r.json())
      .then((d) => setStageProgressPercent(d.percent ?? 0))
      .catch(() => setStageProgressPercent(0));

    fetch(`/api/stage/${selectedStageId}/resources`)
      .then((r) => r.json())
      .then(setResources)
      .catch(() => setResources([]))
      .finally(() => setLoadingResources(false));

    fetch(`/api/project?stage_id=${selectedStageId}`)
      .then((r) => r.json())
      .then((d) => setProject(d || null))
      .catch(() => setProject(null));

    fetch(`/api/stage/${selectedStageId}/notes`)
      .then((r) => r.json())
      .then((d) => setStageNote({
        ai_summary: d.ai_summary || "",
        user_notes: d.user_notes || "",
      }))
      .catch(() => setStageNote({ ai_summary: "", user_notes: "" }));

    fetch(`/api/stage/${selectedStageId}/assessments`)
      .then((r) => r.json())
      .then((d) => {
        setAssessmentHistory(Array.isArray(d) ? d : []);
        setExpandedAssessmentId(null);
      })
      .catch(() => setAssessmentHistory([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStageId]);

  useEffect(() => {
    fetch(`/api/review?plan_id=${planId}`)
      .then((r) => r.json())
      .then((d) => setDueReviewCount(d?.pending?.length || 0))
      .catch(() => {});
  }, [planId]);

  const outlineConfirmed = outlineStatus === "confirmed";

  useEffect(() => {
    if (
      selectedStageId &&
      rightPanel === "learn" &&
      outlineConfirmed &&
      chatLoadedFor !== selectedStageId
    ) {
      loadChat(selectedStageId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStageId, rightPanel, outlineConfirmed]);

  async function refreshStageProgress(stageId?: string) {
    const sid = stageId || selectedStageId;
    if (!sid) return;
    try {
      const res = await fetch(`/api/stage/${sid}/progress`);
      const data = await res.json();
      if (res.ok) setStageProgressPercent(data.percent ?? 0);
    } catch {
      /* ignore */
    }
  }

  async function loadChat(stageId: string) {
    try {
      const outlineRes = await fetch(`/api/stage/${stageId}/outline`);
      const outlineData = await outlineRes.json().catch(() => ({}));
      const status = (outlineData.outline_status as OutlineStatus) || "pending";
      setOutlineStatus(status);
      if (status !== "confirmed") {
        setChatLoadedFor(null);
        return;
      }

      const res = await fetch(`/api/stage/${stageId}/chat`);
      const data = await res.json();
      setChatMessages(Array.isArray(data) ? data : []);
      setChatLoadedFor(stageId);
      if (Array.isArray(data) && data.length === 0) {
        await sendChatMessage("开始学习", stageId);
      }
    } catch { /* ignore */ }
  }

  async function handleOutlineConfirmed() {
    setOutlineStatus("confirmed");
    setStages((prev) =>
      prev.map((s) =>
        s.id === selectedStageId
          ? { ...s, outline_status: "confirmed", outline_confirmed_at: new Date().toISOString() }
          : s
      )
    );
    setChatLoadedFor(null);
    setRightPanel("learn");
    await refreshStageProgress();
  }

  async function sendChatMessage(text: string, stageId?: string) {
    const sid = stageId || selectedStageId;
    if (!sid) return;
    setChatSending(true);
    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatInput("");
    try {
      const res = await fetch(`/api/stage/${sid}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "请先确认学习大纲");
        setOutlineStatus("draft");
        setRightPanel("outline");
        setChatMessages((prev) => prev.slice(0, -1));
        return;
      }
      if (!res.ok) throw new Error("发送失败");
      const data = await res.json();
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChatSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  async function handleGenerateResources() {
    if (!selectedStageId) return;
    setGeneratingResources(true);
    try {
      const res = await fetch(`/api/stage/${selectedStageId}/resources`, { method: "POST" });
      if (!res.ok) throw new Error("生成失败");
      const data = await res.json();
      setResources((prev) => [...prev, ...data]);
      toast.success("资料已生成");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGeneratingResources(false);
    }
  }

  async function handleTogglePostStageReview(enabled: boolean) {
    if (!plan) return;
    try {
      const res = await fetch("/api/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          post_stage_review_enabled: enabled,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "更新失败");
      }
      const data = await res.json();
      if (data.plan) setPlan((p) => (p ? { ...p, ...data.plan } : p));
      toast.success(enabled ? "已开启阶段后复习" : "已关闭阶段后复习");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleToggleTimeLimit(enabled: boolean) {
    if (!plan) return;
    try {
      const res = await fetch("/api/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          answer_time_limit_enabled: enabled,
          answer_time_limit_seconds: plan.answer_time_limit_seconds || DEFAULT_COUNTDOWN_SECONDS,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "更新失败");
      }
      const data = await res.json();
      if (data.plan) setPlan((p) => (p ? { ...p, ...data.plan } : p));
      toast.success(enabled ? "已开启答题限时" : "已关闭答题限时");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleTimeLimitSeconds(seconds: number) {
    if (!plan) return;
    try {
      const res = await fetch("/api/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          answer_time_limit_enabled: true,
          answer_time_limit_seconds: seconds,
        }),
      });
      if (!res.ok) throw new Error("更新失败");
      const data = await res.json();
      if (data.plan) setPlan((p) => (p ? { ...p, ...data.plan } : p));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleSkipAssessment() {
    if (!selectedStageId) return;
    const stage = stages.find((s) => s.id === selectedStageId);
    if (stage?.status !== "active") return;
    if (!confirm("跳过本阶段检测？将直接完成本阶段并解锁下一阶段。")) return;
    setSkippingAssess(true);
    try {
      const res = await fetch(`/api/stage/${selectedStageId}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "跳过失败");
      }
      const data = await res.json();
      toast.success(data.hasNext ? "已跳过检测，下一阶段已解锁" : "已跳过检测，全部阶段已完成");
      await loadData();
      await refreshStageProgress();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSkippingAssess(false);
    }
  }

  async function handleToggleChecklist(index: number) {
    if (!project) return;
    const newChecklist = [...project.checklist];
    newChecklist[index] = { ...newChecklist[index], completed: !newChecklist[index].completed };
    const allDone = newChecklist.every(c => c.completed);
    const newStatus = allDone ? "completed" : "in_progress";

    try {
      await fetch(`/api/project`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          checklist: newChecklist,
          status: newStatus,
          ...(allDone ? { completed_at: new Date().toISOString() } : {}),
        }),
      });
      setProject({ ...project, checklist: newChecklist, status: newStatus });
      if (allDone) toast.success("项目已完成！");
    } catch {
      toast.error("更新失败");
    }
  }

  async function handleToggleResource(resourceId: string, completed: boolean) {
    try {
      await fetch(`/api/resource/${resourceId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      setResources((prev) =>
        prev.map((r) => (r.id === resourceId ? { ...r, is_completed: completed } : r))
      );
    } catch {
      toast.error("更新失败");
    }
  }

  async function handleSaveUserNotes() {
    if (!selectedStageId) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/stage/${selectedStageId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_notes: stageNote.user_notes }),
      });
      if (!res.ok) throw new Error("保存失败");
      const data = await res.json();
      setStageNote({
        ai_summary: data.ai_summary || "",
        user_notes: data.user_notes || "",
      });
      toast.success("笔记已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleGenerateAiSummary() {
    if (!selectedStageId) return;
    setGeneratingSummary(true);
    try {
      const res = await fetch(`/api/stage/${selectedStageId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_notes: stageNote.user_notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "生成失败");
      }
      const data = await res.json();
      setStageNote({
        ai_summary: data.ai_summary || "",
        user_notes: data.user_notes || "",
      });
      toast.success("AI 笔记已生成");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGeneratingSummary(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          </div>
          <span className="text-sm text-muted-foreground">加载中...</span>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">计划不存在</p>
          <Button onClick={() => router.push("/")}>返回</Button>
        </div>
      </div>
    );
  }

  const selectedStage = stages.find((s) => s.id === selectedStageId);
  const completedStages = stages.filter((s) => s.status === "completed").length;
  const progress = plan.total_stages > 0 ? (completedStages / plan.total_stages) * 100 : 0;
  const completedResources = resources.filter((r) => r.is_completed).length;

  const visibleMessages = chatMessages.filter(
    (m) => !(m.role === "user" && m.content === "开始学习")
  );

  const typeIcons: Record<string, string> = {
    article: "📄", video: "🎬", doc: "📚", book: "📖", repo: "💻", paper: "📝",
  };

  return (
    <div className="h-screen flex bg-background">
      {/* ===== 左侧导航栏 ===== */}
      <aside className="w-56 shrink-0 bg-[#1a1a2e] flex flex-col">
        <div className="pt-10 px-5 pb-4">
          <h1 className="text-base font-bold text-white">🎯 精细化 AI 规划</h1>
          <p className="text-[11px] text-white/40 mt-1">个性化学习教练</p>
        </div>

        <nav className="flex-1 px-3 overflow-y-auto">
          <p className="text-[10px] text-white/30 uppercase tracking-wider px-2 mb-2">学习阶段</p>

          {stages.map((stage, i) => {
            const isSelected = stage.id === selectedStageId;
            const isCompleted = stage.status === "completed";
            const isLocked = stage.status === "locked";
            const isActive = stage.status === "active";

            return (
              <button
                key={stage.id}
                onClick={() => {
                  if (!isLocked) {
                    setSelectedStageId(stage.id);
                    setRightPanel("learn");
                  }
                }}
                disabled={isLocked}
                title={isLocked ? "完成上一阶段检测后解锁" : undefined}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 flex items-center gap-2.5 text-sm transition-all ${
                  isSelected
                    ? "bg-primary text-primary-foreground font-medium"
                    : isLocked
                      ? "text-white/20 cursor-not-allowed"
                      : "text-white/60 hover:text-white/90 hover:bg-white/5"
                }`}
              >
                <span className="text-xs w-5 text-center shrink-0">
                  {isCompleted ? "🚩" : isLocked ? "🔒" : isActive ? "📖" : `${i + 1}`}
                </span>
                <span className="truncate text-xs">{stage.title}</span>
              </button>
            );
          })}

          {allPlans.length > 1 && (
            <>
              <div className="h-px bg-white/10 my-3" />
              <p className="text-[10px] text-white/30 uppercase tracking-wider px-2 mb-2">其他计划</p>
              {allPlans.filter((p) => p.id !== plan.id).map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 rounded-lg mb-0.5 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-all truncate"
                  onClick={() => router.push(`/plan/${p.id}`)}
                >
                  {p.status === "completed" ? "✅ " : "📖 "}{p.title}
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-white/5">
          <div className="flex items-center justify-between text-[10px] text-white/30 mb-2 px-1">
            <span>进度 {completedStages}/{plan.total_stages}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1 mb-3" />

          <p className="text-[10px] text-white/30 uppercase tracking-wider px-2 mb-1 mt-2">功能</p>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all flex items-center justify-between"
            onClick={() => router.push(`/review?plan_id=${planId}`)}
          >
            <span>🔄 复习中心</span>
            {dueReviewCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px]">{dueReviewCount}</span>
            )}
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            onClick={() => router.push(`/plan/${planId}/graph`)}
          >
            🧠 知识图谱
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            onClick={() => router.push(`/plan/${planId}/analytics`)}
          >
            📊 学习洞察
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            onClick={() => router.push(`/plan/${planId}/export`)}
          >
            📤 导出中心
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            onClick={() => router.push(`/plan/${planId}/interview`)}
          >
            🎙️ 模拟面试
          </button>
          {plan.source_type === "code" && (
            <button
              className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
              onClick={() => router.push(`/plan/${planId}/architecture`)}
            >
              🏗️ 服务架构
            </button>
          )}
          {allPlans.length >= 2 && (
            <button
              className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
              onClick={() => router.push("/interview/multi")}
            >
              🎙️ 跨计划面试
            </button>
          )}

          <div className="h-px bg-white/5 my-2" />
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            onClick={() => router.push("/plan/new")}
          >
            + 新建计划
          </button>
          <button
            className="w-full text-left px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            onClick={() => router.push("/settings")}
          >
            ⚙️ 设置
          </button>
        </div>
      </aside>

      {/* ===== 右侧内容区 ===== */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {selectedStage ? (
          <>
            {/* 阶段头部 + 面板切换 */}
            <div className="shrink-0 border-b border-border/20 px-8 py-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary">
                      第 {selectedStage.order_index + 1} 阶段
                    </Badge>
                    <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${
                      selectedStage.status === "completed" ? "bg-green-500/10 text-green-500" : "bg-blue-500/10 text-blue-400"
                    }`}>
                      {selectedStage.status === "completed" ? "已完成" : "进行中"}
                    </Badge>
                    {!outlineConfirmed && (
                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400">
                        待确认大纲
                      </Badge>
                    )}
                    <div className="flex items-center gap-1.5 min-w-[100px]">
                      <Progress value={stageProgressPercent} className="h-1.5 w-20" />
                      <span className="text-[10px] text-muted-foreground">{stageProgressPercent}%</span>
                    </div>
                  </div>
                  <h2 className="text-xl font-bold">{selectedStage.title}</h2>
                  <div className="mt-2">
                    <LearningModeSwitcher
                      planId={plan.id}
                      value={plan.learning_mode || defaultLearningMode(plan.source_type || "goal")}
                      onChange={(mode) => setPlan((p) => (p ? { ...p, learning_mode: mode } : p))}
                    />
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant={plan.post_stage_review_enabled !== false ? "default" : "outline"}
                        size="sm"
                        className="rounded-lg text-xs h-8"
                        onClick={() => handleTogglePostStageReview(plan.post_stage_review_enabled === false)}
                      >
                        {plan.post_stage_review_enabled !== false ? "阶段复习：开" : "阶段复习：关"}
                      </Button>
                      <Button
                        type="button"
                        variant={plan.answer_time_limit_enabled ? "default" : "outline"}
                        size="sm"
                        className="rounded-lg text-xs h-8"
                        onClick={() => handleToggleTimeLimit(!plan.answer_time_limit_enabled)}
                      >
                        {plan.answer_time_limit_enabled ? "答题限时：开" : "答题限时：关"}
                      </Button>
                      {plan.answer_time_limit_enabled && (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min={10}
                            max={3600}
                            className="h-8 w-20 text-xs"
                            value={plan.answer_time_limit_seconds || DEFAULT_COUNTDOWN_SECONDS}
                            onChange={(e) => {
                              const seconds = Math.min(3600, Math.max(10, Number(e.target.value) || DEFAULT_COUNTDOWN_SECONDS));
                              setPlan((p) => (p ? { ...p, answer_time_limit_seconds: seconds } : p));
                            }}
                            onBlur={(e) => {
                              const seconds = Math.min(3600, Math.max(10, Number(e.target.value) || DEFAULT_COUNTDOWN_SECONDS));
                              void handleTimeLimitSeconds(seconds);
                            }}
                          />
                          <span className="text-[10px] text-muted-foreground">秒</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {(selectedStage.status === "active" || selectedStage.status === "completed") && (
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedStage.status === "completed" && selectedStage.post_review_status === "pending" && (
                      <Button
                        size="sm"
                        className="rounded-lg text-xs"
                        onClick={() => router.push(`/review?plan_id=${planId}&stage_id=${selectedStage.id}`)}
                      >
                        🔁 可选阶段复习
                      </Button>
                    )}
                    {selectedStage.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-lg text-xs text-muted-foreground"
                        onClick={handleSkipAssessment}
                        disabled={skippingAssess}
                      >
                        {skippingAssess ? "处理中..." : "⏭ 跳过检测"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg text-xs"
                      onClick={() => router.push(`/plan/${planId}/stage/${selectedStageId}/assess`)}
                    >
                      {selectedStage.status === "completed" ? "🔄 再次检测" : "✍️ 申请检测"}
                    </Button>
                  </div>
                )}
              </div>

              {/* 面板切换按钮 */}
              <div className="flex gap-1 flex-wrap">
                {([
                  { key: "learn" as RightPanel, label: "💬 AI 教学" },
                  { key: "outline" as RightPanel, label: "📋 大纲" },
                  { key: "progress" as RightPanel, label: `📈 进度 (${stageProgressPercent}%)` },
                  { key: "scenarios" as RightPanel, label: "🎬 场景" },
                  { key: "resources" as RightPanel, label: `📚 资料 (${resources.length})` },
                  { key: "project" as RightPanel, label: `🛠️ 实战项目` },
                  { key: "notes" as RightPanel, label: "📝 阶段笔记" },
                  { key: "info" as RightPanel, label: "📖 详情" },
                  { key: "assessments" as RightPanel, label: `📌 检测沉淀 (${assessmentHistory.length})` },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setRightPanel(tab.key)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                      rightPanel === tab.key
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    if (!selectedStageId) return;
                    if (selectedStage.status === "locked") {
                      toast.error("请先解锁该阶段");
                      return;
                    }
                    router.push(`/plan/${planId}/stage/${selectedStageId}/interview`);
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-medium transition-all text-muted-foreground hover:text-foreground hover:bg-card/50"
                >
                  🎤 面试模拟
                </button>
              </div>
            </div>

            {/* 面板内容 */}
            <div className="flex-1 overflow-hidden">
              {/* AI 教学面板 */}
              {rightPanel === "learn" && (
                !outlineConfirmed ? (
                  <StageOutlineGate
                    stageId={selectedStageId!}
                    sourceType={plan.source_type}
                    onConfirmed={handleOutlineConfirmed}
                  />
                ) : (
                <div className="h-full flex flex-col relative">
                  <TeachChatBackdrop bgId={bgId} customUrl={customUrl} />

                  <div className="relative z-30 shrink-0 px-6 pt-4 pb-2 flex flex-col gap-3">
                    <div className="flex items-center justify-end gap-2">
                      <TeachBackgroundPicker
                        bgId={bgId}
                        customUrl={customUrl}
                        onSelect={(id) => {
                          selectBackground(id);
                          const label = id === "custom" ? "自定义" : ({ aurora: "极光", dusk: "暮色", ink: "墨海", mint: "薄荷" } as const)[id];
                          toast.success(`背景已切换为「${label}」`);
                        }}
                        onUpload={async (file) => {
                          try {
                            await setCustomBackground(file);
                            toast.success("背景已更换");
                          } catch (e) {
                            toast.error((e as Error).message);
                            throw e;
                          }
                        }}
                        onClearCustom={clearCustomBackground}
                      />
                      {outlineConfirmed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-lg text-xs shrink-0 h-8 text-muted-foreground"
                          disabled={chatSending || !selectedStageId}
                          onClick={async () => {
                            if (!selectedStageId) return;
                            if (!confirm("清空本阶段教学对话，并按当前模式/职级重新开聊？")) return;
                            try {
                              const res = await fetch(`/api/stage/${selectedStageId}/chat`, { method: "DELETE" });
                              if (!res.ok) throw new Error("清空失败");
                              setChatMessages([]);
                              setChatLoadedFor(null);
                              await sendChatMessage("开始学习", selectedStageId);
                              setChatLoadedFor(selectedStageId);
                              toast.success("已按当前画像重新开聊");
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          重新开聊
                        </Button>
                      )}
                      {selectedStage.status === "active" && visibleMessages.length >= 2 && (
                        <Button
                          size="sm"
                          className="rounded-lg text-xs shrink-0 h-8"
                          onClick={() => router.push(`/plan/${planId}/stage/${selectedStageId}/assess`)}
                        >
                          申请检测
                        </Button>
                      )}
                    </div>
                    {selectedStage.status === "active" && visibleMessages.length >= 2 && (
                      <div className="px-3.5 py-2.5 rounded-xl border border-amber-400/20 bg-amber-500/10 backdrop-blur-sm">
                        <p className="text-xs text-amber-100/85">
                          学完本阶段后，通过「申请检测」解锁下一阶段
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="relative z-10 flex-1 overflow-y-auto px-6 py-3 space-y-5">
                    {visibleMessages.length === 0 && !chatSending && (
                      <div className="flex flex-col items-center py-16 text-center">
                        <div className="mb-4">
                          <TutorAvatarPicker avatarId={avatarId} onSelect={selectAvatar} size="md" />
                        </div>
                        <p className="text-base font-semibold mb-1.5 gradient-text">和导师开始对话</p>
                        <p className="text-xs text-muted-foreground/80 max-w-sm leading-relaxed">
                          点击头像可更换导师形象。回复中的重点词会用颜色与下划线标出。
                        </p>
                      </div>
                    )}

                    {visibleMessages.map((msg, i) => {
                      const isUser = msg.role === "user";
                      return (
                        <div
                          key={i}
                          className={`flex items-end gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          {!isUser && (
                            <TutorAvatarPicker avatarId={avatarId} onSelect={selectAvatar} size="sm" />
                          )}
                          <div
                            className={`max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-relaxed relative ${
                              isUser
                                ? "teach-bubble-user rounded-br-md"
                                : `teach-bubble-ai rounded-bl-md text-foreground/95 ${keywordHighlight ? "keyword-highlight-on" : ""}`
                            }`}
                          >
                            {isUser ? (
                              <div className="relative z-[1] space-y-2">
                                {msg.content.split("\n").map((line, j) => (
                                  <p key={j}>{line || "\u00A0"}</p>
                                ))}
                              </div>
                            ) : (
                              <div className="relative z-[1]">
                                <MarkdownRenderer content={msg.content} />
                              </div>
                            )}
                          </div>
                          {isUser && (
                            <LearnerAvatarPicker
                              avatarId={learnerAvatarId}
                              onSelect={selectLearnerAvatar}
                              size="sm"
                            />
                          )}
                        </div>
                      );
                    })}

                    {chatSending && (
                      <div className="flex justify-start items-end gap-2.5">
                        <TutorAvatarPicker avatarId={avatarId} onSelect={selectAvatar} size="sm" />
                        <div className="teach-bubble-ai rounded-2xl rounded-bl-md px-4 py-3.5">
                          <div className="flex gap-1.5">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="relative z-10 shrink-0 teach-input-dock px-6 py-4">
                    <div className="flex gap-2.5 max-w-3xl mx-auto items-end">
                      <Textarea
                        ref={inputRef}
                        placeholder="输入你的回答或问题...（Shift+Enter 换行）"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && chatInput.trim() && !chatSending) {
                            e.preventDefault();
                            sendChatMessage(chatInput.trim());
                          }
                        }}
                        disabled={chatSending}
                        rows={1}
                        className="flex-1 rounded-xl min-h-11 max-h-40 resize-y bg-background/45 border-border/40 focus-visible:border-primary/40 shadow-sm"
                      />
                      <Button
                        onClick={() => chatInput.trim() && sendChatMessage(chatInput.trim())}
                        disabled={!chatInput.trim() || chatSending}
                        className="rounded-xl px-5 h-11 shrink-0"
                      >
                        发送
                      </Button>
                    </div>
                  </div>
                </div>
                )
              )}

              {rightPanel === "outline" && selectedStageId && (
                <StageOutlineGate
                  stageId={selectedStageId}
                  sourceType={plan.source_type}
                  onConfirmed={handleOutlineConfirmed}
                />
              )}

              {rightPanel === "progress" && selectedStageId && (
                <StageProgressPanel
                  stageId={selectedStageId}
                  onPercentChange={setStageProgressPercent}
                />
              )}

              {rightPanel === "scenarios" && selectedStageId && (
                <StageScenariosPanel
                  stageId={selectedStageId}
                  onCompleted={() => refreshStageProgress()}
                />
              )}

              {/* 资料面板 */}
              {rightPanel === "resources" && (
                <div className="h-full overflow-y-auto px-8 py-6">
                  <div className="max-w-2xl">
                    {loadingResources ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
                    ) : resources.length === 0 ? (
                      <div className="py-12 text-center">
                        <span className="text-3xl block mb-3">📚</span>
                        <p className="text-sm text-muted-foreground mb-4">暂无学习资料</p>
                        <Button onClick={handleGenerateResources} disabled={generatingResources} className="rounded-lg">
                          {generatingResources ? "AI 推荐中..." : "让 AI 推荐资料"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold">学习资料</h3>
                          <span className="text-xs text-muted-foreground">{completedResources}/{resources.length} 已完成</span>
                        </div>
                        {resources.map((resource) => {
                          const isVerified = resource.search_source === "tavily" || resource.verified;
                          return (
                            <div
                              key={resource.id}
                              className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-border/20 bg-card/20 hover:bg-card/40 transition-colors ${
                                resource.is_completed ? "opacity-40" : ""
                              }`}
                            >
                              <button
                                onClick={() => handleToggleResource(resource.id, !resource.is_completed)}
                                className={`mt-0.5 w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 ${
                                  resource.is_completed ? "bg-primary border-primary" : "border-border/50 hover:border-primary/50"
                                }`}
                              >
                                {resource.is_completed && <span className="text-[10px] text-primary-foreground">✓</span>}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs">{typeIcons[resource.type] || "📄"}</span>
                                  <a href={resource.url} target="_blank" rel="noopener noreferrer"
                                    className={`text-sm hover:text-primary ${resource.is_completed ? "line-through" : "font-medium"}`}
                                  >{resource.title}</a>
                                  {isVerified && <span className="text-[10px] text-green-400">🔍</span>}
                                </div>
                                <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                                  {resource.source}{resource.estimated_minutes > 0 && ` · ${resource.estimated_minutes}min`}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        <button
                          onClick={handleGenerateResources}
                          disabled={generatingResources}
                          className="w-full py-2.5 rounded-xl border border-dashed border-border/30 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {generatingResources ? "加载中..." : "+ 获取更多资料"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 实战项目面板 */}
              {rightPanel === "project" && (
                <div className="h-full overflow-y-auto px-8 py-6">
                  <div className="max-w-2xl">
                    {project ? (
                      <div className="space-y-6">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-lg font-semibold">{project.title}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${
                                project.status === "completed" ? "bg-green-500/10 text-green-500"
                                : project.status === "in_progress" ? "bg-blue-500/10 text-blue-400"
                                : "bg-gray-500/10 text-gray-400"
                              }`}>
                                {project.status === "completed" ? "已完成" : project.status === "in_progress" ? "进行中" : "未开始"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {project.difficulty === "easy" ? "简单" : project.difficulty === "hard" ? "困难" : "中等"}
                                {" · "}约 {project.estimated_minutes} 分钟
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="px-5 py-4 rounded-xl border border-border/20 bg-card/20">
                          <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
                        </div>

                        <div>
                          <h4 className="text-sm font-medium mb-3">🎯 预期产出</h4>
                          <div className="px-5 py-4 rounded-xl bg-green-500/5 border border-green-500/10">
                            <p className="text-sm text-green-400/90">{project.expected_output}</p>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-medium">📋 完成步骤</h4>
                            <span className="text-xs text-muted-foreground">
                              {project.checklist.filter(c => c.completed).length}/{project.checklist.length}
                            </span>
                          </div>
                          <Progress
                            value={project.checklist.length > 0
                              ? (project.checklist.filter(c => c.completed).length / project.checklist.length) * 100
                              : 0}
                            className="h-1.5 mb-4"
                          />
                          <div className="space-y-2">
                            {project.checklist.map((item, i) => (
                              <div
                                key={i}
                                className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-border/20 bg-card/20 hover:bg-card/40 transition-colors cursor-pointer ${
                                  item.completed ? "opacity-50" : ""
                                }`}
                                onClick={() => handleToggleChecklist(i)}
                              >
                                <div className={`mt-0.5 w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 ${
                                  item.completed ? "bg-primary border-primary" : "border-border/50 hover:border-primary/50"
                                }`}>
                                  {item.completed && <span className="text-[10px] text-primary-foreground">✓</span>}
                                </div>
                                <span className={`text-sm ${item.completed ? "line-through text-muted-foreground" : ""}`}>
                                  {item.item}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center">
                        <span className="text-3xl block mb-3">🛠️</span>
                        <p className="text-sm text-muted-foreground mb-1">此阶段暂无实战项目</p>
                        <p className="text-xs text-muted-foreground/50">完成前一阶段评估后将自动生成</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 阶段笔记面板 */}
              {rightPanel === "notes" && (
                <div className="h-full overflow-y-auto px-8 py-6">
                  <div className="max-w-2xl space-y-6">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={handleGenerateAiSummary}
                        disabled={generatingSummary}
                        className="rounded-lg"
                      >
                        {generatingSummary ? "AI 总结中..." : "🤖 AI 总结本阶段"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleSaveUserNotes}
                        disabled={savingNotes}
                        className="rounded-lg"
                      >
                        {savingNotes ? "保存中..." : "💾 保存我的笔记"}
                      </Button>
                    </div>

                    {(() => {
                      const parsed = tryParseStructuredSummary(stageNote.ai_summary);
                      if (parsed) {
                        return (
                          <div className="space-y-5">
                            {/* One-line summary */}
                            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                              <p className="text-sm font-medium text-primary">
                                📌 {parsed.one_line_summary}
                              </p>
                            </div>

                            {/* Core Concepts */}
                            <div>
                              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                                <span>🧠</span> 核心概念掌握
                              </h3>
                              <div className="grid grid-cols-1 gap-2">
                                {parsed.core_concepts.map((c, i) => (
                                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-card/30 border border-border/20">
                                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                                      c.mastery === "solid" ? "bg-green-400" :
                                      c.mastery === "partial" ? "bg-amber-400" : "bg-red-400"
                                    }`} />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{c.name}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                          c.mastery === "solid" ? "bg-green-500/10 text-green-400" :
                                          c.mastery === "partial" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"
                                        }`}>
                                          {c.mastery === "solid" ? "掌握" : c.mastery === "partial" ? "部分" : "待加强"}
                                        </span>
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-0.5">{c.explanation}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Key Takeaways */}
                            <div>
                              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                                <span>💡</span> 关键收获
                              </h3>
                              <div className="space-y-1.5">
                                {parsed.key_takeaways.map((t, i) => (
                                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-green-500/5 border border-green-500/10">
                                    <span className="text-green-400 text-xs mt-0.5">✓</span>
                                    <p className="text-sm text-muted-foreground">{t}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Open Questions */}
                            {parsed.open_questions.length > 0 && (
                              <div>
                                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                                  <span>❓</span> 待深入问题
                                </h3>
                                <div className="space-y-1.5">
                                  {parsed.open_questions.map((q, i) => (
                                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                      <span className="text-amber-400 text-xs mt-0.5">?</span>
                                      <p className="text-sm text-muted-foreground">{q}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Next Actions */}
                            <div>
                              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                                <span>🎯</span> 下一步行动
                              </h3>
                              <div className="space-y-1.5">
                                {parsed.next_actions.map((a, i) => (
                                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
                                    <span className="text-blue-400 text-xs mt-0.5">→</span>
                                    <p className="text-sm text-muted-foreground">{a}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (stageNote.ai_summary) {
                        return (
                          <div>
                            <h3 className="text-sm font-medium mb-2">AI 阶段笔记</h3>
                            <div className="px-5 py-4 rounded-xl border border-border/20 bg-card/20 min-h-[120px] text-sm text-muted-foreground">
                              <MarkdownRenderer content={stageNote.ai_summary} />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="px-5 py-8 rounded-xl border border-dashed border-border/30 bg-card/10 text-center">
                          <span className="text-3xl mb-3 block">📝</span>
                          <p className="text-sm text-muted-foreground/60">
                            点击「AI 总结本阶段」，根据对话内容生成可视化学习总结
                          </p>
                        </div>
                      );
                    })()}

                    <div>
                      <h3 className="text-sm font-medium mb-2">我的整理</h3>
                      <Textarea
                        placeholder="在这里记录你的理解、疑问和心得..."
                        value={stageNote.user_notes}
                        onChange={(e) => setStageNote((prev) => ({ ...prev, user_notes: e.target.value }))}
                        className="min-h-[220px] max-h-[50vh] resize-y rounded-xl"
                      />
                      <p className="text-[11px] text-muted-foreground/60 mt-2">
                        支持多行输入，内容较长时可拖动右下角调整高度
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 检测沉淀面板 */}
              {rightPanel === "assessments" && (
                <div className="h-full overflow-y-auto px-8 py-6">
                  <div className="max-w-2xl space-y-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">检测沉淀</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          记录本阶段每次做题检测的分数、错题与反馈，方便复盘
                        </p>
                      </div>
                      {(selectedStage.status === "active" || selectedStage.status === "completed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-lg text-xs shrink-0"
                          onClick={() => router.push(`/plan/${planId}/stage/${selectedStageId}/assess`)}
                        >
                          {assessmentHistory.length > 0 ? "再次检测" : "去检测"}
                        </Button>
                      )}
                    </div>

                    {assessmentHistory.length === 0 ? (
                      <div className="px-5 py-10 rounded-xl border border-dashed border-border/30 bg-card/10 text-center">
                        <span className="text-3xl mb-3 block">📌</span>
                        <p className="text-sm text-muted-foreground">
                          完成本阶段学习后进行检测，结果会自动沉淀在这里
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {assessmentHistory.map((item) => {
                          const expanded = expandedAssessmentId === item.id;
                          return (
                            <div
                              key={item.id}
                              className="rounded-xl border border-border/30 bg-card/20 overflow-hidden"
                            >
                              <button
                                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
                                onClick={() => setExpandedAssessmentId(expanded ? null : item.id)}
                              >
                                <Badge
                                  variant="secondary"
                                  className={`text-[10px] px-2 py-0.5 ${
                                    item.type === "skipped"
                                      ? "bg-slate-500/10 text-slate-300"
                                      : item.passed
                                        ? "bg-green-500/10 text-green-400"
                                        : "bg-amber-500/10 text-amber-400"
                                  }`}
                                >
                                  {item.type === "skipped" ? "已跳过" : item.passed ? "通过" : "未通过"}
                                </Badge>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium">
                                    {item.type === "skipped"
                                      ? `第 ${item.attempt_number} 次 · 跳过检测`
                                      : `第 ${item.attempt_number} 次检测 · 总分 ${Math.round(item.score_overall)}`}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {new Date(item.created_at).toLocaleString("zh-CN")}
                                    {item.type !== "skipped" && (
                                      <>
                                        {" · "}覆盖 {Math.round(item.score_coverage)} / 深度 {Math.round(item.score_depth)} / 准确 {Math.round(item.score_accuracy)}
                                      </>
                                    )}
                                  </p>
                                </div>
                                <span className="text-muted-foreground text-xs">{expanded ? "收起" : "展开"}</span>
                              </button>

                              {expanded && (
                                <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
                                  {item.feedback && (
                                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                      {item.feedback}
                                    </p>
                                  )}
                                  {item.missing_topics?.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {item.missing_topics.map((t) => (
                                        <span key={t} className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-300 text-[11px]">
                                          待补强：{t}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {item.per_question_results?.length > 0 && (
                                    <div className="space-y-2">
                                      {item.per_question_results.map((q) => (
                                        <div key={q.question_index} className="px-3 py-2 rounded-lg bg-background/40 border border-border/20">
                                          <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-[11px] ${q.is_correct ? "text-green-400" : "text-red-400"}`}>
                                              {q.is_correct ? "✓" : "✗"} 第 {q.question_index + 1} 题 · {q.score} 分
                                            </span>
                                          </div>
                                          <p className="text-xs text-foreground/90 mb-1">{q.question_text}</p>
                                          {q.feedback && (
                                            <p className="text-[11px] text-muted-foreground">{q.feedback}</p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 详情面板 */}
              {rightPanel === "info" && (
                <div className="h-full overflow-y-auto px-8 py-6">
                  <div className="max-w-2xl space-y-8">
                    <div>
                      <h3 className="text-lg font-semibold mb-3">阶段说明</h3>
                      <p className="text-muted-foreground leading-relaxed">{selectedStage.description}</p>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold mb-3">知识点</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedStage.key_topics.map((topic) => (
                          <span key={topic} className="px-3 py-1.5 rounded-lg border border-border/40 bg-card/30 text-sm">
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>

                    {selectedStage.core_output && (
                      <div>
                        <h3 className="text-lg font-semibold mb-3">🎯 目标产出</h3>
                        <div className="px-5 py-4 rounded-xl bg-green-500/5 border border-green-500/10">
                          <p className="text-sm text-green-400/90">{selectedStage.core_output}</p>
                        </div>
                      </div>
                    )}

                    {selectedStage.summary_text && (
                      <div>
                        <h3 className="text-lg font-semibold mb-3">📖 导读</h3>
                        <div className="px-5 py-4 rounded-xl border border-border/20 bg-card/20 text-sm text-muted-foreground">
                          <MarkdownRenderer content={selectedStage.summary_text} />
                        </div>
                      </div>
                    )}

                    {selectedStage.real_world_cases && selectedStage.real_world_cases.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold mb-3">🌍 真实案例</h3>
                        <div className="space-y-2.5">
                          {selectedStage.real_world_cases.map((c, i) => (
                            <div key={i} className="px-5 py-4 rounded-xl border border-border/20 bg-card/20">
                              <p className="text-sm text-muted-foreground leading-relaxed">{c}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">← 选择一个阶段开始学习</p>
          </div>
        )}
      </main>
    </div>
  );
}

interface StructuredSummaryData {
  core_concepts: { name: string; explanation: string; mastery: "solid" | "partial" | "weak" }[];
  key_takeaways: string[];
  open_questions: string[];
  next_actions: string[];
  one_line_summary: string;
}

function tryParseStructuredSummary(text: string): StructuredSummaryData | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed.core_concepts && parsed.key_takeaways && parsed.one_line_summary) {
      return parsed as StructuredSummaryData;
    }
  } catch {
    // Not JSON - old markdown format
  }
  return null;
}
