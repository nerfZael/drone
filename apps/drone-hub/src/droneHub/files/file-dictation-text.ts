export function appendFileDictationLine(content: string, line: string): string {
  const cleanLine = String(line ?? '').trim();
  if (!cleanLine) return content;
  if (!content) return cleanLine;
  return content.endsWith('\n') ? `${content}${cleanLine}` : `${content}\n${cleanLine}`;
}

export function formatFileDictationTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatFileDictationLine(
  transcript: string,
  timestamp: Date | null,
): string {
  const cleanTranscript = String(transcript ?? '').trim();
  if (!cleanTranscript) return '';
  return timestamp
    ? `[${formatFileDictationTimestamp(timestamp)}] ${cleanTranscript}`
    : cleanTranscript;
}
