/**
 * Theme tokens are CSS variables defined in src/index.css. The class names
 * here expose those tokens to Tailwind so light/dark can swap by flipping
 * data-theme on <html>.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        "surface-2": "var(--bg-surface-2)",
        "surface-hover": "var(--bg-surface-hover)",
        "surface-input": "var(--bg-input)",
        "surface-overlay": "var(--bg-overlay)",
        primary: "var(--text-primary)",
        muted: "var(--text-muted)",
        subtle: "var(--text-subtle)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-strong": "var(--accent-strong)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        "success-soft": "var(--success-soft)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        "danger-hover": "var(--danger-hover)",
        "danger-soft": "var(--danger-soft)",
        info: "var(--info)",
        code: "var(--text-code)",
        "code-bg": "var(--bg-code)",
        "diff-removed-bg": "var(--diff-removed-bg)",
        "diff-removed-fg": "var(--diff-removed-fg)",
        "diff-added-bg": "var(--diff-added-bg)",
        "diff-added-fg": "var(--diff-added-fg)",
      },
      borderColor: {
        DEFAULT: "var(--border-default)",
        default: "var(--border-default)",
        strong: "var(--border-strong)",
        accent: "var(--accent)",
      },
    },
  },
  plugins: [],
};
