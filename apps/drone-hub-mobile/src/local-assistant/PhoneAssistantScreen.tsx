import React from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import ArrowUpRight from 'lucide-react-native/icons/arrow-up-right';
import Mic from 'lucide-react-native/icons/mic';
import MicOff from 'lucide-react-native/icons/mic-off';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Sparkles from 'lucide-react-native/icons/sparkles';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import X from 'lucide-react-native/icons/x';
import { catppuccin, colors } from '../theme';
import { useMobileCompanion } from './MobileCompanionContext';
import { usePhoneAssistantRequest } from './PhoneAssistantContext';
import { phoneAssistant } from './mobile-phone-assistant';
import { usePhoneAssistantLaunch } from './use-phone-assistant-launch';

type Phase = 'starting' | 'listening' | 'muted' | 'working' | 'paused' | 'error' | 'ready';
type Icon = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

const ORB = 156;
const RING = ORB + 24;
const STAGE = RING * 1.7;

const tones: Record<Phase, { core: string; iconColor: string; ring: string; dot: string; icon: Icon }> = {
  starting: { core: colors.surface1, iconColor: colors.accent, ring: colors.accentBorder, dot: colors.warning, icon: Mic },
  listening: { core: catppuccin.mauve, iconColor: colors.onAccent, ring: catppuccin.mauve, dot: colors.online, icon: Mic },
  muted: { core: colors.surface2, iconColor: colors.warning, ring: colors.warningBorder, dot: colors.warning, icon: MicOff },
  working: { core: catppuccin.blue, iconColor: colors.onAccent, ring: catppuccin.blue, dot: colors.info, icon: Sparkles },
  paused: { core: colors.surface1, iconColor: colors.muted, ring: colors.border, dot: colors.mutedDim, icon: Pause },
  error: { core: colors.surface0, iconColor: colors.danger, ring: colors.dangerBorder, dot: colors.danger, icon: TriangleAlert },
  ready: { core: colors.surface1, iconColor: colors.accent, ring: colors.accentBorder, dot: colors.mutedDim, icon: Mic },
};

const headlines: Record<Phase, string> = {
  starting: 'Starting Live', listening: 'Listening', muted: 'Muted', working: 'Working',
  paused: 'Paused', error: 'Needs attention', ready: 'Ready',
};

function hint(phase: Phase, target: string): string {
  const where = target ? `on ${target}` : 'on your Hub';
  if (phase === 'starting') return `Connecting to Companion ${where}…`;
  if (phase === 'listening') return `Go ahead. Companion is listening ${where}.`;
  if (phase === 'muted') return 'Your microphone is off. Unmute to keep talking.';
  if (phase === 'working') return `Companion is handling your request ${where}.`;
  if (phase === 'paused') return 'Live is paused. Resume or hold the side button to continue.';
  if (phase === 'error') return 'Fix the issue below, then retry.';
  return 'Resume to talk to Companion, or hold the side button.';
}

const PULSE = 2_200;

