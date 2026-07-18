import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import X from 'lucide-react-native/icons/x';
import { colors } from '../theme';

export type AssistantModelChoice = {
  provider: string;
  id: string;
  name?: string;
  thinkingLevel?: string;
};

const DEFAULT_REASONING_LEVELS = ['off', 'low', 'medium', 'high'];

function uniqueModels(options: AssistantModelChoice[]): AssistantModelChoice[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.provider}:${option.id}`;
    if (!option.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function AssistantModelPicker({
  open,
  currentProvider,
  currentModel,
  currentThinkingLevel,
  options,
  busy,
  showReasoning = true,
  onClose,
  onSelect,
}: {
  open: boolean;
  currentProvider: string;
  currentModel: string;
  currentThinkingLevel?: string;
  options: AssistantModelChoice[];
  busy?: boolean;
  showReasoning?: boolean;
  onClose(): void;
  onSelect(choice: AssistantModelChoice, selection: 'model' | 'reasoning'): void;
}) {
  const insets = useSafeAreaInsets();
  const [modelsOpen, setModelsOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) setModelsOpen(!showReasoning);
  }, [currentModel, open, showReasoning]);
  const choices = options.some(
    (option) =>
      option.provider === currentProvider &&
      option.id === currentModel &&
      (!option.thinkingLevel ||
        !currentThinkingLevel ||
        option.thinkingLevel === currentThinkingLevel),
  )
    ? options
    : [{ provider: currentProvider, id: currentModel, name: currentModel }, ...options];
  const selectedReasoning = currentThinkingLevel || 'low';
  const reasoningLevels = [
    ...new Set(
      choices
        .filter((option) => option.provider === currentProvider && option.id === currentModel)
        .map((option) => option.thinkingLevel)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const visibleReasoning = reasoningLevels.length > 0 ? reasoningLevels : DEFAULT_REASONING_LEVELS;
  const models = uniqueModels(choices);
  const currentName =
    models.find((choice) => choice.provider === currentProvider && choice.id === currentModel)
      ?.name || currentModel;

  const selectReasoning = (thinkingLevel: string) => {
    const exact = choices.find(
      (choice) =>
        choice.provider === currentProvider &&
        choice.id === currentModel &&
        choice.thinkingLevel === thinkingLevel,
    );
    onSelect(
      exact ?? {
        provider: currentProvider,
        id: currentModel,
        name: currentName,
        thinkingLevel,
      },
      'reasoning',
    );
  };

  const selectModel = (model: AssistantModelChoice) => {
    const exact = choices.find(
      (choice) =>
        choice.provider === model.provider &&
        choice.id === model.id &&
        choice.thinkingLevel === selectedReasoning,
    );
    onSelect(
      exact ?? { ...model, thinkingLevel: model.thinkingLevel ?? selectedReasoning },
      'model',
    );
    setModelsOpen(false);
  };
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.layer}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { marginBottom: Math.max(insets.bottom + 6, 12) }]}>
          <View style={styles.handle} />
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>
              {showReasoning && !modelsOpen ? 'Reasoning' : 'Model'}
            </Text>
            <Pressable onPress={onClose} style={styles.close}>
              <X color={colors.muted} size={19} strokeWidth={2} />
            </Pressable>
          </View>
          {showReasoning && !modelsOpen ? (
            <View style={styles.reasoningList}>
              {visibleReasoning.map((level) => {
                const active = level === selectedReasoning;
                return (
                  <Pressable
                    key={level}
                    disabled={busy}
                    onPress={() => selectReasoning(level)}
                    style={[styles.reasoningChoice, active && styles.choiceActive]}
                  >
                    <Text style={[styles.reasoningName, active && styles.activeText]}>
                      {level === 'off' ? 'Off' : `${level[0].toUpperCase()}${level.slice(1)}`}
                    </Text>
                    {active ? <Check color={colors.accent} size={14} strokeWidth={2.8} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Pressable onPress={() => setModelsOpen((value) => !value)} style={styles.modelToggle}>
            <Text numberOfLines={1} style={styles.modelToggleValue}>
              {currentName}
            </Text>
            {modelsOpen ? (
              <ChevronUp color={colors.accent} size={17} strokeWidth={2.2} />
            ) : (
              <ChevronDown color={colors.accent} size={17} strokeWidth={2.2} />
            )}
          </Pressable>
          {modelsOpen ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
              {busy ? (
                <View style={styles.modelState}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.modelStateText}>Discovering models…</Text>
                </View>
              ) : models.length === 0 ? (
                <View style={styles.modelState}>
                  <Text style={styles.modelStateText}>No models are available for this chat.</Text>
                </View>
              ) : (
                models.map((choice) => {
                  const active = choice.provider === currentProvider && choice.id === currentModel;
                  return (
                    <Pressable
                      key={`${choice.provider}:${choice.id}`}
                      disabled={busy}
                      onPress={() => selectModel(choice)}
                      style={[styles.choice, active && styles.choiceActive]}
                    >
                      <View style={styles.choiceCopy}>
                        <Text style={[styles.choiceName, active && styles.activeText]}>
                          {choice.name || choice.id}
                        </Text>
                      </View>
                      {active ? <Check color={colors.accent} size={16} strokeWidth={2.8} /> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
  },
  sheet: {
    width: 'auto',
    maxWidth: '92%',
    maxHeight: '72%',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    marginTop: 8,
    borderRadius: 3,
    backgroundColor: colors.surface2,
  },
  sectionHead: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 16,
  },
  sectionTitle: { color: colors.textStrong, fontSize: 17, fontWeight: '800' },
  close: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  list: { paddingHorizontal: 12, paddingBottom: 8, gap: 5 },
  modelState: {
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 12,
  },
  modelStateText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  reasoningList: {
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 5,
  },
  reasoningChoice: {
    alignSelf: 'flex-start',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reasoningName: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  modelToggle: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  modelToggleValue: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '800' },
  choice: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  choiceActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceName: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  activeText: { color: colors.accentAlt },
});
