import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createApplyPatchTool } from "./apply-patch.js";
import { assertWorkspacePath, clampInt, isLikelyBinary, toWorkspaceRelative, truncateText } from "./path-utils.js";
import { textResult } from "./result.js";
import type { BlipTool, BlipToolContext, ToolProfile } from "./types.js";

const DEFAULT_OUTPUT_LIMIT = 60_000;

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function textTool(tool: AgentTool<any, any>): BlipTool {
  return tool as BlipTool;
}

function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    timeout.unref();

    const abort = () => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > DEFAULT_OUTPUT_LIMIT * 2) {
        stdout = stdout.slice(0, DEFAULT_OUTPUT_LIMIT * 2);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > DEFAULT_OUTPUT_LIMIT * 2) {
        stderr = stderr.slice(0, DEFAULT_OUTPUT_LIMIT * 2);
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

async function walkFiles(root: string, start: string, limit: number): Promise<string[]> {
  const results: string[] = [];
  const stack = [start];
  const ignored = new Set([".git", "node_modules", "dist", "build", ".turbo"]);

  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = toWorkspaceRelative(root, absolute);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile()) {
        results.push(relative);
        if (results.length >= limit) break;
      }
    }
  }

  return results;
}

function simpleGlobMatch(value: string, glob?: string): boolean {
  if (!glob) return true;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(value);
}

export function createListFilesTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "list_files",
    label: "List Files",
    description: "List direct child files and directories inside the workspace with bounded structured output.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Workspace-relative directory path. Defaults to workspace root." })),
      includeHidden: Type.Optional(Type.Boolean({ description: "Whether to include dotfiles." })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500, description: "Maximum number of entries." })),
    }),
    async execute(_toolCallId, params: any) {
      const target = assertWorkspacePath(context.workspaceRoot, params.path ?? ".");
      const entryStat = await stat(target);
      if (!entryStat.isDirectory()) throw new Error("path is not a directory");
      const limit = clampInt(params.limit, 200, 1, 500);
      const includeHidden = params.includeHidden === true;
      const entries = (await readdir(target, { withFileTypes: true }))
        .filter((entry) => includeHidden || !entry.name.startsWith("."))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, limit);
      const details = await Promise.all(
        entries.map(async (entry) => {
          const absolute = path.join(target, entry.name);
          const info = await stat(absolute);
          return {
            path: toWorkspaceRelative(context.workspaceRoot, absolute),
            type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          };
        }),
      );
      const text = details.map((entry) => `${entry.type === "directory" ? "dir " : "file"} ${entry.path}`).join("\n");
      return textResult(text || "(empty)", { entries: details, truncated: entries.length === limit });
    },
  });
}

export function createReadFileTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "read_file",
    label: "Read File",
    description: "Read a text file inside the workspace with line numbers and bounded ranges.",
    parameters: Type.Object({
      path: Type.String({ description: "Workspace-relative file path." }),
      offset: Type.Optional(Type.Number({ minimum: 0, description: "Zero-based line offset." })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: "Maximum number of lines." })),
    }),
    async execute(_toolCallId, params: any) {
      const target = assertWorkspacePath(context.workspaceRoot, params.path);
      const info = await stat(target);
      if (info.isDirectory()) throw new Error("path is a directory");
      const buffer = await readFile(target);
      if (isLikelyBinary(buffer)) throw new Error("file appears to be binary");
      const content = buffer.toString("utf8");
      const lines = content.split(/\r?\n/);
      const offset = clampInt(params.offset, 0, 0, Math.max(0, lines.length));
      const limit = clampInt(params.limit, 200, 1, 1000);
      const selected = lines.slice(offset, offset + limit);
      const numbered = selected.map((line, index) => `${String(offset + index + 1).padStart(6, " ")} | ${line}`);
      const truncated = offset + limit < lines.length;
      const relative = toWorkspaceRelative(context.workspaceRoot, target);
      context.onFileOperation?.("read", relative);
      return textResult(
        `${numbered.join("\n")}${truncated ? `\n[continue with offset ${offset + limit}]` : ""}`,
        {
          path: relative,
          offset,
          lineCount: lines.length,
          returnedLines: selected.length,
          truncated,
          sha256: hashBuffer(buffer),
        },
      );
    },
  });
}

