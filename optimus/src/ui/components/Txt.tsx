import { Text, type TextProps } from 'react-native';
import { useApp } from '../AppContext';
import { type as T } from '../theme';

export type TxtVariant = keyof typeof T;

/** Themed text. Font scaling stays on (system font size is respected). */
export function Txt({ variant = 'body', color, style, children, ...rest }: TextProps & { variant?: TxtVariant; color?: string }) {
  const { palette } = useApp();
  const upper = variant === 'label';
  return (
    <Text {...rest} maxFontSizeMultiplier={variant === 'hero' || variant === 'label' ? 1.6 : 2.2} style={[T[variant], { color: color ?? palette.text }, upper && { textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}
