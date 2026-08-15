"use client";

import { useCallback, useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MANUAL_PROGRESS_ITEM_TYPES } from "@/lib/learning-types";

interface ProgressItem {
  id: string;
  item_type: string;
  item_key: string;
  title: string;
  status: string;
}

interface StageProgressPanelProps {
  stageId: string;
  onPercentChange?: (percent: number) => void;
}

function isManualType(itemType: string): boolean {
  return (MANUAL_PROGRESS_ITEM_TYPES as readonly string[]).includes(itemType);
}

export function StageProgressPanel({ stageId, onPercentChange }: StageProgressPanelProps) {
  const [loading, setLoading] = useState(true);
  const [percent, setPercent] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/stage/${stageId}/progress`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载进度失败");
      setPercent(data.percent ?? 0);
      setCompleted(data.completed ?? 0);
      setTotal(data.total ?? 0);
      setItems(Array.isArray(data.items) ? data.items : []);
      onPercentChange?.(data.percent ?? 0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stageId, onPercentChange]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function toggleItem(item: ProgressItem) {
    if (!isManualType(item.item_type)) return;
    const nextStatus = item.status === "completed" ? "pending" : "completed";
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/stage/${stageId}/progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");
      setPercent(data.percent ?? 0);
      setCompleted(data.completed ?? 0);
      setTotal(data.total ?? 0);
      setItems(Array.isArray(data.items) ? data.items : []);
      onPercentChange?.(data.percent ?? 0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">加载进度...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-2xl space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">阶段进度</h3>
            <span className="text-xs text-muted-foreground">
              {completed}/{total} · {percent}%
            </span>
          </div>
          <Progress value={percent} className="h-2" />
        </div>

        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">确认大纲后将生成进度清单</p>
          ) : (
            items.map((item) => {
              const manual = isManualType(item.item_type);
              const done = item.status === "completed" || item.status === "skipped";
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-border/20 bg-card/20 ${
                    done ? "opacity-60" : ""
                  }`}
                >
                  {manual ? (
                    <button
                      type="button"
                      disabled={togglingId === item.id}
                      onClick={() => toggleItem(item)}
                      className={`mt-0.5 w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 ${
                        done ? "bg-primary border-primary" : "border-border/50 hover:border-primary/50"
                      }`}
                    >
                      {done && <span className="text-[10px] text-primary-foreground">✓</span>}
                    </button>
                  ) : (
                    <div
                      className={`mt-0.5 w-[18px] h-[18px] rounded border flex items-center justify-center shrink-0 ${
                        done ? "bg-primary/40 border-primary/40" : "border-border/30"
                      }`}
                    >
                      {done && <span className="text-[10px] text-primary-foreground/80">✓</span>}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge variant="outline" className="text-[10px] border-border/30">
                        {item.item_type}
                      </Badge>
                      {!manual && (
                        <span className="text-[10px] text-muted-foreground/60">系统自动</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
