type CodeLanguages = {
  editor: string;
  diff: string | null;
};

const FALLBACK_LANGUAGES: CodeLanguages = {
  editor: 'plaintext',
  diff: null,
};

const FILENAME_LANGUAGE_MAP: Record<string, CodeLanguages> = {
  dockerfile: { editor: 'dockerfile', diff: 'docker' },
  makefile: { editor: 'makefile', diff: 'makefile' },
  '.gitignore': { editor: 'plaintext', diff: 'ignore' },
  '.gitattributes': { editor: 'plaintext', diff: 'git' },
  '.gitmodules': { editor: 'ini', diff: 'ini' },
};

const EXTENSION_LANGUAGE_MAP: Array<[string, CodeLanguages]> = [
  ['.tsx', { editor: 'typescript', diff: 'tsx' }],
  ['.ts', { editor: 'typescript', diff: 'typescript' }],
  ['.mts', { editor: 'typescript', diff: 'typescript' }],
  ['.cts', { editor: 'typescript', diff: 'typescript' }],
  ['.jsx', { editor: 'javascript', diff: 'jsx' }],
  ['.js', { editor: 'javascript', diff: 'javascript' }],
  ['.mjs', { editor: 'javascript', diff: 'javascript' }],
  ['.cjs', { editor: 'javascript', diff: 'javascript' }],
  ['.json', { editor: 'json', diff: 'json' }],
  ['.jsonc', { editor: 'json', diff: 'json' }],
  ['.md', { editor: 'markdown', diff: 'markdown' }],
  ['.mdx', { editor: 'markdown', diff: 'markdown' }],
  ['.py', { editor: 'python', diff: 'python' }],
  ['.go', { editor: 'go', diff: 'go' }],
  ['.rs', { editor: 'rust', diff: 'rust' }],
  ['.sh', { editor: 'shell', diff: 'bash' }],
  ['.bash', { editor: 'shell', diff: 'bash' }],
  ['.zsh', { editor: 'shell', diff: 'bash' }],
  ['.yml', { editor: 'yaml', diff: 'yaml' }],
  ['.yaml', { editor: 'yaml', diff: 'yaml' }],
  ['.xml', { editor: 'xml', diff: 'xml' }],
  ['.html', { editor: 'html', diff: 'html' }],
  ['.htm', { editor: 'html', diff: 'html' }],
  ['.css', { editor: 'css', diff: 'css' }],
  ['.scss', { editor: 'scss', diff: 'scss' }],
  ['.less', { editor: 'less', diff: 'less' }],
  ['.sql', { editor: 'sql', diff: 'sql' }],
  ['.graphql', { editor: 'graphql', diff: 'graphql' }],
  ['.gql', { editor: 'graphql', diff: 'graphql' }],
  ['.ini', { editor: 'ini', diff: 'ini' }],
  ['.cfg', { editor: 'ini', diff: 'ini' }],
  ['.conf', { editor: 'ini', diff: 'ini' }],
  ['.toml', { editor: 'ini', diff: 'toml' }],
  ['.c', { editor: 'c', diff: 'c' }],
  ['.h', { editor: 'cpp', diff: 'c' }],
  ['.cc', { editor: 'cpp', diff: 'cpp' }],
  ['.cpp', { editor: 'cpp', diff: 'cpp' }],
  ['.hpp', { editor: 'cpp', diff: 'cpp' }],
  ['.java', { editor: 'java', diff: 'java' }],
  ['.rb', { editor: 'ruby', diff: 'ruby' }],
  ['.php', { editor: 'php', diff: 'php' }],
  ['.diff', { editor: 'diff', diff: 'diff' }],
  ['.patch', { editor: 'diff', diff: 'diff' }],
];

function normalizePathSegment(rawPath: string): string {
  const normalized = String(rawPath ?? '').trim().replace(/\\/g, '/');
  const segment = normalized.split('/').pop() ?? normalized;
  return segment.toLowerCase();
}

export function codeLanguagesForPath(filePath: string): CodeLanguages {
  const segment = normalizePathSegment(filePath);
  if (!segment) return FALLBACK_LANGUAGES;
  const byFilename = FILENAME_LANGUAGE_MAP[segment];
  if (byFilename) return byFilename;
  if (segment.startsWith('.env')) return { editor: 'shell', diff: 'bash' };
  for (const [suffix, languages] of EXTENSION_LANGUAGE_MAP) {
    if (segment.endsWith(suffix)) return languages;
  }
  return FALLBACK_LANGUAGES;
}

export function editorLanguageForPath(filePath: string): string {
  return codeLanguagesForPath(filePath).editor;
}

export function diffLanguageForPath(filePath: string): string | null {
  return codeLanguagesForPath(filePath).diff;
}
