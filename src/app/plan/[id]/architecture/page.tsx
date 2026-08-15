"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { ArchitectureSnapshot } from "@/lib/learning-types";

const KIND_LABEL: Record<string, string> = {
  module: "模块",
  service: "服务",
  entry: "入口",
  config: "配置",
  data: "数据",
  other: "其他",
};

export default function ArchitecturePage() {
  const router = useRouter();
  const params = useParams();
  const planId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<ArchitectureSnapshot | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [planTitle, setPlanTitle] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/plan/${planId}/architecture`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载架构失败");
      setSnapshot(data.snapshot || null);
      setGeneratedAt(data.generated_at || null);
      setCached(!!data.cached);
    } catch (e) {
      toast.error((e as Error).message);
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetch(`/api/plan?id=${planId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.plan?.title) setPlanTitle(d.plan.title);
      })
      .catch(() => {});
    load();
  }, [planId, load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/plan/${planId}/architecture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "刷新失败");
      setSnapshot(data.snapshot || null);
      setGeneratedAt(data.generated_at || null);
      setCached(!!data.cached);
      toast.success("架构已重新扫描");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-gradient-radial from-primary/6 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      <header className="border-b border-border/40 px-6 py-4 bg-card/40 backdrop-blur-md relative z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/plan/${planId}`)}
            className="text-muted-foreground hover:text-foreground"
          >
            ← 返回计划
          </Button>
          <h1 className="text-lg font-semibold">服务架构</h1>
          {planTitle && (
            <Badge variant="outline" className="text-[10px] border-border/30">
              {planTitle}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {generatedAt && (
              <span className="text-[10px] text-muted-foreground/60">
                {cached ? "缓存 · " : ""}
                {new Date(generatedAt).toLocaleString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs border-border/50"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? "扫描中..." : "重新扫描"}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 relative z-10 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-16 animate-pulse">扫描架构中...</p>
          ) : !snapshot ? (
            <div className="text-center py-16 space-y-3">
              <p className="text-sm text-muted-foreground">暂无架构数据</p>
              <Button onClick={handleRefresh} disabled={refreshing} className="rounded-xl">
                开始扫描
              </Button>
            </div>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-base font-semibold">组件</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {snapshot.components.map((c) => (
                    <div key={c.id} className="glass-card rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold truncate">{c.name}</h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                            {KIND_LABEL[c.kind] || c.kind}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              c.evidence === "verified"
                                ? "border-green-500/30 text-green-400"
                                : "border-amber-500/30 text-amber-400"
                            }`}
                          >
                            {c.evidence === "verified" ? "已验证" : "推断"}
                          </Badge>
                        </div>
                      </div>
                      {c.paths.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {c.paths.map((p) => (
                            <Badge key={p} variant="outline" className="text-[10px] font-mono border-border/30">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-base font-semibold">依赖边</h2>
                <div className="space-y-2">
                  {snapshot.edges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无边关系</p>
                  ) : (
                    snapshot.edges.map((e, i) => (
                      <div
                        key={`${e.from}-${e.to}-${i}`}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border/20 bg-card/20 text-sm"
                      >
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[30%]">{e.from}</span>
                        <span className="text-muted-foreground/50 shrink-0">→</span>
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[30%]">{e.to}</span>
                        {e.label && (
                          <Badge variant="outline" className="text-[10px] border-border/30 shrink-0">
                            {e.label}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] ml-auto shrink-0 ${
                            e.evidence === "verified"
                              ? "border-green-500/30 text-green-400"
                              : "border-amber-500/30 text-amber-400"
                          }`}
                        >
                          {e.evidence === "verified" ? "已验证" : "推断"}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {snapshot.notes && (
                <section className="glass-card rounded-xl p-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">{snapshot.notes}</p>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
