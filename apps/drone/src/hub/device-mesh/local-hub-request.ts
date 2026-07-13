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
