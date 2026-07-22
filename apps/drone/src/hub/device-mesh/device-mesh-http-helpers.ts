import type http from 'node:http';

export function deviceMeshJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

export async function readDeviceMeshBody(
  request: http.IncomingMessage,
): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 128 * 1024) throw new Error('request body is too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('request body must be an object');
  return value;
}
