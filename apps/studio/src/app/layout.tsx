import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CMS Studio", template: "%s · CMS Studio" },
  // Belt and braces with the X-Robots-Tag header in next.config.mjs. The studio
  // is an admin surface; the content it manages is canonical elsewhere.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
