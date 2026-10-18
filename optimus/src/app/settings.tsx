import { Screen } from '../ui/components/Screen';
import { Txt } from '../ui/components/Txt';
import { Dock } from '../ui/components/Dock';
import { View } from 'react-native';

export default function Stub() {
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Txt variant="title">settings</Txt>
      </Screen>
      <Dock />
    </View>
  );
}
