import React from 'react';
import type { DroneControlOperation } from '@drone/device-protocol';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import ChevronsDown from 'lucide-react-native/icons/chevrons-down';
import ChevronsUp from 'lucide-react-native/icons/chevrons-up';
import FileQuestion from 'lucide-react-native/icons/file-question-mark';
import FolderTree from 'lucide-react-native/icons/folder-tree';
import Pencil from 'lucide-react-native/icons/pencil';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Save from 'lucide-react-native/icons/save';
import WrapText from 'lucide-react-native/icons/text-wrap';
import { useEvent } from 'expo';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SvgXml } from 'react-native-svg';
import { NativeFileTypeIcon } from '../components/FileTypeIcon';
import { MobileHighlightedCode } from '../components/MobileHighlightedCode';
import { RenderErrorBoundary } from '../components/RenderErrorBoundary';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import {
  NativeMarkdown,
  type NativeMarkdownExpansionCommand,
} from '../local-assistant/NativeMarkdown';
import { useMobileCompanion } from '../local-assistant/MobileCompanionContext';
import {
  isCodePreview,
  isHtmlPreview,
  isMarkdownPreview,
  isRenderedHtmlPreviewAvailable,
  mobileHtmlPreviewMode,
  mobileFileCanEdit,
  mobileUtf8ByteLength,
  mobileTextPreviewContent,
  MOBILE_FILE_EDIT_MAX_BYTES,
  MOBILE_RENDERED_HTML_PREVIEW_MAX_CHARS,
  type MobileFilePreview,
  type MobileHtmlPreviewMode,
} from './file-preview-model';
import { RenderedHtmlPreview } from './RenderedHtmlPreview';
import { MobileFileExplorer } from './MobileFileExplorer';
import { ZoomableImageStage } from './ZoomableImageStage';
import {
  MOBILE_EXPLORER_HEADER_HEIGHT,
  mobileExplorerExpandedHeight,
  mobileExplorerDragProgress,
  mobileExplorerDragOpens,
} from './mobile-explorer-drag';

const EXPLORER_SPRING = { stiffness: 700, damping: 52, mass: 1, overshootClamping: true };

function MediaUnavailable({ message }: { message: string }) {
  return (
    <View style={styles.centerState}>
      <FileQuestion color={colors.muted} size={34} strokeWidth={1.7} />
      <Text style={styles.stateTitle}>Preview unavailable</Text>
      <Text style={styles.stateBody}>{message}</Text>
    </View>
  );
}

function PreviewVideo({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri);
  React.useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
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
    <ZoomableImageStage resetKey={uri} enabled={state === 'ready'}>
      <Image
        accessible={false}
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
    </ZoomableImageStage>
  );
}

function TextPreview({
  preview,
  line,
  markdownExpansionCommand,
  wordWrap,
}: {
  preview: MobileFilePreview;
  line: number | null;
  markdownExpansionCommand: NativeMarkdownExpansionCommand | null;
  wordWrap: boolean;
}) {
  const scrollRef = React.useRef<ScrollView | null>(null);
  const safePreview = mobileTextPreviewContent(preview.content);
  const markdown = safePreview.formatted && isMarkdownPreview(preview.path, preview.mime);
  const code = safePreview.formatted && isCodePreview(preview.path, preview.mime);
  React.useEffect(() => {
    if (!line || markdown) return;
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: Math.max(0, (line - 1) * 19 - 24), animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [line, markdown, safePreview.content]);

  if (markdown) {
    return (
      <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.markdownContent}>
        <NativeMarkdown
          text={safePreview.content}
          documentMode
          collapsibleHeadings
          expansionCommand={markdownExpansionCommand}
        />
      </ScrollView>
    );
  }
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.bodyScroll}
      contentContainerStyle={styles.textVerticalContent}
    >
      {!safePreview.formatted || safePreview.truncated ? (
        <Text style={styles.previewNotice}>
          {safePreview.truncated
            ? 'This file is large. Showing a shortened plain-text preview.'
            : 'This file is large. Showing plain text to keep the preview responsive.'}
        </Text>
      ) : null}
      {wordWrap ? (
        <View style={[styles.textRow, styles.textRowWrapped]}>
          {code ? (
            <MobileHighlightedCode
              content={safePreview.content}
              path={preview.path}
              mime={preview.mime}
              style={[styles.textContent, styles.codeContent, styles.textContentWrapped]}
            />
          ) : (
            <Text selectable style={[styles.textContent, styles.textContentWrapped]}>
              {safePreview.content}
            </Text>
          )}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={styles.textRow}
        >
          {code ? (
            <MobileHighlightedCode
              content={safePreview.content}
              path={preview.path}
              mime={preview.mime}
              style={[styles.textContent, styles.codeContent]}
            />
          ) : (
            <Text selectable style={styles.textContent}>
              {safePreview.content}
            </Text>
          )}
        </ScrollView>
      )}
    </ScrollView>
  );
}

