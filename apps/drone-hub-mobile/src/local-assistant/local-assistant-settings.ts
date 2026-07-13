import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { LocalAssistantSettings } from './local-assistant-types';
import { hasLocalAssistantCodexAuth } from './local-assistant-codex-auth';
import {
  DEFAULT_LOCAL_ASSISTANT_MODEL,
  DEFAULT_LOCAL_ASSISTANT_THINKING_LEVEL,
  migrateLocalAssistantModel,
  normalizeLocalAssistantThinkingLevel,
  type LocalAssistantThinkingLevel,
} from './local-assistant-model';

const API_KEY_NAME = 'droneHub.localAssistant.openAiApiKey.v1';
const GROQ_API_KEY_NAME = 'droneHub.groqApiKey.v1';
const MODEL_KEY = 'droneHub.localAssistant.model.v1';
const THINKING_LEVEL_KEY = 'droneHub.localAssistant.thinkingLevel.v1';
const PROVIDER_KEY = 'droneHub.localAssistant.provider.v1';

export async function loadLocalAssistantSettings(): Promise<LocalAssistantSettings> {
  const [apiKey, storedModel, storedThinkingLevel, storedProvider, hasCodexAuth] =
    await Promise.all([
      SecureStore.getItemAsync(API_KEY_NAME),
      AsyncStorage.getItem(MODEL_KEY),
      AsyncStorage.getItem(THINKING_LEVEL_KEY),
      AsyncStorage.getItem(PROVIDER_KEY),
      hasLocalAssistantCodexAuth(),
    ]);
  const model = migrateLocalAssistantModel(storedModel);
  const thinkingLevel = storedThinkingLevel
    ? normalizeLocalAssistantThinkingLevel(storedThinkingLevel)
    : DEFAULT_LOCAL_ASSISTANT_THINKING_LEVEL;
  if (storedModel !== model) await AsyncStorage.setItem(MODEL_KEY, model);
  return {
    provider: storedProvider === 'codex' ? 'codex' : 'openai',
    model,
    thinkingLevel,
    hasApiKey: Boolean(apiKey),
    hasCodexAuth,
  };
}

export async function readLocalAssistantApiKey(): Promise<string> {
  return String((await SecureStore.getItemAsync(API_KEY_NAME)) ?? '').trim();
}

export async function saveLocalAssistantSettings(input: {
  provider: 'openai' | 'codex';
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  apiKey?: string;
}): Promise<LocalAssistantSettings> {
  const model = migrateLocalAssistantModel(input.model);
  await Promise.all([
    AsyncStorage.setItem(MODEL_KEY, model),
    AsyncStorage.setItem(THINKING_LEVEL_KEY, input.thinkingLevel),
    AsyncStorage.setItem(PROVIDER_KEY, input.provider),
  ]);
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

export async function readGroqApiKey(): Promise<string> {
  return String((await SecureStore.getItemAsync(GROQ_API_KEY_NAME)) ?? '').trim();
}

export async function saveImportedGroqApiKey(apiKeyRaw: string): Promise<void> {
  const apiKey = apiKeyRaw.trim();
  if (!apiKey) throw new Error('GROQ API key is required');
  await SecureStore.setItemAsync(GROQ_API_KEY_NAME, apiKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function saveLocalAssistantProvider(provider: 'openai' | 'codex'): Promise<void> {
  await AsyncStorage.setItem(PROVIDER_KEY, provider);
}