export function PhoneAssistantScreen() {
  const requestId = usePhoneAssistantRequest();
  const companion = useMobileCompanion();
  const [laidOutRequest, setLaidOutRequest] = React.useState('');
  const launch = usePhoneAssistantLaunch({ requestId, rendered: laidOutRequest === requestId, available: companion.available,
    start: companion.startAssistantVoice });
  const [actionError, setActionError] = React.useState('');
  const dismiss = async () => {
    launch.cancel();
    await companion.close();
    await phoneAssistant?.dismiss(requestId);
  };
  const dismissRef = React.useRef(dismiss); dismissRef.current = dismiss;
  React.useEffect(() => setActionError(''), [requestId]);
  React.useEffect(() => {
    if (!requestId) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      void dismissRef.current().catch(() => setActionError('Could not close Companion. Try End again.'));
      return true;
    });
    return () => listener.remove();
  }, [requestId]);
  if (!requestId) return null;
  const live = companion.live;
  const active = live.status === 'connecting' || live.status === 'listening';
  const error = actionError || launch.error || live.error || companion.error;
  const phase: Phase = launch.pending || live.status === 'connecting' || (active && !live.capturing) ? 'starting'
    : active && companion.status === 'working' ? 'working'
      : active ? (live.muted ? 'muted' : 'listening')
        : live.status === 'paused' ? 'paused'
          : error ? 'error' : 'ready';
  const tone = tones[phase];
  const primary = launch.pending ? null : active ? { label: 'Pause', icon: Pause, onPress: () => { setActionError(''); live.pause(); } }
    : { label: error ? 'Retry' : 'Resume', icon: error ? RotateCcw : Play, onPress: () => {
      setActionError('');
      void launch.retry().catch(() => setActionError('Could not retry Companion. Hold the side button again.'));
    } };
  return <SafeAreaView key={requestId} style={styles.screen} onLayout={() => setLaidOutRequest(requestId)}>
    <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand}>Companion</Text>
        <View style={styles.target}>
          <View style={[styles.targetDot, { backgroundColor: tone.dot }]} />
          <Text numberOfLines={1} style={styles.targetText}>{live.targetName || 'Drone Hub'}</Text>
        </View>
      </View>
      <View style={styles.stage}>
        <Orb phase={phase} />
        <View style={styles.copy}>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.headline}>{headlines[phase]}</Text>
          <Text style={styles.hint}>{hint(phase, live.targetName)}</Text>
        </View>
        {error ? <View style={styles.error}>
          <TriangleAlert color={colors.danger} size={16} strokeWidth={2.3} />
          <Text style={styles.errorText}>{error}</Text>
        </View> : null}
      </View>
      <View style={styles.footer}>
        <View style={styles.controls}>
          <Control label="End" icon={X} tone="danger" onPress={() => {
            setActionError('');
            void dismiss().catch(() => setActionError('Could not close Companion. Try End again.'));
          }} />
          <Control label={primary?.label ?? 'Starting'} icon={primary?.icon ?? Mic} tone="primary" loading={!primary}
            onPress={() => primary?.onPress()} />
          <Control label={live.muted ? 'Unmute' : 'Mute'} icon={live.muted ? MicOff : Mic} tone="neutral" selected={live.muted}
            disabled={live.status !== 'listening'} onPress={live.toggleMute} />
        </View>
        <Pressable accessibilityRole="button" onPress={() => {
          setActionError('');
          launch.cancel();
          void phoneAssistant?.openApp(requestId).catch(() => setActionError('Unlock your phone to open Drone Hub.'));
        }} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={styles.linkText}>Open Drone Hub</Text>
          <ArrowUpRight color={colors.muted} size={15} strokeWidth={2.2} />
        </Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function Orb({ phase }: { phase: Phase }) {
  const tone = tones[phase];
  const Icon = tone.icon;
  const pulse = useSharedValue(0);
  const pulseLate = useSharedValue(0);
  const spin = useSharedValue(0);
  const breathing = phase === 'listening' || phase === 'working';
  const spinning = phase === 'starting';
  React.useEffect(() => {
    if (breathing) {
      const wave = () => withRepeat(withTiming(1, { duration: PULSE, easing: Easing.out(Easing.quad) }), -1, false);
      pulse.value = 0; pulseLate.value = 0;
      pulse.value = wave();
      pulseLate.value = withDelay(PULSE / 2, wave());
    } else {
      cancelAnimation(pulse); cancelAnimation(pulseLate);
      pulse.value = withTiming(0, { duration: 240 });
      pulseLate.value = withTiming(0, { duration: 240 });
    }
  }, [breathing, pulse, pulseLate]);
  React.useEffect(() => {
    if (spinning) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(360, { duration: 1_100, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
  }, [spin, spinning]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.55,
    transform: [{ scale: 1 + pulse.value * 0.55 }],
  }));
  const ringLateStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulseLate.value) * 0.55,
    transform: [{ scale: 1 + pulseLate.value * 0.55 }],
  }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.03 }],
  }));
  return <View style={styles.orbStage}>
    <Animated.View style={[styles.ring, { borderColor: tone.ring }, ringStyle]} />
    <Animated.View style={[styles.ring, { borderColor: tone.ring }, ringLateStyle]} />
    <View style={[styles.halo, { borderColor: tone.ring }]} />
    {spinning ? <Animated.View style={[styles.spinner, spinStyle]} /> : null}
    <Animated.View style={[styles.orb, { backgroundColor: tone.core, borderColor: tone.ring }, coreStyle]}>
      <Icon color={tone.iconColor} size={52} strokeWidth={1.9} />
    </Animated.View>
  </View>;
}

