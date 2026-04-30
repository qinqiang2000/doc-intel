import { create } from "zustand";

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "doc-intel.theme";

function readStored(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "dark" || v === "light" || v === "system") return v;
  return "system";
}

function systemPrefers(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemPrefers() : mode;
}

function applyToDom(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
}

const initialMode = readStored();

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  resolved: resolve(initialMode),
  setMode: (m) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, m);
    }
    const r = resolve(m);
    applyToDom(r);
    set({ mode: m, resolved: r });
  },
}));

// Initial DOM apply
applyToDom(resolve(initialMode));

// Listen for system changes when in `system` mode
if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const { mode } = useThemeStore.getState();
    if (mode !== "system") return;
    const r: ResolvedTheme = mq.matches ? "dark" : "light";
    applyToDom(r);
    useThemeStore.setState({ resolved: r });
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else mq.addListener(onChange);
}
