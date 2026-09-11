import { getHubSettingsRepository } from '../../host/hub-settings-repository';

export async function readCompanionLiveSettings(): Promise<{ enabled: boolean }> {
  const record = (await getHubSettingsRepository()).get<{ enabled?: unknown }>('companion-live-voice');
  return { enabled: record?.value?.enabled === true };
}

export async function writeCompanionLiveSettings(value: unknown): Promise<{ enabled: boolean }> {
  if (!value || typeof value !== 'object' || typeof (value as { enabled?: unknown }).enabled !== 'boolean') {
    throw new Error('Live voice enabled must be a boolean.');
  }
  const settings = { enabled: (value as { enabled: boolean }).enabled };
  await (await getHubSettingsRepository()).put('companion-live-voice', settings);
  return settings;
}
