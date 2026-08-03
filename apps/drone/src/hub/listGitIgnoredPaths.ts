import path from 'node:path';

type CommandResult = { code: number; stdout: string; stderr: string };

type RunCommand = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number; input?: string | Buffer },
) => Promise<CommandResult>;

export async function listGitIgnoredPaths({
  directoryPath,
  entryPaths,
  runCommand,
  timeoutMs,
}: {
  directoryPath: string;
  entryPaths: string[];
  runCommand: RunCommand;
  timeoutMs: number;
}): Promise<Set<string>> {
  if (entryPaths.length === 0) return new Set();
  try {
    const normalizedPaths = entryPaths.map((entryPath) => path.resolve(entryPath));
    const result = await runCommand('git', ['-C', directoryPath, 'check-ignore', '-z', '--stdin'], {
      timeoutMs,
      input: `${normalizedPaths.join('\0')}\0`,
    });
    if (result.code !== 0 && result.code !== 1) return new Set();
    return new Set(
      String(result.stdout ?? '')
        .split('\0')
        .filter((ignoredPath) => ignoredPath.length > 0)
        .map((ignoredPath) => path.resolve(ignoredPath)),
    );
  } catch {
    return new Set();
  }
}
