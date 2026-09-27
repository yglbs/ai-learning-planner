"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useKeywordHighlight } from "@/components/teach-chat";

interface Config {
  llm_provider: string;
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
  proxy_enabled: boolean;
  proxy_type: string;
  proxy_host: string;
  proxy_port: number;
  tavily_api_key: string;
  search_region: string;
  validator_enabled: boolean;
  validator_llm_provider: string;
  validator_llm_api_key: string;
  validator_llm_base_url: string;
  validator_llm_model: string;
  default_post_stage_review_enabled: boolean;
  default_answer_time_limit_enabled: boolean;
  default_answer_time_limit_seconds: number;
  pi_code_max_tool_calls: number;
  pi_book_max_tool_calls: number;
  pi_chat_max_tool_calls: number;
}

export default function SettingsPage() {
  const router = useRouter();
  const [config, setConfig] = useState<Config>({
    llm_provider: "openai",
    llm_api_key: "",
    llm_base_url: "",
    llm_model: "gpt-4o-mini",
    proxy_enabled: false,
    proxy_type: "http",
    proxy_host: "",
    proxy_port: 7890,
    tavily_api_key: "",
    search_region: "global",
    validator_enabled: true,
    validator_llm_provider: "openai",
    validator_llm_api_key: "",
    validator_llm_base_url: "",
    validator_llm_model: "gpt-4o-mini",
    default_post_stage_review_enabled: true,
    default_answer_time_limit_enabled: true,
    default_answer_time_limit_seconds: 120,
    pi_code_max_tool_calls: 20,
    pi_book_max_tool_calls: 16,
    pi_chat_max_tool_calls: 8,
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [tavilyKeyInput, setTavilyKeyInput] = useState("");
  const [validatorKeyInput, setValidatorKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }> | null>(null);
  const { keywordHighlight, setKeywordHighlight } = useKeywordHighlight();

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        llm_provider: config.llm_provider,
        llm_base_url: config.llm_base_url,
        llm_model: config.llm_model,
        proxy_enabled: config.proxy_enabled,
        proxy_type: config.proxy_type,
        proxy_host: config.proxy_host,
        proxy_port: config.proxy_port,
        search_region: config.search_region,
        validator_enabled: config.validator_enabled,
        validator_llm_provider: config.validator_llm_provider,
        validator_llm_base_url: config.validator_llm_base_url,
        validator_llm_model: config.validator_llm_model,
        default_post_stage_review_enabled: config.default_post_stage_review_enabled,
        default_answer_time_limit_enabled: config.default_answer_time_limit_enabled,
        default_answer_time_limit_seconds: config.default_answer_time_limit_seconds,
        pi_code_max_tool_calls: config.pi_code_max_tool_calls,
        pi_book_max_tool_calls: config.pi_book_max_tool_calls,
        pi_chat_max_tool_calls: config.pi_chat_max_tool_calls,
      };
      if (apiKeyInput) {
        payload.llm_api_key = apiKeyInput;
      }
      if (tavilyKeyInput) {
        payload.tavily_api_key = tavilyKeyInput;
      }
      if (validatorKeyInput) {
        payload.validator_llm_api_key = validatorKeyInput;
      }
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success("设置已保存");
      setApiKeyInput("");
      setTavilyKeyInput("");
      setValidatorKeyInput("");
      const res = await fetch("/api/config");
      setConfig(await res.json());
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResults(null);
    try {
      await handleSave();
      await new Promise((r) => setTimeout(r, 300));
      const res = await fetch("/api/config/test", { method: "POST" });
      const data = await res.json();
      setTestResults(data);
    } catch {
      toast.error("测试失败");
    } finally {
      setTesting(false);
    }
  }

  const modelOptions: Record<string, { label: string; value: string }[]> = {
    openai: [
      { label: "GPT-4o Mini (推荐)", value: "gpt-4o-mini" },
      { label: "GPT-4o", value: "gpt-4o" },
      { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
      { label: "GPT-4.1", value: "gpt-4.1" },
    ],
    anthropic: [
      { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
      { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022" },
    ],
    deepseek: [
      { label: "DeepSeek V4 Flash (推荐)", value: "deepseek-v4-flash" },
      { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
      { label: "DeepSeek V4 Flash Vision (实验)", value: "deepseek-v4-flash-vision-exp" },
    ],
    kimi: [
      { label: "Kimi K2 (推荐)", value: "kimi-k2-0711-preview" },
      { label: "Moonshot 128K", value: "moonshot-v1-128k" },
      { label: "Moonshot 32K", value: "moonshot-v1-32k" },
      { label: "Moonshot 8K", value: "moonshot-v1-8k" },
    ],
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/40 px-6 py-4 bg-card/40 backdrop-blur-md">
        <div className="max-w-2xl mx-auto flex items-center gap-2.5">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")} className="text-muted-foreground hover:text-foreground">
            ← 返回
          </Button>
          <h1 className="text-lg font-semibold">⚙️ 系统设置</h1>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>教学界面</CardTitle>
              <CardDescription>
                控制 AI 教学对话中的文字强调效果
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <Label>重点词下划线高亮</Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    开启后，AI 回复里的重点词会显示颜色与下划线；关闭后仅保留普通加粗。
                  </p>
                </div>
                <Button
                  variant={keywordHighlight ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    const next = !keywordHighlight;
                    setKeywordHighlight(next);
                    toast.success(next ? "已开启重点词高亮" : "已关闭重点词高亮");
                  }}
                >
                  {keywordHighlight ? "已开启" : "已关闭"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>LLM 配置</CardTitle>
              <CardDescription>
                配置 AI 大模型，用于生成学习计划和检测评估
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>供应商</Label>
                <Select
                  value={config.llm_provider}
                  onValueChange={(v) => { if (v) setConfig({ ...config, llm_provider: v, llm_model: modelOptions[v]?.[0]?.value || "", llm_base_url: "" }); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="kimi">Kimi (Moonshot)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  placeholder={config.llm_api_key || "输入 API Key..."}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                {config.llm_api_key && (
                  <p className="text-xs text-muted-foreground">
                    当前已配置: {config.llm_api_key}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>模型</Label>
                <Select
                  value={config.llm_model}
                  onValueChange={(v) => { if (v) setConfig({ ...config, llm_model: v }); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(modelOptions[config.llm_provider] || []).map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>自定义 Base URL (可选)</Label>
                <Input
                  placeholder={
                    config.llm_provider === "deepseek"
                      ? "默认: https://api.deepseek.com"
                      : config.llm_provider === "kimi"
                        ? "默认: https://api.moonshot.cn/v1"
                        : config.llm_provider === "anthropic"
                          ? "默认: https://api.anthropic.com"
                          : "默认: https://api.openai.com/v1"
                  }
                  value={config.llm_base_url}
                  onChange={(e) => setConfig({ ...config, llm_base_url: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  留空使用默认地址，如使用代理或转发服务则在此填写
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>学习设置</CardTitle>
              <CardDescription>
                以下三项默认开启，可随时关闭。终极面试是面试时的风格选项，不在这里开关。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <Label>阶段后复习</Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    阶段通过后生成一轮即时复习，可选做，不挡住下一阶段。此为新建计划默认值。
                  </p>
                </div>
                <Button
                  variant={config.default_post_stage_review_enabled ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setConfig({ ...config, default_post_stage_review_enabled: !config.default_post_stage_review_enabled })}
                >
                  {config.default_post_stage_review_enabled ? "默认开" : "默认关"}
                </Button>
              </div>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <Label>答题限时失败</Label>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      检测 / 面试 / 复习统计作答时间，超时记失败。此为新建计划默认值。
                    </p>
                  </div>
                  <Button
                    variant={config.default_answer_time_limit_enabled ? "default" : "outline"}
                    size="sm"
                    className="shrink-0"
                    onClick={() => setConfig({ ...config, default_answer_time_limit_enabled: !config.default_answer_time_limit_enabled })}
                  >
                    {config.default_answer_time_limit_enabled ? "默认开" : "默认关"}
                  </Button>
                </div>
                {config.default_answer_time_limit_enabled && (
                  <div className="flex items-center gap-3">
                    <Label className="text-xs text-muted-foreground shrink-0">默认秒数</Label>
                    <Input
                      type="number"
                      min={10}
                      max={3600}
                      className="h-9 w-28"
                      value={config.default_answer_time_limit_seconds}
                      onChange={(e) => setConfig({
                        ...config,
                        default_answer_time_limit_seconds: Math.min(3600, Math.max(10, Number(e.target.value) || 120)),
                      })}
                    />
                  </div>
                )}
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <Label>交叉验证模型</Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    检测由第二个模型再评一遍。未单独配验证模型时，会用主模型再评一次。
                  </p>
                </div>
                <Button
                  variant={config.validator_enabled ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => setConfig({ ...config, validator_enabled: !config.validator_enabled })}
                >
                  {config.validator_enabled ? "已开启" : "已关闭"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pi 读取上限</CardTitle>
              <CardDescription>
                从代码或书籍生成计划时会按对应次数打开本地文件。教学对话只有选 Agent 模式才用下面的次数；Chat 模式只调用一次模型，不读文件。到上限后不再读取，模型用已经读到的内容回答。对话轮数会在这个数字上再加 4。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "pi_code_max_tool_calls" as const, label: "从代码生成计划", fallback: 20 },
                { key: "pi_book_max_tool_calls" as const, label: "上传书籍生成计划", fallback: 16 },
                { key: "pi_chat_max_tool_calls" as const, label: "教学对话 Agent", fallback: 8 },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-4">
                  <Label>{item.label}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={80}
                    className="h-9 w-28"
                    value={config[item.key] ?? item.fallback}
                    onChange={(e) => setConfig({
                      ...config,
                      [item.key]: Math.min(80, Math.max(1, Number(e.target.value) || item.fallback)),
                    })}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">每次列目录、读文件、搜索都算 1 次。范围 1–80。</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>交叉验证模型</CardTitle>
              <CardDescription>
                检测打分由第二个模型独立再评一遍。两边都通过才算过关，不一致时按更严格结果计分。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>启用交叉验证</Label>
                <Button
                  variant={config.validator_enabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setConfig({ ...config, validator_enabled: !config.validator_enabled })}
                >
                  {config.validator_enabled ? "已启用" : "未启用"}
                </Button>
              </div>
              {config.validator_enabled && (
                <>
                  <div className="space-y-2">
                    <Label>验证模型供应商</Label>
                    <Select
                      value={config.validator_llm_provider || config.llm_provider}
                      onValueChange={(v) => {
                        if (v) {
                          setConfig({
                            ...config,
                            validator_llm_provider: v,
                            validator_llm_model: modelOptions[v]?.[0]?.value || "",
                            validator_llm_base_url: "",
                          });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                        <SelectItem value="kimi">Kimi (Moonshot)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>验证模型 API Key（可选，留空则复用主模型 Key）</Label>
                    <Input
                      type="password"
                      placeholder={config.validator_llm_api_key || "输入验证模型 API Key..."}
                      value={validatorKeyInput}
                      onChange={(e) => setValidatorKeyInput(e.target.value)}
                    />
                    {config.validator_llm_api_key && (
                      <p className="text-xs text-muted-foreground">
                        当前已配置: {config.validator_llm_api_key}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>验证模型</Label>
                    <Select
                      value={config.validator_llm_model || (modelOptions[config.validator_llm_provider || config.llm_provider]?.[0]?.value || "")}
                      onValueChange={(v) => { if (v) setConfig({ ...config, validator_llm_model: v }); }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(modelOptions[config.validator_llm_provider || config.llm_provider] || []).map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>验证模型 Base URL（可选）</Label>
                    <Input
                      placeholder="留空则按供应商默认地址"
                      value={config.validator_llm_base_url}
                      onChange={(e) => setConfig({ ...config, validator_llm_base_url: e.target.value })}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>🔍 数据源配置</CardTitle>
              <CardDescription>
                配置搜索引擎 API，获取真实、可验证的学习资源
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Tavily API Key</Label>
                <Input
                  type="password"
                  placeholder={config.tavily_api_key || "输入 Tavily API Key..."}
                  value={tavilyKeyInput}
                  onChange={(e) => setTavilyKeyInput(e.target.value)}
                />
                {config.tavily_api_key && (
                  <p className="text-xs text-muted-foreground">
                    当前已配置: {config.tavily_api_key}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  免费注册获取: <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">tavily.com</a> · 每月 1000 次免费搜索
                </p>
              </div>

              <div className="space-y-2">
                <Label>搜索区域偏好</Label>
                <Select
                  value={config.search_region}
                  onValueChange={(v) => { if (v) setConfig({ ...config, search_region: v }); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">全球 (推荐)</SelectItem>
                    <SelectItem value="cn">中国优先</SelectItem>
                    <SelectItem value="us">英文优先</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  配置 Tavily API 后，系统将使用真实搜索引擎获取学习资源，替代 AI 生成的不准确链接。未配置时仍使用 AI 生成（可能不准确）。
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>代理配置</CardTitle>
              <CardDescription>
                配置 VPN/代理以访问海外学习资源
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>启用代理</Label>
                <Button
                  variant={config.proxy_enabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setConfig({ ...config, proxy_enabled: !config.proxy_enabled })}
                >
                  {config.proxy_enabled ? "已启用" : "未启用"}
                </Button>
              </div>

              {config.proxy_enabled && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>协议</Label>
                      <Select
                        value={config.proxy_type}
                        onValueChange={(v) => { if (v) setConfig({ ...config, proxy_type: v }); }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="socks5">SOCKS5</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>端口</Label>
                      <Input
                        type="number"
                        value={config.proxy_port}
                        onChange={(e) => setConfig({ ...config, proxy_port: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>主机地址</Label>
                    <Input
                      placeholder="127.0.0.1"
                      value={config.proxy_host}
                      onChange={(e) => setConfig({ ...config, proxy_host: e.target.value })}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>连接测试</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleTest} disabled={testing} className="w-full">
                {testing ? "测试中..." : "测试连接"}
              </Button>
              {testResults && (
                <div className="space-y-2">
                  {Object.entries(testResults).map(([key, result]) => {
                    const displayNames: Record<string, string> = { llm: "LLM", proxy: "代理", tavily: "Tavily 搜索" };
                    return (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm font-medium">{displayNames[key] || key}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{result.message}</span>
                        <Badge variant={result.ok ? "default" : "destructive"}>
                          {result.ok ? "成功" : "失败"}
                        </Badge>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "保存中..." : "保存设置"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
