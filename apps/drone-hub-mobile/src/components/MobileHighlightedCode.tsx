import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { catppuccin, colors } from '../theme';
import {
  highlightMobileCode,
  highlightMobileCodeFence,
} from '../drones/mobile-syntax-highlighting';

const syntaxTokenStyles: Record<string, TextStyle> = {
  comment: { color: catppuccin.overlay1, fontStyle: 'italic' },
  prolog: { color: catppuccin.overlay1 },
  doctype: { color: catppuccin.overlay1 },
  cdata: { color: catppuccin.overlay1 },
  punctuation: { color: catppuccin.subtext0 },
  property: { color: catppuccin.sky },
  tag: { color: catppuccin.red },
  constant: { color: catppuccin.peach },
  symbol: { color: catppuccin.flamingo },
  deleted: { color: catppuccin.red },
  boolean: { color: catppuccin.peach },
  number: { color: catppuccin.peach },
  selector: { color: catppuccin.green },
  'attr-name': { color: catppuccin.yellow },
  string: { color: catppuccin.green },
  char: { color: catppuccin.green },
  builtin: { color: catppuccin.red },
  inserted: { color: catppuccin.green },
  operator: { color: catppuccin.sky },
  entity: { color: catppuccin.peach },
  url: { color: catppuccin.sky },
  atrule: { color: catppuccin.mauve },
  'attr-value': { color: catppuccin.green },
  keyword: { color: catppuccin.mauve },
  function: { color: catppuccin.blue },
  'class-name': { color: catppuccin.yellow },
  regex: { color: catppuccin.peach },
  important: { color: catppuccin.peach, fontWeight: '700' },
  variable: { color: catppuccin.flamingo },
  namespace: { color: catppuccin.overlay2 },
};

export function MobileHighlightedCode({
  content,
  language,
  path = '',
  mime = '',
  selectable = true,
  style,
}: {
  content: string;
  language?: string;
  path?: string;
  mime?: string;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const result = React.useMemo(
    () =>
      language == null
        ? highlightMobileCode(content, path, mime)
        : highlightMobileCodeFence(content, language),
    [content, language, mime, path],
  );
  return (
    <Text selectable={selectable} style={[styles.code, style]}>
      {result.tokens.map((token, index) => (
        <Text
          key={index}
          style={token.types.map((type) => syntaxTokenStyles[type]).filter(Boolean)}
        >
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  code: {
    color: colors.text,
    fontFamily: 'monospace',
  },
});
