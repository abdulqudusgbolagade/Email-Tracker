import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Grant Mail Tracker",
  description: "Private author outreach workspace for Grant Publishing Co.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
