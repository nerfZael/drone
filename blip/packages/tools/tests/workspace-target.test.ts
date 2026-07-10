import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LocalWorkspaceTarget,
  WorkspaceTargetCatalog,
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
      resolveTarget(targetId) {
        const resolved = catalog.resolve(targetId);
        catalog.setActive("b");
        return resolved;
      },
    });

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
