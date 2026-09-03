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
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(new URL(pathname, access.baseUrl()), {
    headers: { authorization: `Bearer ${access.apiToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(String(body?.error ?? `Hub request failed (${response.status})`)),
      { code: `HUB_${response.status}` },
    );
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: String(response.headers.get('content-type') ?? ''),
  };
}
