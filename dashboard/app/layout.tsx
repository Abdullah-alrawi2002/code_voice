import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Televic Service Desk",
  description: "Voice-assisted technical support intake and engineer triage",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        <nav className="border-b border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-400 text-sm font-black text-slate-950">
                T
              </span>
              <span>
                <span className="block text-sm font-semibold leading-tight tracking-wide">TELEVIC</span>
                <span className="block text-[11px] leading-tight text-slate-400">Service Desk</span>
              </span>
            </Link>
            <div className="flex items-center gap-2 sm:gap-5">
              <Link href="/" className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white">
                Engineer queue
              </Link>
              <Link
                href="/voice"
                className="rounded-lg bg-cyan-400 px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Test voice intake
              </Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
