import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeMobilePullRequestMergeMethod,
  type MobilePullRequestMergeMethod,
} from './linked-pull-request-model';

const PULL_REQUEST_MERGE_METHOD_KEY = 'droneHub.prMergeMethod.v1';

export async function loadMobilePullRequestMergeMethod(): Promise<MobilePullRequestMergeMethod> {
  try {
    return normalizeMobilePullRequestMergeMethod(
      await AsyncStorage.getItem(PULL_REQUEST_MERGE_METHOD_KEY),
    );
  } catch {
    return 'merge';
  }
}

export async function saveMobilePullRequestMergeMethod(
  method: MobilePullRequestMergeMethod,
): Promise<void> {
  await AsyncStorage.setItem(PULL_REQUEST_MERGE_METHOD_KEY, method);
}
