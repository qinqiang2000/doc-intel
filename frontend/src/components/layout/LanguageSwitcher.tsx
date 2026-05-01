import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupportedLang } from "../../i18n";

const LABELS: Record<SupportedLang, string> = {
  zh: "中文",
  en: "English",
};

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);

  const current = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith(
    "zh"
  )
    ? "zh"
    : "en";

  function pick(lang: SupportedLang) {
    void i18n.changeLanguage(lang);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t("appShell.language")}
        aria-label={t("appShell.language")}
        className="text-sm text-[#94a3b8] hover:text-[#e2e8f0] px-2 py-1 rounded hover:bg-[#232736]"
      >
        🌐 <span className="hidden md:inline">{LABELS[current]}</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-1 w-32 bg-[#1a1d27] border border-[#2a2e3d] rounded shadow-lg z-50 py-1">
            {(["zh", "en"] as SupportedLang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => pick(l)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#232736] ${
                  current === l ? "text-[#6366f1]" : "text-[#e2e8f0]"
                }`}
              >
                {LABELS[l]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
