import path from "node:path";

export function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(root, resolved);
  return relative || ".";
}

export function assertWorkspacePath(workspaceRoot: string, inputPath = "."): string {
  if (path.isAbsolute(inputPath)) {
    throw new Error("absolute paths are not allowed");
  }

  const root = normalizeWorkspaceRoot(workspaceRoot);
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new Error(`path escapes workspace: ${inputPath}`);
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export function truncateText(value: string, limit = 60_000): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`,
    truncated: true,
  };
}

export function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
}
