import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Hamsa — OSINT Intelligence Console",
    template: "%s · Hamsa",
  },
  description:
    "Hamsa is a self-hosted OSINT console for authorized investigations: phone, IP, email, username and public-channel intelligence with a full audit trail.",
  applicationName: "Hamsa",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
