import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { ChatCard, ChatMessage } from '../../core/types';
import { formatTime } from '../../core/util/time';
import { ChatCardView } from '../cards/DataCards';
import { useApp } from '../AppContext';
import { space } from '../theme';
import { Icon } from './Icon';
import { PanelSurface } from './Panel';
import { Txt } from './Txt';

function UserBubble({ text, at }: { text: string; at: string }) {
  const { palette: p } = useApp();
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View style={styles.userWrap}>
      <View onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={styles.userBubble} accessible accessibilityLabel={`You said: ${text}`}>
        <PanelSurface width={size.w} height={size.h} tone="inset" c={10} />
        <Txt variant="body" selectable>
          {text}
        </Txt>
      </View>
      <Txt variant="mono" color={p.textFaint} style={{ fontSize: 11, marginTop: 4 }}>
        {formatTime(at)}
      </Txt>
    </View>
  );
}

function Caret() {
  const { palette: p, reduceMotion } = useApp();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduceMotion) o.value = withRepeat(withSequence(withTiming(0.2, { duration: 300 }), withTiming(1, { duration: 300 })), -1);
  }, [o, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 9, height: 16, backgroundColor: p.cyan, marginTop: 4 }, style]} />;
}

export function AssistantBlock({ text, cards, streaming, activity, at }: { text: string; cards: ChatCard[]; streaming?: boolean; activity?: string; at?: string }) {
  const { palette: p } = useApp();
  return (
    <View style={styles.assistant}>
      <View style={styles.assistantHead}>
        <View style={[styles.glyph, { borderColor: p.cyan }]}>
          <View style={[styles.glyphVisor, { backgroundColor: p.cyan }]} />
        </View>
        <Txt variant="label" color={p.cyanText}>
          Optimus
        </Txt>
        {at && (
          <Txt variant="mono" color={p.textFaint} style={{ fontSize: 11 }}>
            {formatTime(at)}
          </Txt>
        )}
      </View>
      {text ? (
        <Txt variant="body" selectable accessibilityLiveRegion={streaming ? 'polite' : 'none'}>
          {text}
        </Txt>
      ) : null}
      {streaming && !text && !activity && <Caret />}
      {activity && (
        <View style={styles.activity} accessibilityLiveRegion="polite">
          <Icon name="bolt" size={14} color={p.amberText} />
          <Txt variant="mono" color={p.amberText}>
            {activity.toUpperCase()}…
          </Txt>
        </View>
      )}
      {cards.length > 0 && (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {cards.map((c, i) => (
            <ChatCardView key={`${c.type}-${i}`} card={c} index={i} />
          ))}
        </View>
      )}
    </View>
  );
}

export function MessageView({ m }: { m: ChatMessage }) {
  return m.role === 'user' ? <UserBubble text={m.text} at={m.createdAt} /> : <AssistantBlock text={m.text} cards={m.cards} at={m.createdAt} />;
}

const styles = StyleSheet.create({
  userWrap: { alignItems: 'flex-end', marginVertical: space.sm },
  userBubble: { maxWidth: '86%', paddingHorizontal: space.lg, paddingVertical: space.md },
  assistant: { marginVertical: space.sm, gap: space.sm },
  assistantHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  glyph: { width: 20, height: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  glyphVisor: { width: 10, height: 2.5, transform: [{ rotate: '-45deg' }] },
  activity: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
