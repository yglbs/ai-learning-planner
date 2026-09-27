"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { PLAN_TEMPLATES } from "@/config/templates";
import type { CareerIdentity, LearningMode } from "@/lib/learning-types";
import { defaultLearningMode } from "@/lib/learning-types";
import { readNdjsonResponse } from "@/lib/agent-stream";

type Step = "template" | "book" | "code" | "customize" | "dialogue" | "generating" | "preview";

interface GeneratedStage {
  title: string;
  description: string;
  key_topics: string[];
  estimated_days: number;
  core_output?: string;
  real_world_cases?: string[];
  assessment_questions?: string[];
}

const DIALOGUE_QUESTIONS = [
  {
    id: "motivation",
    icon: "🎯",
    title: "学习动机",
    question: "你为什么想学这个？最终目的是什么？",
    placeholder: "补充说明，让 AI 更理解你...",
    hint: "选一个最接近的，或直接输入",
    presets: [
      "找工作 / 转行",
      "自己做项目 / 创业",
      "投资研究 / 行业分析",
      "提升现有工作技能",
      "纯兴趣 / 个人成长",
      "考试 / 拿证",
    ],
  },
  {
    id: "background",
    icon: "👤",
    title: "当前背景",
    question: "你现在的相关基础怎么样？",
    placeholder: "补充具体情况...",
    hint: "选一个最接近的，或直接输入",
    presets: [
      "完全零基础，从没接触过",
      "了解一些基本概念",
      "有一定基础，做过简单实践",
      "有相关工作/学习经验",
      "相关专业在读或毕业",
    ],
  },
  {
    id: "outcome",
    icon: "🏁",
    title: "期望成果",
    question: "学完后你想达到什么程度？",
    placeholder: "补充你的具体期望...",
    hint: "选一个最接近的，或直接输入",
    presets: [
      "能找到相关领域的工作",
      "能独立完成一个完整项目",
      "能做出有依据的决策（投资/商业）",
      "通过相关考试或认证",
      "能深入理解并给别人讲清楚",
      "能建立系统的知识框架",
    ],
  },
];

