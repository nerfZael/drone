import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { Button, ErrorBanner, Label, textStyles } from '../components/Ui';
import { colors } from '../theme';
import {
  DEFAULT_MOBILE_VOICE_INPUT_SETTINGS,
  MOBILE_VOICE_INPUT_SILENCE_MILLIS_MAX,
  MOBILE_VOICE_INPUT_SILENCE_MILLIS_MIN,
  loadMobileVoiceInputSettings,
  saveMobileVoiceInputSettings,
  type MobileVoiceInputSettings,
} from './mobile-voice-input-settings';

function ChoiceRow<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choice,
              selected && styles.choiceSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MobileVoiceInputSettingsCard() {
  const [settings, setSettings] = React.useState<MobileVoiceInputSettings>(
    DEFAULT_MOBILE_VOICE_INPUT_SETTINGS,
  );
  const [customSeconds, setCustomSeconds] = React.useState('2.5');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  React.useEffect(() => {
    let active = true;
    void loadMobileVoiceInputSettings()
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setCustomSeconds(formatPauseSeconds(next.customSilenceMillis));
      })
      .catch((nextError: any) => active && setError(nextError?.message ?? String(nextError)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const seconds = Number(customSeconds);
      if (
        settings.endThoughtPreset === 'custom' &&
        (!Number.isFinite(seconds) ||
          seconds < MOBILE_VOICE_INPUT_SILENCE_MILLIS_MIN / 1_000 ||
          seconds > MOBILE_VOICE_INPUT_SILENCE_MILLIS_MAX / 1_000)
      ) {
        throw new Error(
          `Custom pause must be between ${MOBILE_VOICE_INPUT_SILENCE_MILLIS_MIN / 1_000} and ${MOBILE_VOICE_INPUT_SILENCE_MILLIS_MAX / 1_000} seconds.`,
        );
      }
      const saved = await saveMobileVoiceInputSettings({
        ...settings,
        customSilenceMillis: Math.round((Number.isFinite(seconds) ? seconds : 2.5) * 1_000),
      });
      setSettings(saved);
      setCustomSeconds(formatPauseSeconds(saved.customSilenceMillis));
      setNotice('Saved voice input settings.');
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.section}>
      <Label>Voice input</Label>
      <Text style={[textStyles.body, styles.description]}>
        Configure how continuous voice steering decides that a spoken thought is complete.
        Listening continues while the screen is locked and recovers after calls or temporary
        microphone interruptions.
      </Text>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>End thought after</Text>
        <ChoiceRow
          value={settings.endThoughtPreset}
          options={[
            { value: 'quick', label: 'Quick' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'patient', label: 'Patient' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(endThoughtPreset) => setSettings((current) => ({ ...current, endThoughtPreset }))}
        />
        {settings.endThoughtPreset === 'custom' ? (
          <ThemedTextInput
            value={customSeconds}
            onChangeText={setCustomSeconds}
            keyboardType="decimal-pad"
            placeholder="2.5 seconds"
            placeholderTextColor={colors.subtle}
            style={styles.input}
          />
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Noise handling</Text>
        <ChoiceRow
          value={settings.noiseHandling}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'quiet', label: 'Quiet' },
            { value: 'noisy', label: 'Noisy' },
          ]}
          onChange={(noiseHandling) => setSettings((current) => ({ ...current, noiseHandling }))}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Transcription quality</Text>
        <ChoiceRow
          value={settings.quality}
          options={[
            { value: 'fast', label: 'Fast' },
            { value: 'accurate', label: 'Accurate' },
          ]}
          onChange={(quality) => setSettings((current) => ({ ...current, quality }))}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Preferred language</Text>
        <ThemedTextInput
          value={settings.language ?? ''}
          onChangeText={(language) =>
            setSettings((current) => ({ ...current, language: language.trim() || null }))
          }
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Auto (or en, hr-HR, …)"
          placeholderTextColor={colors.subtle}
          style={styles.input}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.fieldLabel}>Send confirmation</Text>
          <Text style={styles.helper}>Vibrate briefly after a spoken thought is accepted.</Text>
        </View>
        <Switch
          value={settings.confirmationFeedback}
          onValueChange={(confirmationFeedback) =>
            setSettings((current) => ({ ...current, confirmationFeedback }))
          }
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
        />
      </View>

      <Button onPress={() => void save()} loading={saving} disabled={loading} style={styles.saveButton}>
        Save voice input settings
      </Button>
    </View>
  );
}

function formatPauseSeconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(2).replace(/\.?0+$/, '');
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 13,
  },
  description: { marginTop: -5 },
  field: { gap: 7 },
  fieldLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.controlSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentWash },
  choiceText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  choiceTextSelected: { color: colors.accent },
  input: {
    minHeight: 40,
    color: colors.text,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    paddingVertical: 8,
    fontSize: 14,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchCopy: { flex: 1, gap: 3 },
  helper: { color: colors.secondary, fontSize: 11, lineHeight: 16 },
  notice: { color: colors.online, fontSize: 11, fontWeight: '600' },
  saveButton: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.72 },
});
