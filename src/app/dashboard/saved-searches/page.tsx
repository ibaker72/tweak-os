"use client";

import { useState, useEffect } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { SavedSearch } from "@/lib/leads/types";
import {
  BookmarkCheck,
  Trash2,
  Play,
  Loader2,
  MapPin,
} from "lucide-react";

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    loadSearches();
  }, []);

  async function loadSearches() {
    try {
      const res = await fetch("/api/saved-searches");
      const data = await res.json();
      setSearches(data.searches || []);
    } catch {
      console.error("Failed to load saved searches");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch("/api/saved-searches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setSearches((prev) => prev.filter((s) => s.id !== id));
    } catch {
      console.error("Failed to delete saved search");
    }
  }

  async function handleRunSearch(search: SavedSearch) {
    setRunningId(search.id);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "google_places",
          keyword: search.query,
          niche: search.industry || "",
          city: search.location?.split(",")[0]?.trim() || "",
          state: search.location?.split(",")[1]?.trim() || "",
          radius: search.radius || 10,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Found ${data.total_found} businesses. Go to Discover to import them.`);
      }
    } catch {
      console.error("Failed to run search");
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="Saved Searches"
        description="Re-run saved search queries to find new leads"
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : searches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookmarkCheck className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400">
              No saved searches yet. Save a search from the Discover page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {searches.map((search) => (
            <Card key={search.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">
                    {search.name}
                  </CardTitle>
                  {search.is_recurring && (
                    <Badge variant="info">Recurring</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm text-zinc-300">{search.query}</p>
                  {search.location && (
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <MapPin className="h-3 w-3" />
                      {search.location}
                      {search.radius && ` (${search.radius} mi)`}
                    </div>
                  )}
                  {search.industry && (
                    <Badge variant="secondary" className="text-xs">
                      {search.industry}
                    </Badge>
                  )}
                </div>

                {search.last_run_at && (
                  <p className="text-xs text-zinc-500">
                    Last run: {formatDate(search.last_run_at)}
                  </p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => handleRunSearch(search)}
                    disabled={runningId === search.id}
                  >
                    {runningId === search.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Run
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(search.id)}
                  >
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
