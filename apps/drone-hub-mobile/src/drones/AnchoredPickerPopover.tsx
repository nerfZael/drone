import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type AnchorBounds = {
  x: number;
  y: number;
  width: number;
};

type NativeViewChildren = React.ComponentProps<typeof View>['children'];

export function AnchoredPickerPopover({
  open,
  onClose,
  width,
  align = 'right',
  anchorStyle,
  menuStyle,
  trigger,
  children,
}: {
  open: boolean;
  onClose(): void;
  width: number;
  align?: 'left' | 'right';
  anchorStyle?: StyleProp<ViewStyle>;
  menuStyle?: StyleProp<ViewStyle>;
  trigger: NativeViewChildren;
  children: NativeViewChildren;
}) {
  const window = useWindowDimensions();
  const anchorRef = React.useRef<View>(null);
  const [anchor, setAnchor] = React.useState<AnchorBounds | null>(null);

  React.useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      anchorRef.current?.measureInWindow((x, y, measuredWidth) => {
        setAnchor({ x, y, width: measuredWidth });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, window.height, window.width]);

  const horizontalPosition = anchor
    ? align === 'left'
      ? { left: Math.max(8, anchor.x) }
      : { right: Math.max(8, window.width - anchor.x - anchor.width) }
    : null;

  return (
    <>
      <View ref={anchorRef} collapsable={false} style={anchorStyle}>
        {trigger}
      </View>
      <Modal
        animationType="none"
        transparent
        statusBarTranslucent
        visible={open && Boolean(anchor)}
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close picker"
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          />
          {anchor && horizontalPosition ? (
            <View
              accessibilityViewIsModal
              style={[
                menuStyle,
                styles.menuPosition,
                horizontalPosition,
                {
                  bottom: Math.max(8, window.height - anchor.y + 4),
                  width,
                  maxHeight: Math.max(120, anchor.y - 12),
                },
              ]}
            >
              {children}
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  menuPosition: { position: 'absolute' },
});
