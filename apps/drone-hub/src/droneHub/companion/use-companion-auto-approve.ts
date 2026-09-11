import React from 'react';

async function request(enabled?: boolean): Promise<boolean> {
  const response = await fetch('/api/settings/companion/auto-approve', {
    signal: AbortSignal.timeout(10_000),
    ...(enabled === undefined ? {} : {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    }),
  });
  if (!response.ok) throw new Error(`Could not ${enabled === undefined ? 'load' : 'save'} auto-approve setting (${response.status}).`);
  const value = await response.json();
  if (typeof value?.enabled !== 'boolean') throw new Error('Invalid auto-approve setting from the Hub.');
  return value.enabled;
}

export function useCompanionAutoApprove() {
  const [enabled, setEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  React.useEffect(() => {
    const current = ++generation.current;
    void request().then((value) => {
      if (current === generation.current) { setEnabled(value); setError(''); }
    }).catch((error) => {
      if (current === generation.current) setError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, []);
  const toggle = React.useCallback(async () => {
    if (loading || writing.current) return;
    writing.current = true;
    const current = ++generation.current;
    setSaving(true);
    try {
      const value = await request(!enabled);
      if (current === generation.current) { setEnabled(value); setError(''); }
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      writing.current = false;
      if (current === generation.current) setSaving(false);
    }
  }, [enabled, loading]);
  return { enabled, loading, saving, error, toggle };
}
