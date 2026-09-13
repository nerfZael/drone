import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type AssistantLaunch = { requestId: string };
export type PhoneAssistantStatus = { supported: boolean; selected: boolean };
type NativeAssistant = {
  getLaunch(): Promise<AssistantLaunch>;
  ready(id: string): Promise<boolean>;
  canStart(id: string): Promise<boolean>;
  hasPermissions(): Promise<boolean>;
  claimStart(id: string): Promise<boolean>;
  retry(id: string): Promise<boolean>;
  openApp(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  getStatus(): Promise<PhoneAssistantStatus>;
  requestRole(): Promise<void>;
  addListener(event: 'launchChanged', listener: (launch: AssistantLaunch) => void): { remove(): void };
};

export const phoneAssistant = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeAssistant>('DroneAssistant') : null;
