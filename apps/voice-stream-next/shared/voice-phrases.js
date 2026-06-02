const VOICE_PHRASE_DEFAULTS = {
  unlockPhrase: 'wake up now',
  shutdownPhrase: 'shut down completely',
};

const AWAKE_WAKE_PHRASES = [
  'patch me in',
  'can you transcribe',
  'transcribe',
  'ok stop',
  'okay stop',
  'repeat what you said',
  'go to sleep',
];

const APPROVAL_GRAMMAR = [
  'approval',
  'code',
  'approval code',
  'zero',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

function normalizePhrase(phrase) {
  return String(phrase ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function phraseWords(phrase) {
  return normalizePhrase(phrase)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function wordsFromText(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchesPhrase(text, phrase) {
  const target = phraseWords(phrase);
  const words = wordsFromText(text);
  if (target.length === 0 || words.length < target.length) return false;
  return words.some((_, index) => {
    if (index + target.length > words.length) return false;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (words[index + offset] !== target[offset]) return false;
    }
    return true;
  });
}

function grammarEntriesFromPhrases(phrases) {
  const entries = new Set();
  for (const phrase of phrases) {
    const normalized = normalizePhrase(phrase);
    if (!normalized) continue;
    entries.add(normalized);
  }
  entries.add('[unk]');
  return Array.from(entries);
}

function buildAwakeWakeGrammar(options = {}) {
  const triggerPhrase = normalizePhrase(options.triggerPhrase || 'approval code');
  const assistantWakePhrases = Array.isArray(options.assistantWakePhrases) ? options.assistantWakePhrases : [];
  const entries = new Set([...AWAKE_WAKE_PHRASES, ...assistantWakePhrases.map(normalizePhrase).filter(Boolean), ...APPROVAL_GRAMMAR, '[unk]']);
  if (triggerPhrase) {
    entries.add(triggerPhrase);
    triggerPhrase.split(/\s+/).filter(Boolean).forEach((word) => entries.add(word));
  }
  const shutdownPhrase = normalizePhrase(options.shutdownPhrase || '');
  if (shutdownPhrase) entries.add(shutdownPhrase);
  return Array.from(entries);
}

function buildSleepWakeGrammar(options = {}) {
  const unlockPhrase = normalizePhrase(options.unlockPhrase || VOICE_PHRASE_DEFAULTS.unlockPhrase);
  const shutdownPhrase = normalizePhrase(options.shutdownPhrase || VOICE_PHRASE_DEFAULTS.shutdownPhrase);
  return grammarEntriesFromPhrases([unlockPhrase, shutdownPhrase]);
}

function sleepPhraseMatch(text, unlockPhrase, shutdownPhrase) {
  if (matchesPhrase(text, unlockPhrase)) return 'unlock';
  if (matchesPhrase(text, shutdownPhrase)) return 'shutdown';
  return null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.VoicePhrases = {
    VOICE_PHRASE_DEFAULTS,
    AWAKE_WAKE_PHRASES,
    normalizePhrase,
    phraseWords,
    wordsFromText,
    matchesPhrase,
    grammarEntriesFromPhrases,
    buildAwakeWakeGrammar,
    buildSleepWakeGrammar,
    sleepPhraseMatch,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    VOICE_PHRASE_DEFAULTS,
    AWAKE_WAKE_PHRASES,
    normalizePhrase,
    phraseWords,
    wordsFromText,
    matchesPhrase,
    grammarEntriesFromPhrases,
    buildAwakeWakeGrammar,
    buildSleepWakeGrammar,
    sleepPhraseMatch,
  };
}
