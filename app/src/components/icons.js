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

export function GearIcon(props) {
  return (
    <Icon {...props}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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

export function RefreshIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <Path d="M21 3v5h-5" />
      <Path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <Path d="M3 21v-5h5" />
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

export function PhotoIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="3" y="4" width="18" height="16" rx="2" />
      <Circle cx="9" cy="10" r="2" />
      <Path d="M21 16l-5-5-9 9" />
    </Icon>
  );
}

export function ClipboardIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="6" y="4" width="12" height="17" rx="2" />
      <Path d="M9 4V2.8h6V4M9 10h6M9 14h4" />
    </Icon>
  );
}

export function DownloadIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
    </Icon>
  );
}

export function TrashIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </Icon>
  );
}

/** The paper plane from the app icon, for the brand mark. */
export function PlaneIcon(props) {
  return (
    <Icon {...props}>
      <Path d="M3.5 11.5L20.5 4l-4.6 16.5-4.3-5.4z" />
      <Path d="M11.6 15.1L20.5 4" />
    </Icon>
  );
}

export function PcIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="3" y="4" width="18" height="12" rx="2" />
      <Path d="M8 20h8M12 16v4" />
    </Icon>
  );
}

export function PhoneIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <Path d="M11 18.5h2" />
    </Icon>
  );
}

export function CopyIcon(props) {
  return (
    <Icon {...props}>
      <Rect x="8" y="8" width="12" height="12" rx="2" />
      <Path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </Icon>
  );
}

export const CATEGORY_ICONS = {
  file: { Icon: FileIcon, color: "#7B6BE8" },
  media: { Icon: MediaIcon, color: "#F0784F" },
  text: { Icon: TextIcon, color: "#3FA97B" },
  app: { Icon: AppIcon, color: "#C9862B" },
};
