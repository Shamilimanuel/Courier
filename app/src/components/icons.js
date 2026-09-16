import Svg, { Circle, Path, Rect } from "react-native-svg";

function Icon({ size = 24, color = "#FFFFFF", strokeWidth = 1.8, children }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function FileIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M6 3h8l5 5v13H6z" />
      <Path d="M14 3v5h5" />
    </Icon>
  );
}

export function MediaIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="3" y="4" width="18" height="16" rx="2.5" />
      <Circle cx="9" cy="10" r="1.8" />
      <Path d="M21 16l-5.5-5.5L7 19" />
    </Icon>
  );
}

export function TextIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M4 5h16M4 12h16M4 19h10" />
    </Icon>
  );
}

export function AppIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="3" y="3" width="7.5" height="7.5" rx="1.8" />
      <Rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8" />
      <Rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8" />
      <Rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8" />
    </Icon>
  );
}

export function BackIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function KebabIcon(props) {
  const color = props.color || "#FFFFFF";
  return (
    <Icon {...props}>
      <Circle cx="12" cy="5" r="1.8" fill={color} stroke="none" />
      <Circle cx="12" cy="12" r="1.8" fill={color} stroke="none" />
      <Circle cx="12" cy="19" r="1.8" fill={color} stroke="none" />
    </Icon>
  );
}

export function CheckIcon(props) {
  return (
    <Icon {...props} strokeWidth={props.strokeWidth || 2.5}>
      <Path d="M5 12l5 5L19 7" />
    </Icon>
  );
}

export function SignalIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M12 20v-7M12 13a5 5 0 015-5M12 13a5 5 0 00-5-5M12 5v3" />
    </Icon>
  );
}

export const CATEGORY_ICONS = {
  file: { Icon: FileIcon, color: "#7B6BE8" },
  media: { Icon: MediaIcon, color: "#F0784F" },
  text: { Icon: TextIcon, color: "#3FA97B" },
  app: { Icon: AppIcon, color: "#C9862B" },
};
