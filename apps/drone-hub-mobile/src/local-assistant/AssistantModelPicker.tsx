import React from 'react';
import { formatReasoningLabel } from '@drone/assistant-chat';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
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
  const window = useWindowDimensions();
  const [modelsOpen, setModelsOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) setModelsOpen(!showReasoning);
  }, [currentModel, open, showReasoning]);
  const availableModels = uniqueModels(options);
  const exactCurrentModel = availableModels.find(
    (option) => option.provider === currentProvider && option.id === currentModel,
  );
  const selectedModel =
    exactCurrentModel ||
    availableModels.find((option) => option.id === currentModel) ||
    (!currentModel ? availableModels[0] : undefined);
  const selectedProvider = selectedModel?.provider || currentProvider;
  const selectedModelId = selectedModel?.id || currentModel;
  const choices = options.some(
    (option) =>
      option.provider === selectedProvider &&
      option.id === selectedModelId &&
      (!option.thinkingLevel ||
        !currentThinkingLevel ||
        option.thinkingLevel === currentThinkingLevel),
  )
    ? options
    : [
        {
          provider: selectedProvider,
          id: selectedModelId,
          name: selectedModel?.name || selectedModelId,
        },
        ...options,
      ];
  const selectedReasoning = currentThinkingLevel || 'low';
  const reasoningLevels = [
    ...new Set(
      choices
        .filter((option) => option.provider === selectedProvider && option.id === selectedModelId)
        .map((option) => option.thinkingLevel)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const visibleReasoning = reasoningLevels.length > 0 ? reasoningLevels : DEFAULT_REASONING_LEVELS;
  const models = uniqueModels(choices);
  const currentName =
    models.find((choice) => choice.provider === selectedProvider && choice.id === selectedModelId)
      ?.name || selectedModelId;
  const longestModelLabel = models.reduce(
    (longest, model) => Math.max(longest, String(model.name || model.id).length),
    currentName.length,
  );
  const sheetWidth = Math.min(window.width * 0.92, Math.max(180, longestModelLabel * 8 + 64));

  const selectReasoning = (thinkingLevel: string) => {
    const exact = choices.find(
      (choice) =>
        choice.provider === selectedProvider &&
        choice.id === selectedModelId &&
        choice.thinkingLevel === thinkingLevel,
    );
    onSelect(
      exact ?? {
        provider: selectedProvider,
        id: selectedModelId,
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
        <View
          style={[
            styles.sheet,
            { width: sheetWidth, marginBottom: Math.max(insets.bottom + 6, 12) },
          ]}
        >
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>
              {showReasoning && !modelsOpen ? 'Reasoning' : 'Model'}
            </Text>
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
                      {formatReasoningLabel(level)}
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
                  const active =
                    choice.provider === selectedProvider && choice.id === selectedModelId;
                  return (
                    <Pressable
                      key={`${choice.provider}:${choice.id}`}
                      disabled={busy}
                      onPress={() => selectModel(choice)}
                      style={[styles.choice, active && styles.choiceActive]}
                    >
                      <View style={styles.choiceCopy}>
                        <Text
                          numberOfLines={1}
                          style={[styles.choiceName, active && styles.activeText]}
                        >
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sectionHead: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  sectionTitle: { color: colors.textStrong, fontSize: 17, fontWeight: '600' },
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
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reasoningName: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  modelToggle: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginHorizontal: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  modelToggleValue: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '500' },
  choice: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  choiceActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceName: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  activeText: { color: colors.accentAlt },
});
