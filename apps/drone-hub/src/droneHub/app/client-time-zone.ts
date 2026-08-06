export function clientTimeZone(): string {
  try {
    return new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
