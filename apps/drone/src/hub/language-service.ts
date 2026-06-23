import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type LanguageLocation = {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  name?: string | null;
  preview?: string | null;
};

export type LanguageQuery = {
  repoRoot: string;
  path: string;
  line: number;
  column: number;
  runtimeRepoRoot?: string | null;
  limit?: number;
};

export class LanguageServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'LanguageServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

type LanguageProvider = {
  canHandle(filePath: string): boolean;
  definition(query: ResolvedLanguageQuery): LanguageLocation | null;
  references(query: ResolvedLanguageQuery): LanguageLocation[];
};

type ResolvedLanguageQuery = {
  repoRoot: string;
  runtimeRepoRoot: string | null;
  filePath: string;
  line: number;
  column: number;
  limit: number;
};

const TYPESCRIPT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
]);
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

function normalizePositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function normalizeLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(501, Math.floor(n));
}

function normalizeRuntimeRoot(raw: string | null | undefined): string | null {
  const text = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  if (!text || text === '/') return null;
  return text.endsWith('/') ? text.slice(0, -1) : text;
}

function pathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveQuery(input: LanguageQuery): ResolvedLanguageQuery {
  const repoRoot = path.resolve(String(input.repoRoot ?? '').trim());
  if (!repoRoot || !fs.existsSync(repoRoot)) {
    throw new LanguageServiceError('repository root was not found', 404, 'repo_not_found');
  }
  const runtimeRepoRoot = normalizeRuntimeRoot(input.runtimeRepoRoot);
  const rawPath = String(input.path ?? '').trim();
  if (!rawPath || rawPath.includes('\0')) {
    throw new LanguageServiceError('missing file path', 400, 'invalid_file_path');
  }

  let filePath: string;
  const normalizedRawPath = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (
    runtimeRepoRoot &&
    (normalizedRawPath === runtimeRepoRoot || normalizedRawPath.startsWith(`${runtimeRepoRoot}/`))
  ) {
    const suffix = normalizedRawPath.slice(runtimeRepoRoot.length).replace(/^\/+/, '');
    filePath = path.resolve(repoRoot, suffix);
  } else {
    filePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(repoRoot, rawPath);
  }

  if (!pathInside(repoRoot, filePath)) {
    throw new LanguageServiceError('file path is outside the repository', 400, 'file_outside_repo');
  }
  if (!fs.existsSync(filePath)) {
    throw new LanguageServiceError('file was not found', 404, 'file_not_found');
  }

  return {
    repoRoot,
    runtimeRepoRoot,
    filePath,
    line: normalizePositiveInt(input.line, 1),
    column: normalizePositiveInt(input.column, 1),
    limit: normalizeLimit(input.limit),
  };
}

function toEditorPath(query: ResolvedLanguageQuery, filePath: string): string {
  const absolute = path.resolve(filePath);
  if (!pathInside(query.repoRoot, absolute)) return absolute;
  if (!query.runtimeRepoRoot) return absolute;
  const relative = path.relative(query.repoRoot, absolute).split(path.sep).join('/');
  return relative ? `${query.runtimeRepoRoot}/${relative}` : query.runtimeRepoRoot;
}

function readTsConfig(repoRoot: string): { files: string[]; options: ts.CompilerOptions } {
  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists);
  if (!configPath) {
    return {
      files: collectFallbackSourceFiles(repoRoot),
      options: {
        allowJs: true,
        checkJs: false,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
        skipLibCheck: true,
      },
    };
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw new Error(flattenTsMessage(configFile.error.messageText));
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    {
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
    },
  );
  if (parsed.errors.length > 0)
    throw new Error(flattenTsMessage(parsed.errors[0]?.messageText ?? 'invalid tsconfig'));
  return { files: parsed.fileNames, options: parsed.options };
}

function collectFallbackSourceFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.storybook') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (entry.isFile() && TYPESCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(fullPath);
      }
    }
  };
  walk(repoRoot);
  return out;
}

function flattenTsMessage(message: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(message, '\n');
}

