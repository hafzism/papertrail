import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperTrail",
  description: "A maintained application workspace with evidence and approval-safe actions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
