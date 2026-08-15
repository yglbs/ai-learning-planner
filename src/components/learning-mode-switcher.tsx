"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { LearningMode } from "@/lib/learning-types";

const MODES: { id: LearningMode; label: string }[] = [
  { id: "business", label: "业务" },
  { id: "technical", label: "技术" },
  { id: "business_through_tech", label: "业务×技术" },
];

interface LearningModeSwitcherProps {
  planId: string;
  value: LearningMode;
  onChange: (mode: LearningMode) => void;
  className?: string;
}

export function LearningModeSwitcher({
  planId,
  value,
  onChange,
  className = "",
}: LearningModeSwitcherProps) {
  const [pending, setPending] = useState<LearningMode | null>(null);

  async function select(mode: LearningMode) {
    if (mode === value || pending) return;
    const prev = value;
    onChange(mode);
    setPending(mode);
    try {
      const res = await fetch("/api/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: planId, learning_mode: mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "切换失败");
      if (data.plan?.learning_mode) {
        onChange(data.plan.learning_mode as LearningMode);
      }
    } catch (e) {
      onChange(prev);
      toast.error((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={`inline-flex rounded-lg border border-border/30 bg-card/30 p-0.5 ${className}`}>
      {MODES.map((m) => {
        const active = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            disabled={!!pending}
            onClick={() => select(m.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
