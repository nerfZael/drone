import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CrossDeviceAssistantPolicy,
  HomeWorkspaceTarget,
  TargetWorkspaceRule,
  WorkspaceRoot,
} from './policy-types';

const EMPTY_POLICY: CrossDeviceAssistantPolicy = {
  version: 1,
  roots: [],
  homeTargets: [],
  targetRules: [],
};

function id(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(result))
    throw Object.assign(new Error(`${label} is invalid`), { code: 'INVALID_POLICY' });
  return result;
}

function normalizeHomeTarget(value: any): HomeWorkspaceTarget {
  return {
    threadId: id(value?.threadId, 'thread id'),
    targetDeviceId: id(value?.targetDeviceId, 'target device id'),
    rootId: id(value?.rootId, 'root id'),
    read: value?.read === true,
    write: value?.write === true,
  };
}

function normalizeTargetRule(value: any): TargetWorkspaceRule {
  return {
    assistantHomeDeviceId: id(value?.assistantHomeDeviceId, 'assistant home device id'),
    threadId: id(value?.threadId, 'thread id'),
    rootId: id(value?.rootId, 'root id'),
    read: value?.read === true,
    write: value?.write === true,
  };
}

export class CrossDeviceAssistantPolicyStore {
  private policy: CrossDeviceAssistantPolicy | null = null;
  private writes = Promise.resolve();
  private listeners = new Set<(threadIds: string[]) => void>();

  constructor(private readonly filePath: string) {}

  async read(): Promise<CrossDeviceAssistantPolicy> {
    if (this.policy) return this.policy;
    try {
      this.policy = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      this.policy = structuredClone(EMPTY_POLICY);
    }
    return this.policy!;
  }

  async replace(value: any): Promise<CrossDeviceAssistantPolicy> {
    const previous = await this.read();
    const roots: WorkspaceRoot[] = [];
    for (const raw of Array.isArray(value?.roots) ? value.roots : []) {
      const rootPath = path.resolve(String(raw?.path ?? '').trim());
      const stats = await fs.stat(rootPath).catch(() => null);
      if (!stats?.isDirectory())
        throw Object.assign(new Error(`workspace root is not a directory: ${rootPath}`), {
          code: 'INVALID_POLICY',
        });
      roots.push({
        id: id(raw?.id, 'root id'),
        label: String(raw?.label ?? raw?.id).trim(),
        path: rootPath,
      });
    }
    const next: CrossDeviceAssistantPolicy = {
      version: 1,
      roots,
      homeTargets: (Array.isArray(value?.homeTargets) ? value.homeTargets : []).map(
        normalizeHomeTarget,
      ),
      targetRules: (Array.isArray(value?.targetRules) ? value.targetRules : []).map(
        normalizeTargetRule,
      ),
    };
    if (new Set(roots.map((root) => root.id)).size !== roots.length)
      throw Object.assign(new Error('workspace root ids must be unique'), {
        code: 'INVALID_POLICY',
      });
    if (new Set(next.homeTargets.map((item) => item.threadId)).size !== next.homeTargets.length)
      throw Object.assign(new Error('a thread can have only one remote workspace'), {
        code: 'INVALID_POLICY',
      });
    const rootIds = new Set(roots.map((root) => root.id));
    if (next.targetRules.some((rule) => !rootIds.has(rule.rootId)))
      throw Object.assign(new Error('every accepted target rule needs a local workspace root'), {
        code: 'INVALID_POLICY',
      });
    if ([...next.homeTargets, ...next.targetRules].some((rule) => rule.write && !rule.read))
      throw Object.assign(new Error('write access also requires read access'), {
        code: 'INVALID_POLICY',
      });
    this.policy = next;
    this.writes = this.writes.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    });
    await this.writes;
    const affected = [
      ...new Set([...previous.homeTargets, ...next.homeTargets].map((item) => item.threadId)),
    ];
    for (const listener of this.listeners) {
      try {
        listener(affected);
      } catch {
        // The policy is already durable; one UI invalidation must not make the save look failed.
      }
    }
    return next;
  }

  onChange(listener: (threadIds: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async homeTarget(threadId: string): Promise<HomeWorkspaceTarget | null> {
    return (await this.read()).homeTargets.find((item) => item.threadId === threadId) ?? null;
  }

  async root(rootId: string): Promise<WorkspaceRoot | null> {
    return (await this.read()).roots.find((item) => item.id === rootId) ?? null;
  }

  async exactTargetRule(rule: TargetWorkspaceRule): Promise<boolean> {
    return (await this.read()).targetRules.some(
      (item) =>
        item.assistantHomeDeviceId === rule.assistantHomeDeviceId &&
        item.threadId === rule.threadId &&
        item.rootId === rule.rootId &&
        item.read === rule.read &&
        item.write === rule.write,
    );
  }
}
