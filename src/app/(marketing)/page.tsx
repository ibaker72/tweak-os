import Link from "next/link";
import { Search, Zap, BarChart3, ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      {/* Nav */}
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-emerald-500" />
            <span className="text-lg font-bold text-zinc-50">
              Lead Finder
            </span>
          </div>
          <Link
            href="/login"
            className="rounded-md bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-50">
            Find, Enrich & Score
            <br />
            <span className="text-emerald-500">Your Best Leads</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400">
            Import business lists, automatically enrich websites, score leads
            with transparent rules, and generate outreach insights — all in
            one internal tool.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Features */}
          <div className="mt-20 grid gap-8 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left">
              <Search className="h-8 w-8 text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">
                Enrich
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                Crawl business websites to extract emails, phones, socials,
                and contact pages automatically.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left">
              <BarChart3 className="h-8 w-8 text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">
                Score
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                Transparent, rule-based scoring shows exactly why each lead
                ranked the way it did.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left">
              <Zap className="h-8 w-8 text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">
                Outreach
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                Generate pain points, offer angles, and personalized first
                lines for every prospect.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
