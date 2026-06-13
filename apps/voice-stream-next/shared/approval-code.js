class ApprovalCodeRecognizer {
  constructor(opts = {}) {
    this.opts = opts;
    this.collecting = false;
    this.startedAtMs = 0;
    this.lastUpdateAtMs = 0;
    this.bestCode = '';
    this.lastCompletedCode = '';
    this.lastCompletedAtMs = 0;
  }

  get isCollecting() {
    return this.collecting;
  }

  configure(opts) {
    this.opts = { ...opts };
    this.reset();
  }

  accept(text, nowMs) {
    const words = normalizeWords(text);
    if (words.length === 0) return this.flush(nowMs);

    const phraseEnd = triggerPhraseEnd(words, this.triggerPhraseWords());
    if (!this.collecting && phraseEnd === null) return { type: 'none' };

    let shouldReportCollecting = false;
    if (!this.collecting) {
      this.collecting = true;
      this.startedAtMs = nowMs;
      this.lastUpdateAtMs = nowMs;
      this.bestCode = '';
      shouldReportCollecting = true;
    }

    const candidateWords = phraseEnd !== null ? words.slice(phraseEnd) : words;
    const candidate = candidateWords.map(digitForWord).filter(Boolean).join('');
    if (candidate.length > this.bestCode.length) {
      this.bestCode = candidate.slice(0, this.maxDigits());
      this.lastUpdateAtMs = nowMs;
      shouldReportCollecting = true;
    }

    if (this.bestCode.length >= this.maxDigits()) return this.complete(nowMs);

    const update = this.flush(nowMs);
    if (update.type === 'none' && shouldReportCollecting) return { type: 'collecting', partialCode: this.bestCode };
    return update;
  }

  flush(nowMs) {
    if (!this.collecting) return { type: 'none' };
    if (this.bestCode.length >= this.minDigits() && nowMs - this.lastUpdateAtMs >= this.stableMs()) {
      return this.complete(nowMs);
    }
    if (nowMs - this.startedAtMs >= this.collectTimeoutMs()) {
      this.reset();
      return { type: 'cancelled' };
    }
    return { type: 'none' };
  }

  reset() {
    this.collecting = false;
    this.startedAtMs = 0;
    this.lastUpdateAtMs = 0;
    this.bestCode = '';
  }

  finalizeCheckIntervalMs() {
    return this.opts.finalizeCheckIntervalMs ?? 250;
  }

  complete(nowMs) {
    const code = this.bestCode;
    this.reset();
    if (code === this.lastCompletedCode && nowMs - this.lastCompletedAtMs < this.duplicateCooldownMs()) {
      return { type: 'none' };
    }
    this.lastCompletedCode = code;
    this.lastCompletedAtMs = nowMs;
    return { type: 'completed', code };
  }

  minDigits() {
    return this.opts.minDigits ?? 4;
  }

  maxDigits() {
    return this.opts.maxDigits ?? 8;
  }

  stableMs() {
    return this.opts.stableMs ?? 900;
  }

  collectTimeoutMs() {
    return this.opts.collectTimeoutMs ?? 5_000;
  }

  duplicateCooldownMs() {
    return this.opts.duplicateCooldownMs ?? 4_000;
  }

  triggerPhraseWords() {
    const configured = normalizeWords(this.opts.triggerPhrase ?? '');
    return configured.length > 0 ? configured : ['approval', 'code'];
  }
}

function normalizeWords(text) {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function triggerPhraseEnd(words, triggerWords) {
  if (triggerWords.length === 0 || words.length < triggerWords.length) return null;
  for (let index = 0; index <= words.length - triggerWords.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < triggerWords.length; offset += 1) {
      if (words[index + offset] !== triggerWords[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index + triggerWords.length;
  }
  return null;
}

function digitForWord(word) {
  if (word === '0' || word === 'zero' || word === 'oh' || word === 'o') return '0';
  if (word === '1' || word === 'one' || word === 'won') return '1';
  if (word === '2' || word === 'two' || word === 'too' || word === 'to') return '2';
  if (word === '3' || word === 'three' || word === 'tree') return '3';
  if (word === '4' || word === 'four' || word === 'for') return '4';
  if (word === '5' || word === 'five') return '5';
  if (word === '6' || word === 'six') return '6';
  if (word === '7' || word === 'seven') return '7';
  if (word === '8' || word === 'eight' || word === 'ate') return '8';
  if (word === '9' || word === 'nine' || word === 'niner') return '9';
  return null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.ApprovalCodeRecognizer = ApprovalCodeRecognizer;
}
