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

export async function localHubBoundedJsonRequest(
  access: LocalHubAccess,
  pathname: string,
  options: { maxBytes: number; signal?: AbortSignal },
): Promise<any> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw Object.assign(new Error('invalid Hub JSON byte limit'), { code: 'RESOURCE_LIMIT' });
  }
  const response = await fetch(new URL(pathname, access.baseUrl()), {
    headers: {
      authorization: `Bearer ${access.apiToken}`,
      'content-type': 'application/json',
    },
    signal: options.signal,
  });
  const body = await readBoundedResponseBody(response, options.maxBytes);
  let value: any = {};
  try {
    value = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
  } catch {
    value = {};
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(String(value?.error ?? `Hub request failed (${response.status})`)),
      { code: `HUB_${response.status}` },
    );
  }
  return value;
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

async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength != null && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error('the Hub JSON response exceeded the transfer limit'), {
      code: 'RESOURCE_LIMIT',
    });
  }
  const destination = Buffer.allocUnsafe(declaredLength ?? maxBytes);
  const reader = response.body?.getReader();
  let totalBytes = 0;
  try {
    if (!reader) return Buffer.alloc(0);
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (
        totalBytes + next.value.byteLength > maxBytes ||
        (declaredLength != null && totalBytes + next.value.byteLength > declaredLength)
      ) {
        throw Object.assign(new Error('the Hub JSON response exceeded the transfer limit'), {
          code: 'RESOURCE_LIMIT',
        });
      }
      Buffer.from(next.value).copy(destination, totalBytes);
      totalBytes += next.value.byteLength;
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader?.releaseLock();
  }
  if (declaredLength != null && totalBytes !== declaredLength) {
    throw Object.assign(new Error('the Hub JSON response length changed'), {
      code: 'INVALID_RESPONSE',
    });
  }
  return destination.subarray(0, totalBytes);
}
