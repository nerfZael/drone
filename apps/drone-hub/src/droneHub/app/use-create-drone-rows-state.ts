import React from 'react';

export function useCreateDroneRowsState() {
  const [createName, setCreateName] = React.useState('');
  const [createMessageSuffixRows, setCreateMessageSuffixRows] = React.useState<string[]>(['']);

  const createNameRows = React.useMemo(() => {
    const normalized = String(createName ?? '').replace(/\r\n/g, '\n');
    const rows = normalized.split('\n');
    return rows.length > 0 ? rows : [''];
  }, [createName]);

  const createNameEntries = React.useMemo(
    () => createNameRows.map((row) => String(row ?? '').trim()).filter(Boolean),
    [createNameRows],
  );

  const createNameCounts = React.useMemo(() => {
    const out = new Map<string, number>();
    for (const name of createNameEntries) {
      out.set(name, (out.get(name) ?? 0) + 1);
    }
    return out;
  }, [createNameEntries]);

  React.useEffect(() => {
    setCreateMessageSuffixRows((prev) => {
      const targetLen = Math.max(1, createNameRows.length);
      if (prev.length === targetLen) return prev;
      if (prev.length > targetLen) return prev.slice(0, targetLen);
      return [...prev, ...Array.from({ length: targetLen - prev.length }, () => '')];
    });
  }, [createNameRows]);

  const updateCreateNameRow = React.useCallback(
    (index: number, value: string) => {
      const rows = createNameRows.slice();
      if (index < 0 || index >= rows.length) return;
      rows[index] = value;
      setCreateName(rows.join('\n'));
    },
    [createNameRows],
  );

  const appendCreateNameRow = React.useCallback(() => {
    const rows = createNameRows.slice();
    rows.push('');
    setCreateName(rows.join('\n'));
    setCreateMessageSuffixRows((prev) => [...prev, '']);
  }, [createNameRows]);

  const removeCreateNameRow = React.useCallback(
    (index: number) => {
      const rows = createNameRows.slice();
      if (index < 0 || index >= rows.length) return;
      if (rows.length <= 1) {
        setCreateName('');
        setCreateMessageSuffixRows(['']);
        return;
      }
      rows.splice(index, 1);
      setCreateName(rows.join('\n'));
      setCreateMessageSuffixRows((prev) => {
        const next = prev.slice();
        next.splice(index, 1);
        return next.length > 0 ? next : [''];
      });
    },
    [createNameRows],
  );

  const updateCreateMessageSuffixRow = React.useCallback((index: number, value: string) => {
    setCreateMessageSuffixRows((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice();
      next[index] = value;
      return next;
    });
  }, []);

  return {
    createName,
    setCreateName,
    createNameRows,
    createNameEntries,
    createNameCounts,
    createMessageSuffixRows,
    setCreateMessageSuffixRows,
    updateCreateNameRow,
    appendCreateNameRow,
    removeCreateNameRow,
    updateCreateMessageSuffixRow,
  };
}
