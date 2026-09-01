import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Orbitron, Rajdhani } from "next/font/google";
import "./globals.css";

// The spec's four families. Loaded through next/font rather than a
// Google Fonts <link>: it self-hosts the files at build time, so the
// static export has no third-party request, no FOUT, and nothing to
// block if fonts.googleapis.com is unreachable.
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "J.A.R.V.I.S.",
  description: "Andrew's personal AI assistant.",
};

// Mode lives in localStorage but is applied as a class on <html>. Read
// before first paint or every serious-mode reload flashes cyan for a
// frame. try/catch because a privacy-locked browser throws on access,
// and a colour preference is never worth a blank page.
const MODE_BOOTSTRAP = `try{if(localStorage.getItem("jarvis_mode")==="serious")document.documentElement.classList.add("serious")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${rajdhani.variable} ${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
