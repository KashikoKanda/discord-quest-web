import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { MotionConfigProvider } from "@/components/discord/MotionConfigProvider";
import DevGuard from "@/components/DevGuard";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Discord Quest Auto — Aurora",
  description: "Automate Discord quests with elegance. Run multiple tokens simultaneously with real-time monitoring.",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning className="dark">
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased bg-[#0A0B0E] text-white min-h-[100dvh]`}
        style={{
          fontFamily: "var(--font-sans), 'Inter', system-ui, sans-serif",
        }}
      >
        <DevGuard />
        <MotionConfigProvider>{children}</MotionConfigProvider>
        <Toaster />
      </body>
    </html>
  );
}
