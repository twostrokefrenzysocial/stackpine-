import { StyleSheet, View } from 'react-native';
import { useApp } from '../AppContext';
import { space } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Panel } from './Panel';
import { Txt } from './Txt';

/** Friendly, on-brand error/status message. Never shows raw errors. */
export function Banner({ title, body, icon = 'alert', tone = 'amber', action, onDismiss }: { title: string; body: string; icon?: IconName; tone?: 'amber' | 'danger' | 'cyan'; action?: { label: string; onPress: () => void }; onDismiss?: () => void }) {
  const { palette: p } = useApp();
  const color = tone === 'danger' ? p.dangerText : tone === 'cyan' ? p.cyanText : p.amberText;
  return (
    <Panel tone={tone} assemble={false} accessibilityLabel={`${title}. ${body}`}>
      <View style={styles.row}>
        <Icon name={icon} size={22} color={color} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading" color={color}>
            {title}
          </Txt>
          <Txt variant="small" color={p.textDim}>
            {body}
          </Txt>
        </View>
      </View>
      {(action || onDismiss) && (
        <View style={styles.actions}>
          {action && <Button label={action.label} compact variant="secondary" onPress={action.onPress} />}
          {onDismiss && <Button label="Dismiss" compact variant="ghost" onPress={onDismiss} />}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md, justifyContent: 'flex-end' },
});
