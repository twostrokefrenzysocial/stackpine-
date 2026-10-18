import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { ChatCard, ChatMessage } from '../../core/types';
import { formatTime } from '../../core/util/time';
import { ChatCardView } from '../cards/DataCards';
import { useApp } from '../AppContext';
import { radius, space } from '../theme';
import { Txt } from './Txt';

/** User message: surface block, right aligned, 2px red bar on the left. */
function UserBlock({ text, at }: { text: string; at: string }) {
  const { palette: p } = useApp();
  return (
    <View style={styles.userWrap}>
      <View style={[styles.userBlock, { backgroundColor: p.surface, borderLeftColor: p.red }]} accessible accessibilityLabel={`You said: ${text}`}>
        <Txt variant="body" selectable>
          {text}
        </Txt>
      </View>
      <Txt variant="mono" color={p.textTertiary} style={{ marginTop: 4 }}>
        {formatTime(at)}
      </Txt>
    </View>
  );
}

function Cursor() {
  const { palette: p, reduceMotion } = useApp();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduceMotion) o.value = withRepeat(withSequence(withTiming(0.15, { duration: 400 }), withTiming(1, { duration: 400 })), -1);
  }, [o, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 8, height: 2, backgroundColor: p.red, marginTop: 14 }, style]} />;
}

/** Assistant message: plain white text on black, no bubble. */
export function AssistantBlock({ text, cards, streaming, activity, at }: { text: string; cards: ChatCard[]; streaming?: boolean; activity?: string; at?: string }) {
  const { palette: p } = useApp();
  return (
    <View style={styles.assistant}>
      {text ? (
        <Txt variant="bodyLarge" selectable accessibilityLiveRegion={streaming ? 'polite' : 'none'}>
          {text}
        </Txt>
      ) : null}
      {streaming && !text && !activity && <Cursor />}
      {activity && (
        <Txt variant="mono" color={p.textSecondary} accessibilityLiveRegion="polite">
          {'> '}
          {activity.toUpperCase()}…
        </Txt>
      )}
      {cards.length > 0 && (
        <View style={{ gap: space.sm, marginTop: space.xs }}>
          {cards.map((c, i) => (
            <ChatCardView key={`${c.type}-${i}`} card={c} index={i} />
          ))}
        </View>
      )}
      {at && (
        <Txt variant="mono" color={p.textTertiary}>
          OPTIMUS · {formatTime(at)}
        </Txt>
      )}
    </View>
  );
}

export function MessageView({ m }: { m: ChatMessage }) {
  return m.role === 'user' ? <UserBlock text={m.text} at={m.createdAt} /> : <AssistantBlock text={m.text} cards={m.cards} at={m.createdAt} />;
}

const styles = StyleSheet.create({
  userWrap: { alignItems: 'flex-end', marginVertical: space.md },
  userBlock: { maxWidth: '86%', paddingHorizontal: space.lg, paddingVertical: space.md, borderLeftWidth: 2, borderRadius: radius.sm },
  assistant: { marginVertical: space.md, gap: space.sm },
});
