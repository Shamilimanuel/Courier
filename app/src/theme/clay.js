/**
 * Courier's looks, as sets of tokens. Six of them, chosen in Settings the way
 * Reveille does it, in three families that differ in more than colour:
 *
 *   clay     Dawn, Dusk, Midnight. Claymorphism, the same recipe Reveille
 *            uses: four shadows on every surface, two outside for the lift,
 *            two inside for the thickness, light from the top-left.
 *   gold     Night & Gold. Navy with gold hairlines and a soft glow, square-ish
 *            corners, Cinzel for titles.
 *   post     Airmail, Airmail Night. Sharp lines, nearly square corners and a
 *            hard printed shadow on buttons, Barlow Condensed for titles.
 *
 * Every surface goes through raised / sunken / pressed / filled, so a screen
 * never needs to know which family it is drawn in. React Native's `boxShadow`
 * style (RN 0.76+) takes an array of layers, which makes the clay recipe
 * possible on both platforms. Corners go through corner(): a component keeps
 * its clay radius in its styles and the family decides how much of it shows.
 */

const CLAY = { family: "clay", fontDisplay: undefined, labelSpacing: 0.6 };

export const THEMES = {
  dawn: {
    ...CLAY,
    name: "dawn",
    label: "Dawn",
    dark: false,
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
    ...CLAY,
    name: "dusk",
    label: "Dusk",
    dark: true,
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
    ...CLAY,
    name: "midnight",
    label: "Midnight",
    dark: true,
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
  gold: {
    family: "gold",
    fontDisplay: "Cinzel_700Bold",
    labelSpacing: 1.6,
    name: "gold",
    label: "Night & Gold",
    dark: true,
    ground: "#0C1220",
    clayHi: "#151E34",
    clayLo: "#0F1729",
    ink: "#F2E9D6",
    ink2: "#BBAF96",
    ink3: "#7F7866",
    dusk: "#D8B266",
    duskDeep: "#B08A3E",
    moss: "#7FD1B9",
    danger: "#E98A86",
    shadow: "rgba(0,0,0,0.45)",
    shine: "rgba(255,255,255,0.06)",
    line: "rgba(216,178,102,0.30)",
    lineSoft: "rgba(216,178,102,0.16)",
    onFill: "#1A1508",
  },
  airmail: {
    family: "post",
    fontDisplay: "BarlowCondensed_700Bold",
    labelSpacing: 1,
    name: "airmail",
    label: "Airmail",
    dark: false,
    ground: "#E8EDF3",
    clayHi: "#FFFFFF",
    clayLo: "#EEF2F7",
    ink: "#1B2A49",
    ink2: "#4A5A79",
    ink3: "#8592A9",
    dusk: "#C4392D",
    duskDeep: "#9E2A20",
    moss: "#2B7856",
    danger: "#C4392D",
    shadow: "rgba(27,42,73,0.08)",
    shine: "rgba(255,255,255,0.9)",
    line: "#CAD3DF",
    lineSoft: "#CAD3DF",
    hard: "#1B2A49",
    onFill: "#FFFFFF",
  },
  airnight: {
    family: "post",
    fontDisplay: "BarlowCondensed_700Bold",
    labelSpacing: 1,
    name: "airnight",
    label: "Airmail Night",
    dark: true,
    ground: "#131B2C",
    clayHi: "#1C263E",
    clayLo: "#172036",
    ink: "#E9EEF7",
    ink2: "#A9B5CC",
    ink3: "#6E7A93",
    dusk: "#E2584C",
    duskDeep: "#B5392F",
    moss: "#4FB88A",
    danger: "#E2584C",
    shadow: "rgba(0,0,0,0.30)",
    shine: "rgba(255,255,255,0.05)",
    line: "#2E3A56",
    lineSoft: "#2E3A56",
    hard: "#E9EEF7",
    onFill: "#FFFFFF",
  },
};

/** The order they appear in Settings: the clay family first, as in Reveille. */
export const THEME_ORDER = ["dawn", "dusk", "midnight", "gold", "airmail", "airnight"];

/** A surface that sits above the page. */
export function raised(t, scale = 1) {
  if (t.family === "gold") {
    return {
      backgroundColor: t.clayHi,
      borderWidth: 1,
      borderColor: t.line,
      boxShadow: [{ offsetX: 0, offsetY: 8 * scale, blurRadius: 22 * scale, color: t.shadow }],
    };
  }
  if (t.family === "post") {
    return {
      backgroundColor: t.clayHi,
      borderWidth: 1,
      borderColor: t.line,
      boxShadow: [{ offsetX: 0, offsetY: 4 * scale, blurRadius: 10 * scale, color: t.shadow }],
    };
  }
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
  if (t.family === "gold" || t.family === "post") {
    return { backgroundColor: t.clayLo, borderWidth: 1, borderColor: t.lineSoft, boxShadow: [] };
  }
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
  if (t.family === "gold") return { transform: [{ scale: 0.97 }], borderColor: t.dusk };
  if (t.family === "post") return { transform: [{ translateX: 1 }, { translateY: 1 }], boxShadow: [] };
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
  if (t.family === "gold") {
    return {
      backgroundColor: colour,
      borderWidth: 0,
      boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 18, color: "rgba(216,178,102,0.35)" }],
    };
  }
  if (t.family === "post") {
    return { backgroundColor: colour, borderWidth: 0, boxShadow: [{ offsetX: 2, offsetY: 2, blurRadius: 0, color: t.hard }] };
  }
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

/**
 * A component's corner, in this look. Components write their clay radius
 * (the generous one); Night & Gold keeps pills round and trims everything else
 * to at most 10, Airmail makes everything nearly square.
 */
export function corner(t, r) {
  if (t.family === "gold") return r >= 100 ? r : Math.min(r, r >= 16 ? 10 : 6);
  if (t.family === "post") return Math.min(r, 3);
  return r;
}

/** Titles and section labels: the look's display face, if it has one. */
export function display(t) {
  return t.fontDisplay ? { fontFamily: t.fontDisplay, fontWeight: "normal" } : null;
}

export const RADIUS = { blob: 26, card: 24, pill: 999, field: 18, sheet: 30 };
