import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import { ChatFilesGestureContext } from '../drones/ChatFilesCarousel';

export const DrawerSwipeGestureContext = React.createContext<
  React.RefObject<GestureType | undefined> | null
>(null);

/** Keep horizontal content gestures local, even when the scroll view reaches an edge. */
export function EmbeddedHorizontalScrollView(props: Omit<ScrollViewProps, 'horizontal'>) {
  const drawerGesture = React.useContext(DrawerSwipeGestureContext);
  const pageGesture = React.useContext(ChatFilesGestureContext);
  const gesture = React.useMemo(() => {
    const horizontal = Gesture.Pan()
      .activeOffsetX([-5, 5])
      .failOffsetY([-10, 10]);
    if (drawerGesture) horizontal.blocksExternalGesture(drawerGesture);
    if (pageGesture) horizontal.blocksExternalGesture(pageGesture);
    // The pan reserves horizontal touches, including at content edges. The native
    // gesture still performs scrolling; vertical touches remain available to the parent.
    return Gesture.Simultaneous(horizontal, Gesture.Native());
  }, [drawerGesture, pageGesture]);

  return (
    <GestureDetector gesture={gesture}>
      <ScrollView {...props} horizontal />
    </GestureDetector>
  );
}
