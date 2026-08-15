"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { StageOutline } from "@/lib/learning-types";

interface StageOutlineGateProps {
  stageId: string;
  sourceType?: string | null;
  onConfirmed: () => void;
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function StageOutlineGate({ stageId, sourceType, onConfirmed }: StageOutlineGateProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [outline, setOutline] = useState<StageOutline | null>(null);
  const [objectivesText, setObjectivesText] = useState("");
  const [scenariosText, setScenariosText] = useState("");
  const [filesText, setFilesText] = useState("");
  const [callChain, setCallChain] = useState("");
  const [architectureFocus, setArchitectureFocus] = useState("");
  const [outOfScopeText, setOutOfScopeText] = useState("");
  const [userAdjustments, setUserAdjustments] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);

  const applyOutline = useCallback((o: StageOutline) => {
    setOutline(o);
    setObjectivesText(o.sections.objectives.join("\n"));
    setScenariosText(o.sections.scenarios.join("\n"));
    setFilesText(
      o.sections.files_to_read
        .map((f) => (f.reason ? `${f.path} | ${f.reason}` : f.path))
        .join("\n")
    );
    setCallChain(o.sections.call_chain || "");
    setArchitectureFocus(o.sections.architecture_focus || "");
    setOutOfScopeText(o.sections.out_of_scope.join("\n"));
    setUserAdjustments(o.user_adjustments || "");
    setEstimatedMinutes(o.sections.estimated_minutes || 60);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/stage/${stageId}/outline`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载大纲失败");
        if (!cancelled && data.outline) applyOutline(data.outline);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [stageId, applyOutline]);

  function parseFiles() {
    return linesToArray(filesText).map((line) => {
      const [pathPart, ...rest] = line.split("|");
      return {
        path: pathPart.trim(),
        reason: rest.join("|").trim() || "精读",
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/stage/${stageId}/outline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectives: linesToArray(objectivesText),
          scenarios: linesToArray(scenariosText),
          files_to_read: parseFiles(),
          call_chain: callChain,
          architecture_focus: architectureFocus,
          estimated_minutes: estimatedMinutes,
          out_of_scope: linesToArray(outOfScopeText),
          user_adjustments: userAdjustments,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      if (data.outline) applyOutline(data.outline);
      toast.success("大纲已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const saveRes = await fetch(`/api/stage/${stageId}/outline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectives: linesToArray(objectivesText),
          scenarios: linesToArray(scenariosText),
          files_to_read: parseFiles(),
          call_chain: callChain,
          architecture_focus: architectureFocus,
          estimated_minutes: estimatedMinutes,
          out_of_scope: linesToArray(outOfScopeText),
          user_adjustments: userAdjustments,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "保存失败");

      const res = await fetch(`/api/stage/${stageId}/outline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "确认失败");
      toast.success("大纲已确认，开始学习");
      onConfirmed();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">加载学习大纲...</p>
      </div>
    );
  }

  if (!outline) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6">
        <p className="text-sm text-muted-foreground">无法加载大纲</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          重试
        </Button>
      </div>
    );
  }

  const isCode = sourceType === "code";

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">确认学习大纲</h3>
            <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-400">
              开始前必确认
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            先对齐本阶段目标与范围，确认后才会开启 AI 教学对话
          </p>
        </div>

        <div className="glass-card rounded-xl p-5 space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">学习目标（每行一条）</Label>
            <Textarea
              value={objectivesText}
              onChange={(e) => setObjectivesText(e.target.value)}
              rows={4}
              className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">场景练习（每行一条）</Label>
            <Textarea
              value={scenariosText}
              onChange={(e) => setScenariosText(e.target.value)}
              rows={3}
              className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
            />
          </div>

          {isCode && (
            <>
              <div className="space-y-2">
                <Label className="text-sm">精读文件（`路径 | 原因`）</Label>
                <Textarea
                  value={filesText}
                  onChange={(e) => setFilesText(e.target.value)}
                  rows={4}
                  className="rounded-xl bg-background/50 border-border/40 text-sm font-mono resize-y"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">调用链</Label>
                <Textarea
                  value={callChain}
                  onChange={(e) => setCallChain(e.target.value)}
                  rows={3}
                  className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">架构关注点</Label>
                <Textarea
                  value={architectureFocus}
                  onChange={(e) => setArchitectureFocus(e.target.value)}
                  rows={2}
                  className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label className="text-sm">不在范围内（每行一条）</Label>
            <Textarea
              value={outOfScopeText}
              onChange={(e) => setOutOfScopeText(e.target.value)}
              rows={2}
              className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">预估时长（分钟）</Label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(Number(e.target.value) || 60)}
              className="h-10 rounded-xl bg-background/50 border-border/40 w-32"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">你的调整说明</Label>
            <Textarea
              value={userAdjustments}
              onChange={(e) => setUserAdjustments(e.target.value)}
              rows={2}
              placeholder="希望侧重什么、跳过什么..."
              className="rounded-xl bg-background/50 border-border/40 text-sm resize-y"
            />
          </div>
        </div>

        <div className="flex gap-3 pb-6">
          <Button
            variant="outline"
            className="rounded-xl border-border/50"
            onClick={handleSave}
            disabled={saving || confirming}
          >
            {saving ? "保存中..." : "保存草稿"}
          </Button>
          <Button
            className="flex-1 rounded-xl glow-primary"
            onClick={handleConfirm}
            disabled={saving || confirming}
          >
            {confirming ? "确认中..." : "确认大纲并开始学习"}
          </Button>
        </div>
      </div>
    </div>
  );
}