function createTypeScriptLanguageService(repoRoot: string, entryFile: string): ts.LanguageService {
  const config = readTsConfig(repoRoot);
  const files = new Map<string, { version: string }>();
  for (const fileName of config.files) files.set(path.resolve(fileName), { version: '0' });
  files.set(path.resolve(entryFile), { version: '0' });

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => config.options,
    getCurrentDirectory: () => repoRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => Array.from(files.keys()),
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
    },
    getScriptVersion: (fileName) => files.get(path.resolve(fileName))?.version ?? '0',
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function sourceFilePosition(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  column: number,
): number {
  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(filePath);
  if (!sourceFile) throw new Error('file is not part of the TypeScript project');
  const lines = sourceFile.getLineStarts();
  const lineIndex = Math.min(Math.max(0, line - 1), Math.max(0, lines.length - 1));
  const lineStart = lines[lineIndex] ?? 0;
  const nextLineStart = lines[lineIndex + 1] ?? sourceFile.text.length + 1;
  const maxColumn = Math.max(0, nextLineStart - lineStart - 1);
  const columnIndex = Math.min(Math.max(0, column - 1), maxColumn);
  return ts.getPositionOfLineAndCharacter(sourceFile, lineIndex, columnIndex);
}

function locationFromTextSpan(
  query: ResolvedLanguageQuery,
  service: ts.LanguageService,
  fileName: string,
  textSpan: ts.TextSpan,
  name?: string | null,
): LanguageLocation | null {
  const absolute = path.resolve(fileName);
  if (!pathInside(query.repoRoot, absolute)) return null;
  const program = service.getProgram();
  const sourceFile = program?.getSourceFile(absolute);
  if (!sourceFile) return null;
  const start = ts.getLineAndCharacterOfPosition(sourceFile, textSpan.start);
  const end = ts.getLineAndCharacterOfPosition(sourceFile, textSpan.start + textSpan.length);
  const lineText = sourceFile.text.split(/\r?\n/)[start.line]?.trim() ?? '';
  return {
    path: toEditorPath(query, absolute),
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    name: name ?? null,
    preview: lineText || null,
  };
}

function locationKey(location: LanguageLocation): string {
  return `${location.path}\0${location.line}\0${location.column}\0${location.endLine ?? 0}\0${location.endColumn ?? 0}`;
}

class TypeScriptLanguageProvider implements LanguageProvider {
  canHandle(filePath: string): boolean {
    return TYPESCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  definition(query: ResolvedLanguageQuery): LanguageLocation | null {
    const service = createTypeScriptLanguageService(query.repoRoot, query.filePath);
    const position = sourceFilePosition(service, query.filePath, query.line, query.column);
    const definitions = service.getDefinitionAtPosition(query.filePath, position) ?? [];
    for (const definition of definitions) {
      const location = locationFromTextSpan(
        query,
        service,
        definition.fileName,
        definition.textSpan,
        definition.name,
      );
      if (location) return location;
    }
    return null;
  }

  references(query: ResolvedLanguageQuery): LanguageLocation[] {
    const service = createTypeScriptLanguageService(query.repoRoot, query.filePath);
    const position = sourceFilePosition(service, query.filePath, query.line, query.column);
    const references = service.getReferencesAtPosition(query.filePath, position) ?? [];
    const out: LanguageLocation[] = [];
    const seen = new Set<string>();
    for (const reference of references) {
      const location = locationFromTextSpan(
        query,
        service,
        reference.fileName,
        reference.textSpan,
        null,
      );
      if (!location) continue;
      const key = locationKey(location);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(location);
    }
    return out
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column)
      .slice(0, query.limit);
  }
}

const providers: LanguageProvider[] = [new TypeScriptLanguageProvider()];

function providerFor(filePath: string): LanguageProvider | null {
  return providers.find((provider) => provider.canHandle(filePath)) ?? null;
}

export function resolveLanguageDefinition(input: LanguageQuery): LanguageLocation | null {
  const query = resolveQuery(input);
  const provider = providerFor(query.filePath);
  if (!provider) return null;
  return provider.definition(query);
}

export function resolveLanguageReferences(input: LanguageQuery): LanguageLocation[] {
  const query = resolveQuery(input);
  const provider = providerFor(query.filePath);
  if (!provider) return [];
  return provider.references(query);
}
