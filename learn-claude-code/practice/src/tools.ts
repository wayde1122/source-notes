import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import type { ToolDefinition, ToolHandler } from "./types.js";

const WORKDIR = process.cwd();
const MAX_OUTPUT = 50_000;

function safePath(p: string): string {
  const resolved = resolve(WORKDIR, p);
  const rel = relative(WORKDIR, resolved);
  if (rel.startsWith("..") || resolve(resolved) !== resolved && rel.startsWith("..")) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

function runBash(command: string): string {
  const blocked = ["rm -rf /", "shutdown", "reboot", "> /dev/"];
  for (const pattern of blocked) {
    if (command.includes(pattern)) {
      return `Error: Dangerous command blocked — "${pattern}"`;
    }
  }
  try {
    const result = execSync(command, {
      cwd: WORKDIR,
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = result.trim();
    return output ? output.slice(0, MAX_OUTPUT) : "(no output)";
  } catch (err) {
    if (err instanceof Error && "killed" in err) {
      return "Error: Timeout (120s)";
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg.slice(0, 2000)}`;
  }
}

function runRead(path: string, limit?: number): string {
  const fullPath = safePath(path);
  const text = readFileSync(fullPath, "utf-8");
  const lines = text.split("\n");
  if (limit != null && limit < lines.length) {
    return [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`]
      .join("\n")
      .slice(0, MAX_OUTPUT);
  }
  return text.slice(0, MAX_OUTPUT);
}

function runWrite(path: string, content: string): string {
  const fullPath = safePath(path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
  return `Wrote ${content.length} chars to ${path}`;
}

function runEdit(path: string, oldText: string, newText: string): string {
  const fullPath = safePath(path);
  const content = readFileSync(fullPath, "utf-8");
  if (!content.includes(oldText)) {
    return `Error: old_text not found in ${path}`;
  }
  writeFileSync(fullPath, content.replace(oldText, newText), "utf-8");
  return `Edited ${path}`;
}

// ---- 工具 Schema 定义 ----

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command and return stdout+stderr.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to execute" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file's content. Optionally limit to first N lines.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          limit: { type: "number", description: "Max lines to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace the first occurrence of old_text with new_text in a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          old_text: { type: "string", description: "Text to find" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
    },
  },
];

// ---- 分发表：工具名 → 处理函数 ----

export const TOOL_HANDLERS = new Map<string, ToolHandler>([
  ["bash", (args) => runBash(args.command as string)],
  ["read_file", (args) => runRead(args.path as string, args.limit as number | undefined)],
  ["write_file", (args) => runWrite(args.path as string, args.content as string)],
  ["edit_file", (args) => runEdit(args.path as string, args.old_text as string, args.new_text as string)],
]);
