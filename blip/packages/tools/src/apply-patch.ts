import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@mariozechner/pi-ai";
import { withMutationLocks } from "./mutation-locks.js";
import { assertWorkspacePath, toWorkspaceRelative } from "./path-utils.js";
import { textResult } from "./result.js";
import type { BlipTool, BlipToolContext } from "./types.js";

export type PatchOperation = { type: "add"; path: string; lines: string[] } | { type: "delete"; path: string } | { type: "update"; path: string; moveTo?: string; hunks: PatchLine[][] };

export type PatchLine = {
  kind: "context" | "remove" | "add";
  text: string;
};

export function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") throw new Error("patch must start with *** Begin Patch");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines[lines.length - 1] !== "*** End Patch") throw new Error("patch must end with *** End Patch");

  const operations: PatchOperation[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const line = lines[index];
    if (line.startsWith("*** Add File: ")) {
      const target = line.slice("*** Add File: ".length).trim();
      index += 1;
      const content: string[] = [];
      while (index < lines.length - 1 && !lines[index].startsWith("*** ")) {
        if (!lines[index].startsWith("+")) throw new Error(`Add File lines must start with + for ${target}`);
        content.push(lines[index].slice(1));
        index += 1;
      }
      operations.push({ type: "add", path: target, lines: content });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({ type: "delete", path: line.slice("*** Delete File: ".length).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const target = line.slice("*** Update File: ".length).trim();
      index += 1;
      let moveTo: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = lines[index].slice("*** Move to: ".length).trim();
        index += 1;
      }
      const hunks: PatchLine[][] = [];
      let current: PatchLine[] = [];
      while (index < lines.length - 1 && !lines[index].startsWith("*** ")) {
        const currentLine = lines[index];
        if (currentLine.startsWith("@@")) {
          if (current.length > 0) hunks.push(current);
          current = [];
        } else if (currentLine.startsWith(" ")) {
          current.push({ kind: "context", text: currentLine.slice(1) });
        } else if (currentLine.startsWith("-")) {
          current.push({ kind: "remove", text: currentLine.slice(1) });
        } else if (currentLine.startsWith("+")) {
          current.push({ kind: "add", text: currentLine.slice(1) });
        } else {
          throw new Error(`invalid update line for ${target}: ${currentLine}`);
        }
        index += 1;
      }
      if (current.length > 0) hunks.push(current);
      if (!moveTo && hunks.length === 0) throw new Error(`Update File has no changes: ${target}`);
      operations.push({ type: "update", path: target, moveTo, hunks });
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }
    throw new Error(`unknown patch operation: ${line}`);
  }

  if (operations.length === 0) throw new Error("patch has no operations");
  return operations;
}

