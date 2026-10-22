import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEMES, corner } from "./clay";

const STORAGE_KEY = "courier.theme";
const DEFAULT_THEME = "dawn";

const ThemeContext = createContext({
  theme: THEMES[DEFAULT_THEME],
  themeName: DEFAULT_THEME,
  setThemeName: () => {},
});

export function ThemeProvider({ children }) {
  const [themeName, setThemeNameState] = useState(DEFAULT_THEME);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && THEMES[saved]) setThemeNameState(saved);
    });
  }, []);

  const setThemeName = useCallback((name) => {
    if (!THEMES[name]) return;
    setThemeNameState(name);
    AsyncStorage.setItem(STORAGE_KEY, name);
  }, []);

  const value = useMemo(
    () => ({ theme: THEMES[themeName], themeName, setThemeName }),
    [themeName, setThemeName]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * A file's styles, rebuilt when the look changes. `make` gets c(r), which
 * turns a clay radius into this look's corner, and the theme itself.
 */
export function useThemedStyles(make) {
  const { theme } = useTheme();
  return useMemo(() => StyleSheet.create(make((r) => corner(theme, r), theme)), [theme, make]);
}
