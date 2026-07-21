import refractor from 'refractor/core.js';
import bash from 'refractor/lang/bash.js';
import c from 'refractor/lang/c.js';
import cpp from 'refractor/lang/cpp.js';
import csharp from 'refractor/lang/csharp.js';
import diff from 'refractor/lang/diff.js';
import docker from 'refractor/lang/docker.js';
import go from 'refractor/lang/go.js';
import graphql from 'refractor/lang/graphql.js';
import groovy from 'refractor/lang/groovy.js';
import ini from 'refractor/lang/ini.js';
import java from 'refractor/lang/java.js';
import json from 'refractor/lang/json.js';
import jsx from 'refractor/lang/jsx.js';
import kotlin from 'refractor/lang/kotlin.js';
import less from 'refractor/lang/less.js';
import makefile from 'refractor/lang/makefile.js';
import php from 'refractor/lang/php.js';
import properties from 'refractor/lang/properties.js';
import python from 'refractor/lang/python.js';
import ruby from 'refractor/lang/ruby.js';
import rust from 'refractor/lang/rust.js';
import scss from 'refractor/lang/scss.js';
import sql from 'refractor/lang/sql.js';
import toml from 'refractor/lang/toml.js';
import tsx from 'refractor/lang/tsx.js';
import typescript from 'refractor/lang/typescript.js';
import yaml from 'refractor/lang/yaml.js';

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
const MOBILE_SYNTAX_HIGHLIGHT_MAX_TOKENS = 25_000;

for (const grammar of [
  bash,
  c,
  cpp,
  csharp,
  diff,
  docker,
  go,
  graphql,
  groovy,
  ini,
  java,
  json,
  jsx,
  kotlin,
  less,
  makefile,
  php,
  properties,
  python,
  ruby,
  rust,
  scss,
  sql,
  toml,
  tsx,
  typescript,
  yaml,
]) {
  refractor.register(grammar);
}

const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: 'docker',
  gemfile: 'ruby',
  makefile: 'makefile',
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
  diff: 'diff',
  gql: 'graphql',
  go: 'go',
  gradle: 'groovy',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
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
  mjs: 'javascript',
  mts: 'typescript',
  patch: 'diff',
  php: 'php',
  properties: 'properties',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

const LANGUAGE_BY_MIME: Record<string, string> = {
  'application/graphql': 'graphql',
  'application/javascript': 'javascript',
  'application/json': 'json',
  'application/sql': 'sql',
  'application/typescript': 'typescript',
  'application/xml': 'markup',
  'text/css': 'css',
  'text/html': 'markup',
  'text/javascript': 'javascript',
  'text/x-java-source': 'java',
  'text/x-python': 'python',
  'text/xml': 'markup',
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

export function highlightMobileCode(
  content: string,
  path: string,
  mime = '',
): MobileSyntaxHighlight {
  const source = String(content ?? '');
  const language = mobileSyntaxLanguageForFile(path, mime);
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
