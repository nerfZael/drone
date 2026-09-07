import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { configureMobileWorkspaceDiagnostics } from './mobile-workspace-load';
import { ChatLoadBuffer } from './chat-load-buffer';
import { configureMobileChatDiagnostics } from './mobile-chat-load';

export const mobileChatLoadBuffer = new ChatLoadBuffer(AsyncStorage);
configureMobileWorkspaceDiagnostics({
  uuid: Crypto.randomUUID,
  platform: Platform.OS,
  save: (record) => mobileChatLoadBuffer.append(record),
});
configureMobileChatDiagnostics({
  uuid: Crypto.randomUUID,
  platform: Platform.OS,
  save: (record) => mobileChatLoadBuffer.append(record),
});
