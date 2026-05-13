import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101418",
        panel: "#f7f9fb",
        line: "#d8e0e7",
        brand: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;
