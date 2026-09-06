import refractor from 'refractor/core.js';
import bash from 'refractor/lang/bash.js';
import c from 'refractor/lang/c.js';
import cpp from 'refractor/lang/cpp.js';
import csharp from 'refractor/lang/csharp.js';
import dart from 'refractor/lang/dart.js';
import diff from 'refractor/lang/diff.js';
import docker from 'refractor/lang/docker.js';
import elixir from 'refractor/lang/elixir.js';
import go from 'refractor/lang/go.js';
import graphql from 'refractor/lang/graphql.js';
import groovy from 'refractor/lang/groovy.js';
import haskell from 'refractor/lang/haskell.js';
import hcl from 'refractor/lang/hcl.js';
import ignore from 'refractor/lang/ignore.js';
import ini from 'refractor/lang/ini.js';
import java from 'refractor/lang/java.js';
import json from 'refractor/lang/json.js';
import jsx from 'refractor/lang/jsx.js';
import kotlin from 'refractor/lang/kotlin.js';
import less from 'refractor/lang/less.js';
import lua from 'refractor/lang/lua.js';
import makefile from 'refractor/lang/makefile.js';
import markdown from 'refractor/lang/markdown.js';
import nginx from 'refractor/lang/nginx.js';
import objectivec from 'refractor/lang/objectivec.js';
import perl from 'refractor/lang/perl.js';
import php from 'refractor/lang/php.js';
import powershell from 'refractor/lang/powershell.js';
import properties from 'refractor/lang/properties.js';
import protobuf from 'refractor/lang/protobuf.js';
import python from 'refractor/lang/python.js';
import r from 'refractor/lang/r.js';
import ruby from 'refractor/lang/ruby.js';
import rust from 'refractor/lang/rust.js';
import scala from 'refractor/lang/scala.js';
import scss from 'refractor/lang/scss.js';
import sql from 'refractor/lang/sql.js';
import swift from 'refractor/lang/swift.js';
import toml from 'refractor/lang/toml.js';
import tsx from 'refractor/lang/tsx.js';
import typescript from 'refractor/lang/typescript.js';
import yaml from 'refractor/lang/yaml.js';
import zig from 'refractor/lang/zig.js';

export type MobileSyntaxToken = {
  text: string;
  types: string[];
};

export type MobileSyntaxHighlight = {
  highlighted: boolean;
  language: string | null;
  tokens: MobileSyntaxToken[];
};

type RefractorNode =
  | { type: 'text'; value: string }
  | {
      type: 'element';
      properties?: { className?: unknown };
      children?: RefractorNode[];
    };

export const MOBILE_SYNTAX_HIGHLIGHT_MAX_CHARS = 200_000;
/** The editor re-highlights on every keystroke, so it gives up on large files much sooner. */
export const MOBILE_EDITOR_HIGHLIGHT_MAX_CHARS = 48_000;
const MOBILE_SYNTAX_HIGHLIGHT_MAX_TOKENS = 25_000;

for (const grammar of [
  bash,
  c,
  cpp,
  csharp,
  dart,
  diff,
  docker,
  elixir,
  go,
  graphql,
  groovy,
  haskell,
  hcl,
  ignore,
  ini,
  java,
  json,
  jsx,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  objectivec,
  perl,
  php,
  powershell,
  properties,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  yaml,
  zig,
]) {
  refractor.register(grammar);
}

const LANGUAGE_BY_FILENAME: Record<string, string> = {
  '.dockerignore': 'ignore',
  '.gitignore': 'ignore',
  '.npmignore': 'ignore',
  '.prettierignore': 'ignore',
  cmakelists: 'makefile',
  dockerfile: 'docker',
  gemfile: 'ruby',
  makefile: 'makefile',
  'nginx.conf': 'nginx',
  procfile: 'ruby',
  'gradle.properties': 'properties',
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  dart: 'dart',
  diff: 'diff',
  ex: 'elixir',
  exs: 'elixir',
  gql: 'graphql',
  go: 'go',
  gradle: 'groovy',
  graphql: 'graphql',
  h: 'c',
  hcl: 'hcl',
  hpp: 'cpp',
  hs: 'haskell',
  htm: 'markup',
  html: 'markup',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  m: 'objectivec',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mm: 'objectivec',
  mts: 'typescript',
  patch: 'diff',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  proto: 'protobuf',
  properties: 'properties',
  ps1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sbt: 'scala',
  sc: 'scala',
  scala: 'scala',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svelte: 'markup',
  swift: 'swift',
  tf: 'hcl',
  tfvars: 'hcl',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'markup',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'bash',
};

const LANGUAGE_BY_MIME: Record<string, string> = {
  'application/graphql': 'graphql',
  'application/javascript': 'javascript',
  'application/json': 'json',
  'application/sql': 'sql',
  'application/typescript': 'typescript',
  'application/xml': 'markup',
  'text/markdown': 'markdown',
  'text/css': 'css',
  'text/html': 'markup',
  'text/javascript': 'javascript',
  'text/x-java-source': 'java',
  'text/x-python': 'python',
  'text/xml': 'markup',
};

