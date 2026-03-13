import { createInterface } from "node:readline";
import type { Message } from "./types.js";
import { agentLoopStream } from "./agent-loop.js";
import { initSignalHandlers, registerShutdown } from "./shutdown.js";
import { logInfo } from "./logger.js";

// ============================================================
// 终端 REPL 入口
// 对应 learn-claude-code s01 的 main 入口
// 用 readline 实现交互式命令行，支持流式输出
// ============================================================

const ANSI = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
} as const;

initSignalHandlers();

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

registerShutdown(() => {
  rl.close();
  logInfo("REPL closed");
});

const history: Message[] = [];

function prompt(): void {
  rl.question(`${ANSI.cyan}agent >> ${ANSI.reset}`, async (input) => {
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === "q" || trimmed.toLowerCase() === "exit" || trimmed === "") {
      if (trimmed === "") {
        prompt();
        return;
      }
      logInfo("Bye!");
      rl.close();
      process.exit(0);
    }

    if (trimmed.toLowerCase() === "clear") {
      history.length = 0;
      logInfo("Conversation history cleared");
      prompt();
      return;
    }

    history.push({ role: "user", content: trimmed });

    process.stdout.write(`\n${ANSI.green}`);

    try {
      await agentLoopStream(history, {
        onToken(token) {
          process.stdout.write(token);
        },
        onToolStart(name) {
          process.stdout.write(`${ANSI.reset}\n${ANSI.dim}  ⚙ Running ${name}...${ANSI.reset}${ANSI.green}`);
        },
        onToolEnd(name, result) {
          const preview = result.length > 200 ? result.slice(0, 200) + "..." : result;
          process.stdout.write(
            `${ANSI.reset}\n${ANSI.dim}  ✓ ${name} done (${result.length} chars)${ANSI.reset}`
          );
          process.stdout.write(`\n${ANSI.dim}  ${preview.split("\n")[0]}${ANSI.reset}\n${ANSI.green}`);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${ANSI.reset}\n`);
      console.error(`${ANSI.yellow}[Agent Error] ${msg}${ANSI.reset}`);
    }

    process.stdout.write(`${ANSI.reset}\n\n`);
    prompt();
  });
}

console.log(`
${ANSI.cyan}╔══════════════════════════════════════════╗
║   Agent Loop Practice (TypeScript)       ║
║   Type your task, or 'q' to quit         ║
║   'clear' to reset conversation          ║
╚══════════════════════════════════════════╝${ANSI.reset}
`);

logInfo(`Working directory: ${process.cwd()}`);
logInfo(`Model: ${process.env.MODEL_ID ?? "gpt-4o"}`);
logInfo(`API: ${process.env.API_BASE_URL ?? "https://api.openai.com/v1"}\n`);

prompt();
