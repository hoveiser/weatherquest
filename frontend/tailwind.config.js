/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#FF6B35",
        secondary: "#6B46C1",
        bg: "#0A0E27",
        surface: "#1A1F3A",
        "surface-2": "#232a4d",
        ink: "#FFFFFF",
        muted: "#A0AEC0",
        success: "#48BB78",
        danger: "#F56565",
        warning: "#ECC94B",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "8px",
        modal: "12px",
        pill: "9999px",
      },
      boxShadow: {
        glow: "0 0 20px rgba(255,107,53,0.35)",
        "glow-purple": "0 0 24px rgba(107,70,193,0.45)",
        "glow-green": "0 0 24px rgba(72,187,120,0.5)",
        "glow-red": "0 0 24px rgba(245,101,101,0.5)",
        card: "0 8px 30px rgba(0,0,0,0.35)",
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": { "0%": { boxShadow: "0 0 0 0 rgba(255,107,53,0.5)" }, "100%": { boxShadow: "0 0 0 14px rgba(255,107,53,0)" } },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.66,0,0,1) infinite",
      },
    },
  },
  plugins: [],
};
