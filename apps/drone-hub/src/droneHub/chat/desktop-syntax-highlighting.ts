import refractor from 'refractor/core.js';
import bash from 'refractor/lang/bash.js';
import c from 'refractor/lang/c.js';
import cpp from 'refractor/lang/cpp.js';
import csharp from 'refractor/lang/csharp.js';
import diff from 'refractor/lang/diff.js';
import docker from 'refractor/lang/docker.js';
import go from 'refractor/lang/go.js';
import graphql from 'refractor/lang/graphql.js';
import java from 'refractor/lang/java.js';
import json from 'refractor/lang/json.js';
import jsx from 'refractor/lang/jsx.js';
import kotlin from 'refractor/lang/kotlin.js';
import php from 'refractor/lang/php.js';
import python from 'refractor/lang/python.js';
import ruby from 'refractor/lang/ruby.js';
import rust from 'refractor/lang/rust.js';
import sql from 'refractor/lang/sql.js';
import tsx from 'refractor/lang/tsx.js';
import typescript from 'refractor/lang/typescript.js';
import yaml from 'refractor/lang/yaml.js';

export type DesktopSyntaxToken = {
  text: string;
  types: string[];
};

export type DesktopSyntaxHighlight = {
  highlighted: boolean;
  language: string | null;
  tokens: DesktopSyntaxToken[];
};

type RefractorNode =
  | { type: 'text'; value: string }
  | {
      type: 'element';
      properties?: { className?: unknown };
      children?: RefractorNode[];
    };

export const DESKTOP_SYNTAX_HIGHLIGHT_MAX_CHARS = 200_000;
const DESKTOP_SYNTAX_HIGHLIGHT_MAX_TOKENS = 25_000;

for (const grammar of [
  bash,
  c,
  cpp,
  csharp,
  diff,
  docker,
  go,
  graphql,
  java,
  json,
  jsx,
  kotlin,
  php,
  python,
  ruby,
  rust,
  sql,
  tsx,
  typescript,
  yaml,
]) {
  refractor.register(grammar);
}

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
  html: 'markup',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kotlin: 'kotlin',
  markup: 'markup',
  php: 'php',
  plaintext: null,
  py: 'python',
  python: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  rust: 'rust',
  sh: 'bash',
  shell: 'bash',
  sql: 'sql',
  text: null,
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

export function desktopSyntaxLanguageForFence(languageRaw: string): string | null {
  const language = String(languageRaw ?? '').trim().toLowerCase();
  return language ? (LANGUAGE_BY_FENCE[language] ?? null) : null;
}

function nodeClasses(node: Extract<RefractorNode, { type: 'element' }>): string[] {
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    return className.map(String).filter((item) => item && item !== 'token');
  }
  if (typeof className === 'string') {
    return className.split(/\s+/).filter((item) => item && item !== 'token');
  }
  return [];
}

function appendTokens(
  nodes: RefractorNode[],
  inheritedTypes: string[],
  output: DesktopSyntaxToken[],
): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.value) continue;
      const previous = output[output.length - 1];
      if (
        previous &&
        previous.types.length === inheritedTypes.length &&
        previous.types.every((type, index) => type === inheritedTypes[index])
      ) {
        previous.text += node.value;
      } else {
        output.push({ text: node.value, types: inheritedTypes });
      }
      continue;
    }
    appendTokens(
      Array.isArray(node.children) ? node.children : [],
      [...inheritedTypes, ...nodeClasses(node)],
      output,
    );
  }
}

export function highlightDesktopCodeFence(
  content: string,
  languageRaw: string,
): DesktopSyntaxHighlight {
  const source = String(content ?? '');
  const language = desktopSyntaxLanguageForFence(languageRaw);
  const plain = (): DesktopSyntaxHighlight => ({
    highlighted: false,
    language,
    tokens: [{ text: source, types: [] }],
  });
  if (!language || source.length > DESKTOP_SYNTAX_HIGHLIGHT_MAX_CHARS) return plain();
  try {
    const tokens: DesktopSyntaxToken[] = [];
    appendTokens(refractor.highlight(source, language) as RefractorNode[], [], tokens);
    if (tokens.length === 0 || tokens.length > DESKTOP_SYNTAX_HIGHLIGHT_MAX_TOKENS) return plain();
    return { highlighted: true, language, tokens };
  } catch {
    return plain();
  }
}