function Control({ label, icon: Icon, tone, onPress, disabled = false, loading = false, selected = false }: {
  label: string; icon: Icon; tone: 'primary' | 'neutral' | 'danger'; onPress(): void;
  disabled?: boolean; loading?: boolean; selected?: boolean;
}) {
  const primary = tone === 'primary';
  const foreground = primary ? colors.onAccent : tone === 'danger' ? colors.danger : selected ? colors.warning : colors.text;
  return <View style={styles.control}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, selected }}
      disabled={disabled || loading} hitSlop={6} onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton, primary ? styles.controlPrimary : tone === 'danger' ? styles.controlDanger : styles.controlNeutral,
        selected && styles.controlSelected, disabled && styles.disabled, pressed && styles.pressed,
      ]}>
      {loading ? <ActivityIndicator color={foreground} /> : <Icon color={foreground} size={primary ? 30 : 22} strokeWidth={2.2} />}
    </Pressable>
    <Text style={[styles.controlLabel, primary && styles.controlLabelPrimary, disabled && styles.disabled]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 18, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase' },
  target: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '62%',
    paddingVertical: 7, paddingLeft: 11, paddingRight: 13, borderRadius: 999,
    backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border,
  },
  targetDot: { width: 7, height: 7, borderRadius: 4 },
  targetText: { color: colors.muted, fontSize: 12.5, fontWeight: '600', letterSpacing: 0.2, flexShrink: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26, paddingVertical: 24 },
  orbStage: { width: STAGE, height: STAGE, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1.5 },
  halo: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1, opacity: 0.7 },
  spinner: {
    position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2.5,
    borderColor: colors.accent, borderTopColor: 'transparent', borderRightColor: 'transparent',
  },
  orb: { width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  copy: { alignItems: 'center', gap: 10, maxWidth: 340 },
  headline: { color: colors.textStrong, fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6, textAlign: 'center' },
  hint: { color: colors.muted, fontSize: 15.5, lineHeight: 23, textAlign: 'center' },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, alignSelf: 'stretch',
    backgroundColor: colors.dangerDark, borderColor: colors.dangerBorder, borderWidth: 1, borderRadius: 14, padding: 14,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13.5, lineHeight: 19 },
  footer: { alignItems: 'center', gap: 22, paddingTop: 8 },
  controls: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 34 },
  control: { alignItems: 'center', gap: 10, width: 82 },
  controlButton: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  controlNeutral: { backgroundColor: colors.surface0, borderColor: colors.surface1 },
  controlDanger: { backgroundColor: colors.dangerDark, borderColor: colors.dangerBorder },
  controlPrimary: { width: 78, height: 78, borderRadius: 39, marginTop: -8, backgroundColor: colors.accent, borderColor: colors.accent },
  controlSelected: { backgroundColor: colors.warningDark, borderColor: colors.warningBorder },
  controlLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600', letterSpacing: 0.3 },
  controlLabelPrimary: { color: colors.text },
  link: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: colors.surface0,
  },
  linkText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
});
