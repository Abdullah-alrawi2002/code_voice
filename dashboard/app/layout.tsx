import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Case Management Dashboard",
  description: "Customer service case management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <nav className="border-b border-gray-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <a href="/" className="font-semibold text-gray-900">
              Case Management
            </a>
            <div className="flex gap-6">
              <a href="/" className="text-sm text-gray-600 hover:text-gray-900">Cases</a>
              <a href="/voice" className="text-sm text-gray-600 hover:text-gray-900">Talk to Agent</a>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
