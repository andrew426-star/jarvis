import type { Metadata } from "next";
import { JetBrains_Mono, Orbitron, Rajdhani } from "next/font/google";
import "./globals.css";

// Orbitron carries every label, readout and heading - the squared,
// wide-tracked face the HUD is built around. Rajdhani is the running
// text: condensed and technical, but far more readable at body size
// than Orbitron ever is.
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono-hud",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "J.A.R.V.I.S.",
  description: "Andrew's personal AI assistant.",
};

// Mode lives in localStorage, but the palette is applied by a
// [data-mode] attribute on <html>. Read here, before first paint, or
// every serious-mode reload flashes cyan for a frame first. Wrapped in
// try/catch because a privacy-locked browser throws on localStorage
// access, and a theme preference is never worth a blank page.
const MODE_BOOTSTRAP = `try{var m=localStorage.getItem("jarvis_mode");if(m==="serious")document.documentElement.setAttribute("data-mode","serious")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${rajdhani.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_BOOTSTRAP }} />
      </head>
      <body className="noise-overlay min-h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}
