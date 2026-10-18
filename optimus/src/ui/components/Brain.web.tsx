import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { View } from 'react-native';
import type { BrainProps } from './BrainImpl';

/** Browser preview: Skia can only be imported after CanvasKit has loaded. */
export function Brain(props: BrainProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: () => '/canvaskit.wasm' }}
      getComponent={() => import('./BrainImpl')}
      fallback={<View style={{ width: props.size, height: props.size }} />}
      componentProps={props}
    />
  );
}
