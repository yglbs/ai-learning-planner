"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  InterviewCountdownBar,
  InterviewCountdownToggle,
  InterviewLateBanner,
  buildCountdownRequestFields,
  DEFAULT_COUNTDOWN_SECONDS,
} from "@/components/interview-countdown";

interface PlanSummary {
  id: string;
  title: string;
  status: string;
  total_stages: number;
}

interface ChatMsg {
  role: string;
  content: string;
  answer_deadline_at?: string | null;
}

type InterviewStyle = "friendly" | "standard" | "tough";

const STYLES: { id: InterviewStyle; icon: string; name: string; desc: string }[] = [
  { id: "friendly", icon: "😊", name: "友善引导", desc: "像和同事聊天，轻松愉快" },
  { id: "standard", icon: "👔", name: "标准技术面", desc: "模拟真实面试流程" },
  { id: "tough", icon: "🔥", name: "压力面试", desc: "深挖细节，持续追问" },
];

export default function MultiInterviewPage() {
  const router = useRouter();

  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [style, setStyle] = useState<InterviewStyle | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(DEFAULT_COUNTDOWN_SECONDS);
  const [answerDeadlineAt, setAnswerDeadlineAt] = useState<string | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [isLate, setIsLate] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/plan?all=true")
      .then((r) => r.json())
      .then((data) => setPlans(Array.isArray(data) ? data : []))
      .catch(() => toast.error("加载计划失败"))
      .finally(() => setLoadingPlans(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function togglePlan(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) {
        toast.error("最多选择 5 个计划");
        return prev;
      }
      return [...prev, id];
    });
  }

  function applyReplyMeta(reply: {
    answer_deadline_at?: string | null;
    server_now?: string;
    is_late?: boolean;
    countdown_enabled?: boolean;
    countdown_seconds?: number;
    session_key?: string;
  }) {
    if (reply.session_key) setSessionKey(reply.session_key);
    if (reply.answer_deadline_at !== undefined) setAnswerDeadlineAt(reply.answer_deadline_at || null);
    if (reply.server_now) setServerNow(reply.server_now);
    if (typeof reply.is_late === "boolean") setIsLate(reply.is_late);
    if (typeof reply.countdown_enabled === "boolean") setCountdownEnabled(reply.countdown_enabled);
    if (typeof reply.countdown_seconds === "number") setCountdownSeconds(reply.countdown_seconds);
  }

  async function startInterview(s: InterviewStyle) {
    if (selectedIds.length < 2) {
      toast.error("请至少选择 2 个计划");
      return;
    }
    setStyle(s);
    setSending(true);
    setIsLate(false);
    try {
      const countdown = buildCountdownRequestFields({
        enabled: countdownEnabled,
        seconds: countdownSeconds,
      });
      const res = await fetch("/api/interview/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_ids: selectedIds,
          style: s,
          message: "开始跨计划综合面试",
          ...countdown,
        }),
      });
      const reply = await res.json();
      if (!res.ok) throw new Error(reply.error || "开始失败");
      if (!reply.content) throw new Error("面试官未返回内容");
      applyReplyMeta(reply);
      setMessages([
        { role: "user", content: "开始跨计划综合面试" },
        { role: "assistant", content: reply.content, answer_deadline_at: reply.answer_deadline_at },
      ]);
    } catch (e) {
      toast.error((e as Error).message);
      setStyle(null);
      setMessages([]);
      setSessionKey(null);
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    if (!input.trim() || sending || !sessionKey || !style) return;
    const msg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setSending(true);
    try {
      const countdown = buildCountdownRequestFields({
        enabled: countdownEnabled,
        seconds: countdownSeconds,
        answerDeadlineAt,
        serverNow,
      });
      const res = await fetch("/api/interview/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_key: sessionKey,
          message: msg,
          style,
          ...countdown,
        }),
      });
      const reply = await res.json();
      if (!res.ok) throw new Error(reply.error || "发送失败");
      applyReplyMeta(reply);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply.content, answer_deadline_at: reply.answer_deadline_at },
      ]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  async function handleReset() {
    if (!sessionKey) {
      setStyle(null);
      setMessages([]);
      return;
    }
    try {
      await fetch(`/api/interview/multi?session_key=${encodeURIComponent(sessionKey)}`, {
        method: "DELETE",
      });
      setMessages([]);
      setStyle(null);
      setSessionKey(null);
      setAnswerDeadlineAt(null);
      setIsLate(false);
      toast.success("面试已重置");
    } catch {
      toast.error("重置失败");
    }
  }

  if (!style) {
    return (
      <div className="min-h-screen flex flex-col relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-radial from-primary/6 via-transparent to-transparent rounded-full blur-3xl" />
        </div>

        <header className="border-b border-border/40 px-6 py-4 bg-card/40 backdrop-blur-md relative z-10">
          <div className="max-w-3xl mx-auto flex items-center gap-2.5">
            <Button variant="ghost" size="sm" onClick={() => router.back()} className="text-muted-foreground hover:text-foreground">
              ← 返回
            </Button>
            <h1 className="text-lg font-semibold">跨计划综合面试</h1>
          </div>
        </header>

        <main className="flex-1 px-6 py-8 relative z-10 overflow-y-auto">
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/10">
                <span className="text-4xl">🎙️</span>
              </div>
              <h2 className="text-3xl font-bold gradient-text">跨计划综合面试</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                选择 2–5 个学习计划，AI 面试官会综合考察你的知识迁移与串联能力
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">
                选择计划
                <span className="text-muted-foreground font-normal ml-2">
                  已选 {selectedIds.length}/5
                </span>
              </p>
              {loadingPlans ? (
                <p className="text-sm text-muted-foreground animate-pulse">加载中...</p>
              ) : plans.length < 2 ? (
                <p className="text-sm text-muted-foreground">至少需要 2 个计划才能开始跨计划面试</p>
              ) : (
                plans.map((p) => {
                  const selected = selectedIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlan(p.id)}
                      className={`w-full text-left glass-card rounded-xl p-4 transition-all ${
                        selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                            selected ? "bg-primary border-primary" : "border-border/50"
                          }`}
                        >
                          {selected && <span className="text-[10px] text-primary-foreground">✓</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.total_stages} 阶段 · {p.status}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <InterviewCountdownToggle
              enabled={countdownEnabled}
              seconds={countdownSeconds}
              onEnabledChange={setCountdownEnabled}
              onSecondsChange={setCountdownSeconds}
            />

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">选择面试官风格</p>
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  disabled={selectedIds.length < 2 || sending}
                  className="w-full glass-card rounded-xl p-5 text-left transition-all hover:border-primary/30 hover:bg-primary/5 group disabled:opacity-40"
                  onClick={() => startInterview(s.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center border border-primary/10 shrink-0">
                      <span className="text-2xl">{s.icon}</span>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold">{s.name}</h3>
                      <p className="text-sm text-muted-foreground mt-0.5">{s.desc}</p>
                    </div>
                    <span className="text-muted-foreground/50">→</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const currentStyle = STYLES.find((s) => s.id === style)!;
  const selectedTitles = plans.filter((p) => selectedIds.includes(p.id)).map((p) => p.title);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border/40 px-6 py-3 bg-card/40 backdrop-blur-md shrink-0">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="text-muted-foreground hover:text-foreground shrink-0">
            ← 返回
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-lg">{currentStyle.icon}</span>
            <span className="text-sm font-medium truncate">{currentStyle.name}</span>
            <Badge variant="outline" className="text-[10px] border-border/30 shrink-0">
              {selectedIds.length} 个计划
            </Badge>
          </div>
          <InterviewCountdownBar
            answerDeadlineAt={answerDeadlineAt}
            serverNow={serverNow}
            enabled={countdownEnabled}
            totalSeconds={countdownSeconds}
          />
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setStyle(null); setMessages([]); setSessionKey(null); }}>
              重选
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-destructive/70 hover:text-destructive" onClick={handleReset}>
              重新开始
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {selectedTitles.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                {t}
              </Badge>
            ))}
          </div>
          <InterviewLateBanner isLate={isLate} />
          {messages
            .filter((m) => m.content !== "开始跨计划综合面试")
            .map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary/10 border border-primary/20 text-foreground"
                      : "glass-card"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
                      <span>{currentStyle.icon}</span>
                      <span>{currentStyle.name}</span>
                    </div>
                  )}
                  {msg.role === "assistant" ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

          {sending && (
            <div className="flex justify-start">
              <div className="glass-card rounded-2xl px-4 py-3">
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${j * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </main>

      <footer className="border-t border-border/40 px-6 py-4 bg-card/40 backdrop-blur-md shrink-0">
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="flex gap-3">
            <Textarea
              ref={inputRef}
              placeholder="输入你的回答..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
              className="flex-1 rounded-xl bg-background/50 border-border/40 focus:border-primary/50 resize-none text-sm"
              disabled={sending}
            />
            <Button className="h-auto rounded-xl px-6 shrink-0" onClick={handleSend} disabled={!input.trim() || sending}>
              发送
            </Button>
          </div>
          {countdownEnabled && (
            <p className="text-[10px] text-muted-foreground/60 text-center">
              倒计时以服务器收到回答的时间为准
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
