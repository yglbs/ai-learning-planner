import { NextResponse } from "next/server";
import { getConfig } from "@/db/queries";

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
  kimi: "https://api.moonshot.cn/v1",
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function buildLlmTestUrl(provider: string, baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);

  if (provider === "anthropic") {
    const root = normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
    return `${root}/v1/messages`;
  }

  const root = normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
  return `${root}/models`;
}

export async function POST() {
  const config = getConfig();

  const results: Record<string, { ok: boolean; message: string }> = {};

  if (config.llm_api_key) {
    try {
      const baseUrl =
        config.llm_base_url ||
        PROVIDER_BASE_URLS[config.llm_provider] ||
        PROVIDER_BASE_URLS.openai;

      const testUrl = buildLlmTestUrl(config.llm_provider, baseUrl);

      const headers: Record<string, string> = config.llm_provider === "anthropic"
        ? { "x-api-key": config.llm_api_key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${config.llm_api_key}` };

      const response = await fetch(testUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      results.llm = response.ok || response.status === 405
        ? { ok: true, message: `${config.llm_provider} 连接成功` }
        : { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
    } catch (e) {
      results.llm = { ok: false, message: `连接失败: ${(e as Error).message}` };
    }
  } else {
    results.llm = { ok: false, message: "未配置 API Key" };
  }

  if (config.tavily_api_key) {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.tavily_api_key,
          query: "test",
          max_results: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });

      results.tavily = response.ok
        ? { ok: true, message: "Tavily 搜索连接成功" }
        : { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
    } catch (e) {
      results.tavily = { ok: false, message: `连接失败: ${(e as Error).message}` };
    }
  } else {
    results.tavily = { ok: false, message: "未配置 Tavily API Key（可选）" };
  }

  if (config.proxy_enabled && config.proxy_host) {
    try {
      const proxyUrl = `${config.proxy_type}://${config.proxy_host}:${config.proxy_port}`;
      results.proxy = { ok: true, message: `代理已配置: ${proxyUrl}` };
    } catch (e) {
      results.proxy = { ok: false, message: `代理配置错误: ${(e as Error).message}` };
    }
  } else {
    results.proxy = { ok: true, message: "未启用代理" };
  }

  return NextResponse.json(results);
}
