export type HubClientConfig = {
  apiUrl: string;
  apiToken: string;
};

export type HubVoiceThreadResult = {
  ok: true;
  threadId: string;
  created?: boolean;
};

export function buildHubClientConfigFromEnv(env: NodeJS.ProcessEnv): HubClientConfig | null {
  const apiUrl = String(env.DRONE_HUB_API_URL ?? "").trim().replace(/\/+$/, "");
  const apiToken = String(env.DRONE_HUB_API_TOKEN ?? "").trim();
  if (!apiUrl || !apiToken) return null;
  return { apiUrl, apiToken };
}

export async function connectVoiceThread(config: HubClientConfig, title = "Voice thread"): Promise<HubVoiceThreadResult> {
  return await postHubJson(config, "/api/assistant/voice/connect", { title });
}

export async function submitVoiceMessage(config: HubClientConfig, prompt: string, title = "Voice thread", deliveryMode?: "queue" | "asap"): Promise<HubVoiceThreadResult> {
  return await postHubJson(config, "/api/assistant/voice/message", { prompt, title, deliveryMode });
}

export async function beginVoicePatch(config: HubClientConfig, source = "android", sessionId?: string | null): Promise<any> {
  return await postHubJson(config, "/api/assistant/voice/patch-state", { active: true, source, sessionId });
}

export async function endVoicePatch(config: HubClientConfig, source = "android", sessionId?: string | null, reason?: string): Promise<any> {
  return await postHubJson(config, "/api/assistant/voice/patch-state", { active: false, source, sessionId, reason });
}

export async function submitVoicePatchMessage(config: HubClientConfig, prompt: string, source = "android", sessionId?: string | null): Promise<any> {
  return await postHubJson(config, "/api/assistant/voice/patch-message", { prompt, source, sessionId });
}

export async function getVoiceApprovalSettings(config: HubClientConfig): Promise<any> {
  return await getHubJson(config, "/api/settings/voice-approval");
}

async function getHubJson(config: HubClientConfig, pathname: string): Promise<any> {
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${config.apiToken}`,
    },
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data;
}

async function postHubJson(config: HubClientConfig, pathname: string, body: any): Promise<any> {
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  return data;
}
