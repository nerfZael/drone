import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors } from '../theme';
import { renderNativeMermaid } from './native-mermaid';

const MAX_DIAGRAM_WIDTH = 1_600;
const MAX_DIAGRAM_HEIGHT = 1_400;
const DIAGRAM_PADDING = 12;

export function NativeMermaidDiagram({ source }: { source: string }) {
  const [availableWidth, setAvailableWidth] = React.useState(0);
  const result = React.useMemo(() => {
    try {
      return { diagram: renderNativeMermaid(source), errorMessage: '' };
    } catch (error) {
      return {
        diagram: null,
        errorMessage:
          error instanceof Error && error.message.includes('too large')
            ? error.message
            : 'Could not render this Mermaid diagram. Open Source to check its syntax.',
      };
    }
  }, [source]);

  if (result.errorMessage || !result.diagram) {
    return (
      <View accessibilityRole="alert" style={styles.error}>
        <Text style={styles.errorText}>{result.errorMessage}</Text>
      </View>
    );
  }

  const contentWidth = Math.max(0, availableWidth - DIAGRAM_PADDING * 2);
  const fitScale = contentWidth > 0 ? Math.max(1, contentWidth / result.diagram.width) : 1;
  const scale = Math.min(
    fitScale,
    MAX_DIAGRAM_WIDTH / result.diagram.width,
    MAX_DIAGRAM_HEIGHT / result.diagram.height,
  );
  const diagramWidth = Math.max(1, Math.round(result.diagram.width * scale));
  const diagramHeight = Math.max(1, Math.round(result.diagram.height * scale));

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        setAvailableWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={styles.container}
    >
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.scrollContent}
      >
        <SvgXml
          accessible
          accessibilityLabel="Rendered Mermaid diagram"
          xml={result.diagram.xml}
          width={diagramWidth}
          height={diagramHeight}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minWidth: 0,
    backgroundColor: colors.mantle,
  },
  scrollContent: {
    padding: DIAGRAM_PADDING,
  },
  error: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    backgroundColor: colors.dangerDark,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