export function FilePreviewModal({
  embedded = false,
  visible,
  preview,
  displayPath,
  line,
  loading,
  error,
  refreshError,
  saving,
  saveError,
  targetId,
  droneId,
  chatName,
  rootPath,
  workspaceName,
  selectedPath,
  requestDroneControl,
  onOpenPath,
  onSave,
  onClose,
  onRetry,
  onPreviewPathsChanged,
}: {
  embedded?: boolean;
  visible: boolean;
  preview: MobileFilePreview | null;
  displayPath: string;
  line: number | null;
  loading: boolean;
  error: string | null;
  refreshError: string | null;
  saving: boolean;
  saveError: string | null;
  targetId: string;
  droneId: string;
  chatName: string;
  rootPath: string;
  workspaceName: string;
  selectedPath: string;
  requestDroneControl: (
    destinationId: string,
    operation: DroneControlOperation,
    payload?: any,
  ) => Promise<any>;
  onOpenPath(path: string): void;
  onSave(content: string, expectedRevision?: string | null): Promise<boolean>;
  onClose(): void;
  onRetry(): void;
  onPreviewPathsChanged(paths: readonly string[]): void;
}) {
  const companion = useMobileCompanion();
  const [explorerExpanded, setExplorerExpanded] = React.useState(embedded);
  const [explorerDragging, setExplorerDragging] = React.useState(false);
  const explorerProgress = useSharedValue(embedded ? 1 : 0);
  const explorerTarget = useSharedValue(embedded ? 1 : 0);
  const explorerGestureActive = useSharedValue(false);
  const explorerDragStart = useSharedValue(0);
  const explorerDragTarget = useSharedValue(0);
  const explorerTravel = useSharedValue(172);
  const beginExplorerDrag = React.useCallback(() => {
    Keyboard.dismiss();
    setExplorerDragging(true);
  }, []);
  const finishExplorerDrag = React.useCallback((open: boolean) => {
    setExplorerExpanded(open);
    setExplorerDragging(false);
  }, []);
  React.useEffect(() => {
    const target = explorerExpanded ? 1 : 0;
    if (explorerTarget.value === target) return;
    explorerTarget.value = target;
    explorerProgress.value = withSpring(target, EXPLORER_SPRING);
  }, [explorerExpanded, explorerProgress, explorerTarget]);
  const explorerDockStyle = useAnimatedStyle(() => ({
    height: MOBILE_EXPLORER_HEADER_HEIGHT + explorerProgress.value * explorerTravel.value,
  }));
  const explorerGesture = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      explorerGestureActive.value = true;
      cancelAnimation(explorerProgress);
      explorerDragStart.value = explorerProgress.value;
      explorerDragTarget.value = explorerTarget.value;
      runOnJS(beginExplorerDrag)();
    })
    .onUpdate((event) => {
      explorerProgress.value = mobileExplorerDragProgress(
        explorerDragStart.value,
        event.translationY,
        explorerTravel.value,
      );
    })
    .onEnd((event) => {
      const open = mobileExplorerDragOpens(explorerProgress.value, event.velocityY);
      explorerTarget.value = open ? 1 : 0;
      explorerProgress.value = withSpring(explorerTarget.value, {
        ...EXPLORER_SPRING,
        velocity: -event.velocityY / Math.max(1, explorerTravel.value),
      });
      runOnJS(finishExplorerDrag)(open);
    })
    .onFinalize((_event, success) => {
      if (!explorerGestureActive.value) return;
      explorerGestureActive.value = false;
      if (success) return;
      explorerProgress.value = withSpring(explorerDragTarget.value, EXPLORER_SPRING);
      runOnJS(finishExplorerDrag)(explorerDragTarget.value === 1);
    });
  const [wordWrap, setWordWrap] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [savedDraft, setSavedDraft] = React.useState('');
  const [draftRevision, setDraftRevision] = React.useState<string | null>(null);
  const companionDraftRef = React.useRef({ key: '', content: '', revision: 0 });
  const [markdownExpansionCommand, setMarkdownExpansionCommand] =
    React.useState<NativeMarkdownExpansionCommand | null>(null);
  const [htmlModeSelection, setHtmlModeSelection] = React.useState<{
    path: string;
    mode: MobileHtmlPreviewMode;
  } | null>(null);
  const safeTextPreview = mobileTextPreviewContent(preview?.content);
  const markdownPreview = Boolean(
    preview?.kind === 'text' &&
    safeTextPreview.formatted &&
    isMarkdownPreview(preview.path, preview.mime),
  );
  const htmlPreview = Boolean(
    preview?.kind === 'text' && isHtmlPreview(preview.path, preview.mime),
  );
  const htmlRenderingAvailable =
    isRenderedHtmlPreviewAvailable(Platform.OS) &&
    safeTextPreview.content.length <= MOBILE_RENDERED_HTML_PREVIEW_MAX_CHARS &&
    !safeTextPreview.truncated;
  const htmlMode = preview
    ? mobileHtmlPreviewMode({
        path: preview.path,
        mime: preview.mime,
        renderingAvailable: htmlRenderingAvailable,
        selection: htmlModeSelection,
      })
    : 'source';
  const canEdit = React.useMemo(
    () => mobileFileCanEdit(preview),
    [preview?.content, preview?.kind, preview?.size],
  );
  const dirty = canEdit && draft !== savedDraft;
  const companionEditorTargetId = `editor:${targetId}:${droneId}:${preview?.path ?? displayPath}`;
  const companionTargetChanged = companionDraftRef.current.key !== companionEditorTargetId;
  if (companionTargetChanged || companionDraftRef.current.content !== draft) {
    companionDraftRef.current = {
      key: companionEditorTargetId,
      content:
        companionTargetChanged && preview?.kind === 'text' ? String(preview.content ?? '') : draft,
      revision: companionDraftRef.current.revision + 1,
    };
  }
  const companionEditorMode = loading
    ? ('loading' as const)
    : saving
      ? ('saving' as const)
      : companionTargetChanged || !editing
        ? ('preview' as const)
        : canEdit
          ? ('edit' as const)
          : ('read-only' as const);

  React.useEffect(() => {
    return companion.registerEditorTarget({
      id: companionEditorTargetId,
      isEligible: () => Boolean(visible && preview?.kind === 'text'),
      read: () => ({
        targetId: companionEditorTargetId,
        path: preview?.path ?? displayPath,
        content: companionDraftRef.current.content,
        revision: `${draftRevision ?? ''}:${companionDraftRef.current.revision}`,
        mode: companionEditorMode,
        dirty,
      }),
      apply: (baseRevision, content) => {
        if (companionEditorMode !== 'edit') throw new Error('EDITOR_NOT_EDITABLE');
        if (mobileUtf8ByteLength(content) > MOBILE_FILE_EDIT_MAX_BYTES) {
          throw new Error('EDITOR_TOO_LARGE');
        }
        const revision = `${draftRevision ?? ''}:${companionDraftRef.current.revision}`;
        if (baseRevision !== revision) throw new Error('STALE_EDITOR_REVISION');
        companionDraftRef.current = {
          ...companionDraftRef.current,
          content,
          revision: companionDraftRef.current.revision + 1,
        };
        setDraft(content);
        return {
          ok: true,
          revision: `${draftRevision ?? ''}:${companionDraftRef.current.revision}`,
        };
      },
    });
  }, [
    canEdit,
    companion.registerEditorTarget,
    companionEditorMode,
    companionEditorTargetId,
    dirty,
    displayPath,
    draftRevision,
    preview?.kind,
    preview?.path,
    visible,
  ]);

  React.useEffect(() => {
    setEditing(false);
    const content = preview?.kind === 'text' ? String(preview.content ?? '') : '';
    setDraft(content);
    setSavedDraft(content);
    setDraftRevision(preview?.revision ?? null);
  }, [preview?.path]);

  React.useEffect(() => {
    if (dirty) return;
    const content = preview?.kind === 'text' ? String(preview.content ?? '') : '';
    setDraft(content);
    setSavedDraft(content);
    setDraftRevision(preview?.revision ?? null);
  }, [dirty, preview?.content, preview?.kind, preview?.revision]);

  React.useEffect(() => {
    if (!visible && !embedded) setExplorerExpanded(false);
  }, [embedded, visible]);

  const confirmDiscard = React.useCallback(
    (continueAction: () => void) => {
      if (saving) {
        Alert.alert('Save in progress', 'Wait for this file to finish saving before leaving it.');
        return;
      }
      if (!dirty) {
        continueAction();
        return;
      }
      Alert.alert('Discard unsaved changes?', 'Your edits to this file have not been saved.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: continueAction },
      ]);
    },
    [dirty, saving],
  );

  const closeWorkspace = React.useCallback(
    // Returning to chat keeps this mounted page and its unsaved draft intact.
    () => (embedded ? onClose() : confirmDiscard(onClose)),
    [embedded, confirmDiscard, onClose],
  );
  const openExplorerPath = React.useCallback(
    (path: string) =>
      confirmDiscard(() => {
        onOpenPath(path);
      }),
    [confirmDiscard, onOpenPath],
  );

  const saveDraft = React.useCallback(async () => {
    if (!dirty || saving) return;
    if (await onSave(draft, draftRevision)) {
      setSavedDraft(draft);
      setDraftRevision(preview?.revision ?? draftRevision);
    }
  }, [dirty, draft, draftRevision, onSave, preview?.revision, saving]);

  React.useEffect(() => {
    setMarkdownExpansionCommand(null);
  }, [preview?.path, visible]);

  React.useEffect(() => {
    if (!visible) setHtmlModeSelection(null);
  }, [visible]);

  const content = (
    <SafeAreaView style={styles.screen} edges={embedded ? [] : undefined}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={embedded ? 'Back to chat' : 'Close file preview'}
          hitSlop={10}
          onPress={closeWorkspace}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ChevronLeft color={colors.text} size={22} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerCopy}>
          <View style={styles.titleRow}>
            <NativeFileTypeIcon path={preview?.name || displayPath} size={18} />
            <Text numberOfLines={1} style={styles.title}>
              {preview?.name || displayPath.split('/').at(-1) || 'File preview'}
            </Text>
            <Text style={styles.readOnly}>
              {editing ? 'EDITING' : dirty ? 'UNSAVED' : 'PREVIEW'}
            </Text>
          </View>
          <Text numberOfLines={1} style={styles.path}>
            {displayPath}
          </Text>
        </View>
        <View style={styles.headingActions}>
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Stop editing file' : 'Edit file'}
              hitSlop={8}
              disabled={saving}
              onPress={() =>
                setEditing((current) => {
                  if (!current) setExplorerExpanded(false);
                  return !current;
                })
              }
              style={({ pressed }) => [
                styles.headingAction,
                editing && styles.headingActionActive,
                saving && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Pencil color={editing ? colors.accent : colors.muted} size={16} strokeWidth={2} />
            </Pressable>
          ) : null}
          {preview?.kind === 'text' &&
          !markdownPreview &&
          (!htmlPreview || htmlMode === 'source') &&
          !editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={wordWrap ? 'Turn off word wrap' : 'Turn on word wrap'}
              accessibilityState={{ checked: wordWrap }}
              hitSlop={8}
              onPress={() => setWordWrap((current) => !current)}
              style={({ pressed }) => [
                styles.headingAction,
                wordWrap && styles.headingActionActive,
                pressed && styles.pressed,
              ]}
            >
              <WrapText color={wordWrap ? colors.accent : colors.muted} size={17} strokeWidth={2} />
            </Pressable>
          ) : null}
          {editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save file"
              disabled={!dirty || saving}
              hitSlop={8}
              onPress={() => void saveDraft()}
              style={({ pressed }) => [
                styles.headingAction,
                (!dirty || saving) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Save color={dirty ? colors.accent : colors.muted} size={17} strokeWidth={2} />
              )}
            </Pressable>
          ) : null}
          {markdownPreview && !editing ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Collapse all Markdown headings"
                hitSlop={8}
                onPress={() =>
                  setMarkdownExpansionCommand((previous) => ({
                    action: 'collapse',
                    sequence: (previous?.sequence ?? 0) + 1,
                  }))
                }
                style={({ pressed }) => [styles.headingAction, pressed && styles.pressed]}
              >
                <ChevronsUp color={colors.muted} size={17} strokeWidth={2} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Expand all Markdown headings"
                hitSlop={8}
                onPress={() =>
                  setMarkdownExpansionCommand((previous) => ({
                    action: 'expand',
                    sequence: (previous?.sequence ?? 0) + 1,
                  }))
                }
                style={({ pressed }) => [styles.headingAction, pressed && styles.pressed]}
              >
                <ChevronsDown color={colors.muted} size={17} strokeWidth={2} />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        onLayout={(event) => {
          explorerTravel.value =
            mobileExplorerExpandedHeight(event.nativeEvent.layout.height) -
            MOBILE_EXPLORER_HEADER_HEIGHT;
        }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {saveError ? (
          <View style={styles.saveErrorBanner}>
            <Text numberOfLines={2} style={styles.saveErrorText}>
              {saveError}
            </Text>
          </View>
        ) : null}
        {htmlPreview && !editing && !loading && !error && preview ? (
          <View style={styles.htmlModeBar}>
            <View
              accessibilityRole="tablist"
              accessibilityLabel="HTML preview mode"
              style={styles.htmlModeTabs}
            >
              {(['rendered', 'source'] as const).map((mode) => {
                const disabled = mode === 'rendered' && !htmlRenderingAvailable;
                const selected = htmlMode === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="tab"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => setHtmlModeSelection({ path: preview.path, mode })}
                    style={({ pressed }) => [
                      styles.htmlModeButton,
                      selected && styles.htmlModeButtonSelected,
                      disabled && styles.htmlModeButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.htmlModeText, selected && styles.htmlModeTextSelected]}>
                      {mode === 'rendered' ? 'Rendered' : 'Source'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!htmlRenderingAvailable ? (
              <Text style={styles.htmlFallback}>
                Rendered HTML is unavailable for this file on this device. Showing source.
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.previewBody}>
          {refreshError && preview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry file preview refresh"
              onPress={onRetry}
              style={styles.refreshErrorBanner}
            >
              <Text numberOfLines={2} style={styles.refreshErrorText}>
                Refresh failed: {refreshError}
              </Text>
              <Text style={styles.refreshErrorRetry}>Retry</Text>
            </Pressable>
          ) : null}
          <RenderErrorBoundary
            key={`${preview?.path ?? displayPath}:${preview?.revision ?? preview?.mtimeMs ?? preview?.content?.length ?? 0}`}
            fallback={
              <MediaUnavailable message="This file could not be rendered safely. Try opening it as plain text on the desktop." />
            }
          >
            {editing && preview?.kind === 'text' ? (
              <ThemedTextInput
                accessibilityLabel={`Edit ${preview.name}`}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                maxLength={MOBILE_FILE_EDIT_MAX_BYTES}
                textAlignVertical="top"
                value={draft}
                onChangeText={setDraft}
                style={styles.editorInput}
              />
            ) : loading ? (
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
            ) : preview?.kind === 'text' && htmlPreview && htmlMode === 'rendered' ? (
              preview.content ? (
                <RenderedHtmlPreview source={preview.content} />
              ) : (
                <View style={styles.centerState}>
                  <Text style={styles.stateTitle}>Empty HTML file</Text>
                  <Text style={styles.stateBody}>There is no markup to render.</Text>
                </View>
              )
            ) : preview?.kind === 'text' ? (
              <TextPreview
                preview={preview}
                line={line}
                markdownExpansionCommand={markdownExpansionCommand}
                wordWrap={wordWrap}
              />
            ) : preview?.kind === 'image' && preview.mime === 'image/svg+xml' && preview.content ? (
              <ZoomableImageStage resetKey={`${preview.path}:${preview.content.length}`}>
                <SvgXml
                  xml={preview.content}
                  width="100%"
                  height="100%"
                  fallback={
                    <MediaUnavailable message="This SVG file could not be displayed on this phone." />
                  }
                />
              </ZoomableImageStage>
            ) : preview?.kind === 'image' && preview.uri ? (
              <PreviewImage uri={preview.uri} />
            ) : preview?.kind === 'video' && preview.uri ? (
              <PreviewVideo uri={preview.uri} active={visible} />
            ) : preview ? (
              <View style={styles.centerState}>
                <FileQuestion color={colors.muted} size={34} strokeWidth={1.7} />
                <Text style={styles.stateTitle}>No visual preview</Text>
                <Text style={styles.stateBody}>
                  This file is available, but its binary format cannot be displayed yet.
                </Text>
              </View>
            ) : (
              <View style={styles.centerState}>
                <FolderTree color={colors.muted} size={34} strokeWidth={1.7} />
                <Text style={styles.stateTitle}>Choose a file</Text>
                <Text style={styles.stateBody}>
                  Expand the file explorer below to browse this workspace.
                </Text>
              </View>
            )}
          </RenderErrorBoundary>
        </View>
        <Animated.View style={[styles.explorerDock, explorerDockStyle]}>
          <MobileFileExplorer
            renderHeader={(actions) => (
              <GestureDetector gesture={explorerGesture}>
                <View collapsable={false} style={styles.explorerHandle}>
                  <View style={styles.explorerHandleRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        explorerExpanded ? 'Collapse file explorer' : 'Expand file explorer'
                      }
                      accessibilityState={{ expanded: explorerExpanded }}
                      onPress={() =>
                        setExplorerExpanded((current) => {
                          if (!current) Keyboard.dismiss();
                          return !current;
                        })
                      }
                      style={({ pressed }) => [styles.explorerToggle, pressed && styles.pressed]}
                    >
                      <FolderTree color={colors.accentAlt} size={17} strokeWidth={1.9} />
                      <Text numberOfLines={1} style={styles.explorerTitle}>
                        Files{workspaceName ? ` (${workspaceName})` : ''}
                      </Text>
                      {explorerExpanded ? (
                        <ChevronDown color={colors.muted} size={18} strokeWidth={2} />
                      ) : (
                        <ChevronUp color={colors.muted} size={18} strokeWidth={2} />
                      )}
                    </Pressable>
                    {actions}
                  </View>
                </View>
              </GestureDetector>
            )}
            onRequestExpand={() => setExplorerExpanded(true)}
            active={visible && (explorerExpanded || explorerDragging)}
            targetId={targetId}
            droneId={droneId}
            chatName={chatName}
            rootPath={rootPath}
            selectedPath={selectedPath}
            requestDroneControl={requestDroneControl}
            onOpenFile={openExplorerPath}
            onPathsChanged={onPreviewPathsChanged}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  if (embedded) return content;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeWorkspace}
    >
      <GestureHandlerRootView style={styles.screen}>{content}</GestureHandlerRootView>
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
  headingActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headingAction: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  headingActionActive: { backgroundColor: colors.accentWash },
  disabled: { opacity: 0.35 },
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
  saveErrorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.dangerBorder,
    backgroundColor: colors.dangerDark,
  },
  saveErrorText: { color: colors.danger, fontSize: 10, lineHeight: 14 },
  previewNotice: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  previewBody: { flex: 1, minHeight: 0 },
  refreshErrorBanner: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.warningBorder,
    backgroundColor: colors.warningDark,
  },
  refreshErrorText: { minWidth: 0, flex: 1, color: colors.warning, fontSize: 10 },
  refreshErrorRetry: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  editorInput: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    backgroundColor: colors.background,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  explorerDock: {
    height: 48,
    minHeight: 48,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.mantle,
  },
  explorerHandle: {
    height: MOBILE_EXPLORER_HEADER_HEIGHT,
    flexShrink: 0,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  explorerHandleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  explorerToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  explorerTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  htmlModeBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.mantle,
  },
  htmlModeTabs: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    backgroundColor: colors.surface0,
  },
  htmlModeButton: {
    minWidth: 78,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  htmlModeButtonSelected: { backgroundColor: colors.accentWash },
  htmlModeButtonDisabled: { opacity: 0.42 },
  htmlModeText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  htmlModeTextSelected: { color: colors.accent },
  htmlFallback: { color: colors.mutedDim, fontSize: 10, lineHeight: 14 },
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
  textRowWrapped: { width: '100%' },
  textContent: { color: colors.text, fontSize: 14, lineHeight: 21 },
  textContentWrapped: { width: '100%', flexShrink: 1 },
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
