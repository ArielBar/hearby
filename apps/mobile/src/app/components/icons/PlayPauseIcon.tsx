import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface PlayPauseIconProps {
  size?: number;
  color?: string;
  paused: boolean;
}

export function PlayPauseIcon({ size = 20, color = '#ffffff', paused }: PlayPauseIconProps) {
  if (paused) {
    // Play triangle
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d="M8 5v14l11-7z" />
      </Svg>
    );
  }
  // Pause bars
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </Svg>
  );
}
