import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tweak & Build — Lead Finder",
  description: "Internal lead finder and enrichment tool for Tweak & Build Studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
