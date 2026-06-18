import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolProfile } from "@blip/tools";

const IDENTITY = `You are Blip, a pragmatic CLI coding agent.

Work inside the user's repository. Inspect before editing. Keep changes focused. Preserve user work. Prefer the repo's existing patterns.`;

const WORKFLOW = `Workflow:
- Understand the task from the current prompt and repository context.
- Use targeted tools to inspect files before changing them.
- Batch independent read_file/search_files/list_files/bash calls in the same assistant turn when they can run in parallel.
- Prefer apply_patch for code edits.
- Use bash for local trusted CLI commands, tests, builds, and git inspection when available.
- Do not commit or stage unless the user explicitly asks.
- Verify with the narrowest meaningful command when practical.
- Finish with a concise summary of changes and verification.`;

const PATCH_RULES = `Patch rules:
- Use apply_patch for normal code edits.
- Keep patches small and reviewable.
- Do not overwrite unrelated user changes.
- For local CLI cleanup or generated content, bash may be used when the active profile exposes it.`;

function toolRules(profile: ToolProfile, clonesEnabled: boolean): string {
  const cloneTool = clonesEnabled ? "\ncreate_clones is also available for parallel independent subtasks." : "";
  if (profile === "local-trusted-write") {
    return `Tool profile: local-trusted-write.
Available tools are intentionally small: bash, apply_patch, read_file, search_files, and list_files.${cloneTool}
Use bash for git status, simple file moves/deletes/directories, package scripts, tests, and builds.
Use read_file/search_files/list_files when structured bounded output is clearer than shell output.`;
  }
  if (profile === "read-only") {
    return `Tool profile: read-only.
Only inspection tools are available. Do not try to mutate files. Bash is unavailable.${cloneTool}`;
  }
  return `Tool profile: no-shell-workspace-write.
Bash is unavailable. Use structured file tools for filesystem mutations and get_working_tree_status for git state.${cloneTool}`;
}

function permissionRules(): string {
  return `Permission and safety rules:
- All paths are workspace-relative.
- Do not access files outside the workspace.
- The active tool profile controls which tools exist.
- Bash has no OS sandbox in v1 and is only available in trusted local write sessions.`;
}

function cloneRules(maxClones: number): string {
  return `Clone rules:
- Use create_clones when up to ${maxClones} independent subtasks can run in parallel.
- If the user explicitly permits parallel work and the task has separable lanes, strongly prefer starting with create_clones.
- Give each clone a focused task string with enough context to work alone.
- Do not use clones for tightly coupled edits that are likely to conflict.
- The original session waits while clones run, then receives each clone's final message as the tool result.`;
}

async function readOptional(pathname: string): Promise<string | undefined> {
  try {
    const text = await readFile(pathname, "utf8");
    return text.trim() ? text : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function assembleSystemPrompt(input: { workspaceRoot: string; toolProfile: ToolProfile; clonesEnabled?: boolean; maxClones?: number }): Promise<string> {
  const repoInstructions = await readOptional(path.join(input.workspaceRoot, "AGENTS.md"));
  const clonesEnabled = input.clonesEnabled === true;
  const sections = [IDENTITY, WORKFLOW, toolRules(input.toolProfile, clonesEnabled), clonesEnabled ? cloneRules(input.maxClones ?? 4) : undefined, PATCH_RULES, permissionRules(), repoInstructions ? `Repository instructions from AGENTS.md:\n${repoInstructions}` : undefined];
  return sections.filter(Boolean).join("\n\n");
}
