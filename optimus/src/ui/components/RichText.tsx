import { Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseMarkdown, type Span } from '../../core/util/markdown';
import { useApp } from '../AppContext';
import { fonts, space, type as T } from '../theme';
import { Txt } from './Txt';

function Spans({ spans }: { spans: Span[] }) {
  const { palette: p } = useApp();
  return (
    <>
      {spans.map((s, i) => (
        <Text
          key={i}
          style={[
            s.bold && { fontFamily: fonts.bodySemi },
            s.italic && { fontStyle: 'italic' },
            s.code && { fontFamily: fonts.mono, fontSize: 14, backgroundColor: p.surface },
          ]}
        >
          {s.text}
        </Text>
      ))}
    </>
  );
}

/** Assistant reply text with light Markdown (headings, lists, bold) rendered natively. */
export function RichText({ text, selectable }: { text: string; selectable?: boolean }) {
  const { palette: p } = useApp();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.kind === 'heading' ? (
            <Txt variant="bodyLarge" selectable={selectable} style={{ fontFamily: fonts.bodySemi, marginTop: i ? space.xs : 0 }}>
              <Spans spans={b.spans} />
            </Txt>
          ) : b.kind === 'bullet' ? (
            <View style={[styles.bullet, { paddingLeft: b.depth * space.lg }]}>
              <Txt variant="bodyLarge" color={p.textSecondary} style={styles.marker}>
                {b.marker}
              </Txt>
              <Txt variant="bodyLarge" selectable={selectable} style={{ flex: 1 }}>
                <Spans spans={b.spans} />
              </Txt>
            </View>
          ) : (
            <Txt variant="bodyLarge" selectable={selectable}>
              <Spans spans={b.spans} />
            </Txt>
          )}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm },
  marker: { minWidth: 16, fontFamily: T.bodyLarge.fontFamily },
});
