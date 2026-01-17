import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Docker Hub inspired palette
        hub: {
          blue: "#1d63ed",
          "blue-dark": "#0d47a1",
          "blue-light": "#e3f2fd",
          nav: "#1d2939",
          sidebar: "#f8fafc",
          border: "#e2e8f0",
          text: "#1e293b",
          "text-muted": "#64748b",
          success: "#22c55e",
          warning: "#f59e0b",
          danger: "#ef4444",
          bg: "#ffffff",
        },
      },
      fontFamily: {
        sans: ["Open Sans", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["Source Code Pro", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
