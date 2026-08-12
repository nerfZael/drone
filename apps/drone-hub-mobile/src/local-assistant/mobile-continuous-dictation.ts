export type MobileContinuousDictationLine = {
  id: string;
  text: string;
};

export type MobileContinuousVoiceMode = 'dictation' | 'steering';

export type MobileContinuousDictationSnapshot = {
  targetKey: string;
  lines: MobileContinuousDictationLine[];
};

export type MobileContinuousDictationState = {
  targetKey: string | null;
  lines: MobileContinuousDictationLine[];
};

export type MobileContinuousDictationNavigationAction = {
  discardDictation: boolean;
  voiceAction: 'none' | 'cancel' | 'stop';
};

export function appendMobileContinuousDictationLine(
  lines: readonly MobileContinuousDictationLine[],
  line: MobileContinuousDictationLine,
): MobileContinuousDictationLine[] {
  const text = line.text.trim();
  if (!text || lines.some((current) => current.id === line.id)) return lines.slice();
  return [...lines, { ...line, text }];
}

export function mobileContinuousDictationText(
  lines: readonly MobileContinuousDictationLine[],
): string {
  return lines.map((line) => line.text).join('\n');
}

export function mergeMobileDraftWithContinuousDictation(
  draft: string,
  dictation: string,
): string {
  const cleanDictation = dictation.trim();
  if (!cleanDictation) return draft;
  if (!draft.trim()) return cleanDictation;
  return `${draft.trimEnd()}\n${cleanDictation}`;
}

export function restoreMobileContinuousDictationLines(
  current: readonly MobileContinuousDictationLine[],
  restored: readonly MobileContinuousDictationLine[],
): MobileContinuousDictationLine[] {
  const currentIds = new Set(current.map((line) => line.id));
  return [...restored.filter((line) => !currentIds.has(line.id)), ...current];
}

export function resolveMobileContinuousDictationNavigationAction(input: {
  previousTargetKey: string;
  nextTargetKey: string;
  dictationTargetKey: string | null;
  continuousVoiceTargetKey: string | null;
  continuousVoiceIdle: boolean;
}): MobileContinuousDictationNavigationAction {
  if (!input.previousTargetKey || input.previousTargetKey === input.nextTargetKey) {
    return { discardDictation: false, voiceAction: 'none' };
  }
  const discardDictation = input.dictationTargetKey === input.previousTargetKey;
  if (
    input.continuousVoiceIdle ||
    input.continuousVoiceTargetKey !== input.previousTargetKey
  ) {
    return { discardDictation, voiceAction: 'none' };
  }
  return {
    discardDictation,
    voiceAction: discardDictation ? 'cancel' : 'stop',
  };
}

export class MobileContinuousDictationBuffer {
  private generation = 0;
  private targetKey: string | null = null;
  private lines: MobileContinuousDictationLine[] = [];

  begin(targetKey: string): number {
    this.generation += 1;
    this.targetKey = targetKey;
    this.lines = [];
    return this.generation;
  }

  append(
    generation: number,
    targetKey: string,
    line: MobileContinuousDictationLine,
  ): boolean {
    if (generation !== this.generation || targetKey !== this.targetKey) return false;
    const next = appendMobileContinuousDictationLine(this.lines, line);
    if (next.length === this.lines.length) return false;
    this.lines = next;
    return true;
  }

  discard(expectedTargetKey?: string): boolean {
    if (expectedTargetKey && expectedTargetKey !== this.targetKey) return false;
    this.generation += 1;
    this.targetKey = null;
    this.lines = [];
    return true;
  }

  takeSnapshot(expectedTargetKey: string): MobileContinuousDictationSnapshot | null {
    if (expectedTargetKey !== this.targetKey) return null;
    const snapshot = this.lines.length
      ? { targetKey: expectedTargetKey, lines: this.lines.slice() }
      : null;
    this.generation += 1;
    this.targetKey = null;
    this.lines = [];
    return snapshot;
  }

  restoreSnapshot(snapshot: MobileContinuousDictationSnapshot): boolean {
    if (this.targetKey !== null && this.targetKey !== snapshot.targetKey) return false;
    this.targetKey = snapshot.targetKey;
    this.lines = restoreMobileContinuousDictationLines(this.lines, snapshot.lines);
    return true;
  }

  snapshot(): MobileContinuousDictationState {
    return { targetKey: this.targetKey, lines: this.lines };
  }

  isCurrent(generation: number, targetKey: string): boolean {
    return generation === this.generation && targetKey === this.targetKey;
  }
}
