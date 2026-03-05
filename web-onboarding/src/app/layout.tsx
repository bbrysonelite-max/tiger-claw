import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Tiger Claw | Deploy Your Agent in 60 Seconds",
  description: "Enterprise BYOK Agent Infrastructure. High availability, maximum privacy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased bg-black text-white selection:bg-primary/30 min-h-screen flex flex-col`}>
        {/* Background Grid Accent */}
        <div className="fixed inset-0 z-[-1] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px]">
          <div className="absolute inset-0 bg-black/60 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_80%)]"></div>
        </div>

        {/* Navbar */}
        <header className="fixed top-0 w-full z-50 border-b border-white/5 bg-black/50 backdrop-blur-xl">
          <div className="container mx-auto px-6 h-16 flex items-center justify-between">
            <div className="font-bold text-xl tracking-tight flex items-center gap-2">
              <span className="text-primary text-2xl">⚡️</span> Tiger Claw
            </div>
            <div className="text-sm font-medium text-white/60">
              Enterprise V4.0
            </div>
          </div>
        </header>

        <main className="flex-1 mt-16">{children}</main>
      </body>
    </html>
  );
}
