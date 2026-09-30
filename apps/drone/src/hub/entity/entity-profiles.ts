import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type EntityReasoning = (typeof REASONING_LEVELS)[number];

/** One part of the entity: the model it runs on and how hard that model thinks. */
export interface ModelChoice { model: string; reasoning: EntityReasoning }

/** The model for each part of the entity. No voice: the head is the front. */
export interface EntityModels { head: ModelChoice; task: ModelChoice; voice: ModelChoice | null }

/** A named set of models the user saved to reuse. */
export interface EntityProfile { id: string; name: string; models: EntityModels }

export function isReasoning(value: unknown): value is EntityReasoning {
  return typeof value === 'string' && (REASONING_LEVELS as readonly string[]).includes(value);
}

/** Checks a models value from a request; `known` says whether a model id can be run. */
export function parseModels(value: unknown, known: (model: string) => boolean): EntityModels | string {
  const v = value as Partial<Record<'head' | 'task' | 'voice', unknown>> | null;
  if (!v || typeof v !== 'object') return 'models must be an object';
  const choice = (part: string, raw: unknown): ModelChoice | string => {
    const c = raw as Partial<ModelChoice> | null;
    if (!c || typeof c.model !== 'string' || !known(c.model)) return `unsupported ${part} model`;
    if (!isReasoning(c.reasoning)) return `${part} reasoning must be one of ${REASONING_LEVELS.join(', ')}`;
    return { model: c.model, reasoning: c.reasoning };
  };
  const head = choice('head', v.head);
  if (typeof head === 'string') return head;
  const task = choice('task', v.task);
  if (typeof task === 'string') return task;
  const voice = v.voice == null ? null : choice('voice', v.voice);
  if (typeof voice === 'string') return voice;
  return { head, task, voice };
}

/** Profiles live in one small JSON file in the Hub's data directory. */
export class EntityProfiles {
  constructor(private readonly file: string) {}

  list(): EntityProfile[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { profiles?: EntityProfile[] };
      return Array.isArray(parsed.profiles) ? parsed.profiles : [];
    } catch {
      return [];
    }
  }

  /** Saves a new profile, or replaces the one with the same id (or, without an id, the same name). */
  save(input: { id?: string; name: string; models: EntityModels }): EntityProfile {
    const name = input.name.trim();
    const profiles = this.list();
    const existing = profiles.find(p => (input.id ? p.id === input.id : p.name.toLowerCase() === name.toLowerCase()));
    if (input.id && !existing) throw new Error('no such profile');
    if (profiles.some(p => p !== existing && p.name.toLowerCase() === name.toLowerCase())) throw new Error(`a profile named "${name}" already exists`);
    const profile: EntityProfile = { id: existing?.id ?? randomUUID(), name, models: input.models };
    this.write(existing ? profiles.map(p => (p === existing ? profile : p)) : [...profiles, profile]);
    return profile;
  }

  remove(id: string): boolean {
    const profiles = this.list();
    const kept = profiles.filter(p => p.id !== id);
    if (kept.length === profiles.length) return false;
    this.write(kept);
    return true;
  }

  private write(profiles: EntityProfile[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ profiles }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
