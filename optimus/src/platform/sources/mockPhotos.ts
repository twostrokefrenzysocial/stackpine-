import { Asset } from 'expo-asset';
import { MOCK_PHOTO_MODULES } from '../../core/mock/photoAssets';
import type { PhotoAsset } from '../../core/types';
import { resizeForVision } from './real';

/** Bundled image module for a mock photo (for <Image source>). */
export function mockPhotoSource(photo: Pick<PhotoAsset, 'filename' | 'uri'>): number | { uri: string } {
  const mod = MOCK_PHOTO_MODULES[photo.filename];
  return mod ?? { uri: photo.uri };
}

/** Loads a bundled mock photo for vision, resized like real photos. */
export async function loadMockPhoto(photo: PhotoAsset, maxEdge: number) {
  const mod = MOCK_PHOTO_MODULES[photo.filename];
  if (!mod) return null;
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return resizeForVision(uri, photo.width, photo.height, maxEdge);
}
