import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

type SidebarIconProps = {
  color: string;
  size: number;
  strokeWidth?: number;
  style?: React.ComponentProps<typeof Svg>['style'];
};

export function SidebarDroneIcon({ color, size, strokeWidth = 1.5 }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x="5" y="5" width="6" height="6" rx="1" />
      <Line x1="2" y1="2" x2="5" y2="5" />
      <Line x1="14" y1="2" x2="11" y2="5" />
      <Line x1="2" y1="14" x2="5" y2="11" />
      <Line x1="14" y1="14" x2="11" y2="11" />
      <Circle cx="2" cy="2" r="1" fill={color} stroke="none" />
      <Circle cx="14" cy="2" r="1" fill={color} stroke="none" />
      <Circle cx="2" cy="14" r="1" fill={color} stroke="none" />
      <Circle cx="14" cy="14" r="1" fill={color} stroke="none" />
    </Svg>
  );
}

export function SidebarContainerIcon({ color, size, strokeWidth = 1.35 }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="m8 1.5 5.5 3v7L8 14.5l-5.5-3v-7L8 1.5Z" />
      <Path d="m2.5 4.5 5.5 3 5.5-3M8 7.5v7" />
    </Svg>
  );
}

export function SidebarNetworkIcon({ color, size, strokeWidth = 1.9 }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect width="6" height="6" x="9" y="2" rx="1" />
      <Rect width="6" height="6" x="16" y="16" rx="1" />
      <Rect width="6" height="6" x="2" y="16" rx="1" />
      <Path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" />
    </Svg>
  );
}

export function SidebarSettingsIcon({ color, size }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 16 16"
      fill={color}
    >
      <Path d="M6.8 1.03a1.2 1.2 0 012.4 0l.1.81a5.9 5.9 0 011.36.57l.68-.46a1.2 1.2 0 011.53.15l1.4 1.4a1.2 1.2 0 01.15 1.53l-.46.68c.23.43.42.89.56 1.36l.81.1a1.2 1.2 0 010 2.4l-.81.1a5.9 5.9 0 01-.56 1.36l.46.68a1.2 1.2 0 01-.15 1.53l-1.4 1.4a1.2 1.2 0 01-1.53.15l-.68-.46c-.43.23-.89.42-1.36.56l-.1.81a1.2 1.2 0 01-2.4 0l-.1-.81a5.9 5.9 0 01-1.36-.56l-.68.46a1.2 1.2 0 01-1.53-.15l-1.4-1.4a1.2 1.2 0 01-.15-1.53l.46-.68a5.9 5.9 0 01-.56-1.36l-.81-.1a1.2 1.2 0 010-2.4l.81-.1a5.9 5.9 0 01.56-1.36l-.46-.68a1.2 1.2 0 01.15-1.53l1.4-1.4a1.2 1.2 0 011.53-.15l.68.46c.43-.23.89-.42 1.36-.57l.1-.81zM8 5.75a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
    </Svg>
  );
}

export function SidebarMessageIcon({ color, size, strokeWidth = 1.9 }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </Svg>
  );
}

export function SidebarFolderGitIcon({ color, size, strokeWidth = 1.9, style }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <Path d="M14 6l-2-2-2 2M12 4v4" />
      <Path d="M6 14l2 2-2 2M8 16v-5.5A2.5 2.5 0 0 1 10.5 8H12" />
      <Path d="M2 12.5V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function SidebarFolderOutlineIcon({
  color,
  size,
  strokeWidth = 1.35,
  style,
}: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <Path d="M2.25 2.5h2.6c.44 0 .84.21 1.08.58l.78 1.17h7.04c.69 0 1.25.56 1.25 1.25v6.75c0 .69-.56 1.25-1.25 1.25H2.25c-.69 0-1.25-.56-1.25-1.25v-8.5c0-.69.56-1.25 1.25-1.25Z" />
    </Svg>
  );
}

export function SidebarPinIcon({ color, size, style }: SidebarIconProps) {
  return (
    <Svg height={size} width={size} viewBox="0 0 16 16" fill="none" style={style}>
      <Path
        d="M5.1 1.5h5.8l-.8 4.1 2.15 2.15v1.1H8.7V14.5H7.3V8.85H3.75v-1.1L5.9 5.6l-.8-4.1z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SidebarPlusIcon({ color, size }: SidebarIconProps) {
  return (
    <Svg height={size} width={size} viewBox="0 0 16 16" fill={color}>
      <Path d="M8 1.75a.75.75 0 01.75.75v4.75h4.75a.75.75 0 010 1.5H8.75v4.75a.75.75 0 01-1.5 0V8.75H2.5a.75.75 0 010-1.5h4.75V2.5A.75.75 0 018 1.75z" />
    </Svg>
  );
}

export function SidebarChevronIcon({
  color,
  size,
  strokeWidth = 2,
  direction,
}: SidebarIconProps & { direction: 'left' | 'right' | 'down' | 'up' }) {
  const path =
    direction === 'left'
      ? 'm15 18-6-6 6-6'
      : direction === 'right'
        ? 'm9 18 6-6-6-6'
        : direction === 'up'
          ? 'm18 15-6-6-6 6'
          : 'm6 9 6 6 6-6';
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={path} />
    </Svg>
  );
}

export function SidebarTreeChevronIcon({
  color,
  size,
  strokeWidth = 1.25,
  expanded,
  style,
}: SidebarIconProps & { expanded: boolean }) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <Path d={expanded ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
    </Svg>
  );
}

export function SidebarWorkingIcon({ color, size, strokeWidth = 2.4 }: SidebarIconProps) {
  return (
    <Svg
      height={size}
      width={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Svg>
  );
}
