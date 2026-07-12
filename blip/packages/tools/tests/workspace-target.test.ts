import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateToolArguments } from "@mariozechner/pi-ai";
import {
  LocalWorkspaceTarget,
  WorkspaceTargetCatalog,
  createWorkspaceTargetSelectionTools,
  createWorkspaceTargetTools,
  type WorkspaceTarget,
} from "../src/index";

async function tempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function findTool(tools: ReturnType<typeof createWorkspaceTargetTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool: ${name}`);
  return tool;
}

function exposesTargetParameter(tool: ReturnType<typeof findTool>): boolean {
  return JSON.stringify(tool.parameters).includes('"target"');
}

describe("Workspace targets", () => {
  test("runs the same read and write contracts through a local target", async () => {
    const root = await tempWorkspace("blip-target-local-");
    const target = new LocalWorkspaceTarget({
      workspaceRoot: root,
      permissionMode: "workspace-write",
      profile: "no-shell-workspace-write",
    });
    const tools = createWorkspaceTargetTools({
      profile: "no-shell-workspace-write",
      resolveTarget: () => target,
    });
    expect(exposesTargetParameter(findTool(tools, "read_file"))).toBe(false);

    await findTool(tools, "write_file").execute("write", {
      path: "notes/example.txt",
      content: "hello target\n",
      mode: "create",
    } as never);
    const read = await findTool(tools, "read_file").execute("read", {
      path: "notes/example.txt",
    } as never);

    expect(await readFile(path.join(root, "notes/example.txt"), "utf8")).toBe("hello target\n");
    expect(read.content[0]?.type === "text" ? read.content[0].text : "").toContain("hello target");
    expect(read.details).toMatchObject({ target: { id: "local", kind: "local" } });
  });

  test("supports explicit targets and freezes resolution before execution", async () => {
    const rootA = await tempWorkspace("blip-target-a-");
    const rootB = await tempWorkspace("blip-target-b-");
    await writeFile(path.join(rootA, "value.txt"), "from a\n");
    await writeFile(path.join(rootB, "value.txt"), "from b\n");
    const targetA = new LocalWorkspaceTarget({
      id: "a",
      workspaceRoot: rootA,
      permissionMode: "read-only",
      profile: "read-only",
    });
    const targetB = new LocalWorkspaceTarget({
      id: "b",
      workspaceRoot: rootB,
      permissionMode: "read-only",
      profile: "read-only",
    });
    const catalog = new WorkspaceTargetCatalog([targetA, targetB], "a");
    const tools = createWorkspaceTargetTools({
      profile: "read-only",
      catalog,
    });
    expect(exposesTargetParameter(findTool(tools, "read_file"))).toBe(true);
    expect(validateToolArguments(findTool(tools, "read_file") as any, {
      id: "validated-explicit",
      type: "toolCall",
      name: "read_file",
      arguments: { target: "a", path: "value.txt" },
    } as any)).toMatchObject({ target: "a", path: "value.txt" });

    const frozen = await findTool(tools, "read_file").execute("frozen", {
      path: "value.txt",
    } as never);
    const explicit = await findTool(tools, "read_file").execute("explicit", {
      target: "a",
      path: "value.txt",
    } as never);

    expect(frozen.content[0]?.type === "text" ? frozen.content[0].text : "").toContain("from a");
    expect(explicit.details).toMatchObject({ target: { id: "a" } });
  });

  test("lists and selects the active target", async () => {
    const rootA = await tempWorkspace("blip-target-select-a-");
    const rootB = await tempWorkspace("blip-target-select-b-");
    const targetA = new LocalWorkspaceTarget({ id: "a", workspaceRoot: rootA, permissionMode: "read-only", profile: "read-only" });
    const targetB = new LocalWorkspaceTarget({ id: "b", workspaceRoot: rootB, permissionMode: "read-only", profile: "read-only" });
    const catalog = new WorkspaceTargetCatalog([targetA, targetB], "a");
    const tools = createWorkspaceTargetSelectionTools(catalog);
    const listed = await findTool(tools as ReturnType<typeof createWorkspaceTargetTools>, "list_targets").execute("list", {} as never);
    expect(listed.details).toMatchObject({ activeTargetId: "a", targets: [{ id: "a" }, { id: "b" }] });
    await findTool(tools as ReturnType<typeof createWorkspaceTargetTools>, "set_target").execute("set", { target: "b" } as never);
    expect(catalog.active()).toMatchObject({ id: "b" });
  });

  test("omits selection and target parameters for a single bound target", () => {
    const target: WorkspaceTarget = {
      descriptor: { id: "only", kind: "artifacts", label: "Only", rootLabel: "only", capabilities: ["files.read"] },
      async execute() { return { content: [], details: {} }; },
    };
    const catalog = new WorkspaceTargetCatalog([target]);
    const tools = createWorkspaceTargetTools({ profile: "read-only", catalog });
    expect(createWorkspaceTargetSelectionTools(catalog)).toEqual([]);
    expect(exposesTargetParameter(findTool(tools, "read_file"))).toBe(false);
    expect(() => validateToolArguments(findTool(tools, "read_file") as any, {
      id: "invalid-explicit",
      type: "toolCall",
      name: "read_file",
      arguments: { target: "only", path: "value.txt" },
    } as any)).toThrow();
  });

  test("rejects target selection dispatched alongside a filesystem call", async () => {
    let releaseRead!: () => void;
    const readStarted = new Promise<void>((resolve) => { releaseRead = resolve; });
    let markExecuting!: () => void;
    const executing = new Promise<void>((resolve) => { markExecuting = resolve; });
    const slow: WorkspaceTarget = {
      descriptor: { id: "slow", kind: "remote-device", label: "Slow", rootLabel: "slow", capabilities: ["files.read"] },
      async execute() {
        markExecuting();
        await readStarted;
        return { content: [], details: {} };
      },
    };
    const other: WorkspaceTarget = {
      descriptor: { id: "other", kind: "remote-device", label: "Other", rootLabel: "other", capabilities: ["files.read"] },
      async execute() { return { content: [], details: {} }; },
    };
    const catalog = new WorkspaceTargetCatalog([slow, other], "slow");
    const workspaceTools = createWorkspaceTargetTools({ profile: "read-only", catalog });
    const selectionTools = createWorkspaceTargetSelectionTools(catalog);
    const read = findTool(workspaceTools, "read_file").execute("read", { path: "value.txt" } as never);
    await executing;
    await expect(findTool(selectionTools as ReturnType<typeof createWorkspaceTargetTools>, "set_target").execute("set", { target: "other" } as never)).rejects.toThrow("call set_target separately");
    releaseRead();
    await read;
    expect(catalog.active()).toMatchObject({ id: "slow" });
  });

  test("can add shell to the full workspace-write tool set", () => {
    const tools = createWorkspaceTargetTools({ profile: "no-shell-workspace-write", includeShell: true, resolveTarget: () => { throw new Error("not executed"); } });
    expect(tools.map((tool) => tool.name)).toContain("bash");
    expect(tools.map((tool) => tool.name)).toContain("write_file");
  });

  test("rejects a call before execution when the target lacks its capability", async () => {
    let executed = false;
    const target: WorkspaceTarget = {
      descriptor: {
        id: "artifacts",
        kind: "artifacts",
        label: "Artifacts",
        rootLabel: "artifacts:test",
        capabilities: ["files.read"],
      },
      async execute() {
        executed = true;
        throw new Error("must not execute");
      },
    };
    const tools = createWorkspaceTargetTools({
      profile: "no-shell-workspace-write",
      resolveTarget: () => target,
    });

    await expect(
      findTool(tools, "write_file").execute("denied", {
        path: "value.txt",
        content: "no",
        mode: "create",
      } as never),
    ).rejects.toThrow("lacks capability files.write");
    expect(executed).toBe(false);
  });
});
