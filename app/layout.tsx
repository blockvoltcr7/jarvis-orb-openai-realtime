import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS AI — Realtime Voice Assistant",
  description: "Futuristic holographic AI orb voice assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-display">{children}</body>
    </html>
  );
}
