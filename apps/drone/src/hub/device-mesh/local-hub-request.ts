export type LocalHubAccess = {
  baseUrl(): string;
  apiToken: string;
};

export async function localHubRequest(
  access: LocalHubAccess,
  pathname: string,
  init?: RequestInit,
): Promise<any> {
  const response = await fetch(new URL(pathname, access.baseUrl()), {
    ...init,
    headers: {
      authorization: `Bearer ${access.apiToken}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(String(body?.error ?? `Hub request failed (${response.status})`)),
      {
        code: `HUB_${response.status}`,
      },
    );
  }
  return body;
}

export async function localHubBinaryRequest(
  access: LocalHubAccess,
  pathname: string,
  options: { maxBytes: number; expectedBytes?: number; signal?: AbortSignal },
): Promise<{ bytes: Buffer; contentType: string }> {
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 0 ||
    (options.expectedBytes != null &&
      (!Number.isSafeInteger(options.expectedBytes) ||
        options.expectedBytes < 0 ||
        options.expectedBytes > options.maxBytes))
  ) {
    throw Object.assign(new Error('invalid Hub media byte limit'), { code: 'RESOURCE_LIMIT' });
  }
  const response = await fetch(new URL(pathname, access.baseUrl()), {
    headers: { authorization: `Bearer ${access.apiToken}` },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(String(body?.error ?? `Hub request failed (${response.status})`)),
      { code: `HUB_${response.status}` },
    );
  }
  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength != null && declaredLength > options.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error('the Hub media response exceeded the transfer limit'), {
      code: 'RESOURCE_LIMIT',
    });
  }
  if (
    options.expectedBytes != null &&
    declaredLength != null &&
    declaredLength !== options.expectedBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error('the Hub media response length changed'), {
      code: 'INVALID_RESPONSE',
    });
  }

  const expectedBytes = options.expectedBytes ?? declaredLength;
  const destination = expectedBytes == null ? null : Buffer.alloc(expectedBytes);
  const chunks: Buffer[] = [];
  const reader = response.body?.getReader();
  let totalBytes = 0;
  try {
    if (!reader) throw new Error('the Hub returned an empty media response');
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (
        totalBytes + next.value.byteLength > options.maxBytes ||
        (expectedBytes != null && totalBytes + next.value.byteLength > expectedBytes)
      ) {
        throw Object.assign(new Error('the Hub media response exceeded its declared size'), {
          code: 'RESOURCE_LIMIT',
        });
      }
      const chunk = Buffer.from(next.value);
      if (destination) chunk.copy(destination, totalBytes);
      else chunks.push(chunk);
      totalBytes += chunk.length;
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader?.releaseLock();
  }
  if (expectedBytes != null && totalBytes !== expectedBytes) {
    throw Object.assign(new Error('the Hub media response ended before its declared size'), {
      code: 'INVALID_RESPONSE',
    });
  }
  return {
    bytes: destination ?? Buffer.concat(chunks, totalBytes),
    contentType: String(response.headers.get('content-type') ?? ''),
  };
}

function parseContentLength(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
