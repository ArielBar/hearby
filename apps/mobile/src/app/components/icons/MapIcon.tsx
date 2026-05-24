import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

export function MapIcon({ size = 20, color = '#ffffff' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
      <Path d="M8 2v16" />
      <Path d="M16 6v16" />
    </Svg>
  );
}