export default function NewPlanPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("template");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [weeks, setWeeks] = useState(6);
  const [hours, setHours] = useState([2]);
  const [level, setLevel] = useState("beginner");
  const [learningMode, setLearningMode] = useState<LearningMode>("business");
  const [careerIdentity, setCareerIdentity] = useState<CareerIdentity>("");
  const [postStageReviewEnabled, setPostStageReviewEnabled] = useState(true);
  const [answerTimeLimitEnabled, setAnswerTimeLimitEnabled] = useState(true);
  const [answerTimeLimitSeconds, setAnswerTimeLimitSeconds] = useState(120);
  const [sourcePrompt, setSourcePrompt] = useState("");

  const [dialogueAnswers, setDialogueAnswers] = useState<Record<string, string>>({
    motivation: "",
    background: "",
    outcome: "",
  });
  const [dialogueIndex, setDialogueIndex] = useState(0);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadDragging, setUploadDragging] = useState(false);

  const [projectPath, setProjectPath] = useState("");
  const [projectValidated, setProjectValidated] = useState(false);
  const [projectValidating, setProjectValidating] = useState(false);
  const [projectMeta, setProjectMeta] = useState<{
    project_name: string;
    file_count: number;
    dir_count: number;
    preview_tree: string;
  } | null>(null);

  const [generatedPlan, setGeneratedPlan] = useState<{
    planId: string;
    plan: { plan_title: string; stages: GeneratedStage[] };
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [agentTraces, setAgentTraces] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.default_post_stage_review_enabled === "boolean") {
          setPostStageReviewEnabled(data.default_post_stage_review_enabled);
        }
        if (typeof data.default_answer_time_limit_enabled === "boolean") {
          setAnswerTimeLimitEnabled(data.default_answer_time_limit_enabled);
        }
        if (typeof data.default_answer_time_limit_seconds === "number") {
          setAnswerTimeLimitSeconds(data.default_answer_time_limit_seconds);
        }
      })
      .catch(() => {});
  }, []);

  function handleTemplateSelect(templateId: string) {
    const template = PLAN_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setGoal(template.goal);
      setWeeks(template.recommended_weeks);
      setHours([template.recommended_hours]);
    }
  }

  function handleDialogueNext() {
    if (dialogueIndex < DIALOGUE_QUESTIONS.length - 1) {
      setDialogueIndex(dialogueIndex + 1);
    } else {
      handleGenerate();
    }
  }

  async function handleGenerate() {
    if (!uploadedFile && !projectPath.trim() && !goal.trim()) {
      toast.error("请输入学习目标");
      return;
    }

    setStep("generating");
    setGenerating(true);
    setAgentTraces(
      projectPath.trim() || uploadedFile
        ? ["正在连接 Pi agent loop…"]
        : [],
    );

    try {
      let res: Response;

      if (projectPath.trim()) {
        res = await fetch("/api/plan/generate-from-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_path: projectPath.trim(),
            duration_weeks: weeks,
            daily_hours: hours[0],
            skill_level: level,
            learning_mode: learningMode,
            career_identity: careerIdentity,
            motivation: dialogueAnswers.motivation,
            background: dialogueAnswers.background,
            expected_outcome: dialogueAnswers.outcome,
            focus: sourcePrompt.trim(),
            post_stage_review_enabled: postStageReviewEnabled,
            answer_time_limit_enabled: answerTimeLimitEnabled,
            answer_time_limit_seconds: answerTimeLimitSeconds,
          }),
        });
      } else if (uploadedFile) {
        const formData = new FormData();
        formData.append("file", uploadedFile);
        formData.append("duration_weeks", String(weeks));
        formData.append("daily_hours", String(hours[0]));
        formData.append("skill_level", level);
        formData.append("learning_mode", learningMode);
        formData.append("career_identity", careerIdentity);
        formData.append("motivation", dialogueAnswers.motivation || "");
        formData.append("background", dialogueAnswers.background || "");
        formData.append("expected_outcome", dialogueAnswers.outcome || "");
        formData.append("focus", sourcePrompt.trim());
        formData.append("post_stage_review_enabled", String(postStageReviewEnabled));
        formData.append("answer_time_limit_enabled", String(answerTimeLimitEnabled));
        formData.append("answer_time_limit_seconds", String(answerTimeLimitSeconds));

        res = await fetch("/api/plan/generate-from-book", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: goal.trim(),
            duration_weeks: weeks,
            daily_hours: hours[0],
            skill_level: level,
            learning_mode: learningMode,
            career_identity: careerIdentity,
            motivation: dialogueAnswers.motivation,
            background: dialogueAnswers.background,
            expected_outcome: dialogueAnswers.outcome,
            post_stage_review_enabled: postStageReviewEnabled,
            answer_time_limit_enabled: answerTimeLimitEnabled,
            answer_time_limit_seconds: answerTimeLimitSeconds,
          }),
        });
      }

      if (!res.ok) {
        let errorMsg = "生成失败";
        try {
          const err = await res.json();
          errorMsg = err.error || errorMsg;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) errorMsg = `服务端错误: ${text.slice(0, 100)}`;
        }
        throw new Error(errorMsg);
      }

      const data = await readNdjsonResponse(res, (text) => {
        setAgentTraces((prev) => [...prev, text]);
      });
      setGeneratedPlan({
        planId: String(data.planId),
        plan: data.plan as { plan_title: string; stages: GeneratedStage[] },
      });
      setStep("preview");
    } catch (e) {
      toast.error((e as Error).message);
      setStep("dialogue");
      setDialogueIndex(DIALOGUE_QUESTIONS.length - 1);
    } finally {
      setGenerating(false);
    }
  }

  const currentQ = DIALOGUE_QUESTIONS[dialogueIndex];
  const allAnswered = DIALOGUE_QUESTIONS.every(
    (q) => dialogueAnswers[q.id]?.trim()
  );

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-radial from-primary/6 via-transparent to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-[400px] h-[400px] bg-gradient-radial from-chart-4/4 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      <header className="border-b border-border/40 px-6 py-4 bg-card/40 backdrop-blur-md relative z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-2.5">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")} className="text-muted-foreground hover:text-foreground">
            ← 返回
          </Button>
          <h1 className="text-lg font-semibold">创建学习计划</h1>
          <div className="ml-auto flex gap-1.5">
            {(projectPath.trim()
              ? ["template", "code", "customize", "dialogue", "generating", "preview"]
              : uploadedFile
                ? ["template", "book", "customize", "dialogue", "generating", "preview"]
                : ["template", "customize", "dialogue", "generating", "preview"]
            ).map((s, i, arr) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-all ${
                  s === step ? "bg-primary w-6" : i < arr.indexOf(step) ? "bg-primary/50" : "bg-border/40"
                }`}
              />
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 relative z-10">
        <div className="max-w-3xl mx-auto">
          {step === "template" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold gradient-text mb-3">选择学习方向</h2>
                <p className="text-muted-foreground">
                  选择预设模板快速开始，或自定义你的学习目标
                </p>
              </div>

              <div className="grid gap-4">
                {PLAN_TEMPLATES.map((template) => (
                  <div
                    key={template.id}
                    className={`glass-card rounded-xl p-5 cursor-pointer transition-all hover:border-primary/30 ${
                      selectedTemplate === template.id
                        ? "border-primary/50 ring-1 ring-primary/30 bg-primary/5"
                        : ""
                    }`}
                    onClick={() => handleTemplateSelect(template.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center border border-primary/10 shrink-0">
                        <span className="text-2xl">{template.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold mb-0.5">{template.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-1">{template.description}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          {template.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs bg-secondary/50 border border-border/30">
                              {tag}
                            </Badge>
                          ))}
                          <span className="text-xs text-muted-foreground/70 ml-auto">
                            {template.recommended_weeks} 周 · {template.recommended_hours}h/天
                          </span>
                        </div>
                      </div>
                      {selectedTemplate === template.id && (
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <span className="text-xs text-primary-foreground">✓</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  className="flex-1 h-12 rounded-xl glow-primary font-medium"
                  onClick={() => {
                    setLearningMode(defaultLearningMode("goal"));
                    setStep("customize");
                  }}
                  disabled={!selectedTemplate}
                >
                  使用模板 →
                </Button>
                <Button
                  variant="outline"
                  className="h-12 rounded-xl border-border/50 px-6"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setGoal("");
                    setLearningMode(defaultLearningMode("goal"));
                    setStep("customize");
                  }}
                >
                  自定义目标
                </Button>
                <Button
                  variant="outline"
                  className="h-12 rounded-xl border-border/50 px-6"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setUploadedFile(null);
                    setProjectPath("");
                    setProjectValidated(false);
                    setLearningMode(defaultLearningMode("book"));
                    setStep("book");
                  }}
                >
                  📖 上传书籍
                </Button>
                <Button
                  variant="outline"
                  className="h-12 rounded-xl border-border/50 px-6"
                  onClick={() => {
                    setSelectedTemplate(null);
                    setUploadedFile(null);
                    setProjectPath("");
                    setProjectValidated(false);
                    setLearningMode(defaultLearningMode("code"));
                    setStep("code");
                  }}
                >
                  💻 从代码学习
                </Button>
              </div>
            </div>
          )}

          {step === "book" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold gradient-text mb-3">上传书籍</h2>
                <p className="text-muted-foreground">
                  上传一本书。生成计划时会分段阅读全文，不再只截取前几万字
                </p>
              </div>

              <div
                className={`glass-card rounded-xl p-8 border-2 border-dashed transition-all cursor-pointer ${
                  uploadDragging
                    ? "border-primary/60 bg-primary/5"
                    : uploadedFile
                      ? "border-green-500/40 bg-green-500/5"
                      : "border-border/40 hover:border-primary/30"
                }`}
                onDragOver={(e) => { e.preventDefault(); setUploadDragging(true); }}
                onDragLeave={() => setUploadDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setUploadDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    const valid = file.name.endsWith(".pdf") || file.name.endsWith(".txt") || file.name.endsWith(".md");
                    if (valid) {
                      setUploadedFile(file);
                      setGoal(`阅读学习《${file.name.replace(/\.(pdf|txt|md)$/i, "")}》`);
                    } else {
                      toast.error("仅支持 PDF、TXT、Markdown 格式");
                    }
                  }
                }}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".pdf,.txt,.md";
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      setUploadedFile(file);
                      setGoal(`阅读学习《${file.name.replace(/\.(pdf|txt|md)$/i, "")}》`);
                    }
                  };
                  input.click();
                }}
              >
                <div className="flex flex-col items-center gap-4 text-center">
                  {uploadedFile ? (
                    <>
                      <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                        <span className="text-3xl">📗</span>
                      </div>
                      <div>
                        <p className="text-base font-semibold text-green-400">{uploadedFile.name}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB · 点击可更换文件
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <span className="text-3xl">📖</span>
                      </div>
                      <div>
                        <p className="text-base font-medium">拖拽文件到这里，或点击选择</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          支持 PDF、TXT、Markdown 格式
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep("template")} className="h-12 rounded-xl border-border/50 px-6">
                  ← 返回
                </Button>
                <Button
                  className="flex-1 h-12 rounded-xl glow-primary font-medium"
                  onClick={() => setStep("customize")}
                  disabled={!uploadedFile}
                >
                  下一步：设置参数 →
                </Button>
              </div>
            </div>
          )}

          {step === "code" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold gradient-text mb-3">从代码学习</h2>
                <p className="text-muted-foreground">
                  对着真实仓库学：优先读入口与主链路，教学过程会持续引用具体文件与函数
                </p>
              </div>

              <div className="glass-card rounded-xl p-6 space-y-5">
                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">📁</span> 本地项目路径
                  </Label>
                  <div className="flex gap-3">
                    <Input
                      placeholder="例：~/projects/my-app 或 /Users/xxx/code/project"
                      value={projectPath}
                      onChange={(e) => {
                        setProjectPath(e.target.value);
                        setProjectValidated(false);
                        setProjectMeta(null);
                      }}
                      className="flex-1 h-12 rounded-xl bg-background/50 border-border/40 focus:border-primary/50 font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      className="h-12 rounded-xl border-border/50 px-5 shrink-0"
                      disabled={!projectPath.trim() || projectValidating}
                      onClick={async () => {
                        setProjectValidating(true);
                        try {
                          const res = await fetch("/api/plan/generate-from-code", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ project_path: projectPath.trim(), validate_only: true }),
                          });
                          if (!res.ok) {
                            const err = await res.json();
                            toast.error(err.error || "路径无效");
                            setProjectValidated(false);
                            setProjectMeta(null);
                          } else {
                            const data = await res.json();
                            setProjectValidated(true);
                            setProjectMeta({
                              project_name: data.project_name || "",
                              file_count: data.file_count || 0,
                              dir_count: data.dir_count || 0,
                              preview_tree: data.preview_tree || "",
                            });
                            setGoal(`深入学习项目「${data.project_name}」的代码实现`);
                            toast.success(`已识别 ${data.file_count} 个源码文件`);
                          }
                        } catch {
                          toast.error("验证失败");
                          setProjectValidated(false);
                          setProjectMeta(null);
                        } finally {
                          setProjectValidating(false);
                        }
                      }}
                    >
                      {projectValidating ? "扫描中..." : "扫描项目"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    会按需打开仓库里的源码（忽略 node_modules、.git 和密钥文件），不再只截取前 120KB
                  </p>
                </div>

                {projectValidated && projectMeta && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-500/5 border border-green-500/20">
                      <span className="text-base">✅</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-green-400">
                          已识别「{projectMeta.project_name}」· {projectMeta.file_count} 个文件 / {projectMeta.dir_count} 个目录
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{projectPath}</p>
                      </div>
                    </div>
                    {projectMeta.preview_tree && (
                      <pre className="px-4 py-3 rounded-xl bg-background/50 border border-border/30 text-[11px] text-muted-foreground overflow-x-auto max-h-48 overflow-y-auto font-mono leading-relaxed">
                        {projectMeta.preview_tree}
                      </pre>
                    )}
                  </div>
                )}

                <div className="px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <span>💡</span> 强化后的学习方式
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">1.</span>
                      <span>按入口 → 主调用链 → 核心模块拆阶段，并标注精读文件</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">2.</span>
                      <span>保留项目路径，后续 AI 教学会回读相关源码并引用具体函数</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">3.</span>
                      <span>检测题与面试模拟都围绕真实代码设计，而不是空泛概念</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">4.</span>
                      <span>用「打开某文件回答问题」的方式推进，逼你真正读懂代码</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => { setProjectPath(""); setProjectValidated(false); setLearningMode(defaultLearningMode("goal")); setStep("template"); }} className="h-12 rounded-xl border-border/50 px-6">
                  ← 返回
                </Button>
                <Button
                  className="flex-1 h-12 rounded-xl glow-primary font-medium"
                  onClick={() => {
                    setLearningMode(defaultLearningMode("code"));
                    setStep("customize");
                  }}
                  disabled={!projectValidated}
                >
                  下一步：设置参数 →
                </Button>
              </div>
            </div>
          )}

          {step === "customize" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold gradient-text mb-3">定制你的计划</h2>
                <p className="text-muted-foreground">告诉我你想学什么，以及你想投入多少精力</p>
              </div>

              <div className="glass-card rounded-xl p-6 space-y-7">
                <div className="space-y-2.5">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">🎯</span> 学习目标
                  </Label>
                  {projectPath.trim() ? (
                    <div className="flex items-center gap-3 h-12 px-4 rounded-xl bg-green-500/5 border border-green-500/20">
                      <span className="text-base">💻</span>
                      <span className="text-sm font-medium text-green-400 font-mono truncate">{projectPath}</span>
                      <button
                        onClick={() => { setProjectPath(""); setProjectValidated(false); setGoal(""); setSourcePrompt(""); setLearningMode(defaultLearningMode("code")); setStep("code"); }}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground shrink-0"
                      >
                        更换
                      </button>
                    </div>
                  ) : uploadedFile ? (
                    <div className="flex items-center gap-3 h-12 px-4 rounded-xl bg-green-500/5 border border-green-500/20">
                      <span className="text-base">📗</span>
                      <span className="text-sm font-medium text-green-400">{uploadedFile.name}</span>
                      <button
                        onClick={() => { setUploadedFile(null); setGoal(""); setSourcePrompt(""); setStep("book"); }}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                      >
                        更换
                      </button>
                    </div>
                  ) : (
                    <>
                      <Input
                        placeholder="例：投资存储行业研究、AI应用开发、商务英语提升..."
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        className="h-12 rounded-xl bg-background/50 border-border/40 focus:border-primary/50"
                      />
                      <p className="text-xs text-muted-foreground/70">
                        可以是任何领域 — 技术、投资、语言、商业、人文等
                      </p>
                    </>
                  )}
                </div>

                {(projectPath.trim() || uploadedFile) && (
                  <div className="space-y-2.5">
                    <Label className="text-base font-medium flex items-center gap-2">
                      <span className="text-lg">✏️</span> 补充提示
                    </Label>
                    <Textarea
                      placeholder={
                        projectPath.trim()
                          ? "例：重点看直播链路和 gRPC 入口，先讲业务接口再讲存储"
                          : "例：重点看估值方法那一章，跳过前言和附录"
                      }
                      value={sourcePrompt}
                      onChange={(e) => setSourcePrompt(e.target.value)}
                      className="min-h-24 rounded-xl bg-background/50 border-border/40 focus:border-primary/50"
                    />
                    <p className="text-xs text-muted-foreground/70">
                      会写进生成计划的提示词，用来指定想先看的模块、章节或问题。留空则按材料本身来规划。
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">📐</span> 研究深度
                  </Label>
                  <RadioGroup
                    value={String(weeks)}
                    onValueChange={(v) => setWeeks(parseInt(v))}
                    className="grid grid-cols-2 gap-3"
                  >
                    {[
                      { value: 2, label: "快速了解", desc: "~2周，抓住核心要点", icon: "⚡" },
                      { value: 4, label: "系统学习", desc: "~1个月，建立知识框架", icon: "📚" },
                      { value: 8, label: "深度研究", desc: "~2个月，全面深入", icon: "🔬" },
                      { value: 12, label: "精通之路", desc: "~3个月，专家级理解", icon: "🏆" },
                    ].map((item) => (
                      <label
                        key={item.value}
                        className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                          weeks === item.value
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/40 hover:border-border/60"
                        }`}
                      >
                        <RadioGroupItem value={String(item.value)} className="sr-only" />
                        <span className="text-xl">{item.icon}</span>
                        <div>
                          <span className={`text-sm font-medium block ${weeks === item.value ? "text-primary" : ""}`}>{item.label}</span>
                          <span className="text-xs text-muted-foreground/70">{item.desc}</span>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">⏰</span> 每日投入: <span className="text-primary">{hours[0]} 小时</span>
                  </Label>
                  <div className="px-1">
                    <Slider
                      value={hours}
                      onValueChange={(v) => setHours(Array.isArray(v) ? v : [v])}
                      min={0.5}
                      max={8}
                      step={0.5}
                      className="py-2"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground/60 px-1">
                    <span>0.5h 碎片时间</span>
                    <span>8h 全天投入</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">📊</span> 相关经验
                  </Label>
                  <RadioGroup
                    value={level}
                    onValueChange={setLevel}
                    className="flex gap-3"
                  >
                    {[
                      { value: "beginner", label: "完全不了解", icon: "🌱" },
                      { value: "intermediate", label: "知道一些", icon: "🌿" },
                      { value: "advanced", label: "有一定研究", icon: "🌳" },
                    ].map((item) => (
                      <label
                        key={item.value}
                        className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border cursor-pointer transition-all ${
                          level === item.value
                            ? "border-primary/50 bg-primary/5 text-primary"
                            : "border-border/40 hover:border-border/60"
                        }`}
                      >
                        <RadioGroupItem value={item.value} id={`level-${item.value}`} className="sr-only" />
                        <span>{item.icon}</span>
                        <span className="text-sm font-medium">{item.label}</span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">🧭</span> 学习模式
                  </Label>
                  <RadioGroup
                    value={learningMode}
                    onValueChange={(v) => setLearningMode(v as LearningMode)}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                  >
                    {[
                      { value: "business" as LearningMode, label: "业务视角", desc: "关注价值与决策" },
                      { value: "technical" as LearningMode, label: "技术深入", desc: "机制与实现细节" },
                      { value: "business_through_tech" as LearningMode, label: "业务×技术", desc: "用代码理解业务" },
                    ].map((item) => (
                      <label
                        key={item.value}
                        className={`flex flex-col gap-1 p-3.5 rounded-xl border cursor-pointer transition-all ${
                          learningMode === item.value
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/40 hover:border-border/60"
                        }`}
                      >
                        <RadioGroupItem value={item.value} className="sr-only" />
                        <span className={`text-sm font-medium ${learningMode === item.value ? "text-primary" : ""}`}>
                          {item.label}
                        </span>
                        <span className="text-xs text-muted-foreground/70">{item.desc}</span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">👔</span> 职业身份
                  </Label>
                  <RadioGroup
                    value={careerIdentity || "none"}
                    onValueChange={(v) => setCareerIdentity((v === "none" ? "" : v) as CareerIdentity)}
                    className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                  >
                    {[
                      { value: "none", label: "不指定" },
                      { value: "junior", label: "初级" },
                      { value: "senior", label: "高级" },
                      { value: "staff", label: "资深" },
                    ].map((item) => (
                      <label
                        key={item.value}
                        className={`flex items-center justify-center h-11 rounded-xl border cursor-pointer transition-all ${
                          (careerIdentity || "none") === item.value
                            ? "border-primary/50 bg-primary/5 text-primary"
                            : "border-border/40 hover:border-border/60"
                        }`}
                      >
                        <RadioGroupItem value={item.value} className="sr-only" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-3 pt-1">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">🔁</span> 阶段后复习
                  </Label>
                  <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/40">
                    <p className="text-xs text-muted-foreground leading-relaxed pr-3">
                      阶段检测通过后会生成一轮即时复习，可选做，不挡住下一阶段。
                    </p>
                    <Button
                      type="button"
                      variant={postStageReviewEnabled ? "default" : "outline"}
                      size="sm"
                      className="shrink-0"
                      onClick={() => setPostStageReviewEnabled((v) => !v)}
                    >
                      {postStageReviewEnabled ? "已开启" : "已关闭"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <span className="text-lg">⏱️</span> 答题限时失败
                  </Label>
                  <div className="p-4 rounded-xl border border-border/40 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground leading-relaxed pr-3">
                        可开可关。开启后，检测 / 面试 / 阶段复习会统计作答时间；超时本题或本轮直接失败。
                      </p>
                      <Button
                        type="button"
                        variant={answerTimeLimitEnabled ? "default" : "outline"}
                        size="sm"
                        className="shrink-0"
                        onClick={() => setAnswerTimeLimitEnabled((v) => !v)}
                      >
                        {answerTimeLimitEnabled ? "已开启" : "已关闭"}
                      </Button>
                    </div>
                    {answerTimeLimitEnabled && (
                      <div className="flex items-center gap-3">
                        <Label className="text-xs text-muted-foreground shrink-0">限时秒数</Label>
                        <Input
                          type="number"
                          min={10}
                          max={3600}
                          value={answerTimeLimitSeconds}
                          onChange={(e) => setAnswerTimeLimitSeconds(Math.min(3600, Math.max(10, Number(e.target.value) || 120)))}
                          className="h-9 rounded-lg bg-background/50 border-border/40 w-28 text-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep("template")} className="h-12 rounded-xl border-border/50 px-6">
                  ← 返回选择
                </Button>
                <Button className="flex-1 h-12 rounded-xl glow-primary font-medium text-base" onClick={() => setStep("dialogue")}>
                  下一步：了解你 →
                </Button>
              </div>
            </div>
          )}

          {step === "dialogue" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold gradient-text mb-3">先聊几个问题</h2>
                <p className="text-muted-foreground">
                  帮我更好地了解你，才能制定真正适合你的计划
                </p>
              </div>

              <div className="flex justify-center gap-2 mb-6">
                {DIALOGUE_QUESTIONS.map((q, i) => (
                  <button
                    key={q.id}
                    onClick={() => setDialogueIndex(i)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all ${
                      i === dialogueIndex
                        ? "bg-primary/10 border border-primary/30 text-primary font-medium"
                        : dialogueAnswers[q.id]?.trim()
                          ? "bg-green-500/5 border border-green-500/20 text-green-400/80"
                          : "bg-card/40 border border-border/30 text-muted-foreground"
                    }`}
                  >
                    <span>{q.icon}</span>
                    <span className="hidden sm:inline">{q.title}</span>
                    {dialogueAnswers[q.id]?.trim() && <span className="text-xs">✓</span>}
                  </button>
                ))}
              </div>

              <div className="glass-card rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center border border-primary/10">
                    <span className="text-xl">{currentQ.icon}</span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">{currentQ.question}</h3>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">{currentQ.hint}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {currentQ.presets.map((preset) => {
                    const currentVal = dialogueAnswers[currentQ.id] || "";
                    const isSelected = currentVal.startsWith(preset);
                    return (
                      <button
                        key={preset}
                        onClick={() => {
                          if (isSelected) {
                            setDialogueAnswers({ ...dialogueAnswers, [currentQ.id]: "" });
                          } else {
                            setDialogueAnswers({ ...dialogueAnswers, [currentQ.id]: preset });
                          }
                        }}
                        className={`px-3 py-2 rounded-xl text-sm transition-all border ${
                          isSelected
                            ? "bg-primary/10 border-primary/30 text-primary font-medium"
                            : "bg-card/50 border-border/30 text-muted-foreground hover:border-border/60 hover:text-foreground"
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>

                <Textarea
                  placeholder={currentQ.placeholder}
                  value={
                    currentQ.presets.includes(dialogueAnswers[currentQ.id] || "")
                      ? ""
                      : (dialogueAnswers[currentQ.id] || "")
                  }
                  onChange={(e) => {
                    const presetMatch = currentQ.presets.find((p) =>
                      (dialogueAnswers[currentQ.id] || "").startsWith(p)
                    );
                    if (presetMatch && e.target.value) {
                      setDialogueAnswers({
                        ...dialogueAnswers,
                        [currentQ.id]: presetMatch + "：" + e.target.value,
                      });
                    } else {
                      setDialogueAnswers({
                        ...dialogueAnswers,
                        [currentQ.id]: e.target.value,
                      });
                    }
                  }}
                  rows={2}
                  className="rounded-xl bg-background/50 border-border/40 focus:border-primary/50 resize-none text-sm"
                />

                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground/50">
                    {dialogueIndex + 1} / {DIALOGUE_QUESTIONS.length}
                  </p>
                  <div className="flex gap-2">
                    {dialogueIndex > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialogueIndex(dialogueIndex - 1)}
                      >
                        ← 上一题
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={handleDialogueNext}
                      disabled={!dialogueAnswers[currentQ.id]?.trim()}
                    >
                      {dialogueIndex < DIALOGUE_QUESTIONS.length - 1
                        ? "下一题 →"
                        : "生成计划 →"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep("customize")} className="h-10 rounded-xl border-border/50 px-4 text-sm">
                  ← 修改参数
                </Button>
                {allAnswered && (
                  <Button className="flex-1 h-10 rounded-xl glow-primary font-medium" onClick={handleGenerate}>
                    跳到生成 →
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === "generating" && (
            <GeneratingView
              isBook={!!uploadedFile}
              isCode={!!projectPath.trim()}
              traces={agentTraces}
            />
          )}

          {step === "preview" && generatedPlan && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 mb-4">
                  <span className="text-3xl">✅</span>
                </div>
                <h2 className="text-3xl font-bold gradient-text mb-3">
                  {generatedPlan.plan.plan_title}
                </h2>
                <p className="text-muted-foreground">
                  共 {generatedPlan.plan.stages.length} 个阶段 · {weeks} 周 · 每天 {hours[0]} 小时
                </p>
              </div>

              <div className="space-y-3">
                {generatedPlan.plan.stages.map((stage, i) => (
                  <div key={i} className="glass-card rounded-xl p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-bold text-primary border border-primary/10 shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <h3 className="font-semibold">{stage.title}</h3>
                          <span className="text-xs text-muted-foreground/70 shrink-0 ml-2">
                            {stage.estimated_days} 天
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {stage.description}
                        </p>
                        {stage.core_output && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/10 mb-2">
                            <span className="text-xs shrink-0 mt-0.5">🏁</span>
                            <span className="text-xs text-green-400/80">产出: {stage.core_output}</span>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {stage.key_topics.map((topic) => (
                            <Badge key={topic} variant="outline" className="text-xs border-border/30 bg-background/30">
                              {topic}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="h-12 rounded-xl border-border/50 px-6"
                  onClick={() => {
                    setGeneratedPlan(null);
                    setStep("dialogue");
                    setDialogueIndex(0);
                  }}
                >
                  重新生成
                </Button>
                <Button
                  className="flex-1 h-12 rounded-xl glow-primary font-medium text-base"
                  onClick={() => router.push(`/plan/${generatedPlan.planId}`)}
                >
                  确认并开始学习 →
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const GENERATING_STEPS = [
  { icon: "🔍", text: "分析学习目标和你的背景...", duration: 3000 },
  { icon: "🧩", text: "拆解知识体系...", duration: 5000 },
  { icon: "📐", text: "规划实操优先的学习路线...", duration: 8000 },
  { icon: "🌍", text: "收集真实案例...", duration: 12000 },
  { icon: "📚", text: "编排学习内容...", duration: 20000 },
  { icon: "❓", text: "设计思考题...", duration: 25000 },
  { icon: "🔧", text: "搜索学习资源...", duration: 30000 },
  { icon: "✨", text: "即将完成...", duration: 60000 },
];

const BOOK_GENERATING_STEPS = [
  { icon: "📖", text: "解析书籍内容...", duration: 3000 },
  { icon: "📑", text: "分析章节结构...", duration: 6000 },
  { icon: "🧩", text: "提取核心知识点...", duration: 10000 },
  { icon: "📐", text: "规划阶段化学习路线...", duration: 15000 },
  { icon: "✍️", text: "编写学习导读...", duration: 25000 },
  { icon: "❓", text: "设计检测题...", duration: 35000 },
  { icon: "✨", text: "即将完成...", duration: 60000 },
];

const CODE_GENERATING_STEPS = [
  { icon: "📁", text: "扫描项目文件结构...", duration: 2000 },
  { icon: "📖", text: "读取源代码文件...", duration: 5000 },
  { icon: "🔍", text: "分析代码架构和模块...", duration: 10000 },
  { icon: "🧩", text: "识别设计模式和技术栈...", duration: 15000 },
  { icon: "📐", text: "规划代码学习路线...", duration: 22000 },
  { icon: "✍️", text: "编写代码解读导读...", duration: 30000 },
  { icon: "❓", text: "设计代码理解检测题...", duration: 40000 },
  { icon: "✨", text: "即将完成...", duration: 60000 },
];

function GeneratingView({
  isBook = false,
  isCode = false,
  traces = [],
}: {
  isBook?: boolean;
  isCode?: boolean;
  traces?: string[];
}) {
  const steps = isCode ? CODE_GENERATING_STEPS : isBook ? BOOK_GENERATING_STEPS : GENERATING_STEPS;
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const startRef = useRef(Date.now());
  const traceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const diff = now - startRef.current;
      setElapsed(Math.floor(diff / 1000));
      const p = Math.min(95, (1 - Math.exp(-diff / 40000)) * 100);
      setProgress(p);
    }, 300);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (traceRef.current) traceRef.current.scrollTop = traceRef.current.scrollHeight;
  }, [traces]);

  const currentStep = steps.reduce(
    (acc, s, i) => (elapsed * 1000 >= s.duration ? i : acc),
    0
  );

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-10">
      <div className="relative w-32 h-32">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" strokeWidth="4" className="text-border/20" />
          <circle
            cx="64" cy="64" r="56" fill="none" stroke="url(#progressGrad)" strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 56}`}
            strokeDashoffset={`${2 * Math.PI * 56 * (1 - progress / 100)}`}
            className="transition-all duration-500 ease-out"
          />
          <defs>
            <linearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--chart-2))" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-primary">{Math.round(progress)}%</span>
        </div>
      </div>

      <div className="text-center space-y-3 max-w-sm">
        <h2 className="text-2xl font-bold gradient-text">
          {isCode ? "AI 正在分析代码并生成学习计划" : isBook ? "AI 正在解析书籍并生成学习计划" : "AI 正在为你定制学习计划"}
        </h2>
        <p className="text-muted-foreground/80 text-sm">
          {minutes > 0 ? `${minutes}分${seconds.toString().padStart(2, "0")}秒` : `${seconds}秒`}
        </p>
      </div>

      {(isCode || isBook) ? (
        <div className="w-full max-w-md space-y-2">
          <p className="text-xs font-medium text-primary">Pi agent loop 读取记录</p>
          <div ref={traceRef} className="max-h-56 overflow-y-auto rounded-xl border border-border/40 bg-background/40 px-4 py-3 space-y-1.5 font-mono text-xs">
            {traces.length === 0 ? (
              <p className="text-muted-foreground">等待 Pi agent loop…</p>
            ) : traces.map((line, i) => (
              <p key={`${i}-${line}`} className={i === traces.length - 1 ? "text-foreground" : "text-muted-foreground"}>
                {line}
              </p>
            ))}
          </div>
        </div>
      ) : (
      <div className="w-full max-w-xs space-y-2.5">
        {steps.slice(0, Math.min(currentStep + 2, steps.length)).map((s, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-500 ${
                isCurrent
                  ? "glass-card bg-primary/5"
                  : isDone
                    ? "opacity-50"
                    : "opacity-30"
              }`}
            >
              <span className="text-base">{isDone ? "✅" : s.icon}</span>
              <span className={`text-sm ${isCurrent ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {s.text}
              </span>
              {isCurrent && (
                <div className="ml-auto flex gap-1">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${j * 0.15}s` }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      <p className="text-xs text-muted-foreground/40 max-w-xs text-center">
        {isCode ? "分析代码项目可能需要 1-3 分钟，取决于项目大小" : isBook ? "解析书籍内容可能需要 1-2 分钟" : "首次生成可能需要 30-60 秒，取决于 AI 服务响应速度"}
      </p>
    </div>
  );
}
