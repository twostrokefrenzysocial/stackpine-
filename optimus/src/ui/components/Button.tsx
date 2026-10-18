import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useApp } from '../AppContext';
import { feedback, type FeedbackKind } from '../feedback';
import { TOUCH, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

/** primary = solid red; secondary = hairline outline; ghost = text only. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  compact?: boolean;
  feedbackKind?: FeedbackKind;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  /** Icon-only; the label is still read by screen readers. */
  iconOnly?: boolean;
}

export function Button({ label, onPress, variant = 'primary', icon, disabled, compact, feedbackKind = 'tap', accessibilityHint, style, iconOnly }: ButtonProps) {
  const { palette: p } = useApp();
  const fg = variant === 'primary' ? p.onRed : p.text;
  const h = compact ? 40 : TOUCH;
  return (
    <Pressable
      onPress={() => {
        feedback.fire(feedbackKind);
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={compact || iconOnly ? 6 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: h,
          minWidth: iconOnly ? TOUCH : undefined,
          paddingHorizontal: iconOnly ? 0 : compact ? space.md : space.lg,
          backgroundColor: variant === 'primary' ? p.red : pressed ? p.surfaceRaised : 'transparent',
          borderColor: variant === 'secondary' ? p.line : 'transparent',
          opacity: disabled ? 0.4 : variant === 'primary' && pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon && <Icon name={icon} size={compact ? 18 : 20} color={fg} />}
        {!iconOnly && (
          <Txt variant="heading" color={fg} style={{ fontSize: compact ? 13 : 15 }} numberOfLines={1}>
            {label}
          </Txt>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
