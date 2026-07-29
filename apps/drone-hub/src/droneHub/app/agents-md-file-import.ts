const MAX_AGENTS_MD_UPLOAD_BYTES = 2 * 1024 * 1024;
const SUPPORTED_AGENTS_MD_EXTENSIONS = ['.md', '.markdown', '.txt'];

export function agentsMdNameFromUpload(filenameRaw: unknown): string {
  const filename =
    String(filenameRaw ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.trim() ?? '';
  const lower = filename.toLowerCase();
  const extension = SUPPORTED_AGENTS_MD_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  const name = extension ? filename.slice(0, -extension.length).trim() : filename;
  if (!name) throw new Error('The uploaded file must have a name');
  if (name.length > 80) throw new Error(`${filename} has a name longer than 80 characters`);
  return name;
}

export function validateAgentsMdUploadFile(file: Pick<File, 'name' | 'size'>): void {
  const lowerName = String(file.name ?? '').toLowerCase();
  if (!SUPPORTED_AGENTS_MD_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    throw new Error(`${file.name || 'File'} must be a .md, .markdown, or .txt file`);
  }
  if (file.size > MAX_AGENTS_MD_UPLOAD_BYTES) {
    throw new Error(`${file.name} must be at most 2 MiB`);
  }
  agentsMdNameFromUpload(file.name);
}

export async function prepareAgentsMdUpload(
  file: Pick<File, 'name' | 'size' | 'text'>,
): Promise<{ name: string; content: string }> {
  validateAgentsMdUploadFile(file);
  const normalized = (await file.text()).replace(/\r\n?/g, '\n');
  if (normalized.includes('\0')) {
    throw new Error(`${file.name} does not appear to be a text file`);
  }
  const content = !normalized || normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  if (new TextEncoder().encode(content).byteLength > MAX_AGENTS_MD_UPLOAD_BYTES) {
    throw new Error(`${file.name} must be at most 2 MiB after text normalization`);
  }
  return {
    name: agentsMdNameFromUpload(file.name),
    content,
  };
}
