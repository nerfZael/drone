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

  test("profile tools do not force sequential batches", () => {
    for (const profile of ["local-trusted-write", "read-only", "no-shell-workspace-write"] as const) {
      const tools = createProfileTools({
        workspaceRoot: process.cwd(),
        permissionMode: "workspace-write",
        profile,
      });
      for (const entry of tools) expect(entry.executionMode).not.toBe("sequential");
    }
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
      patch: ["*** Begin Patch", "*** Update File: src/example.txt", "@@", " hello", "-world", "+blip", "*** End Patch"].join("\n"),
    } as never);

    expect(await readFile(path.join(workspace, "src/example.txt"), "utf8")).toBe("hello\nblip");
  });

  test("same-path concurrent creates are serialized", async () => {
    const workspace = await tempWorkspace();
    const write = tool(workspace, "write_file");

    const results = await Promise.allSettled([write.execute("call_1", { path: "race.txt", content: "one", mode: "create" } as never), write.execute("call_2", { path: "race.txt", content: "two", mode: "create" } as never)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["one", "two"]).toContain(await readFile(path.join(workspace, "race.txt"), "utf8"));
  });

  test("search_files finds content", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "note.txt"), "alpha\nneedle\nomega\n");
    const search = tool(workspace, "search_files");

    const result = await search.execute("call_1", { mode: "content", query: "needle" } as never);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("note.txt");
  });

  test("search_files searches a file path in content mode", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "note.txt"), "alpha\nneedle\nomega\n");
    const search = tool(workspace, "search_files");

    const result = await search.execute("call_1", { mode: "content", query: "needle", path: "note.txt" } as never);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("note.txt:2:needle");
    expect(result.details).toMatchObject({ engine: "file", smartCase: true });
  });

  test("search_files searches a file path in name mode", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "VoiceSettings.ts"), "export const LanguageCode = 'en';\n");
    const search = tool(workspace, "search_files");

    const result = await search.execute("call_1", { mode: "name", query: "voicesettings", path: "VoiceSettings.ts" } as never);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("VoiceSettings.ts");
    expect(result.details).toMatchObject({ engine: "file", smartCase: true });
  });

  test("search_files uses smart-case matching for names and content", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "VoiceSettings.ts"), "export const LanguageCode = 'en';\n");
    const search = tool(workspace, "search_files");

    const nameResult = await search.execute("call_1", {
      mode: "name",
      query: "voicesettings",
    } as never);
    expect(nameResult.content[0]?.type === "text" ? nameResult.content[0].text : "").toContain("VoiceSettings.ts");

    const contentResult = await search.execute("call_2", {
      mode: "content",
      query: "languagecode",
    } as never);
    expect(contentResult.content[0]?.type === "text" ? contentResult.content[0].text : "").toContain("LanguageCode");
    expect(contentResult.details).toMatchObject({ smartCase: true });
  });

  test("apply_patch context failures include expected and nearby content", async () => {
    const workspace = await tempWorkspace();
    await writeFile(path.join(workspace, "example.txt"), "alpha\nneedle current\nomega\n");
    const applyPatch = tool(workspace, "apply_patch");

    await expect(
      applyPatch.execute("call_1", {
        patch: ["*** Begin Patch", "*** Update File: example.txt", "@@", " alpha", "-needle stale", "+needle updated", " omega", "*** End Patch"].join("\n"),
      } as never),
    ).rejects.toThrow(/Patch expected this existing context:[\s\S]*needle stale[\s\S]*Nearest matching file content:[\s\S]*needle current/);
  });
});
