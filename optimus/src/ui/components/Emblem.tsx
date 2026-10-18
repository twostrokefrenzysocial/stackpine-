import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';

/**
 * The original Optimus emblem: a split hexagonal shield with a crest chevron
 * and a glowing visor slot. Halves can be drawn separately for the
 * transform-in animation.
 */
export function Emblem({ size = 96, steel = ['#6A7680', '#2B3238'], edge = '#3A444D', visor = '#22D3EE', part = 'all' }: { size?: number; steel?: [string, string] | string[]; edge?: string; visor?: string; part?: 'all' | 'left' | 'right' | 'visor' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs>
        <LinearGradient id="em" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor={steel[0]} />
          <Stop offset="1" stopColor={steel[1]} />
        </LinearGradient>
      </Defs>
      {(part === 'all' || part === 'left') && (
        <>
          <Polygon points="58,8 22,28 18,74 58,112 58,86 34,66 36,38 58,26" fill="url(#em)" stroke={edge} strokeWidth={2} />
          <Polygon points="58,30 42,40 58,46" fill={edge} />
        </>
      )}
      {(part === 'all' || part === 'right') && (
        <>
          <Polygon points="62,8 98,28 102,74 62,112 62,86 86,66 84,38 62,26" fill="url(#em)" stroke={edge} strokeWidth={2} />
          <Polygon points="62,30 78,40 62,46" fill={edge} />
        </>
      )}
      {(part === 'all' || part === 'visor') && (
        <>
          <Polygon points="30,52 90,52 84,62 36,62" fill={visor} opacity={0.35} />
          <Polygon points="36,55 84,55 81,59.5 39,59.5" fill={visor} />
        </>
      )}
    </Svg>
  );
}
