import Link from "next/link";
import { Search, Zap, BarChart3, ArrowRight, MapPin, Globe } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      {/* Nav */}
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a
            href="https://tweakandbuild.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
              <Zap className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <span className="text-lg font-bold text-zinc-50">
                Tweak & Build
              </span>
              <span className="ml-2 text-sm text-zinc-500">Lead Finder</span>
            </div>
          </a>
          <Link
            href="/login"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-50">
            Find, Enrich & Close
            <br />
            <span className="text-emerald-500">Your Best Prospects</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400">
            Discover businesses via Google Places, crawl their websites for tech
            stack and contact info, score them for fit, and generate personalized
            outreach — all from one dashboard.
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
              <MapPin className="h-8 w-8 text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">
                Discover
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                Search Google Places by industry + location to find businesses,
                complete with ratings, reviews, and contact info.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left">
              <Globe className="h-8 w-8 text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">
                Enrich & Score
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                Crawl websites to detect tech stack, mobile responsiveness, SSL,
                and more. Score leads 0-100 based on fit for Tweak & Build.
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-left">
              <Zap className="h-8 w-8 text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">
                AI Outreach
              </h3>
              <p className="mt-2 text-sm text-zinc-400">
                Generate personalized cold emails, LinkedIn DMs, and follow-ups
                powered by GPT-4o-mini with specific pain points and offers.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-4 text-center">
        <p className="text-xs text-zinc-600">
          Internal Tool — Tweak & Build Studio {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
