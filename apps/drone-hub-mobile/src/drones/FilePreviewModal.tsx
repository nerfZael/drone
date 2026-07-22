import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import FileQuestion from 'lucide-react-native/icons/file-question-mark';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import { useEvent } from 'expo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SvgXml } from 'react-native-svg';
import { MobileHighlightedCode } from '../components/MobileHighlightedCode';
import { colors } from '../theme';
import { NativeMarkdown } from '../local-assistant/NativeMarkdown';
import { isCodePreview, isMarkdownPreview, type MobileFilePreview } from './file-preview-model';

function MediaUnavailable({ message }: { message: string }) {
  return (
    <View style={styles.centerState}>
      <FileQuestion color={colors.muted} size={34} strokeWidth={1.7} />
      <Text style={styles.stateTitle}>Preview unavailable</Text>
      <Text style={styles.stateBody}>{message}</Text>
    </View>
  );
}

function PreviewVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  const status = useEvent(player, 'statusChange', { status: player.status });
  if (status.status === 'error') {
    return (
      <MediaUnavailable
        message={status.error?.message || 'This video format could not be played on this phone.'}
      />
    );
  }
  return (
    <View style={styles.mediaStage}>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        surfaceType="textureView"
        style={styles.video}
      />
      {status.status === 'loading' || status.status === 'idle' ? (
        <View pointerEvents="none" style={styles.mediaLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}
    </View>
  );
}

function PreviewImage({ uri }: { uri: string }) {
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  React.useEffect(() => setState('loading'), [uri]);
  return (
    <View style={styles.mediaStage}>
      <Image
        source={{ uri }}
        resizeMode="contain"
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
        style={styles.image}
      />
      {state === 'loading' ? (
        <View pointerEvents="none" style={styles.mediaLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : state === 'error' ? (
        <View style={styles.mediaLoading}>
          <MediaUnavailable message="This image format could not be displayed on this phone." />
        </View>
      ) : null}
    </View>
  );
}

function TextPreview({ preview, line }: { preview: MobileFilePreview; line: number | null }) {
  const scrollRef = React.useRef<ScrollView | null>(null);
  const markdown = isMarkdownPreview(preview.path, preview.mime);
  const code = isCodePreview(preview.path, preview.mime);
  React.useEffect(() => {
    if (!line || markdown) return;
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: Math.max(0, (line - 1) * 19 - 24), animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [line, markdown, preview.content]);

  if (markdown) {
    return (
      <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.markdownContent}>
        <NativeMarkdown text={preview.content ?? ''} />
      </ScrollView>
    );
  }
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.bodyScroll}
      contentContainerStyle={styles.textVerticalContent}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.textRow}>
        {code ? (
          <MobileHighlightedCode
            content={preview.content ?? ''}
            path={preview.path}
            mime={preview.mime}
            style={[styles.textContent, styles.codeContent]}
          />
        ) : (
          <Text selectable style={styles.textContent}>
            {preview.content ?? ''}
          </Text>
        )}
      </ScrollView>
    </ScrollView>
  );
}

export function FilePreviewModal({
  visible,
  preview,
  displayPath,
  line,
  loading,
  error,
  onClose,
  onRetry,
}: {
  visible: boolean;
  preview: MobileFilePreview | null;
  displayPath: string;
  line: number | null;
  loading: boolean;
  error: string | null;
  onClose(): void;
  onRetry(): void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close file preview"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ChevronLeft color={colors.text} size={22} strokeWidth={2} />
          </Pressable>
          <View style={styles.headerCopy}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={styles.title}>
                {preview?.name || displayPath.split('/').at(-1) || 'File preview'}
              </Text>
              <Text style={styles.readOnly}>PREVIEW</Text>
            </View>
            <Text numberOfLines={1} style={styles.path}>
              {displayPath}
            </Text>
          </View>
        </View>

        <View style={styles.content}>
          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.stateTitle}>Opening preview</Text>
              <Text style={styles.stateBody}>Reading the file from the selected drone…</Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <FileQuestion color={colors.danger} size={34} strokeWidth={1.7} />
              <Text style={styles.stateTitle}>Preview unavailable</Text>
              <Text style={styles.stateBody}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <RotateCcw color={colors.onAccent} size={15} strokeWidth={2.2} />
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : preview?.kind === 'text' ? (
            <TextPreview preview={preview} line={line} />
          ) : preview?.kind === 'image' && preview.mime === 'image/svg+xml' && preview.content ? (
            <View style={styles.mediaStage}>
              <SvgXml
                xml={preview.content}
                width="100%"
                height="100%"
                fallback={
                  <MediaUnavailable message="This SVG file could not be displayed on this phone." />
                }
              />
            </View>
          ) : preview?.kind === 'image' && preview.uri ? (
            <PreviewImage uri={preview.uri} />
          ) : preview?.kind === 'video' && preview.uri ? (
            <PreviewVideo uri={preview.uri} />
          ) : preview ? (
            <View style={styles.centerState}>
              <FileQuestion color={colors.muted} size={34} strokeWidth={1.7} />
              <Text style={styles.stateTitle}>No visual preview</Text>
              <Text style={styles.stateBody}>
                This file is available, but its binary format cannot be displayed yet.
              </Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.mantle,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  pressed: { opacity: 0.68 },
  headerCopy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, color: colors.textStrong, fontSize: 15, fontWeight: '800' },
  readOnly: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentWash,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  path: { color: colors.muted, fontFamily: 'monospace', fontSize: 9, marginTop: 3 },
  content: { flex: 1, minHeight: 0 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  stateTitle: { color: colors.textStrong, fontSize: 17, fontWeight: '800', marginTop: 3 },
  stateBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  retryButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.onAccent, fontSize: 11, fontWeight: '900' },
  bodyScroll: { flex: 1 },
  markdownContent: { paddingHorizontal: 16, paddingVertical: 18, paddingBottom: 52 },
  textVerticalContent: { minWidth: '100%' },
  textRow: { minWidth: '100%', paddingHorizontal: 14, paddingVertical: 16, paddingBottom: 48 },
  textContent: { color: colors.text, fontSize: 14, lineHeight: 21 },
  codeContent: { fontFamily: 'monospace', fontSize: 12, lineHeight: 19 },
  mediaStage: {
    flex: 1,
    backgroundColor: colors.crust,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  video: { width: '100%', height: '100%' },
  mediaLoading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.crust,
  },
});
