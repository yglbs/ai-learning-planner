export async function readNdjsonResponse(
  response: Response,
  onTrace: (text: string) => void,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("ndjson")) {
    return response.json();
  }
  if (!response.body) {
    throw new Error("没有响应内容");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: Record<string, unknown> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as {
        type?: string;
        text?: string;
        error?: string;
      };
      if ((event.type === "trace" || event.type === "fallback") && event.text) {
        onTrace(event.text);
      } else if (event.type === "error") {
        throw new Error(event.error || "生成失败");
      } else if (event.type === "done") {
        donePayload = event as Record<string, unknown>;
      }
    }
  }

  if (!donePayload) {
    throw new Error("生成中断，没有拿到结果");
  }
  return donePayload;
}

export function streamNdjson(
  run: (send: (event: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await run(send);
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成失败";
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
