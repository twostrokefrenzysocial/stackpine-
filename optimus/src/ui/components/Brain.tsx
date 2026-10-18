import BrainImpl, { type BrainProps } from './BrainImpl';

export type { BrainProps };

/** Native: render directly. (Brain.web.tsx loads CanvasKit first.) */
export function Brain(props: BrainProps) {
  return <BrainImpl {...props} />;
}
