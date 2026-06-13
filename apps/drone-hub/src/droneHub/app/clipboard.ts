export async function copyText(text: string): Promise<boolean> {
  const t = String(text ?? '');
  if (!t) return false;
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // ignore; fall back below
  }
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (ta?.parentNode) ta.parentNode.removeChild(ta);
  }
}

export function downloadTextFile({
  filename,
  text,
  mimeType = 'text/plain;charset=utf-8',
}: {
  filename: string;
  text: string;
  mimeType?: string;
}): void {
  const safeFilename = String(filename ?? '').trim();
  if (!safeFilename) return;
  const payload = String(text ?? '');
  const blob = new Blob([payload], { type: mimeType });
  const href = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = href;
    link.download = safeFilename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(href);
    }, 0);
  }
}
