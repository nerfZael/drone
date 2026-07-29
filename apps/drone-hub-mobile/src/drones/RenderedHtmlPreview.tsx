import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';
import {
  buildMobileHtmlPreviewDocument,
  MOBILE_HTML_PREVIEW_BASE_URL,
  MOBILE_HTML_PREVIEW_ORIGIN_WHITELIST,
  MOBILE_HTML_PREVIEW_WEBVIEW_POLICY,
  shouldAllowMobileHtmlPreviewNavigation,
} from './mobile-html-preview-security';

export function RenderedHtmlPreview({ source }: { source: string }) {
  const webViewRef = React.useRef<WebView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const document = React.useMemo(() => buildMobileHtmlPreviewDocument(source), [source]);

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
          Sandboxed preview: scripts, network, links, forms, downloads, and file access are blocked.
        </Text>
      </View>
      <WebView
        ref={webViewRef}
        {...MOBILE_HTML_PREVIEW_WEBVIEW_POLICY}
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
      />
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
  webView: { flex: 1, backgroundColor: '#ffffff' },
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
