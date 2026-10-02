import fs from 'node:fs';
import path from 'node:path';
import { PROMPT_SECTIONS, type PromptOverrides, type PromptSection } from '@entity/core';
import { SUMMARY_PROMPT } from './entity-summarizer';
import { ASK_LINK_PROMPT, ASK_RESOLVE_PROMPT, ASK_SPLIT_PROMPT } from './entity-asks';

/** Prompt sections the Hub adds to the core's: texts its own helpers send to models. */
const HUB_SECTIONS: PromptSection[] = [
  {
    id: 'hub_work_summaries', title: 'Work summaries',
    description: 'Instructions for the cheap model that writes the Work canvas\'s done / doing / next lists for busy workers.',
    placeholders: [], default: SUMMARY_PROMPT,
  },
  {
    id: 'hub_ask_split', title: 'Asks: splitting messages',
    description: 'Instructions for the cheap model that splits each of the user\'s messages into asks: things to do, questions and standing rules.',
    placeholders: [], default: ASK_SPLIT_PROMPT,
  },
  {
    id: 'hub_ask_resolve', title: 'Asks: checking results',
    description: 'Instructions for the cheap model that checks which asks a finished worker or a reply resolved.',
    placeholders: [], default: ASK_RESOLVE_PROMPT,
  },
  {
    id: 'hub_ask_link', title: 'Asks: linking work',
    description: 'Instructions for the cheap model that decides which asks new work serves, when the run that started it read several messages.',
    placeholders: [], default: ASK_LINK_PROMPT,
  },
];

export const ENTITY_PROMPT_SECTIONS: readonly PromptSection[] = [...PROMPT_SECTIONS, ...HUB_SECTIONS];

/**
 * The user's edits to the entity's prompts, kept in one small JSON file in the Hub's data directory and read by every
 * session on each wake. Only sections that differ from their default are stored.
 */
export class EntityPrompts {
  private overrides: PromptOverrides;

  constructor(private readonly file: string) {
    let parsed: { overrides?: PromptOverrides } = {};
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    const known = new Set(ENTITY_PROMPT_SECTIONS.map(s => s.id));
    this.overrides = Object.fromEntries(Object.entries(parsed.overrides ?? {}).filter(([id, text]) => known.has(id) && typeof text === 'string' && text.trim()));
  }

  /** The current overrides, for building prompts. */
  current(): PromptOverrides { return this.overrides; }

  /** A section's text as used now. */
  text(id: string): string {
    return this.overrides[id] ?? ENTITY_PROMPT_SECTIONS.find(s => s.id === id)?.default ?? '';
  }

  list() {
    return ENTITY_PROMPT_SECTIONS.map(s => ({ ...s, text: this.text(s.id), edited: this.overrides[s.id] !== undefined }));
  }

  /** Saves a section's text; empty text, or the default itself, resets it. */
  save(id: string, text: string): void {
    const section = ENTITY_PROMPT_SECTIONS.find(s => s.id === id);
    if (!section) throw new Error(`no prompt section "${id}"`);
    const next = { ...this.overrides };
    if (!text.trim() || text === section.default) delete next[id]; else next[id] = text;
    this.write(next);
  }

  /** Resets one section, or every section. */
  reset(id?: string): void {
    const next = { ...this.overrides };
    if (id) delete next[id]; else for (const key of Object.keys(next)) delete next[key];
    this.write(next);
  }

  private write(next: PromptOverrides): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ overrides: next }, null, 2));
    fs.renameSync(tmp, this.file);
    this.overrides = next;
  }
}
