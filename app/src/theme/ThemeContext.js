import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEMES } from "./clay";

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
