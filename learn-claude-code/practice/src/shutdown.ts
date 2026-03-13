import { logInfo, logError } from "./logger.js";

// ============================================================
// 信号处理 + 优雅退出
//
// 为什么需要优雅退出？
// 1. 直接 kill 进程会导致正在处理的请求被截断
// 2. 数据库连接、文件句柄等资源不会被正确释放
// 3. 容器编排（Docker/K8s）发送 SIGTERM 后等待一段时间再 SIGKILL
//    如果不处理 SIGTERM，就浪费了这段优雅退出的窗口期
//
// SIGINT  = Ctrl+C（用户手动中断）
// SIGTERM = kill 命令 / Docker stop / K8s pod 终止
// ============================================================

type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
let shuttingDown = false;

export function registerShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    logInfo(`Already shutting down, ignoring duplicate ${signal}`);
    return;
  }
  shuttingDown = true;

  logInfo(`Received ${signal}, starting graceful shutdown...`);
  logInfo(`${hooks.length} shutdown hook(s) registered`);

  const forceExitTimer = setTimeout(() => {
    logError("Graceful shutdown timed out (10s), forcing exit");
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  for (let i = hooks.length - 1; i >= 0; i--) {
    try {
      await hooks[i]();
    } catch (err) {
      logError(`Shutdown hook ${i} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logInfo("Graceful shutdown complete");
  process.exit(0);
}

// 注册信号监听（只注册一次）
let registered = false;

export function initSignalHandlers(): void {
  if (registered) return;
  registered = true;

  process.on("SIGINT", () => { gracefulShutdown("SIGINT"); });
  process.on("SIGTERM", () => { gracefulShutdown("SIGTERM"); });

  process.on("uncaughtException", (err) => {
    logError(`Uncaught exception: ${err.message}\n${err.stack}`);
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logError(`Unhandled rejection: ${reason}`);
    gracefulShutdown("unhandledRejection");
  });

  logInfo("Signal handlers registered (SIGINT, SIGTERM, uncaughtException, unhandledRejection)");
}
