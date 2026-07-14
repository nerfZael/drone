import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import {
  relativeMessageTime,
  relativeMessageTimeRefreshDelay,
} from './relative-message-time';

export function RelativeMessageTimestamp({
  timestamp,
  style,
}: {
  timestamp: string | number | null | undefined;
  style?: StyleProp<TextStyle>;
}) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const label = relativeMessageTime(timestamp, nowMs);

  React.useEffect(() => {
    setNowMs(Date.now());
  }, [timestamp]);

  React.useEffect(() => {
    const delay = relativeMessageTimeRefreshDelay(timestamp, nowMs);
    if (delay == null) return;
    const timer = setTimeout(() => setNowMs(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [nowMs, timestamp]);

  return label ? <Text style={style}>{label}</Text> : null;
}
