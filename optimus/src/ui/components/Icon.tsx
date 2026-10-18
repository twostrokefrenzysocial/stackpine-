import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Original thin outline icon set on a 24-unit grid (1.5px stroke).
 */
export type IconName =
  | 'mic'
  | 'send'
  | 'stop'
  | 'home'
  | 'chat'
  | 'core'
  | 'activity'
  | 'settings'
  | 'calendar'
  | 'message'
  | 'phone'
  | 'phoneMissed'
  | 'mail'
  | 'photo'
  | 'bell'
  | 'alert'
  | 'check'
  | 'close'
  | 'edit'
  | 'plus'
  | 'search'
  | 'history'
  | 'chevronRight'
  | 'chevronLeft'
  | 'lock'
  | 'scan'
  | 'trash'
  | 'person'
  | 'pin'
  | 'clock'
  | 'speaker'
  | 'speakerOff'
  | 'download'
  | 'upload'
  | 'offline'
  | 'brief'
  | 'bolt';

const PATHS: Record<IconName, string> = {
  mic: 'M9 4h6l1 1v7l-1 1H9l-1-1V5zM5 11v1l2 4 3 2h4l3-2 2-4v-1M12 18v3M9 21h6',
  send: 'M3 12 21 4l-5 16-4-6-9-2zM12 14l9-10',
  stop: 'M7 6h10l1 1v10l-1 1H7l-1-1V7z',
  home: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  chat: 'M4 5h16l1 1v10l-1 1h-9l-5 4v-4H4l-1-1V6zM8 10h8M8 13h5',
  core: 'M9 3h6M9 21h6M3 9v6M21 9v6M7 7h10v10H7zM10 10h4v4h-4zM12 3v4M12 17v4M3 12h4M17 12h4',
  activity: 'M2 12h4l3-7 4 14 3-7h6',
  settings: 'M12 2l2 3 3.5-.5 1 3.5L22 10l-1.5 2 1.5 2-3.5 2-1 3.5L14 19l-2 3-2-3-3.5.5-1-3.5L2 14l1.5-2L2 10l3.5-2 1-3.5L10 5zM12 9a3 3 0 1 0 .01 0',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3M13 14h3M8 17h3',
  message: 'M5 4h14l2 2v9l-2 2h-7l-5 4v-4H5l-2-2V6zM8 10h.01M12 10h.01M16 10h.01',
  phone: 'M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3l-2 3C10 21 3 14 3 5z',
  phoneMissed: 'M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3l-2 3C10 21 3 14 3 5zM15 3l6 6M21 3l-6 6',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  photo: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01',
  bell: 'M6 10a6 6 0 0 1 12 0v4l2 3H4l2-3zM10 20h4',
  alert: 'M12 3 22 20H2zM12 9v5M12 17h.01',
  check: 'M4 12l5 5L20 6',
  close: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  plus: 'M12 4v16M4 12h16',
  search: 'M10.5 4a6.5 6.5 0 1 0 .01 0M15.5 15.5 21 21',
  history: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5M12 8v4l3 2',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  scan: 'M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4M3 12h18',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  person: 'M12 4a4 4 0 1 0 .01 0M4 21v-2l3-4h10l3 4v2',
  pin: 'M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12zM12 7a3 3 0 1 0 .01 0',
  clock: 'M12 3a9 9 0 1 0 .01 0M12 7v5l3 3',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  speakerOff: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 4h16',
  offline: 'M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18',
  brief: 'M5 3h10l4 4v14H5zM15 3v4h4M8 11h8M8 14h8M8 17h5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
};

export function Icon({ name, size = 24, color, strokeWidth = 1.5 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={PATHS[name]} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A small status dot. */
export function StatusDot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8">
      <Circle cx={4} cy={4} r={4} fill={color} />
    </Svg>
  );
}
