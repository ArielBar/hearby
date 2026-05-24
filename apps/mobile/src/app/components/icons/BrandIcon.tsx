import React from 'react';
import Svg, { Circle, Path, G } from 'react-native-svg';

interface Props {
  size?: number;
}

export function BrandIcon({ size = 80 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Outer ring */}
      <Circle cx={40} cy={40} r={36} stroke="#6366f1" strokeWidth={3} opacity={0.3} />
      <Circle cx={40} cy={40} r={28} stroke="#6366f1" strokeWidth={2} opacity={0.15} />
      {/* Location pin */}
      <G>
        <Path
          d="M40 20c-8.284 0-15 6.492-15 14.5C25 45.5 40 58 40 58s15-12.5 15-23.5C55 26.492 48.284 20 40 20z"
          fill="#6366f1"
          opacity={0.9}
        />
        <Circle cx={40} cy={34} r={6} fill="#ffffff" />
      </G>
      {/* Pulse rings (decorative) */}
      <Circle cx={40} cy={34} r={18} stroke="#6366f1" strokeWidth={1.5} opacity={0.2} strokeDasharray="4 3" />
    </Svg>
  );
}