const LANGUAGE_BY_FENCE: Record<string, string | null> = {
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  css: 'css',
  diff: 'diff',
  docker: 'docker',
  dockerfile: 'docker',
  go: 'go',
  graphql: 'graphql',
  groovy: 'groovy',
  html: 'markup',
  ini: 'ini',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kotlin: 'kotlin',
  less: 'less',
  lua: 'lua',
  makefile: 'makefile',
  markdown: 'markdown',
  markup: 'markup',
  md: 'markdown',
  php: 'php',
  plaintext: null,
  properties: 'properties',
  py: 'python',
  python: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  rust: 'rust',
  sass: 'scss',
  scss: 'scss',
  sh: 'bash',
  shell: 'bash',
  sql: 'sql',
  swift: 'swift',
  text: null,
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

function fileName(path: string): string {
  const normalized = String(path ?? '')
    .trim()
    .replace(/\\/g, '/');
  return (normalized.split('/').at(-1) ?? '').toLowerCase();
}

export function mobileSyntaxLanguageForFile(path: string, mime = ''): string | null {
  const name = fileName(path);
  if (!name) return null;
  if (name.startsWith('.env')) return 'bash';
  const exact = LANGUAGE_BY_FILENAME[name];
  if (exact) return exact;
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : '';
  const fromExtension = LANGUAGE_BY_EXTENSION[extension];
  if (fromExtension) return fromExtension;
  return LANGUAGE_BY_MIME[String(mime).split(';', 1)[0]?.trim().toLowerCase()] ?? null;
}

export function mobileSyntaxLanguageForFence(languageRaw: string): string | null {
  const language = String(languageRaw ?? '')
    .trim()
    .toLowerCase();
  return language ? (LANGUAGE_BY_FENCE[language] ?? null) : null;
}

function nodeClasses(node: Extract<RefractorNode, { type: 'element' }>): string[] {
  const className = node.properties?.className;
  if (Array.isArray(className))
    return className.filter((value): value is string => typeof value === 'string');
  return typeof className === 'string' ? className.split(/\s+/).filter(Boolean) : [];
}

function appendToken(tokens: MobileSyntaxToken[], text: string, types: string[]): void {
  if (!text) return;
  const previous = tokens.at(-1);
  if (
    previous &&
    previous.types.length === types.length &&
    previous.types.every((type, index) => type === types[index])
  ) {
    previous.text += text;
    return;
  }
  tokens.push({ text, types });
}

function flattenNodes(
  nodes: RefractorNode[],
  inherited: string[],
  output: MobileSyntaxToken[],
): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      appendToken(output, node.value, inherited);
      continue;
    }
    const classes = nodeClasses(node).filter((name) => name !== 'token');
    flattenNodes(node.children ?? [], [...inherited, ...classes], output);
  }
}

function plainHighlight(content: string, language: string | null): MobileSyntaxHighlight {
  return {
    highlighted: false,
    language,
    tokens: content ? [{ text: content, types: [] }] : [],
  };
}

function highlightMobileCodeWithLanguage(
  content: string,
  language: string | null,
): MobileSyntaxHighlight {
  const source = String(content ?? '');
  if (!language || source.length > MOBILE_SYNTAX_HIGHLIGHT_MAX_CHARS) {
    return plainHighlight(source, language);
  }
  try {
    const nodes = refractor.highlight(source, language) as RefractorNode[];
    const tokens: MobileSyntaxToken[] = [];
    flattenNodes(nodes, [], tokens);
    if (tokens.length > MOBILE_SYNTAX_HIGHLIGHT_MAX_TOKENS) {
      return plainHighlight(source, language);
    }
    return { highlighted: true, language, tokens };
  } catch {
    return plainHighlight(source, language);
  }
}

export function highlightMobileCode(
  content: string,
  path: string,
  mime = '',
): MobileSyntaxHighlight {
  const language = mobileSyntaxLanguageForFile(path, mime);
  return highlightMobileCodeWithLanguage(content, language);
}

export function highlightMobileEditorCode(
  content: string,
  path: string,
  mime = '',
): MobileSyntaxHighlight {
  const language = mobileSyntaxLanguageForFile(path, mime);
  const source = String(content ?? '');
  if (source.length > MOBILE_EDITOR_HIGHLIGHT_MAX_CHARS) return plainHighlight(source, language);
  return highlightMobileCodeWithLanguage(source, language);
}

export function highlightMobileCodeFence(
  content: string,
  languageRaw: string,
): MobileSyntaxHighlight {
  return highlightMobileCodeWithLanguage(content, mobileSyntaxLanguageForFence(languageRaw));
}
