import { NextResponse } from "next/server";
import { getConfig, updateConfig } from "@/db/queries";

export async function GET() {
  const config = getConfig();
  return NextResponse.json({
    ...config,
    llm_api_key: config.llm_api_key ? "••••" + config.llm_api_key.slice(-4) : "",
    proxy_password: config.proxy_password ? "••••" : "",
    tavily_api_key: config.tavily_api_key ? "••••" + config.tavily_api_key.slice(-4) : "",
    validator_llm_api_key: config.validator_llm_api_key
      ? "••••" + config.validator_llm_api_key.slice(-4)
      : "",
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const updates: Record<string, unknown> = { ...body };
  if (typeof updates.llm_api_key === "string" && updates.llm_api_key.includes("••••")) {
    delete updates.llm_api_key;
  }
  if (typeof updates.validator_llm_api_key === "string" && updates.validator_llm_api_key.includes("••••")) {
    delete updates.validator_llm_api_key;
  }
  if (typeof updates.tavily_api_key === "string" && updates.tavily_api_key.includes("••••")) {
    delete updates.tavily_api_key;
  }
  updateConfig(updates);
  return NextResponse.json({ success: true });
}
