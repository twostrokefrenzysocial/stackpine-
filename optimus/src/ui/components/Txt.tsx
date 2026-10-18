import { Text, type TextProps } from 'react-native';
import { useApp } from '../AppContext';
import { type as T } from '../theme';

export type TxtVariant = keyof typeof T;

const UPPER: TxtVariant[] = ['label', 'heading'];

/** Themed text. System font scaling stays on. */
export function Txt({ variant = 'body', color, style, children, ...rest }: TextProps & { variant?: TxtVariant; color?: string }) {
  const { palette } = useApp();
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={variant === 'hero' || variant === 'display' ? 1.4 : 2}
      style={[T[variant], { color: color ?? palette.text }, UPPER.includes(variant) && { textTransform: 'uppercase' }, style]}
    >
      {children}
    </Text>
  );
}
