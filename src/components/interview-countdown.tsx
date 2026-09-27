"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { DEFAULT_COUNTDOWN_SECONDS, MAX_ANSWER_SECONDS, MIN_ANSWER_SECONDS } from "@/lib/learning-types";

export { DEFAULT_COUNTDOWN_SECONDS };

export interface CountdownRequestFields {
  countdown_enabled: boolean;
  countdown_seconds: number;
  elapsed_seconds?: number;
}

export function buildCountdownRequestFields(params: {
  enabled: boolean;
  seconds: number;
  answerDeadlineAt?: string | null;
  serverNow?: string | null;
}): CountdownRequestFields {
  const fields: CountdownRequestFields = {
    countdown_enabled: params.enabled,
    countdown_seconds: Math.min(MAX_ANSWER_SECONDS, Math.max(MIN_ANSWER_SECONDS, params.seconds || DEFAULT_COUNTDOWN_SECONDS)),
  };
  if (params.enabled && params.answerDeadlineAt) {
    const deadline = new Date(params.answerDeadlineAt).getTime();
    const issuedAt = deadline - fields.countdown_seconds * 1000;
    // Diagnostic only; server uses answer_deadline_at for lateness.
    // serverNow reserved for future clock-skew correction on client elapsed.
    void params.serverNow;
    fields.elapsed_seconds = Math.max(0, Math.round((Date.now() - issuedAt) / 1000));
  }
  return fields;
}

interface InterviewCountdownToggleProps {
  enabled: boolean;
  seconds: number;
  onEnabledChange: (v: boolean) => void;
  onSecondsChange: (v: number) => void;
  /** When set, countdown follows plan「答题限时」and local toggle is disabled. */
  lockedByPlan?: boolean;
}

export function InterviewCountdownToggle({
  enabled,
  seconds,
  onEnabledChange,
  onSecondsChange,
  lockedByPlan = false,
}: InterviewCountdownToggleProps) {
  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">回答倒计时</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lockedByPlan
              ? "由计划页「答题限时」控制；关闭后面试内不再限时"
              : "开启后，每题有时限；若计划开启了限时失败，超时本题记为失败"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (lockedByPlan) return;
            onEnabledChange(!enabled);
          }}
          disabled={lockedByPlan}
          className={`relative h-7 w-12 rounded-full transition-colors shrink-0 ${
            enabled ? "bg-primary" : "bg-border/60"
          } ${lockedByPlan ? "opacity-80 cursor-not-allowed" : ""}`}
          aria-pressed={enabled}
          aria-disabled={lockedByPlan}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-background transition-transform ${
              enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>
      {enabled && (
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground shrink-0">秒数</Label>
          <Input
            type="number"
            min={MIN_ANSWER_SECONDS}
            max={MAX_ANSWER_SECONDS}
            value={seconds}
            disabled={lockedByPlan}
            onChange={(e) => onSecondsChange(Math.min(MAX_ANSWER_SECONDS, Math.max(MIN_ANSWER_SECONDS, Number(e.target.value) || DEFAULT_COUNTDOWN_SECONDS)))}
            className="h-9 rounded-lg bg-background/50 border-border/40 w-28 text-sm"
          />
          <span className="text-xs text-muted-foreground">默认 {DEFAULT_COUNTDOWN_SECONDS}s</span>
        </div>
      )}
    </div>
  );
}

interface InterviewCountdownBarProps {
  answerDeadlineAt: string | null | undefined;
  serverNow: string | null | undefined;
  enabled?: boolean;
  totalSeconds?: number;
  onExpire?: () => void;
}

export function InterviewCountdownBar({
  answerDeadlineAt,
  serverNow,
  enabled = true,
  totalSeconds = DEFAULT_COUNTDOWN_SECONDS,
  onExpire,
}: InterviewCountdownBarProps) {
  const offsetMs = useMemo(() => {
    if (!serverNow) return 0;
    return new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);

  const [remaining, setRemaining] = useState<number | null>(null);
  const expiredFor = useRef<string | null>(null);

  useEffect(() => {
    expiredFor.current = null;
  }, [answerDeadlineAt]);

  useEffect(() => {
    if (!enabled || !answerDeadlineAt) {
      setRemaining(null);
      return;
    }
    function tick() {
      const now = Date.now() + offsetMs;
      const left = Math.max(0, Math.ceil((new Date(answerDeadlineAt!).getTime() - now) / 1000));
      setRemaining(left);
      if (left <= 0 && expiredFor.current !== answerDeadlineAt) {
        expiredFor.current = answerDeadlineAt!;
        onExpire?.();
      }
    }
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [answerDeadlineAt, enabled, offsetMs, onExpire]);

  if (!enabled || remaining === null || !answerDeadlineAt) return null;

  const pct = totalSeconds > 0 ? Math.min(100, (remaining / totalSeconds) * 100) : 0;
  const urgent = remaining <= 15;

  return (
    <div className="w-full max-w-xs">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className={urgent ? "text-amber-400 font-medium" : "text-muted-foreground"}>
          剩余 {remaining}s
        </span>
        <span className="text-muted-foreground/60">作答时限</span>
      </div>
      <Progress value={pct} className={`h-1.5 ${urgent ? "[&>div]:bg-amber-400" : ""}`} />
    </div>
  );
}

export function InterviewLateBanner({ isLate, failedTimeout }: { isLate?: boolean; failedTimeout?: boolean }) {
  if (!isLate && !failedTimeout) return null;
  if (failedTimeout) {
    return (
      <div className="px-3.5 py-2 rounded-xl border border-red-400/20 bg-red-500/10 text-xs text-red-100/90">
        上一题超时，本题已判定失败
      </div>
    );
  }
  return (
    <div className="px-3.5 py-2 rounded-xl border border-amber-400/20 bg-amber-500/10 text-xs text-amber-100/90">
      上一题回答已超时（以服务器收到时间为准）
    </div>
  );
}
