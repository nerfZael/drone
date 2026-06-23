import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LanguageServiceError,
  resolveLanguageDefinition,
  resolveLanguageReferences,
} from '../src/hub/language-service';

const tempRoots: string[] = [];

function makeProject(): { repoRoot: string; indexPath: string; defsPath: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-language-service-'));
  tempRoots.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  );
  const defsPath = path.join(repoRoot, 'src', 'defs.ts');
  const indexPath = path.join(repoRoot, 'src', 'index.ts');
  fs.writeFileSync(
    defsPath,
    'export function makeValue(input: string) {\n  return input.length;\n}\n',
  );
  fs.writeFileSync(
    indexPath,
    "import { makeValue } from './defs';\n\nconst first = makeValue('a');\nconst second = makeValue('b');\nconsole.log(first, second);\n",
  );
  return { repoRoot, indexPath, defsPath };
}

function writeProjectConfig(repoRoot: string, include: string[]): void {
  fs.writeFileSync(
    path.join(repoRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: true,
        },
        include,
      },
      null,
      2,
    ),
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('language-service', () => {
  test('resolves TypeScript definitions and maps targets back to runtime paths', () => {
    const { repoRoot, defsPath } = makeProject();
    const target = resolveLanguageDefinition({
      repoRoot,
      runtimeRepoRoot: '/work/repo',
      path: '/work/repo/src/index.ts',
      line: 3,
      column: 15,
    });

    expect(target).toMatchObject({
      path: '/work/repo/src/defs.ts',
      line: 1,
      column: 17,
      name: 'makeValue',
    });
    expect(target?.path).not.toBe(defsPath);
  });

  test('finds references inside the project', () => {
    const { repoRoot } = makeProject();
    const references = resolveLanguageReferences({
      repoRoot,
      runtimeRepoRoot: '/work/repo',
      path: '/work/repo/src/index.ts',
      line: 3,
      column: 15,
    });

    expect(
      references.map((reference) => `${reference.path}:${reference.line}:${reference.column}`),
    ).toEqual([
      '/work/repo/src/defs.ts:1:17',
      '/work/repo/src/index.ts:1:10',
      '/work/repo/src/index.ts:3:15',
      '/work/repo/src/index.ts:4:16',
    ]);
  });

  test('keeps the active file available when tsconfig excludes it', () => {
    const { repoRoot } = makeProject();
    writeProjectConfig(repoRoot, ['src/defs.ts']);

    const target = resolveLanguageDefinition({
      repoRoot,
      runtimeRepoRoot: '/work/repo',
      path: '/work/repo/src/index.ts',
      line: 3,
      column: 15,
    });

    expect(target).toMatchObject({
      path: '/work/repo/src/defs.ts',
      line: 1,
      column: 17,
    });
  });

  test('limits references after stable sorting', () => {
    const { repoRoot } = makeProject();
    const references = resolveLanguageReferences({
      repoRoot,
      runtimeRepoRoot: '/work/repo',
      path: '/work/repo/src/index.ts',
      line: 3,
      column: 15,
      limit: 2,
    });

    expect(references.map((reference) => `${reference.path}:${reference.line}:${reference.column}`)).toEqual([
      '/work/repo/src/defs.ts:1:17',
      '/work/repo/src/index.ts:1:10',
    ]);
  });

  test('rejects paths outside the repo as input errors', () => {
    const { repoRoot } = makeProject();
    let caught: unknown = null;

    try {
      resolveLanguageDefinition({
        repoRoot,
        runtimeRepoRoot: '/work/repo',
        path: path.dirname(repoRoot),
        line: 1,
        column: 1,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LanguageServiceError);
    expect((caught as LanguageServiceError).statusCode).toBe(400);
    expect((caught as LanguageServiceError).code).toBe('file_outside_repo');
  });
});
