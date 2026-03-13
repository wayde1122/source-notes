import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { Message } from "./types.js";
import { agentLoopStream } from "./agent-loop.js";
import { logInfo, logError } from "./logger.js";
import { registerShutdown } from "./shutdown.js";

// ============================================================
// SSE 流式响应服务器
// 用原生 node:http 模块实现，不依赖 Express/Koa 等框架
//
// 协议：Server-Sent Events (text/event-stream)
// 客户端用 EventSource API 或 fetch + ReadableStream 消费
// ============================================================

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function sendSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 读取请求体
  const raw = await readBody(req);
  let userMessage: string;
  try {
    const body = JSON.parse(raw) as { message?: string };
    userMessage = body.message ?? "";
  } catch {
    res.writeHead(400, { "Content-Type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: "Invalid JSON body. Expected: { message: string }" }));
    return;
  }

  if (!userMessage.trim()) {
    res.writeHead(400, { "Content-Type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: "message is required" }));
    return;
  }

  // SSE 响应头
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS_HEADERS,
  });

  const messages: Message[] = [{ role: "user", content: userMessage }];

  // 客户端断开时中止
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    await agentLoopStream(messages, {
      signal: ac.signal,
      onToken(token) {
        sendSSE(res, "token", { token });
      },
      onToolStart(name) {
        sendSSE(res, "tool_start", { tool: name });
      },
      onToolEnd(name, result) {
        sendSSE(res, "tool_end", { tool: name, result: result.slice(0, 2000) });
      },
    });

    sendSSE(res, "done", { status: "complete" });
  } catch (err) {
    if (ac.signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    sendSSE(res, "error", { error: msg });
    logError(`SSE stream error: ${msg}`);
  } finally {
    res.end();
  }
}

function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  const { method, url } = req;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // 健康检查
  if (method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // SSE 聊天端点
  if (method === "POST" && url === "/chat") {
    handleChat(req, res).catch((err) => {
      logError(`Unhandled error in /chat: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify({ error: "Not found", routes: ["POST /chat", "GET /health"] }));
}

const server = createServer(requestHandler);

// 注册优雅退出
registerShutdown(() => {
  return new Promise<void>((resolve) => {
    logInfo("Closing HTTP server...");
    server.close(() => resolve());
    // 强制超时兜底
    setTimeout(() => resolve(), 5000);
  });
});

server.listen(PORT, () => {
  logInfo(`SSE server listening on http://localhost:${PORT}`);
  logInfo("Routes: POST /chat (SSE stream), GET /health");
});
