import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProfileTools } from "../src/index";
import type { BlipToolContext } from "../src/types";

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "blip-tools-"));
}

function context(workspaceRoot: string): BlipToolContext {
  return {
    workspaceRoot,
    permissionMode: "workspace-write",
    profile: "no-shell-workspace-write",
  };
}

function tool(workspaceRoot: string, name: string) {
  const found = createProfileTools(context(workspaceRoot)).find((entry) => entry.name === name);
  if (!found) throw new Error(`missing tool: ${name}`);
  return found;
}

describe("Blip tools", () => {
  test("selects a small local trusted profile", () => {
    const tools = createProfileTools({
      workspaceRoot: process.cwd(),
      permissionMode: "workspace-write",
      profile: "local-trusted-write",
    }).map((entry) => entry.name);

    expect(tools).toEqual(["bash", "apply_patch", "read_file", "search_files", "list_files"]);
  });

  test("read_file rejects workspace traversal", async () => {
    const workspace = await tempWorkspace();
    const read = tool(workspace, "read_file");

    await expect(read.execute("call_1", { path: "../outside.txt" } as never)).rejects.toThrow("path escapes workspace");
  });

  test("apply_patch adds and updates files", async () => {
    const workspace = await tempWorkspace();
    const applyPatch = tool(workspace, "apply_patch");

    await applyPatch.execute("call_1", {
      patch: ["*** Begin Patch", "*** Add File: src/example.txt", "+hello", "+world", "*** End Patch"].join("\n"),
    } as never);

    expect(await readFile(path.join(workspace, "src/example.txt"), "utf8")).toBe("hello\nworld");

    await applyPatch.execute("call_2", {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/example.txt",
        "@@",
        " hello",
        "-world",
        "+blip",
        "*** End Patch",
      ].join("\n"),
    } as never);

    expect(await readFile(path.join(workspace, "src/example.txt"), "utf8")).toBe("hello\nblip");
  });

  test("search_files finds content", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "note.txt"), "alpha\nneedle\nomega\n");
    const search = tool(workspace, "search_files");

    const result = await search.execute("call_1", { mode: "content", query: "needle" } as never);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("note.txt");
  });
});
