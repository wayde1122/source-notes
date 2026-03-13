import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LLMCallLog } from "./types.js";

// ============================================================
// 日志中间件
// 记录每次 LLM 调用的耗时、token 数、错误信息
// 输出到 stdout（彩色）+ 文件（JSON Lines 格式，方便后续分析）
// ============================================================

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
} as const;

const LOG_FILE = "logs/llm-calls.jsonl";

function ensureLogDir(): void {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
}

export function logLLMCall(log: LLMCallLog): void {
  const { timestamp, model, durationMs, promptTokens, completionTokens, totalTokens, finishReason, toolCalls, error } = log;

  // stdout 彩色输出
  const parts = [
    `${ANSI.dim}${timestamp}${ANSI.reset}`,
    `${ANSI.cyan}[LLM]${ANSI.reset}`,
    `${ANSI.magenta}${model}${ANSI.reset}`,
    `${ANSI.yellow}${durationMs}ms${ANSI.reset}`,
    `tokens: ${ANSI.green}${promptTokens}+${completionTokens}=${totalTokens}${ANSI.reset}`,
    `finish: ${finishReason}`,
  ];

  if (toolCalls.length > 0) {
    parts.push(`tools: [${toolCalls.join(", ")}]`);
  }

  if (error) {
    parts.push(`${ANSI.red}ERROR: ${error}${ANSI.reset}`);
  }

  console.log(parts.join(" | "));

  // 文件输出（JSON Lines，每行一个 JSON 对象）
  ensureLogDir();
  appendFileSync(LOG_FILE, JSON.stringify(log) + "\n", "utf-8");
}

export function logToolExec(toolName: string, durationMs: number, success: boolean): void {
  const status = success
    ? `${ANSI.green}OK${ANSI.reset}`
    : `${ANSI.red}FAIL${ANSI.reset}`;
  console.log(
    `  ${ANSI.dim}└─${ANSI.reset} ${ANSI.cyan}[TOOL]${ANSI.reset} ${toolName} | ${durationMs}ms | ${status}`
  );
}

export function logInfo(msg: string): void {
  console.log(`${ANSI.dim}[INFO]${ANSI.reset} ${msg}`);
}

export function logError(msg: string): void {
  console.error(`${ANSI.red}[ERROR]${ANSI.reset} ${msg}`);
}