export function createSearchFilesTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "search_files",
    label: "Search Files",
    description: "Search workspace files by relative path or content.",
    parameters: Type.Object({
      query: Type.String({ description: "Text or pattern to search for." }),
      mode: Type.Union([Type.Literal("name"), Type.Literal("content")], { description: "Search names or content." }),
      path: Type.Optional(Type.String({ description: "Workspace-relative search root." })),
      includeGlob: Type.Optional(Type.String({ description: "Optional include glob." })),
      excludeGlob: Type.Optional(Type.String({ description: "Optional exclude glob." })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500, description: "Maximum matches." })),
    }),
    async execute(_toolCallId, params: any, signal) {
      const searchRoot = assertWorkspacePath(context.workspaceRoot, params.path ?? ".");
      const limit = clampInt(params.limit, 100, 1, 500);
      if (params.mode === "name") {
        const files = await walkFiles(context.workspaceRoot, searchRoot, 10_000);
        const matches = files
          .filter((file) => file.includes(params.query))
          .filter((file) => simpleGlobMatch(file, params.includeGlob))
          .filter((file) => !params.excludeGlob || !simpleGlobMatch(file, params.excludeGlob))
          .slice(0, limit);
        const text = matches.join("\n") || "(no matches)";
        return textResult(text, { matches, truncated: matches.length === limit });
      }

      const rgArgs = ["--line-number", "--no-heading", "--color", "never"];
      if (params.includeGlob) rgArgs.push("--glob", params.includeGlob);
      if (params.excludeGlob) rgArgs.push("--glob", `!${params.excludeGlob}`);
      rgArgs.push(params.query, ".");
      try {
        const result = await runCommand(`rg ${rgArgs.map((arg) => JSON.stringify(arg)).join(" ")}`, searchRoot, 30_000, signal);
        const lines = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit);
        const matches = lines.map((line) => {
          const [file = "", lineNumber = "", ...previewParts] = line.split(":");
          const absolute = path.resolve(searchRoot, file);
          return {
            path: toWorkspaceRelative(context.workspaceRoot, absolute),
            line: Number(lineNumber) || undefined,
            preview: previewParts.join(":").trim(),
          };
        });
        for (const match of matches) context.onFileOperation?.("read", match.path);
        return textResult(lines.join("\n") || "(no matches)", { matches, truncated: lines.length === limit });
      } catch {
        const files = await walkFiles(context.workspaceRoot, searchRoot, 10_000);
        const matches: Array<{ path: string; line: number; preview: string }> = [];
        for (const file of files) {
          if (matches.length >= limit) break;
          if (!simpleGlobMatch(file, params.includeGlob)) continue;
          if (params.excludeGlob && simpleGlobMatch(file, params.excludeGlob)) continue;
          const absolute = assertWorkspacePath(context.workspaceRoot, file);
          const buffer = await readFile(absolute);
          if (isLikelyBinary(buffer)) continue;
          const lines = buffer.toString("utf8").split(/\r?\n/);
          for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
            if (lines[index].includes(params.query)) {
              matches.push({ path: file, line: index + 1, preview: lines[index].trim() });
              context.onFileOperation?.("read", file);
            }
          }
        }
        return textResult(
          matches.map((match) => `${match.path}:${match.line}:${match.preview}`).join("\n") || "(no matches)",
          { matches, truncated: matches.length === limit },
        );
      }
    },
  });
}

