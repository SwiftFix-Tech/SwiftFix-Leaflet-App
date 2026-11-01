import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SwiftFix Tech — UK Leaflet Tracker",
  description:
    "UK leaflet distribution map with progress saved locally in your browser.",
  robots: { index: false, follow: false },
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
