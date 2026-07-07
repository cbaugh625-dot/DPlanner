import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { DemoBanner, ComplianceDisclaimer } from "@/components/DemoBanner";

export const metadata: Metadata = {
  title: "DPlanner — Student-Athlete Course Planner",
  description:
    "Multi-year, NCAA-eligibility-aware course planning for college student-athletes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <DemoBanner />
        <header className="no-print border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-screen-2xl px-4 py-2.5 flex items-baseline gap-6">
            <Link href="/" className="text-base font-bold text-slate-900">
              DPlanner
              <span className="ml-2 text-xs font-medium text-slate-400">
                Student-Athlete Course Planner
              </span>
            </Link>
            <nav className="ml-auto flex gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">
                Planner
              </Link>
              <Link href="/admin/rulesets" className="hover:text-slate-900">
                Eligibility Rulesets
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="no-print border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-screen-2xl px-4 py-3">
            <ComplianceDisclaimer />
          </div>
        </footer>
      </body>
    </html>
  );
}
