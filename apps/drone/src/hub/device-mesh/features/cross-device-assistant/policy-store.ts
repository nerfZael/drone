import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CrossDeviceAssistantPolicy,
  HomeWorkspaceTarget,
  WorkspaceDeviceGrant,
  WorkspaceRoot,
} from './policy-types';

const EMPTY_POLICY: CrossDeviceAssistantPolicy = {
  version: 2,
  roots: [],
  homeTargets: [],
  deviceGrants: [],
};

function id(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(result))
    throw Object.assign(new Error(`${label} is invalid`), { code: 'INVALID_POLICY' });
  return result;
}

function normalizeHomeTarget(value: any): HomeWorkspaceTarget {
  const write = value?.write === true;
  return {
    threadId: id(value?.threadId, 'thread id'),
    targetDeviceId: id(value?.targetDeviceId, 'target device id'),
    deviceName: String(value?.deviceName ?? value?.targetDeviceId ?? '')
      .trim()
      .slice(0, 80),
    rootId: id(value?.rootId, 'root id'),
    workspaceName: String(value?.workspaceName ?? value?.rootId ?? '')
      .trim()
      .slice(0, 160),
    read: value?.read === true || write,
    write,
    execute: value?.execute === true,
  };
}

function normalizeDeviceGrant(value: any): WorkspaceDeviceGrant {
  return {
    deviceId: id(value?.deviceId ?? value?.assistantHomeDeviceId, 'device id'),
    rootId: id(value?.rootId, 'root id'),
    read: value?.read === true,
    write: value?.write === true,
    execute: value?.execute === true,
  };
}

function workspacePath(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw)
    throw Object.assign(new Error('workspace path is required'), { code: 'INVALID_POLICY' });
  return path.resolve(raw);
}

export class CrossDeviceAssistantPolicyStore {
  private policy: CrossDeviceAssistantPolicy | null = null;
  private writes = Promise.resolve();
  private listeners = new Set<(threadIds: string[]) => void>();

  constructor(private readonly filePath: string) {}

  async read(): Promise<CrossDeviceAssistantPolicy> {
    if (this.policy) return this.policy;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const legacyGrants = Array.isArray(raw?.targetRules) ? raw.targetRules : [];
      const grants = Array.isArray(raw?.deviceGrants) ? raw.deviceGrants : legacyGrants;
      const mergedGrants = new Map<string, WorkspaceDeviceGrant>();
      for (const rawGrant of grants) {
        const grant = normalizeDeviceGrant(rawGrant);
        const key = `${grant.deviceId}\0${grant.rootId}`;
        const previous = mergedGrants.get(key);
        mergedGrants.set(key, {
          ...grant,
          read: grant.read || grant.write || previous?.read === true,
          write: grant.write || previous?.write === true,
          execute: grant.execute || previous?.execute === true,
        });
      }
      const mergedHomeTargets = new Map<string, HomeWorkspaceTarget>();
      for (const rawTarget of Array.isArray(raw?.homeTargets) ? raw.homeTargets : []) {
        const target = normalizeHomeTarget(rawTarget);
        const key = `${target.threadId}\0${target.targetDeviceId}\0${target.rootId}`;
        const previous = mergedHomeTargets.get(key);
        mergedHomeTargets.set(key, {
          ...target,
          deviceName: target.deviceName || previous?.deviceName || target.targetDeviceId,
          workspaceName: target.workspaceName || previous?.workspaceName || target.rootId,
          read: target.read || previous?.read === true,
          write: target.write || previous?.write === true,
          execute: target.execute || previous?.execute === true,
        });
      }
      this.policy = {
        version: 2,
        roots: (Array.isArray(raw?.roots) ? raw.roots : []).map((root: any) => ({
          id: id(root?.id, 'root id'),
          label: String(root?.label ?? root?.id).trim(),
          path: workspacePath(root?.path),
        })),
        homeTargets: [...mergedHomeTargets.values()],
        deviceGrants: [...mergedGrants.values()],
      };
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
      const rootPath = workspacePath(raw?.path);
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
    const legacyRules = Array.isArray(value?.targetRules) ? value.targetRules : [];
    const next: CrossDeviceAssistantPolicy = {
      version: 2,
      roots,
      homeTargets: (Array.isArray(value?.homeTargets) ? value.homeTargets : []).map(
        normalizeHomeTarget,
      ),
      deviceGrants: (Array.isArray(value?.deviceGrants) ? value.deviceGrants : legacyRules).map(
        normalizeDeviceGrant,
      ),
    };
    if (new Set(roots.map((root) => root.id)).size !== roots.length)
      throw Object.assign(new Error('workspace root ids must be unique'), {
        code: 'INVALID_POLICY',
      });
    if (roots.some((root) => !root.label))
      throw Object.assign(new Error('every workspace needs a name'), { code: 'INVALID_POLICY' });
    if (new Set(roots.map((root) => root.label.trim().toLowerCase())).size !== roots.length)
      throw Object.assign(new Error('workspace names must be unique on this device'), {
        code: 'INVALID_POLICY',
      });
    const rootIds = new Set(roots.map((root) => root.id));
    if (next.deviceGrants.some((rule) => !rootIds.has(rule.rootId)))
      throw Object.assign(new Error('every device grant needs a local workspace root'), {
        code: 'INVALID_POLICY',
      });
    if ([...next.homeTargets, ...next.deviceGrants].some((rule) => rule.write && !rule.read))
      throw Object.assign(new Error('write access also requires read access'), {
        code: 'INVALID_POLICY',
      });
    const grantKeys = next.deviceGrants.map((grant) => `${grant.deviceId}\0${grant.rootId}`);
    if (new Set(grantKeys).size !== grantKeys.length)
      throw Object.assign(new Error('a device can have only one grant per workspace'), {
        code: 'INVALID_POLICY',
      });
    const homeTargetKeys = next.homeTargets.map(
      (target) => `${target.threadId}\0${target.targetDeviceId}\0${target.rootId}`,
    );
    if (new Set(homeTargetKeys).size !== homeTargetKeys.length)
      throw Object.assign(new Error('a thread can target a remote workspace only once'), {
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

  async homeTargets(threadId: string): Promise<HomeWorkspaceTarget[]> {
    return (await this.read()).homeTargets.filter((item) => item.threadId === threadId);
  }

  async root(rootId: string): Promise<WorkspaceRoot | null> {
    return (await this.read()).roots.find((item) => item.id === rootId) ?? null;
  }

  async deviceGrant(deviceId: string, rootId: string): Promise<WorkspaceDeviceGrant | null> {
    return (
      (await this.read()).deviceGrants.find(
        (item) => item.deviceId === deviceId && item.rootId === rootId,
      ) ?? null
    );
  }

  async grantedRoots(deviceId: string): Promise<Array<WorkspaceRoot & WorkspaceDeviceGrant>> {
    const policy = await this.read();
    return policy.deviceGrants
      .filter((grant) => grant.deviceId === deviceId)
      .flatMap((grant) => {
        const root = policy.roots.find((candidate) => candidate.id === grant.rootId);
        return root ? [{ ...root, ...grant }] : [];
      });
  }
}
