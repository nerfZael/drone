import React from 'react';
import type { MeshDevice } from './use-device-mesh';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
type Root = { id: string; label: string; path: string };
type HomeTarget = {
  threadId: string;
  targetDeviceId: string;
  rootId: string;
  read: boolean;
  write: boolean;
};
type TargetRule = {
  assistantHomeDeviceId: string;
  threadId: string;
  rootId: string;
  read: boolean;
  write: boolean;
};
type Policy = { version: 1; roots: Root[]; homeTargets: HomeTarget[]; targetRules: TargetRule[] };

const emptyPolicy: Policy = { version: 1, roots: [], homeTargets: [], targetRules: [] };
const fieldClass =
  'min-w-0 rounded border border-[var(--border)] bg-[var(--input)] px-2.5 py-2 text-[11px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]';

function AccessChecks({
  read,
  write,
  onChange,
}: {
  read: boolean;
  write: boolean;
  onChange(read: boolean, write: boolean): void;
}) {
  return (
    <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={read}
          onChange={(event) => onChange(event.target.checked, write)}
        />{' '}
        Read
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={write}
          onChange={(event) => onChange(event.target.checked || read, event.target.checked)}
        />{' '}
        Write
      </label>
    </div>
  );
}

export function CrossDeviceAssistantPolicyPanel({
  requestJson,
  devices,
  selfDeviceId,
}: {
  requestJson: RequestJson;
  devices: MeshDevice[];
  selfDeviceId: string;
}) {
  const [policy, setPolicy] = React.useState<Policy>(emptyPolicy);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void requestJson<{ policy: Policy }>('/api/device-mesh/cross-device-assistant')
      .then((result) => {
        if (active) setPolicy(result.policy);
      })
      .catch((nextError) => active && setError(nextError?.message ?? String(nextError)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [requestJson]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await requestJson<{ policy: Policy }>(
        '/api/device-mesh/cross-device-assistant',
        { method: 'PUT', body: JSON.stringify(policy) },
      );
      setPolicy(result.policy);
      setSaved(true);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <section className="rounded-lg border border-[var(--border-subtle)] p-4 text-[12px] text-[var(--muted)]">
        Loading cross-device assistant policy…
      </section>
    );

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)]">
      <div className="border-b border-[var(--border-subtle)] bg-[linear-gradient(115deg,rgba(250,204,21,.08),transparent_55%)] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--yellow)]">
          Cross-device assistant prototype
        </div>
        <h2 className="mt-1 text-[16px] font-semibold text-[var(--fg)]">
          Two matching policy ledgers
        </h2>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
          On the assistant home, assign one remote root to a thread. On the workspace device, accept
          that exact home, thread, root, and access level. A mismatch is denied on the workspace
          device.
        </p>
      </div>

      <div className="grid gap-5 p-4">
        <PolicySection
          label="Local workspace roots"
          description="Only these folders can be exposed. Paths must already be directories on this device."
          empty="No local roots are exposed."
          onAdd={() =>
            setPolicy((current) => ({
              ...current,
              roots: [...current.roots, { id: '', label: '', path: '' }],
            }))
          }
        >
          {policy.roots.map((root, index) => (
            <div
              key={index}
              className="grid gap-2 rounded border border-[var(--border-subtle)] p-3 md:grid-cols-[.7fr_1fr_2fr_auto]"
            >
              <input
                className={fieldClass}
                placeholder="root-id"
                value={root.id}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    roots: current.roots.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, id: event.target.value } : item,
                    ),
                  }))
                }
              />
              <input
                className={fieldClass}
                placeholder="Display label"
                value={root.label}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    roots: current.roots.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, label: event.target.value } : item,
                    ),
                  }))
                }
              />
              <input
                className={`${fieldClass} font-mono`}
                placeholder="/absolute/workspace/path"
                value={root.path}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    roots: current.roots.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, path: event.target.value } : item,
                    ),
                  }))
                }
              />
              <RemoveButton
                onClick={() =>
                  setPolicy((current) => ({
                    ...current,
                    roots: current.roots.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              />
            </div>
          ))}
        </PolicySection>

        <PolicySection
          label="Threads hosted here"
          description="This is the home-side record. At most one remote workspace should be assigned per thread."
          empty="No local assistant thread has a remote workspace."
          onAdd={() =>
            setPolicy((current) => ({
              ...current,
              homeTargets: [
                ...current.homeTargets,
                {
                  threadId: '',
                  targetDeviceId:
                    devices.find((device) => !device.revokedAt && device.id !== selfDeviceId)?.id ??
                    '',
                  rootId: '',
                  read: true,
                  write: false,
                },
              ],
            }))
          }
        >
          {policy.homeTargets.map((target, index) => (
            <div
              key={index}
              className="grid gap-2 rounded border border-[var(--border-subtle)] p-3 md:grid-cols-[1.2fr_1.2fr_1fr_auto_auto] md:items-center"
            >
              <input
                className={`${fieldClass} font-mono`}
                placeholder="Assistant thread ID"
                value={target.threadId}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    homeTargets: current.homeTargets.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, threadId: event.target.value } : item,
                    ),
                  }))
                }
              />
              <select
                className={fieldClass}
                value={target.targetDeviceId}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    homeTargets: current.homeTargets.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, targetDeviceId: event.target.value } : item,
                    ),
                  }))
                }
              >
                <option value="">Target device</option>
                {devices
                  .filter((device) => !device.revokedAt && device.id !== selfDeviceId)
                  .map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
              </select>
              <input
                className={fieldClass}
                placeholder="root-id"
                value={target.rootId}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    homeTargets: current.homeTargets.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, rootId: event.target.value } : item,
                    ),
                  }))
                }
              />
              <AccessChecks
                read={target.read}
                write={target.write}
                onChange={(read, write) =>
                  setPolicy((current) => ({
                    ...current,
                    homeTargets: current.homeTargets.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, read, write } : item,
                    ),
                  }))
                }
              />
              <RemoveButton
                onClick={() =>
                  setPolicy((current) => ({
                    ...current,
                    homeTargets: current.homeTargets.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              />
            </div>
          ))}
        </PolicySection>

        <PolicySection
          label="Remote threads accepted here"
          description="This is the destination-side record and final authority for local files."
          empty="No remote assistant thread can use a local workspace."
          onAdd={() =>
            setPolicy((current) => ({
              ...current,
              targetRules: [
                ...current.targetRules,
                {
                  assistantHomeDeviceId:
                    devices.find((device) => !device.revokedAt && device.id !== selfDeviceId)?.id ??
                    '',
                  threadId: '',
                  rootId: '',
                  read: true,
                  write: false,
                },
              ],
            }))
          }
        >
          {policy.targetRules.map((rule, index) => (
            <div
              key={index}
              className="grid gap-2 rounded border border-[var(--border-subtle)] p-3 md:grid-cols-[1.2fr_1.2fr_1fr_auto_auto] md:items-center"
            >
              <select
                className={fieldClass}
                value={rule.assistantHomeDeviceId}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    targetRules: current.targetRules.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, assistantHomeDeviceId: event.target.value }
                        : item,
                    ),
                  }))
                }
              >
                <option value="">Assistant home</option>
                {devices
                  .filter((device) => !device.revokedAt && device.id !== selfDeviceId)
                  .map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
              </select>
              <input
                className={`${fieldClass} font-mono`}
                placeholder="Assistant thread ID"
                value={rule.threadId}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    targetRules: current.targetRules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, threadId: event.target.value } : item,
                    ),
                  }))
                }
              />
              <input
                className={fieldClass}
                placeholder="root-id"
                value={rule.rootId}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    targetRules: current.targetRules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, rootId: event.target.value } : item,
                    ),
                  }))
                }
              />
              <AccessChecks
                read={rule.read}
                write={rule.write}
                onChange={(read, write) =>
                  setPolicy((current) => ({
                    ...current,
                    targetRules: current.targetRules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, read, write } : item,
                    ),
                  }))
                }
              />
              <RemoveButton
                onClick={() =>
                  setPolicy((current) => ({
                    ...current,
                    targetRules: current.targetRules.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              />
            </div>
          ))}
        </PolicySection>
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] p-4">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-4 py-2 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
        >
          {saving ? 'Saving policy…' : 'Save assistant policy'}
        </button>
        {saved ? <span className="text-[11px] text-[var(--green)]">Saved</span> : null}
        {error ? <span className="text-[11px] text-[var(--red)]">{error}</span> : null}
      </div>
    </section>
  );
}

function PolicySection({
  label,
  description,
  empty,
  onAdd,
  children,
}: {
  label: string;
  description: string;
  empty: string;
  onAdd(): void;
  children: React.ReactNode;
}) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
            {label}
          </h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]"
        >
          Add record
        </button>
      </div>
      <div className="grid gap-2">
        {hasChildren ? (
          children
        ) : (
          <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
            {empty}
          </div>
        )}
      </div>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] font-semibold uppercase tracking-wider text-[var(--red)]"
    >
      Remove
    </button>
  );
}
