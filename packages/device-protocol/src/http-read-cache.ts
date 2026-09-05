import { canonicalJson } from './canonical-json';

type Patch = { path: string[]; value?: unknown; remove?: true; append?: string };
type Snapshot = { revision: string; value: any };

export function diffDeviceRead(
  previous: any,
  next: any,
  path: string[] = [],
  output: Patch[] = [],
): Patch[] {
  if (canonicalJson(previous) === canonicalJson(next)) return output;
  if (typeof previous === 'string' && typeof next === 'string' && next.startsWith(previous)) {
    output.push({ path, append: next.slice(previous.length) });
  } else if (
    previous &&
    next &&
    typeof previous === 'object' &&
    typeof next === 'object' &&
    !Array.isArray(previous) &&
    !Array.isArray(next) &&
    path.length < 24
  ) {
    for (const key of Object.keys(previous))
      if (!Object.prototype.hasOwnProperty.call(next, key))
        output.push({ path: [...path, key], remove: true });
    for (const key of Object.keys(next))
      diffDeviceRead(previous[key], next[key], [...path, key], output);
  } else if (
    Array.isArray(previous) &&
    Array.isArray(next) &&
    previous.length === next.length &&
    path.length < 24
  ) {
    for (let i = 0; i < next.length; i++)
      diffDeviceRead(previous[i], next[i], [...path, String(i)], output);
  } else output.push({ path, value: next });
  return output;
}

export function applyDeviceReadPatch(previous: unknown, patches: Patch[]): unknown {
  let result = JSON.parse(JSON.stringify(previous));
  if (patches.length > 20_000) throw new Error('Device read delta is too large');
  for (const patch of patches) {
    if (!Array.isArray(patch.path) || patch.path.length > 32)
      throw new Error('Invalid device read delta');
    if (!patch.path.length) {
      result = patch.append !== undefined ? String(result) + patch.append : patch.value;
      continue;
    }
    let target = result;
    for (const key of patch.path.slice(0, -1)) {
      if (
        !target ||
        typeof target !== 'object' ||
        !Object.prototype.hasOwnProperty.call(target, key)
      )
        throw new Error('Invalid device read path');
      target = target[key];
    }
    const key = patch.path[patch.path.length - 1]!;
    if (patch.remove) delete target[key];
    else
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value:
          patch.append !== undefined
            ? String(Object.prototype.hasOwnProperty.call(target, key) ? target[key] : '') +
              patch.append
            : patch.value,
      });
  }
  return result;
}

export class DeviceReadClientCache {
  private readonly snapshots = new Map<string, Snapshot>();
  prepare(target: string, capability: string, operation: string, payload: any) {
    if (capability !== 'drone-control' || operation !== 'chat.read')
      return { payload, decode: (value: any) => value };
    const key = canonicalJson({ target, capability, operation, payload });
    const baseline = this.snapshots.get(key);
    return {
      payload: { ...payload, __deviceReadRevision: baseline?.revision ?? '' },
      decode: (wire: any) => {
        if (wire?.type !== 'device.read') return wire;
        if (wire.base && wire.base !== baseline?.revision)
          throw new Error('Device read revision mismatch');
        const value = wire.base ? applyDeviceReadPatch(baseline!.value, wire.patch) : wire.value;
        this.snapshots.delete(key);
        // Cache only small read pages, and retain at most 16 page representations.
        // Callers may decorate returned messages; never let them mutate a signed delta baseline.
        const serialized = canonicalJson(value);
        if (serialized.length <= 512 * 1024)
          this.snapshots.set(key, { revision: wire.revision, value: JSON.parse(serialized) });
        while (this.snapshots.size > 16) this.snapshots.delete(this.snapshots.keys().next().value!);
        return value;
      },
    };
  }
  clear(): void {
    this.snapshots.clear();
  }
}
