export const COMPANION_INSTRUCTIONS_SKILL = 'companion-instructions';
export const COMPANION_INSTRUCTIONS_PATH = 'companion-instructions.md';
export const COMPANION_INSTRUCTIONS_MAX_CHARS = 50_000;
export const COMPANION_INSTRUCTIONS_DESCRIPTION =
  'Read at the start of every conversation. Contains persistent instructions, preferences, and working conventions for Companion. Read again when you need the latest version.';

export type CompanionInstructions = {
  content: string;
  /** Zero means the initially empty document has not been saved yet. */
  revision: number;
};

export type CompanionInstructionsResponse = {
  ok: true;
  instructions: CompanionInstructions;
  maxChars: number;
};
