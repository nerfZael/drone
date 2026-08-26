import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import { Label, textStyles } from '../components/Ui';
import {
  setMobileReadingDensity,
  useMobileReadingDensity,
  type MobileReadingDensity,
} from '../mobile-reading-density';
import { colors } from '../theme';

const options: Array<{
  value: MobileReadingDensity;
  label: string;
  description: string;
}> = [
  {
    value: 'default',
    label: 'Default',
    description: 'Keeps the compact layout while preserving readable conversation text.',
  },
  {
    value: 'comfortable',
    label: 'Comfortable',
    description: 'Enlarges chat, Markdown, navigation, and supporting operational text.',
  },
];

export function MobileReadingSettingsCard() {
  const density = useMobileReadingDensity();
  return (
    <View style={styles.section}>
      <Label>Reading density</Label>
      <Text style={[textStyles.heading, styles.title]}>Choose a comfortable text size</Text>
      <Text style={textStyles.body}>
        This preference is saved on this phone. Android system font scaling continues to apply.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {options.map((option) => {
          const selected = density === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => void setMobileReadingDensity(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
            >
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                  {option.label}
                </Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </View>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <Check color={colors.crust} size={13} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { marginTop: 6, marginBottom: 7 },
  options: { gap: 9, marginTop: 16 },
  option: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.whiteWashSoft,
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentWash,
  },
  optionPressed: { opacity: 0.74 },
  optionCopy: { flex: 1, minWidth: 0 },
  optionTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  optionTitleSelected: { color: colors.textStrong },
  optionDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  radio: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  radioSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
});
