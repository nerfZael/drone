import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const pending = [path.join(sourceRoot, 'index.ts')];
const visited = new Set();
const violations = [];
const modulePattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

while (pending.length > 0) {
  const filename = pending.pop();
  if (!filename || visited.has(filename)) continue;
  visited.add(filename);
  const source = await readFile(filename, 'utf8');
  for (const match of source.matchAll(modulePattern)) {
    const specifier = match[1];
    if (specifier.startsWith('node:'))
      violations.push(`${path.relative(packageRoot, filename)} imports ${specifier}`);
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(filename), specifier.replace(/\.js$/, '.ts'));
    if (resolved.startsWith(sourceRoot)) pending.push(resolved);
  }
  if (
    /\bprocess\.(?:env|platform|versions|cwd|exit|stdin|stdout|stderr|argv|pid|kill|_get)/.test(
      source,
    )
  ) {
    violations.push(`${path.relative(packageRoot, filename)} uses process`);
  }
  if (/\bBuffer\s*[.(]/.test(source))
    violations.push(`${path.relative(packageRoot, filename)} uses Buffer`);
}

if (violations.length > 0) {
  throw new Error(
    `@blip/core portable entry contains platform-specific code:\n${violations.join('\n')}`,
  );
}

console.log(`@blip/core portable entry verified (${visited.size} modules)`);
