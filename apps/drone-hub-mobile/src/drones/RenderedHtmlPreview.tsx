import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';
import {
  buildMobileHtmlPreviewDocument,
  mobileHtmlPreviewDocumentUrl,
  mobileHtmlPreviewMediaBase,
  mobileHtmlPreviewWebViewPolicy,
  MOBILE_HTML_PREVIEW_IMAGE_DELIVERY,
  MOBILE_HTML_PREVIEW_IMAGE_REQUEST,
  MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST,
  shouldAllowMobileHtmlPreviewNavigation,
} from './mobile-html-preview-security';
import {
  createMobileHtmlImageBudget,
  createMobileHtmlRuntimeImages,
  embedMobileHtmlImages,
  loadMobileHtmlImages,
  type MobileHtmlImageBudget,
  mobileHtmlLocalImagePaths,
  type MobileHtmlImageReader,
  type MobileHtmlMediaSessionOpener,
} from './mobile-html-preview-images';

export function RenderedHtmlPreview({
  source,
  path,
  readImage,
  openMediaSession,
}: {
  source: string;
  path: string;
  readImage?: MobileHtmlImageReader;
  openMediaSession?: MobileHtmlMediaSessionOpener;
}) {
  const webViewRef = React.useRef<WebView | null>(null);
  const [failed, setFailed] = React.useState(false);

  // With a media session the page loads its images and video by URL, like a
  // browser. Without one (files on the phone, an older Hub) the app embeds them.
  const openMediaSessionRef = React.useRef(openMediaSession);
  openMediaSessionRef.current = openMediaSession;
  const hasMediaSessions = Boolean(openMediaSession);
  const [session, setSession] = React.useState<{ path: string; mediaBase: string | null } | null>(null);
  React.useEffect(() => {
    const open = openMediaSessionRef.current;
    if (!open) return;
    const controller = new AbortController();
    void open(path, controller.signal).then(
      (mediaBase) => {
        if (!controller.signal.aborted) setSession({ path, mediaBase: mobileHtmlPreviewMediaBase(mediaBase) });
      },
      () => {
        if (!controller.signal.aborted) setSession({ path, mediaBase: null });
      },
    );
    return () => controller.abort();
  }, [hasMediaSessions, path]);
  const sessionSettled = !hasMediaSessions || session?.path === path;
  const mediaBase = session?.path === path ? session.mediaBase : null;

  // Pages run once, with their images already in place, rather than reloading as each arrives.
  const needsImages = React.useMemo(
    () => sessionSettled && !mediaBase && Boolean(readImage) && mobileHtmlLocalImagePaths(source, path).length > 0,
    [sessionSettled, mediaBase, readImage, source, path],
  );
  const [images, setImages] = React.useState<{
    source: string;
    path: string;
    html: string;
    failed: number;
    budget: MobileHtmlImageBudget;
  } | null>(null);
  React.useEffect(() => {
    if (!needsImages || !readImage) return;
    const controller = new AbortController();
    const budget = createMobileHtmlImageBudget();
    void loadMobileHtmlImages(source, path, readImage, controller.signal, budget)
      .then(({ images: loaded, failed: missing }) => {
        setImages({ source, path, html: embedMobileHtmlImages(source, path, loaded), failed: missing, budget });
      })
      .catch(() => {
        if (!controller.signal.aborted) setImages({ source, path, html: source, failed: 1, budget });
      });
    return () => controller.abort();
  }, [needsImages, readImage, source, path]);
  const current = images?.source === source && images.path === path ? images : null;
  // A refreshed file keeps showing its last page until the new images are in place.
  const shown = needsImages ? current ?? (images?.path === path ? images : null) : null;
  const html = !sessionSettled ? null : needsImages ? shown?.html ?? null : source;
  const document = React.useMemo(
    () => (html == null ? null : buildMobileHtmlPreviewDocument(html, mediaBase ? { mediaBase, htmlPath: path } : undefined)),
    [html, mediaBase, path],
  );
  const documentUrl = mobileHtmlPreviewDocumentUrl(path);

  // Images the page asks for while it runs share the budget of those embedded up front.
  const [runtimeFailed, setRuntimeFailed] = React.useState(0);
  const runtimeImagesRef = React.useRef<ReturnType<typeof createMobileHtmlRuntimeImages> | null>(null);
  const shownBudgetRef = React.useRef(shown?.budget);
  shownBudgetRef.current = shown?.budget;
  React.useEffect(() => {
    setRuntimeFailed(0);
    if (document == null || !readImage || mediaBase) return;
    const controller = new AbortController();
    runtimeImagesRef.current = createMobileHtmlRuntimeImages({
      documentUrl,
      readImage,
      budget: shownBudgetRef.current ?? createMobileHtmlImageBudget(),
      signal: controller.signal,
      requestType: MOBILE_HTML_PREVIEW_IMAGE_REQUEST,
      deliver: (url, dataUrl) => {
        webViewRef.current?.injectJavaScript(
          `window.${MOBILE_HTML_PREVIEW_IMAGE_DELIVERY}?.(${JSON.stringify(url)}, ${JSON.stringify(dataUrl)}); true;`,
        );
      },
      onFailed: () => setRuntimeFailed((count) => count + 1),
    });
    return () => {
      controller.abort();
      runtimeImagesRef.current = null;
    };
  }, [document, documentUrl, readImage, mediaBase]);
  const failedImages = (needsImages ? current?.failed ?? 0 : 0) + runtimeFailed;

  React.useEffect(() => {
    setFailed(false);
  }, [document]);

  if (failed) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Rendered preview unavailable</Text>
        <Text style={styles.stateBody}>
          The secure HTML renderer stopped. Source mode is still available above.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.stage}>
      <View style={styles.notice}>
        <View style={styles.noticeDot} />
        <Text style={styles.noticeText}>
          Sandboxed preview: local images and inline scripts work; network, links, forms, downloads, and storage are blocked.
        </Text>
      </View>
      {failedImages ? (
        <Text style={styles.imageNotice}>
          {failedImages === 1 ? 'One local image' : `${failedImages} local images`} could not be shown.
          Local images load up to 4 MiB each and 8 MiB per page.
        </Text>
      ) : null}
      {document == null ? (
        <View style={styles.imagesLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : <WebView
        ref={webViewRef}
        {...mobileHtmlPreviewWebViewPolicy(Platform.OS)}
        originWhitelist={[...MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST]}
        source={{ html: document, baseUrl: documentUrl }}
        onShouldStartLoadWithRequest={(request) =>
          shouldAllowMobileHtmlPreviewNavigation(request.url, documentUrl)
        }
        // Only pages without a media session get a message channel, for image requests.
        onMessage={mediaBase ? undefined : (event) => runtimeImagesRef.current?.request(event.nativeEvent.data)}
        onOpenWindow={() => {
          // Supplying the handler makes target=_blank a denied event instead of a navigation.
        }}
        onFileDownload={() => {
          // iOS cancels downloads handled here. Android outbound navigation is denied above.
        }}
        onLoadStart={(event) => {
          if (!shouldAllowMobileHtmlPreviewNavigation(event.nativeEvent.url, documentUrl)) {
            webViewRef.current?.stopLoading();
          }
        }}
        onError={(event) => {
          event.preventDefault();
          setFailed(true);
        }}
        onRenderProcessGone={() => setFailed(true)}
        onContentProcessDidTerminate={() => setFailed(true)}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}
        style={styles.webView}
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#ffffff' },
  notice: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.mantle,
  },
  noticeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.online },
  noticeText: { flex: 1, color: colors.muted, fontSize: 9, lineHeight: 13 },
  imageNotice: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
    backgroundColor: colors.mantle,
  },
  webView: { flex: 1, backgroundColor: '#ffffff' },
  imagesLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  stateTitle: { color: colors.textStrong, fontSize: 17, fontWeight: '800' },
  stateBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
