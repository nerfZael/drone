export function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString();
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function joinParts(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

export function relativeTimeAgo(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const at = date.getTime();
  if (!Number.isFinite(at)) return iso;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${plural(seconds, 'second')} ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return `${joinParts([plural(hours, 'hour'), remainingMinutes ? plural(remainingMinutes, 'minute') : ''])} ago`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${joinParts([plural(days, 'day'), remainingHours ? plural(remainingHours, 'hour') : ''])} ago`;
}

export function exactTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}
