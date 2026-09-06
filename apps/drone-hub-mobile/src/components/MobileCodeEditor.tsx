import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { highlightMobileEditorCode } from '../drones/mobile-syntax-highlighting';
import { ThemedTextInput } from './ThemedTextInput';
import { syntaxTokenStyles } from './MobileHighlightedCode';

/**
 * A multiline input with a highlighted mirror rendered underneath it. The input keeps its
 * caret, selection, keyboard, and IME behaviour; only its glyphs are transparent. Both layers
 * share the exact same font metrics, padding, and break strategy so they wrap identically.
 */
export function MobileCodeEditor({
  value,
  path,
  mime,
  accessibilityLabel,
  maxLength,
  editable = true,
  onChangeText,
}: {
  value: string;
  path: string;
  mime?: string;
  accessibilityLabel: string;
  maxLength?: number;
  editable?: boolean;
  onChangeText(value: string): void;
}) {
  const highlight = React.useMemo(
    () => highlightMobileEditorCode(value, path, mime),
    [mime, path, value],
  );
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
    >
      <View style={styles.stage}>
        {highlight.highlighted ? (
          <Text
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            textBreakStrategy="simple"
            style={[styles.code, styles.mirror]}
          >
            {highlight.tokens.map((token, index) => (
              <Text
                key={index}
                style={token.types.map((type) => syntaxTokenStyles[type]).filter(Boolean)}
              >
                {token.text}
              </Text>
            ))}
          </Text>
        ) : null}
        <ThemedTextInput
          accessibilityLabel={accessibilityLabel}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          multiline
          scrollEnabled={false}
          editable={editable}
          maxLength={maxLength}
          textAlignVertical="top"
          textBreakStrategy="simple"
          underlineColorAndroid="transparent"
          value={value}
          onChangeText={onChangeText}
          style={[styles.code, styles.input, highlight.highlighted && styles.inputTransparent]}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  content: { flexGrow: 1 },
  stage: { flexGrow: 1, position: 'relative' },
  code: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 48,
    color: colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0,
    includeFontPadding: false,
    textAlignVertical: 'top',
  },
  mirror: { position: 'absolute', top: 0, left: 0, right: 0 },
  input: { flexGrow: 1, minHeight: '100%', margin: 0, backgroundColor: 'transparent' },
  inputTransparent: { color: 'transparent' },
});
