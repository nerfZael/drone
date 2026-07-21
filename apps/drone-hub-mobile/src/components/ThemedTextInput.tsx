import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { colors } from '../theme';

/**
 * React Native does not inherit cursor and selection colors from a global theme.
 * Keep those defaults at the component boundary so new inputs cannot drift.
 */
export const ThemedTextInput = React.forwardRef<TextInput, TextInputProps>(
  (
    {
      cursorColor = colors.cursor,
      selectionColor = colors.textSelection,
      ...props
    },
    ref,
  ) => (
    <TextInput
      ref={ref}
      cursorColor={cursorColor}
      selectionColor={selectionColor}
      {...props}
    />
  ),
);

ThemedTextInput.displayName = 'ThemedTextInput';