function findSubsequence(haystack: string[], needle: string[], fromIndex: number): number {
  if (needle.length === 0) return fromIndex;
  for (let index = fromIndex; index <= haystack.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function formatNumberedLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${String(startLine + index).padStart(6, " ")} | ${line}`).join("\n");
}

function bestContextWindow(lines: string[], oldLines: string[]): { startLine: number; lines: string[] } | undefined {
  const anchors = oldLines.map((line) => line.trim()).filter(Boolean);
  for (const anchor of anchors) {
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index >= 0) {
      const start = Math.max(0, index - 3);
      const end = Math.min(lines.length, index + 4);
      return { startLine: start + 1, lines: lines.slice(start, end) };
    }
  }
  return undefined;
}

function patchContextFailureMessage(lines: string[], oldLines: string[], filePath: string): string {
  const expected = oldLines.slice(0, 12);
  const expectedText = expected.length > 0 ? formatNumberedLines(expected, 1) : "(empty context)";
  const nearby = bestContextWindow(lines, oldLines);
  const nearbyText = nearby ? formatNumberedLines(nearby.lines, nearby.startLine) : "(no nearby exact line match found)";
  const suffix = oldLines.length > expected.length ? `\n... ${oldLines.length - expected.length} more expected lines omitted` : "";
  return [`could not find patch context in ${filePath}`, "Patch expected this existing context:", expectedText + suffix, "Nearest matching file content:", nearbyText, "Read the current file around the target area and retry with fresh context."].join("\n");
}

export function applyPatchHunks(original: string, hunks: PatchLine[][], filePath: string): string {
  let lines = original.split(/\r?\n/);
  let searchFrom = 0;

  for (const hunk of hunks) {
    const oldLines = hunk.filter((line) => line.kind !== "add").map((line) => line.text);
    const newLines = hunk.filter((line) => line.kind !== "remove").map((line) => line.text);
    const found = findSubsequence(lines, oldLines, searchFrom);
    if (found < 0) {
      throw new Error(patchContextFailureMessage(lines, oldLines, filePath));
    }
    lines = [...lines.slice(0, found), ...newLines, ...lines.slice(found + oldLines.length)];
    searchFrom = found + newLines.length;
  }

  return lines.join("\n");
}

export function createApplyPatchTool(context: BlipToolContext): BlipTool {
  return {
    name: "apply_patch",
    label: "Apply Patch",
    description: "Apply a strict patch envelope inside the workspace. Pass the envelope directly, without Markdown fences or leading text.",
    parameters: Type.Object({
      patch: Type.String({
        description:
          "Patch text that starts with '*** Begin Patch', contains operations such as '*** Update File: path' followed by '@@' and space/-/+ lines, and ends with '*** End Patch'. Do not wrap it in Markdown fences.",
      }),
      baseHash: Type.Optional(Type.String({ description: "Optional stale workspace marker." })),
    }),
    async execute(_toolCallId, params: any) {
      const operations = parsePatch(params.patch);
      const lockPaths = operations.flatMap((operation) => {
        if (operation.type === "update" && operation.moveTo) {
          return [assertWorkspacePath(context.workspaceRoot, operation.path), assertWorkspacePath(context.workspaceRoot, operation.moveTo)];
        }
        return [assertWorkspacePath(context.workspaceRoot, operation.path)];
      });

      return withMutationLocks(lockPaths, async () => {
        const planned: Array<{
          operation: PatchOperation;
          source?: string;
          target?: string;
          content?: string;
        }> = [];

        for (const operation of operations) {
          if (operation.type === "add") {
            const target = assertWorkspacePath(context.workspaceRoot, operation.path);
            try {
              await stat(target);
              throw new Error(`file already exists: ${operation.path}`);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            planned.push({ operation, target, content: operation.lines.join("\n") });
          } else if (operation.type === "delete") {
            const target = assertWorkspacePath(context.workspaceRoot, operation.path);
            const info = await stat(target);
            if (info.isDirectory()) throw new Error(`Delete File target is a directory: ${operation.path}`);
            planned.push({ operation, target });
          } else {
            const source = assertWorkspacePath(context.workspaceRoot, operation.path);
            const current = await readFile(source, "utf8");
            const content = operation.hunks.length > 0 ? applyPatchHunks(current, operation.hunks, operation.path) : current;
            const target = operation.moveTo ? assertWorkspacePath(context.workspaceRoot, operation.moveTo) : source;
            if (operation.moveTo) {
              try {
                await stat(target);
                throw new Error(`move destination exists: ${operation.moveTo}`);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
              }
            }
            planned.push({ operation, source, target, content });
          }
        }

        const changedPaths: string[] = [];
        for (const item of planned) {
          if (item.operation.type === "add") {
            if (!item.target || item.content === undefined) throw new Error("invalid planned add");
            await mkdir(path.dirname(item.target), { recursive: true });
            await writeFile(item.target, item.content);
            changedPaths.push(toWorkspaceRelative(context.workspaceRoot, item.target));
          } else if (item.operation.type === "delete") {
            if (!item.target) throw new Error("invalid planned delete");
            await rm(item.target);
            changedPaths.push(toWorkspaceRelative(context.workspaceRoot, item.target));
          } else {
            if (!item.source || !item.target || item.content === undefined) throw new Error("invalid planned update");
            if (item.operation.moveTo) {
              await mkdir(path.dirname(item.target), { recursive: true });
              await rename(item.source, item.target);
            }
            await writeFile(item.target, item.content);
            changedPaths.push(toWorkspaceRelative(context.workspaceRoot, item.source));
            changedPaths.push(toWorkspaceRelative(context.workspaceRoot, item.target));
          }
        }

        const uniqueChanged = Array.from(new Set(changedPaths));
        for (const filePath of uniqueChanged) context.onFileOperation?.("modified", filePath);
        return textResult(`applied patch\n${uniqueChanged.join("\n")}`, {
          changedPaths: uniqueChanged,
          operations: operations.map((operation) => operation.type),
        });
      });
    },
  };
}
