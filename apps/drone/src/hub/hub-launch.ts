import fsSync from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export type DetachedCliLaunchSpec = {
  command: string;
  args: string[];
};

type ResolveDetachedCliLaunchSpecOptions = {
  cliFilename: string;
  nodeExecPath?: string;
  fileExists?: (filePath: string) => boolean;
  resolveModulePath?: (moduleId: string) => string;
};

function defaultFileExists(filePath: string): boolean {
  try {
    fsSync.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveBuiltCliPath(cliFilename: string): string {
  const ext = path.extname(cliFilename);
  const filename = ext ? path.basename(cliFilename, ext) : path.basename(cliFilename);
  return path.resolve(path.dirname(cliFilename), '..', 'dist', `${filename}.js`);
}

export function resolveDetachedCliLaunchSpec(opts: ResolveDetachedCliLaunchSpecOptions): DetachedCliLaunchSpec {
  const cliFilename = String(opts.cliFilename ?? '').trim();
  if (!cliFilename) throw new Error('missing cli filename');

  const nodeExecPath = String(opts.nodeExecPath ?? process.execPath).trim() || process.execPath;
  const fileExists = opts.fileExists ?? defaultFileExists;
  const requireForCli = createRequire(cliFilename);
  const resolveModulePath =
    opts.resolveModulePath ??
    ((moduleId: string) => {
      return requireForCli.resolve(moduleId);
    });

  if (cliFilename.endsWith('.js')) {
    return { command: nodeExecPath, args: [cliFilename] };
  }

  if (cliFilename.endsWith('.ts')) {
    try {
      const tsNodeRegister = resolveModulePath('ts-node/register');
      return { command: nodeExecPath, args: ['-r', tsNodeRegister, cliFilename] };
    } catch {
      const builtCliPath = resolveBuiltCliPath(cliFilename);
      if (fileExists(builtCliPath)) {
        return { command: nodeExecPath, args: [builtCliPath] };
      }
    }
  }

  return { command: nodeExecPath, args: [cliFilename] };
}
