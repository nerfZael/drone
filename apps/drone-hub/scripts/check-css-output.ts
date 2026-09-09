// Post-build guard: fail if Tailwind turned a font-size token into a color rule.
//
// `text-[var(--text-11)]` is ambiguous to Tailwind, which emits
// `color: var(--text-11)` instead of a font size. The source-level test in
// tests/style-tokens.test.ts catches the pattern in components; this check
// catches it in the shipped stylesheet regardless of where it came from.

import { Glob } from 'bun';
import path from 'node:path';

const distAssets = path.resolve(import.meta.dir, '..', 'dist', 'assets');
const SIZE_TOKEN = String.raw`(?:text-[0-9][0-9-]*|type-[a-z]+|[a-z-]+-size)`;
const BAD_RULE = new RegExp(String.raw`([^{}]*)\{[^}]*\bcolor:\s*var\(--${SIZE_TOKEN}\)[^}]*\}`, 'g');

const offenders: string[] = [];
let files = 0;
for await (const rel of new Glob('*.css').scan({ cwd: distAssets, onlyFiles: true })) {
  files += 1;
  const css = await Bun.file(path.join(distAssets, rel)).text();
  for (const match of css.matchAll(BAD_RULE)) {
    const selector = match[1].trim().split(/\s*,\s*/).slice(-1)[0] ?? match[1].trim();
    offenders.push(`${rel}: ${selector.slice(-120)}`);
  }
}

if (files === 0) {
  console.error(`check-css-output: no stylesheets found in ${distAssets}`);
  process.exit(1);
}
if (offenders.length > 0) {
  console.error('check-css-output: font-size tokens compiled into color rules:');
  for (const line of offenders) console.error(`  ${line}`);
  console.error('Use the named font-size utilities from tailwind.config.ts (text-11, text-caption, …).');
  process.exit(1);
}
console.log(`check-css-output: ${files} stylesheet(s) clean`);