export function createBashTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "bash",
    label: "Bash",
    description: "Run a non-interactive bash command in the local workspace.",
    parameters: Type.Object({
      command: Type.String({ description: "Command to run with bash." }),
      cwd: Type.Optional(Type.String({ description: "Workspace-relative working directory." })),
      timeoutMs: Type.Optional(Type.Number({ minimum: 1000, description: "Timeout in milliseconds." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params: any, signal) {
      if (context.profile !== "local-trusted-write") throw new Error("bash is only available in local-trusted-write");
      const cwd = assertWorkspacePath(context.workspaceRoot, params.cwd ?? ".");
      const timeoutMs = clampInt(params.timeoutMs, 120_000, 1_000, 30 * 60_000);
      const result = await runCommand(params.command, cwd, timeoutMs, signal);
      const stdout = truncateText(result.stdout, DEFAULT_OUTPUT_LIMIT);
      const stderr = truncateText(result.stderr, DEFAULT_OUTPUT_LIMIT);
      const textParts = [
        `exitCode: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
        stdout.text ? `stdout:\n${stdout.text}` : "",
        stderr.text ? `stderr:\n${stderr.text}` : "",
      ].filter(Boolean);
      return textResult(textParts.join("\n\n"), {
        ...result,
        cwd: toWorkspaceRelative(context.workspaceRoot, cwd),
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    },
  });
}

export function createWriteFileTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "write_file",
    label: "Write File",
    description: "Create or overwrite a complete file inside the workspace.",
    parameters: Type.Object({
      path: Type.String({ description: "Workspace-relative file path." }),
      content: Type.String({ description: "Complete file content." }),
      mode: Type.Union([Type.Literal("create"), Type.Literal("overwrite")]),
      baseHash: Type.Optional(Type.String({ description: "Optional previous sha256 hash." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params: any) {
      const target = assertWorkspacePath(context.workspaceRoot, params.path);
      let exists = true;
      try {
        const current = await readFile(target);
        if (params.baseHash && hashBuffer(current) !== params.baseHash) throw new Error("baseHash does not match");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
        else throw error;
      }
      if (params.mode === "create" && exists) throw new Error("file already exists");
      if (params.mode === "overwrite" && !exists) throw new Error("file does not exist");
      if (params.mode === "create") await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, params.content);
      const relative = toWorkspaceRelative(context.workspaceRoot, target);
      context.onFileOperation?.("modified", relative);
      return textResult(`wrote ${relative}`, { path: relative, bytes: Buffer.byteLength(params.content), created: !exists });
    },
  });
}

export function createDeleteFileTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "delete_file",
    label: "Delete File",
    description: "Delete one file inside the workspace.",
    parameters: Type.Object({
      path: Type.String({ description: "Workspace-relative file path." }),
      baseHash: Type.Optional(Type.String({ description: "Optional current sha256 hash." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params: any) {
      const target = assertWorkspacePath(context.workspaceRoot, params.path);
      const info = await stat(target);
      if (info.isDirectory()) throw new Error("path is a directory");
      const current = await readFile(target);
      if (params.baseHash && hashBuffer(current) !== params.baseHash) throw new Error("baseHash does not match");
      await rm(target);
      const relative = toWorkspaceRelative(context.workspaceRoot, target);
      context.onFileOperation?.("modified", relative);
      return textResult(`deleted ${relative}`, { path: relative, size: info.size, sha256: hashBuffer(current) });
    },
  });
}

export function createDirectoryTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "create_directory",
    label: "Create Directory",
    description: "Create a directory inside the workspace.",
    parameters: Type.Object({
      path: Type.String({ description: "Workspace-relative directory path." }),
      recursive: Type.Optional(Type.Boolean({ description: "Create missing parents." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params: any) {
      const target = assertWorkspacePath(context.workspaceRoot, params.path);
      await mkdir(target, { recursive: params.recursive === true });
      const relative = toWorkspaceRelative(context.workspaceRoot, target);
      context.onFileOperation?.("modified", relative);
      return textResult(`created directory ${relative}`, { path: relative, recursive: params.recursive === true });
    },
  });
}

export function deleteDirectoryTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "delete_directory",
    label: "Delete Directory",
    description: "Delete a directory inside the workspace.",
    parameters: Type.Object({
      path: Type.String({ description: "Workspace-relative directory path." }),
      recursive: Type.Optional(Type.Boolean({ description: "Delete non-empty directories." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params: any) {
      const target = assertWorkspacePath(context.workspaceRoot, params.path);
      const info = await stat(target);
      if (!info.isDirectory()) throw new Error("path is not a directory");
      if (params.recursive === true) await rm(target, { recursive: true, force: false });
      else await rmdir(target);
      const relative = toWorkspaceRelative(context.workspaceRoot, target);
      context.onFileOperation?.("modified", relative);
      return textResult(`deleted directory ${relative}`, { path: relative, recursive: params.recursive === true });
    },
  });
}

export function createMovePathTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "move_path",
    label: "Move Path",
    description: "Move or rename a file or directory inside the workspace.",
    parameters: Type.Object({
      from: Type.String({ description: "Workspace-relative source path." }),
      to: Type.String({ description: "Workspace-relative destination path." }),
      overwrite: Type.Optional(Type.Boolean({ description: "Overwrite destination if it exists." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params: any) {
      const from = assertWorkspacePath(context.workspaceRoot, params.from);
      const to = assertWorkspacePath(context.workspaceRoot, params.to);
      await stat(from);
      try {
        await stat(to);
        if (params.overwrite !== true) throw new Error("destination exists");
        await rm(to, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(from, to);
      const fromRel = toWorkspaceRelative(context.workspaceRoot, from);
      const toRel = toWorkspaceRelative(context.workspaceRoot, to);
      context.onFileOperation?.("modified", fromRel);
      context.onFileOperation?.("modified", toRel);
      return textResult(`moved ${fromRel} -> ${toRel}`, { from: fromRel, to: toRel, overwritten: params.overwrite === true });
    },
  });
}

export function createGetWorkingTreeStatusTool(context: BlipToolContext): BlipTool {
  return textTool({
    name: "get_working_tree_status",
    label: "Working Tree Status",
    description: "Return bounded git working-tree status for the workspace.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Workspace-relative directory to inspect." })),
      includeDiffSummary: Type.Optional(Type.Boolean({ description: "Include diff summary." })),
    }),
    async execute(_toolCallId, params: any, signal) {
      const cwd = assertWorkspacePath(context.workspaceRoot, params.path ?? ".");
      const status = await runCommand("git status --short --branch", cwd, 30_000, signal);
      const diff = params.includeDiffSummary === true ? await runCommand("git diff --stat", cwd, 30_000, signal) : undefined;
      const text = [status.stdout.trim() || status.stderr.trim() || "(not a git repository)", diff?.stdout.trim()].filter(Boolean).join("\n\n");
      return textResult(text, {
        cwd: toWorkspaceRelative(context.workspaceRoot, cwd),
        status: status.stdout,
        statusError: status.stderr,
        diffSummary: diff?.stdout,
      });
    },
  });
}

export function createProfileTools(context: BlipToolContext): BlipTool[] {
  const common = [createReadFileTool(context), createSearchFilesTool(context), createListFilesTool(context)];
  if (context.profile === "read-only") {
    return [...common, createGetWorkingTreeStatusTool(context)];
  }
  if (context.profile === "no-shell-workspace-write") {
    return [
      createApplyPatchTool(context),
      ...common,
      createWriteFileTool(context),
      createDeleteFileTool(context),
      createDirectoryTool(context),
      deleteDirectoryTool(context),
      createMovePathTool(context),
      createGetWorkingTreeStatusTool(context),
    ];
  }
  return [createBashTool(context), createApplyPatchTool(context), ...common];
}

export function toolsForProfile(profile: ToolProfile): string[] {
  if (profile === "read-only") return ["read_file", "search_files", "list_files", "get_working_tree_status"];
  if (profile === "no-shell-workspace-write") {
    return [
      "apply_patch",
      "read_file",
      "search_files",
      "list_files",
      "write_file",
      "delete_file",
      "create_directory",
      "delete_directory",
      "move_path",
      "get_working_tree_status",
    ];
  }
  return ["bash", "apply_patch", "read_file", "search_files", "list_files"];
}
