"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown-renderer";

interface Scenario {
  id: string;
  title: string;
  prompt: string;
  status: string;
  user_response: string;
  conclusion: string;
  conclusion_evidence: unknown[];
}

interface StageScenariosPanelProps {
  stageId: string;
  onCompleted?: () => void;
}

function evidencePaths(evidence: unknown[]): string[] {
  return evidence
    .map((e) => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object" && "path" in e && typeof (e as { path: unknown }).path === "string") {
        return (e as { path: string }).path;
      }
      return null;
    })
    .filter((p): p is string => !!p);
}

export function StageScenariosPanel({ stageId, onCompleted }: StageScenariosPanelProps) {
  const [loading, setLoading] = useState(true);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stage/${stageId}/scenarios`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载场景失败");
      const list = Array.isArray(data) ? data : [];
      setScenarios(list);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const s of list) {
          if (next[s.id] === undefined) next[s.id] = s.user_response || "";
        }
        return next;
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stageId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleConclude(scenarioId: string) {
    const text = (drafts[scenarioId] || "").trim();
    if (text.length < 10) {
      toast.error("请至少写 10 个字的分析");
      return;
    }
    setSubmittingId(scenarioId);
    try {
      const res = await fetch(`/api/stage/${stageId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_id: scenarioId, user_response: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交失败");
      toast.success("场景结论已生成");
      await load();
      onCompleted?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">加载场景...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-2xl space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">场景练习</h3>
          <p className="text-xs text-muted-foreground">写出你的分析，AI 会给出带证据的结论</p>
        </div>

        {scenarios.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">确认大纲后会同步场景练习</p>
        ) : (
          scenarios.map((s, i) => {
            const done = s.status === "completed";
            const paths = evidencePaths(Array.isArray(s.conclusion_evidence) ? s.conclusion_evidence : []);
            return (
              <div key={s.id} className="glass-card rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">场景 {i + 1}</p>
                    <h4 className="text-sm font-semibold">{s.title}</h4>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] shrink-0 ${
                      done ? "bg-green-500/10 text-green-400" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {done ? "已完成" : "待完成"}
                  </Badge>
                </div>
                {s.prompt && s.prompt !== s.title && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.prompt}</p>
                )}

                {done && s.conclusion ? (
                  <div className="space-y-2">
                    {s.user_response && (
                      <div className="px-3 py-2 rounded-lg bg-background/40 border border-border/20 text-xs text-muted-foreground">
                        你的回答：{s.user_response}
                      </div>
                    )}
                    <div className="text-sm">
                      <MarkdownRenderer content={s.conclusion} />
                    </div>
                    {paths.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {paths.map((p) => (
                          <Badge key={p} variant="outline" className="text-[10px] font-mono border-border/30">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      value={drafts[s.id] || ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      placeholder="写下你的分析（至少 10 字）..."
                      rows={4}
                      className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
                      disabled={submittingId === s.id}
                    />
                    <Button
                      size="sm"
                      className="rounded-lg"
                      onClick={() => handleConclude(s.id)}
                      disabled={submittingId === s.id}
                    >
                      {submittingId === s.id ? "生成结论中..." : "提交并生成结论"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
