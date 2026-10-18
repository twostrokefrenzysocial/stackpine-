import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PhotoAsset } from '../../core/types';
import { formatDay, formatTime } from '../../core/util/time';
import { mockPhotoSource } from '../../platform/sources/mockPhotos';
import { space } from '../theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

const source = (p: PhotoAsset) => (p.uri.startsWith('mock://') ? mockPhotoSource(p) : { uri: p.uri });

/** Full-screen photos on black: swipe sideways between them, tap × to close. */
export function PhotoViewer({ photos, start, onClose }: { photos: PhotoAsset[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(start);
  const current = photos[index];
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(p) => p.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <View style={{ width, height, justifyContent: 'center' }}>
              <Image source={source(item)} style={{ width, height: height * 0.86 }} contentFit="contain" transition={150} accessibilityLabel={`Photo from ${formatDay(item.takenAt)}`} />
            </View>
          )}
        />
        <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
          <Txt variant="mono" color="#FFFFFF">
            {current ? `${formatDay(current.takenAt).toUpperCase()} · ${formatTime(current.takenAt)}` : ''}
            {photos.length > 1 ? `   ${index + 1} / ${photos.length}` : ''}
          </Txt>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close photo" style={styles.close}>
            <Icon name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
