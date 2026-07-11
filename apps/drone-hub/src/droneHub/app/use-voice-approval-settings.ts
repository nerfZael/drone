import React from 'react';
import type { VoiceActivationSettings, VoiceApprovalSettings, VoiceApprovalSettingsResponse, VoiceRealtimeSettings, VoiceTranscriptionSettings } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export type UseVoiceApprovalSettingsResult = {
  voiceApprovalSettings: VoiceApprovalSettingsResponse | null;
  voiceApprovalSettingsLoading: boolean;
  voiceApprovalSettingsError: string | null;
  voiceApprovalSettingsNotice: string | null;
  voiceApprovalDraft: VoiceApprovalSettings | null;
  voiceTranscriptionDraft: VoiceTranscriptionSettings | null;
  voiceActivationDraft: VoiceActivationSettings | null;
  voiceRealtimeDraft: VoiceRealtimeSettings | null;
  savingVoiceApprovalSettings: boolean;
  setVoiceApprovalDraft: React.Dispatch<React.SetStateAction<VoiceApprovalSettings | null>>;
  setVoiceTranscriptionDraft: React.Dispatch<React.SetStateAction<VoiceTranscriptionSettings | null>>;
  setVoiceActivationDraft: React.Dispatch<React.SetStateAction<VoiceActivationSettings | null>>;
  setVoiceRealtimeDraft: React.Dispatch<React.SetStateAction<VoiceRealtimeSettings | null>>;
  loadVoiceApprovalSettings: () => Promise<void>;
  saveVoiceApprovalSettings: () => Promise<void>;
};

export function useVoiceApprovalSettings(requestJson: RequestJsonFn): UseVoiceApprovalSettingsResult {
  const [voiceApprovalSettings, setVoiceApprovalSettings] = React.useState<VoiceApprovalSettingsResponse | null>(null);
  const [voiceApprovalSettingsLoading, setVoiceApprovalSettingsLoading] = React.useState(false);
  const [voiceApprovalSettingsError, setVoiceApprovalSettingsError] = React.useState<string | null>(null);
  const [voiceApprovalSettingsNotice, setVoiceApprovalSettingsNotice] = React.useState<string | null>(null);
  const [voiceApprovalDraft, setVoiceApprovalDraft] = React.useState<VoiceApprovalSettings | null>(null);
  const [voiceTranscriptionDraft, setVoiceTranscriptionDraft] = React.useState<VoiceTranscriptionSettings | null>(null);
  const [voiceActivationDraft, setVoiceActivationDraft] = React.useState<VoiceActivationSettings | null>(null);
  const [voiceRealtimeDraft, setVoiceRealtimeDraft] = React.useState<VoiceRealtimeSettings | null>(null);
  const [savingVoiceApprovalSettings, setSavingVoiceApprovalSettings] = React.useState(false);

  const applyResponse = React.useCallback((data: VoiceApprovalSettingsResponse) => {
    setVoiceApprovalSettings(data);
    setVoiceApprovalDraft({
      triggerPhrase: data.voiceApproval.triggerPhrase,
      unlockCode: data.voiceApproval.unlockCode,
      lockCode: data.voiceApproval.lockCode,
      lockedOffCode: data.voiceApproval.lockedOffCode,
      minDigits: data.voiceApproval.minDigits,
      maxDigits: data.voiceApproval.maxDigits,
      stableMs: data.voiceApproval.stableMs,
      collectTimeoutMs: data.voiceApproval.collectTimeoutMs,
      duplicateCooldownMs: data.voiceApproval.duplicateCooldownMs,
      finalizeCheckIntervalMs: data.voiceApproval.finalizeCheckIntervalMs,
      postPromptCommandSuppressionMs: data.voiceApproval.postPromptCommandSuppressionMs,
    });
    setVoiceTranscriptionDraft({
      finalMode: data.voiceTranscription.finalMode,
    });
    setVoiceActivationDraft({
      normalAliases: data.voiceActivation.normalAliases,
      realTimeAliases: data.voiceActivation.realTimeAliases,
    });
    setVoiceRealtimeDraft({
      enabled: data.voiceRealtime.enabled,
      provider: data.voiceRealtime.provider,
    });
  }, []);

  const loadVoiceApprovalSettings = React.useCallback(async () => {
    setVoiceApprovalSettingsLoading(true);
    setVoiceApprovalSettingsError(null);
    setVoiceApprovalSettingsNotice(null);
    try {
      applyResponse(await requestJson<VoiceApprovalSettingsResponse>('/api/settings/voice-approval'));
    } catch (e: any) {
      setVoiceApprovalSettingsError(e?.message ?? String(e));
    } finally {
      setVoiceApprovalSettingsLoading(false);
    }
  }, [applyResponse, requestJson]);

  React.useEffect(() => {
    void loadVoiceApprovalSettings();
  }, [loadVoiceApprovalSettings]);

  const saveVoiceApprovalSettings = React.useCallback(async () => {
    if (!voiceApprovalDraft || !voiceTranscriptionDraft || !voiceActivationDraft || !voiceRealtimeDraft) return;
    setSavingVoiceApprovalSettings(true);
    setVoiceApprovalSettingsError(null);
    setVoiceApprovalSettingsNotice(null);
    try {
      const data = await requestJson<VoiceApprovalSettingsResponse>('/api/settings/voice-approval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voiceApproval: voiceApprovalDraft,
          voiceTranscription: voiceTranscriptionDraft,
          voiceActivation: voiceActivationDraft,
          voiceRealtime: voiceRealtimeDraft,
        }),
      });
      applyResponse(data);
      setVoiceApprovalSettingsNotice('Saved voice settings.');
    } catch (e: any) {
      setVoiceApprovalSettingsError(e?.message ?? String(e));
    } finally {
      setSavingVoiceApprovalSettings(false);
    }
  }, [applyResponse, requestJson, voiceActivationDraft, voiceApprovalDraft, voiceRealtimeDraft, voiceTranscriptionDraft]);

  return {
    voiceApprovalSettings,
    voiceApprovalSettingsLoading,
    voiceApprovalSettingsError,
    voiceApprovalSettingsNotice,
    voiceApprovalDraft,
    voiceTranscriptionDraft,
    voiceActivationDraft,
    voiceRealtimeDraft,
    savingVoiceApprovalSettings,
    setVoiceApprovalDraft,
    setVoiceTranscriptionDraft,
    setVoiceActivationDraft,
    setVoiceRealtimeDraft,
    loadVoiceApprovalSettings,
    saveVoiceApprovalSettings,
  };
}
