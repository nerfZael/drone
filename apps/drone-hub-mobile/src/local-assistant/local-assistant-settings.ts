import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { LocalAssistantSettings } from './local-assistant-types';

const API_KEY_NAME = 'droneHub.localAssistant.openAiApiKey.v1';
const MODEL_KEY = 'droneHub.localAssistant.model.v1';
export const DEFAULT_LOCAL_ASSISTANT_MODEL = 'gpt-5.6-luna';

export async function loadLocalAssistantSettings(): Promise<LocalAssistantSettings> {
  const [apiKey, storedModel] = await Promise.all([
    SecureStore.getItemAsync(API_KEY_NAME),
    AsyncStorage.getItem(MODEL_KEY),
  ]);
  return {
    model: String(storedModel ?? '').trim() || DEFAULT_LOCAL_ASSISTANT_MODEL,
    hasApiKey: Boolean(apiKey),
  };
}

export async function readLocalAssistantApiKey(): Promise<string> {
  return String((await SecureStore.getItemAsync(API_KEY_NAME)) ?? '').trim();
}

export async function saveLocalAssistantSettings(input: {
  model: string;
  apiKey?: string;
}): Promise<LocalAssistantSettings> {
  const model = input.model.trim().slice(0, 100) || DEFAULT_LOCAL_ASSISTANT_MODEL;
  await AsyncStorage.setItem(MODEL_KEY, model);
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    await SecureStore.setItemAsync(API_KEY_NAME, apiKey, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return await loadLocalAssistantSettings();
}

export async function clearLocalAssistantApiKey(): Promise<LocalAssistantSettings> {
  await SecureStore.deleteItemAsync(API_KEY_NAME);
  return await loadLocalAssistantSettings();
}

export async function saveImportedOpenAiApiKey(apiKeyRaw: string): Promise<void> {
  const apiKey = apiKeyRaw.trim();
  if (!apiKey) throw new Error('OpenAI API key is required');
  await SecureStore.setItemAsync(API_KEY_NAME, apiKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
