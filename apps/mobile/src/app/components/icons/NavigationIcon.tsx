import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

export function NavigationIcon({ size = 20, color = '#ffffff' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M3.27 11.44l17.17-8.59a.5.5 0 0 1 .68.68l-8.59 17.17a.5.5 0 0 1-.92-.04L9.53 14.5a.5.5 0 0 0-.03-.03l-6.16-2.08a.5.5 0 0 1-.07-.95z" />
    </Svg>
  );
}
