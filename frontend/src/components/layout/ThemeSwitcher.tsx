import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore, type ThemeMode } from "../../stores/theme-store";

const ICON: Record<ThemeMode, string> = {
  system: "🖥️",
  dark: "🌙",
  light: "☀️",
};

export default function ThemeSwitcher() {
  const { t } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const [open, setOpen] = useState(false);

  function pick(m: ThemeMode) {
    setMode(m);
    setOpen(false);
  }

  const label: Record<ThemeMode, string> = {
    system: t("appShell.themeSystem"),
    dark: t("appShell.themeDark"),
    light: t("appShell.themeLight"),
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("appShell.theme")}
        aria-label={t("appShell.theme")}
        className="text-sm text-muted hover:text-primary px-2 py-1 rounded hover:bg-surface-hover"
      >
        <span className="mr-1">{ICON[mode]}</span>
        <span className="hidden md:inline">{label[mode]}</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-1 w-36 bg-surface border border-default rounded shadow-lg z-50 py-1">
            {(["system", "dark", "light"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pick(m)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover flex items-center gap-2 ${
                  mode === m ? "text-accent" : "text-primary"
                }`}
              >
                <span>{ICON[m]}</span>
                <span>{label[m]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
