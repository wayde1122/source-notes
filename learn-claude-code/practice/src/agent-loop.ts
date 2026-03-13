import type { Message, ToolCall } from "./types.js";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "./tools.js";
import { chatCompletion, chatCompletionStream } from "./llm-client.js";
import { logToolExec } from "./logger.js";

// ============================================================
// 核心 Agent Loop
// 非流式版本：完整请求-响应循环
// 流式版本：逐 token 输出 + 工具调用累积
// ============================================================

const SYSTEM_PROMPT = `your name is "god yuan", You are a coding agent working in ${process.cwd()}. Use the provided tools to solve tasks. Act directly, don't explain unless asked.`;

function buildSystemMessage(): Message {
  return { role: "system", content: SYSTEM_PROMPT };
}

async function executeTool(name: string, argsJson: string): Promise<string> {
  const handler = TOOL_HANDLERS.get(name);
  if (!handler) {
    return `Error: Unknown tool "${name}"`;
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return `Error: Invalid JSON arguments for tool "${name}"`;
  }

  const start = performance.now();
  try {
    const result = await handler(args);
    logToolExec(name, Math.round(performance.now() - start), true);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToolExec(name, Math.round(performance.now() - start), false);
    return `Error: ${msg}`;
  }
}

/**
 * 非流式 Agent Loop
 * 对应 learn-claude-code s01 的核心循环，用 TypeScript + 原生 fetch 重写
 */
export async function agentLoop(
  messages: Message[],
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const allMessages: Message[] = [buildSystemMessage(), ...messages];

  while (true) {
    const response = await chatCompletion({
      messages: allMessages,
      tools: TOOL_DEFINITIONS,
      signal: opts?.signal,
    });

    const choice = response.choices[0];
    if (!choice) break;

    // 将助手回复追加到消息历史
    const assistantMsg: Message = {
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    };
    allMessages.push(assistantMsg);
    messages.push(assistantMsg);

    // 输出文本内容
    if (choice.message.content) {
      process.stdout.write(`\n${choice.message.content}\n`);
    }

    // 如果没有工具调用，循环结束
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      break;
    }

    // 执行所有工具调用，收集结果
    for (const toolCall of choice.message.tool_calls) {
      const output = await executeTool(
        toolCall.function.name,
        toolCall.function.arguments,
      );
      const toolMsg: Message = {
        role: "tool",
        content: output,
        tool_call_id: toolCall.id,
      };
      allMessages.push(toolMsg);
      messages.push(toolMsg);
    }
    // 工具结果已追加，继续下一轮循环让 LLM 处理结果
  }
}

/**
 * 流式 Agent Loop
 * 逐 token 输出文本，同时累积工具调用参数
 * 用于 SSE 服务器和终端实时输出
 */
export async function agentLoopStream(
  messages: Message[],
  opts?: {
    signal?: AbortSignal;
    onToken?: (token: string) => void;
    onToolStart?: (name: string) => void;
    onToolEnd?: (name: string, result: string) => void;
  },
): Promise<void> {
  const allMessages: Message[] = [buildSystemMessage(), ...messages];
  const { signal, onToken, onToolStart, onToolEnd } = opts ?? {};

  while (true) {
    let fullContent = "";
    const toolCallsAccum = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let finishReason: string | null = null;

    const stream = chatCompletionStream({
      messages: allMessages,
      tools: TOOL_DEFINITIONS,
      signal,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // 累积文本内容，逐 token 回调
      if (delta.content) {
        fullContent += delta.content;
        onToken?.(delta.content);
      }

      // 累积工具调用（流式中 tool_calls 是分片到达的）
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsAccum.get(tc.index);
          if (existing) {
            existing.args += tc.function?.arguments ?? "";
          } else {
            toolCallsAccum.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              args: tc.function?.arguments ?? "",
            });
          }
        }
      }

      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    }

    // 构建助手消息
    const toolCalls: ToolCall[] = [...toolCallsAccum.values()].map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    }));

    const assistantMsg: Message = {
      role: "assistant",
      content: fullContent || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    allMessages.push(assistantMsg);
    messages.push(assistantMsg);

    if (toolCalls.length === 0) break;

    // 执行工具调用
    for (const tc of toolCalls) {
      onToolStart?.(tc.function.name);
      const output = await executeTool(tc.function.name, tc.function.arguments);
      onToolEnd?.(tc.function.name, output);

      const toolMsg: Message = {
        role: "tool",
        content: output,
        tool_call_id: tc.id,
      };
      allMessages.push(toolMsg);
      messages.push(toolMsg);
    }
  }
}
