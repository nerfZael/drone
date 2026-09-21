import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { CompanionInstructionsResponse } from '@drone/assistant-chat';
import { Button, ErrorBanner } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

type Props = { deviceId: string; supported: boolean; readable: boolean; writable: boolean };

export function MobileCompanionInstructionsSettings({ deviceId, supported, readable, writable }: Props) {
  const { request } = useMesh();
  const [data, setData] = React.useState<CompanionInstructionsResponse | null>(null);
  const [content, setContent] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const generation = React.useRef(0);
  const writing = React.useRef(false);
  const load = React.useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError(''); setSaved(false);
    try {
      const result = await request(deviceId, 'companion', 'instructions.get') as CompanionInstructionsResponse;
      if (token === generation.current) { setData(result); setContent(result.instructions.content); }
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === generation.current) setLoading(false); }
  }, [deviceId, request]);
  React.useEffect(() => {
    if (supported && readable) void load();
    return () => { generation.current++; };
  }, [supported, readable, load]);
  const save = async () => {
    if (!data || !writable || writing.current) return;
    writing.current = true; setSaving(true); setError(''); setSaved(false);
    const token = ++generation.current;
    try {
      const result = await request(deviceId, 'companion', 'instructions.update', { content, revision: data.instructions.revision }) as CompanionInstructionsResponse;
      if (token === generation.current) { setData(result); setContent(result.instructions.content); setSaved(true); }
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { writing.current = false; if (token === generation.current) setSaving(false); }
  };
  const dirty = data && content !== data.instructions.content;
  return <View style={{ gap: 10 }}>
    <Text style={{ color: colors.text, fontWeight: '600' }}>Persistent Companion instructions</Text>
    <Text style={{ color: colors.textSecondary }}>Preferences and working conventions retained across conversations. Companion can also update these instructions.</Text>
    {!supported ? <Text style={{ color: colors.textSecondary }}>Update this Hub to edit persistent instructions.</Text> : !readable ?
      <Text style={{ color: colors.textSecondary }}>Allow Companion instructions access for this phone in the Hub device settings.</Text> : <>
      {loading ? <ActivityIndicator accessibilityLabel="Loading Companion instructions" /> : null}
      {data ? <>
        <ThemedTextInput accessibilityLabel="Persistent Companion instructions" multiline value={content} maxLength={data.maxChars}
          editable={!loading && !saving && writable} onChangeText={value => { setContent(value); setSaved(false); }}
          style={{ minHeight: 120, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, textAlignVertical: 'top' }} />
        <Button disabled={!dirty || !writable || loading || saving} loading={saving} onPress={() => void save()}>Save instructions</Button>
        {dirty ? <Text style={{ color: colors.textSecondary }}>Unsaved changes</Text> : saved ? <Text style={{ color: colors.textSecondary }}>Saved on this Hub.</Text> : null}
        {!writable ? <Text style={{ color: colors.textSecondary }}>Allow Companion instructions changes for this phone in the Hub device settings.</Text> : null}
      </> : null}
      {error ? <><ErrorBanner message={error} /><Button tone="quiet" disabled={loading || saving} onPress={() => void load()}>{data ? 'Discard draft and load latest instructions' : 'Retry'}</Button></> : null}
    </>}
  </View>;
}
