/**
 * Claymorphism, as a set of tokens — the same recipe Reveille uses.
 *
 * Four shadows on every surface, not one: two outside for the lift, two
 * inside for the thickness, light always from the top-left, shade always
 * from the bottom-right. React Native's `boxShadow` style (RN 0.76+) takes
 * an array of layers, which is what makes this possible on both platforms.
 */

export const THEMES = {
  dawn: {
    name: "dawn",
    label: "Dawn",
    ground: "#DED6F0",
    clayHi: "#FBF8FF",
    clayLo: "#DCD2F0",
    ink: "#38305A",
    ink2: "#6C6390",
    ink3: "#9A92B8",
    dusk: "#7B6BE8",
    duskDeep: "#5A48CF",
    moss: "#3FA97B",
    danger: "#DB4A66",
    shadow: "rgba(122,104,172,0.38)",
    shine: "rgba(255,255,255,0.92)",
    onFill: "#FFFFFF",
  },
  dusk: {
    name: "dusk",
    label: "Dusk",
    ground: "#2A2036",
    clayHi: "#3B2E4C",
    clayLo: "#231A2E",
    ink: "#F6EDFF",
    ink2: "#C0AFD4",
    ink3: "#8A7AA0",
    dusk: "#A48BFF",
    duskDeep: "#7C63E0",
    moss: "#68D6A4",
    danger: "#FF8099",
    shadow: "rgba(0,0,0,0.50)",
    shine: "rgba(255,255,255,0.075)",
    onFill: "#1A1226",
  },
  midnight: {
    name: "midnight",
    label: "Midnight",
    ground: "#12151F",
    clayHi: "#1F2433",
    clayLo: "#0C0F16",
    ink: "#E8ECF7",
    ink2: "#98A2BA",
    ink3: "#646E88",
    dusk: "#5D8BFF",
    duskDeep: "#3D66E0",
    moss: "#4FD69A",
    danger: "#FF6B84",
    shadow: "rgba(0,0,0,0.62)",
    shine: "rgba(255,255,255,0.055)",
    onFill: "#0B0E16",
  },
};

/** A surface that sits above the page. */
export function raised(t, scale = 1) {
  return {
    backgroundColor: t.clayHi,
    boxShadow: [
      { offsetX: 10 * scale, offsetY: 10 * scale, blurRadius: 22 * scale, color: t.shadow },
      { offsetX: -7 * scale, offsetY: -7 * scale, blurRadius: 16 * scale, color: t.shine },
      { offsetX: -3 * scale, offsetY: -3 * scale, blurRadius: 9 * scale, color: t.shadow, inset: true },
      { offsetX: 4 * scale, offsetY: 4 * scale, blurRadius: 10 * scale, color: t.shine, inset: true },
    ],
  };
}

/** A surface pressed into the page — inputs, wells. */
export function sunken(t, scale = 1) {
  return {
    backgroundColor: t.clayLo,
    boxShadow: [
      { offsetX: 5 * scale, offsetY: 5 * scale, blurRadius: 12 * scale, color: t.shadow, inset: true },
      { offsetX: -4 * scale, offsetY: -4 * scale, blurRadius: 10 * scale, color: t.shine, inset: true },
    ],
  };
}

/** What a raised surface becomes while your thumb is on it. */
export function pressed(t) {
  return {
    transform: [{ scale: 0.96 }],
    boxShadow: [
      { offsetX: 6, offsetY: 6, blurRadius: 13, color: t.shadow, inset: true },
      { offsetX: -4, offsetY: -4, blurRadius: 10, color: t.shine, inset: true },
    ],
  };
}

/** A filled control — the one accent-colour action on a screen. */
export function filled(t, colour, deep) {
  return {
    backgroundColor: colour,
    boxShadow: [
      { offsetX: 10, offsetY: 10, blurRadius: 22, color: t.shadow },
      { offsetX: -6, offsetY: -6, blurRadius: 14, color: t.shine },
      { offsetX: 3, offsetY: 3, blurRadius: 9, color: "rgba(255,255,255,0.45)", inset: true },
      { offsetX: -3, offsetY: -3, blurRadius: 9, color: deep, inset: true },
    ],
  };
}

export const RADIUS = { blob: 26, card: 24, pill: 999, field: 18, sheet: 30 };
