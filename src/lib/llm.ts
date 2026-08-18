import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getConfig } from "@/db/queries";

export const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.cn/v1",
};

export interface LlmConnection {
  llm_provider: string;
  llm_api_key: string;
  llm_base_url: string;
  llm_model: string;
}

export function isStructuredFallbackProvider(provider: string) {
  return provider === "deepseek" || provider === "kimi";
}

export function isOpenAICompatibleStructuredFallback() {
  return isStructuredFallbackProvider(getConfig().llm_provider);
}

export function createModelFromConnection(config: LlmConnection) {
  if (!config.llm_api_key) {
    throw new Error("请先在设置页面配置 API Key");
  }

  if (config.llm_provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.llm_api_key,
      ...(config.llm_base_url ? { baseURL: config.llm_base_url } : {}),
    });
    return anthropic(config.llm_model || "claude-sonnet-4-20250514");
  }

  if (config.llm_provider === "deepseek") {
    const deepseek = createOpenAI({
      apiKey: config.llm_api_key,
      baseURL: config.llm_base_url || PROVIDER_DEFAULT_BASE_URLS.deepseek,
    });
    return deepseek.chat(config.llm_model || "deepseek-chat");
  }

  if (config.llm_provider === "kimi") {
    const kimi = createOpenAI({
      apiKey: config.llm_api_key,
      baseURL: config.llm_base_url || PROVIDER_DEFAULT_BASE_URLS.kimi,
    });
    return kimi.chat(config.llm_model || "kimi-k2-0711-preview");
  }

  const openai = createOpenAI({
    apiKey: config.llm_api_key,
    ...(config.llm_base_url ? { baseURL: config.llm_base_url } : {}),
  });
  return openai(config.llm_model || "gpt-4o-mini");
}

export function getModel() {
  return createModelFromConnection(getConfig());
}

export function getValidatorConnection(): LlmConnection | null {
  const config = getConfig();
  if (!config.validator_enabled) return null;
  const apiKey = config.validator_llm_api_key || config.llm_api_key;
  if (!apiKey) return null;
  const provider = config.validator_llm_provider || config.llm_provider;
  return {
    llm_provider: provider,
    llm_api_key: apiKey,
    llm_base_url:
      config.validator_llm_base_url
      || (provider === config.llm_provider ? config.llm_base_url : ""),
    llm_model: config.validator_llm_model || config.llm_model,
  };
}

export function getValidatorModel() {
  const connection = getValidatorConnection();
  if (!connection) return null;
  return createModelFromConnection(connection);
}
