import {
  groupProviderModelOptions,
  type ProviderModelCatalogModel,
} from '@drone/assistant-chat';

export type NativeModelCatalogEntry = ProviderModelCatalogModel;
export const buildNativeModelCatalog = groupProviderModelOptions;
