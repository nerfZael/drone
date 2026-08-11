export function extractChangeRequestNumbers(text: string): number[] {
  const numbers = new Set<number>();
  const patterns = [/\bCR\s*#(\d+)\b/gi, /\bchange[\s-]+request\s*#(\d+)\b/gi];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const number = Number(match[1]);
      if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
    }
  }

  return [...numbers];
}
