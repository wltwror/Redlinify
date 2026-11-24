function cssRgbVar(name: string) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {
          50: cssRgbVar("--rl-slate-50"),
          100: cssRgbVar("--rl-slate-100"),
          200: cssRgbVar("--rl-slate-200"),
          300: cssRgbVar("--rl-slate-300"),
          400: cssRgbVar("--rl-slate-400"),
          500: cssRgbVar("--rl-slate-500"),
          600: cssRgbVar("--rl-slate-600"),
          700: cssRgbVar("--rl-slate-700"),
          800: cssRgbVar("--rl-slate-800"),
          900: cssRgbVar("--rl-slate-900"),
          950: cssRgbVar("--rl-slate-950"),
        },
        sky: {
          100: cssRgbVar("--rl-sky-100"),
          200: cssRgbVar("--rl-sky-200"),
          300: cssRgbVar("--rl-sky-300"),
          400: cssRgbVar("--rl-sky-400"),
          500: cssRgbVar("--rl-sky-500"),
          950: cssRgbVar("--rl-sky-950"),
        },
        amber: {
          100: cssRgbVar("--rl-amber-100"),
          200: cssRgbVar("--rl-amber-200"),
          300: cssRgbVar("--rl-amber-300"),
          400: cssRgbVar("--rl-amber-400"),
          500: cssRgbVar("--rl-amber-500"),
          950: cssRgbVar("--rl-amber-950"),
        },
        emerald: {
          100: cssRgbVar("--rl-emerald-100"),
          200: cssRgbVar("--rl-emerald-200"),
          300: cssRgbVar("--rl-emerald-300"),
          400: cssRgbVar("--rl-emerald-400"),
          500: cssRgbVar("--rl-emerald-500"),
          950: cssRgbVar("--rl-emerald-950"),
        },
        rose: {
          100: cssRgbVar("--rl-rose-100"),
          200: cssRgbVar("--rl-rose-200"),
          300: cssRgbVar("--rl-rose-300"),
          400: cssRgbVar("--rl-rose-400"),
          500: cssRgbVar("--rl-rose-500"),
          600: cssRgbVar("--rl-rose-600"),
          950: cssRgbVar("--rl-rose-950"),
        },
        violet: {
          200: cssRgbVar("--rl-violet-200"),
          300: cssRgbVar("--rl-violet-300"),
          400: cssRgbVar("--rl-violet-400"),
          500: cssRgbVar("--rl-violet-500"),
          950: cssRgbVar("--rl-violet-950"),
        },
        teal: {
          300: cssRgbVar("--rl-teal-300"),
          500: cssRgbVar("--rl-teal-500"),
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
