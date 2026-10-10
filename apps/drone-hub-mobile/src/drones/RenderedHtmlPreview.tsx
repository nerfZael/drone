import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';
import {
  buildMobileHtmlPreviewDocument,
  mobileHtmlPreviewWebViewPolicy,
  MOBILE_HTML_PREVIEW_BASE_URL,
  MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST,
  shouldAllowMobileHtmlPreviewNavigation,
} from './mobile-html-preview-security';
import {
  embedMobileHtmlImages,
  loadMobileHtmlImages,
  mobileHtmlLocalImagePaths,
  type MobileHtmlImageReader,
} from './mobile-html-preview-images';

export function RenderedHtmlPreview({
  source,
  path,
  readImage,
}: {
  source: string;
  path: string;
  readImage?: MobileHtmlImageReader;
}) {
  const webViewRef = React.useRef<WebView | null>(null);
  const [failed, setFailed] = React.useState(false);
  // Pages run once, with their images already in place, rather than reloading as each arrives.
  const needsImages = React.useMemo(
    () => Boolean(readImage) && mobileHtmlLocalImagePaths(source, path).length > 0,
    [readImage, source, path],
  );
  const [images, setImages] = React.useState<{ source: string; path: string; html: string; failed: number } | null>(null);
  React.useEffect(() => {
    if (!needsImages || !readImage) return;
    const controller = new AbortController();
    void loadMobileHtmlImages(source, path, readImage, controller.signal)
      .then(({ images: loaded, failed: missing }) => {
        setImages({ source, path, html: embedMobileHtmlImages(source, path, loaded), failed: missing });
      })
      .catch(() => {
        if (!controller.signal.aborted) setImages({ source, path, html: source, failed: 1 });
      });
    return () => controller.abort();
  }, [needsImages, readImage, source, path]);
  const current = images?.source === source && images.path === path ? images : null;
  // A refreshed file keeps showing its last page until the new images are in place.
  const html = needsImages ? (current ?? (images?.path === path ? images : null))?.html ?? null : source;
  const document = React.useMemo(() => (html == null ? null : buildMobileHtmlPreviewDocument(html)), [html]);

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
      {needsImages && current?.failed ? (
        <Text style={styles.imageNotice}>
          {current.failed === 1 ? 'One local image' : `${current.failed} local images`} could not be shown.
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
        source={{ html: document, baseUrl: MOBILE_HTML_PREVIEW_BASE_URL }}
        onShouldStartLoadWithRequest={(request) =>
          shouldAllowMobileHtmlPreviewNavigation(request.url)
        }
        onOpenWindow={() => {
          // Supplying the handler makes target=_blank a denied event instead of a navigation.
        }}
        onFileDownload={() => {
          // iOS cancels downloads handled here. Android outbound navigation is denied above.
        }}
        onLoadStart={(event) => {
          if (!shouldAllowMobileHtmlPreviewNavigation(event.nativeEvent.url)) {
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
