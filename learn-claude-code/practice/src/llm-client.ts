import type {
  Message,
  ToolDefinition,
  ChatCompletionResponse,
  ChatCompletionChunk,
  LLMCallLog,
} from "./types.js";
import { logLLMCall, logError } from "./logger.js";

// ============================================================
// LLM 客户端
// 用原生 fetch 调用 OpenAI 兼容 API，不依赖任何 SDK
// 包含重试逻辑和日志记录
// ============================================================

const API_BASE_URL = (process.env.API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = (process.env.API_KEY ?? "").trim();
const MODEL_ID = (process.env.MODEL_ID ?? "gpt-4o").trim();
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

interface CallOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  stream?: boolean;
  signal?: AbortSignal;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 非流式调用：返回完整的 ChatCompletionResponse
 * 带指数退避重试
 */
export async function chatCompletion(opts: CallOptions): Promise<ChatCompletionResponse> {
  const { messages, tools, signal } = opts;

  const body: Record<string, unknown> = {
    model: MODEL_ID,
    messages,
    max_tokens: 8000,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const start = performance.now();
    try {
      const res = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const durationMs = Math.round(performance.now() - start);

      const choice = data.choices[0];
      const toolCalls = choice?.message.tool_calls?.map((tc) => tc.function.name) ?? [];

      const log: LLMCallLog = {
        timestamp: new Date().toISOString(),
        model: data.model,
        durationMs,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        finishReason: choice?.finish_reason ?? "unknown",
        toolCalls,
        error: null,
      };
      logLLMCall(log);

      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const durationMs = Math.round(performance.now() - start);

      if (signal?.aborted) {
        throw lastError;
      }

      logLLMCall({
        timestamp: new Date().toISOString(),
        model: MODEL_ID,
        durationMs,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        finishReason: "error",
        toolCalls: [],
        error: lastError.message,
      });

      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        logError(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("All retries exhausted");
}

/**
 * 流式调用：返回 AsyncGenerator，逐个 yield SSE chunk
 * 手动解析 SSE 协议（text/event-stream）
 */
export async function* chatCompletionStream(
  opts: CallOptions
): AsyncGenerator<ChatCompletionChunk, void, undefined> {
  const { messages, tools, signal } = opts;

  const body: Record<string, unknown> = {
    model: MODEL_ID,
    messages,
    max_tokens: 8000,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const url = `${API_BASE_URL}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    const msg = `HTTP ${res.status}: ${text.slice(0, 500)}`;
    logError(`Stream request failed: ${msg}`);
    throw new Error(msg);
  }

  if (!res.body) {
    throw new Error("Response body is null — streaming not supported");
  }

  // 手动解析 SSE：逐行读取，遇到 "data: " 前缀就解析 JSON
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const rawChunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(rawChunk, { stream: true });

    const lines = buffer.split("\n");
    // 最后一行可能不完整，留到下次处理
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith(":")) continue;
      if (trimmed === "data: [DONE]") return;

      if (trimmed.startsWith("data: ")) {
        const json = trimmed.slice(6);
        try {
          yield JSON.parse(json) as ChatCompletionChunk;
        } catch {
          logError(`Failed to parse SSE chunk: ${json.slice(0, 200)}`);
        }
      }
    }
  }
}
