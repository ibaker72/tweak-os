"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GrowthCalendarEntry } from "@/types/growth";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<GrowthCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });

  useEffect(() => {
    fetchEntries();
  }, [year, month]);

  async function fetchEntries() {
    try {
      setLoading(true);
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`;
      const res = await fetch(`/api/growth/calendar?start_date=${startDate}&end_date=${endDate}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : data.entries ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  }

  // Build calendar grid
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDayOfMonth).fill(null);

  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  function getEntriesForDay(day: number): GrowthCalendarEntry[] {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return entries.filter((e) => e.scheduled_date === dateStr);
  }

  function getStatusColor(status: string): string {
    if (status === "published") return "bg-emerald-500";
    if (status === "scheduled") return "bg-blue-500";
    return "bg-amber-500";
  }

  const selectedDayNum = selectedDay ? parseInt(selectedDay) : null;
  const selectedEntries = selectedDayNum ? getEntriesForDay(selectedDayNum) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Content Calendar</h1>
        <p className="text-sm text-zinc-400 mt-1">Schedule and track your content publishing</p>
      </div>

      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-zinc-100 min-w-[200px] text-center">{monthName}</h2>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
          Today
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-4">
          {/* Calendar Grid */}
          <div className="lg:col-span-3 rounded-xl border border-zinc-800 overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-zinc-900/80 border-b border-zinc-800">
              {DAYS.map((day) => (
                <div key={day} className="px-2 py-2 text-center text-xs font-medium text-zinc-400">
                  {day}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 border-b border-zinc-800/50 last:border-0">
                {week.map((day, di) => {
                  const dayEntries = day ? getEntriesForDay(day) : [];
                  const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
                  const isSelected = day !== null && String(day) === selectedDay;

                  return (
                    <div
                      key={di}
                      className={cn(
                        "min-h-[80px] p-2 transition-colors",
                        day ? "cursor-pointer hover:bg-zinc-800/50" : "bg-zinc-950/50",
                        isSelected && "bg-zinc-800/70"
                      )}
                      onClick={() => day && setSelectedDay(String(day))}
                    >
                      {day && (
                        <>
                          <span className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                            isToday ? "bg-emerald-500 text-white font-bold" : "text-zinc-400"
                          )}>
                            {day}
                          </span>
                          <div className="mt-1 space-y-1">
                            {dayEntries.slice(0, 3).map((entry) => (
                              <div key={entry.id} className="flex items-center gap-1">
                                <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", getStatusColor(entry.status))} />
                                <span className="text-[10px] text-zinc-400 truncate">{entry.title}</span>
                              </div>
                            ))}
                            {dayEntries.length > 3 && (
                              <span className="text-[10px] text-zinc-500">+{dayEntries.length - 3} more</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Day detail sidebar */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">
                {selectedDayNum
                  ? `${monthName.split(" ")[0]} ${selectedDayNum}`
                  : "Select a day"}
              </h3>
              {selectedDayNum ? (
                selectedEntries.length > 0 ? (
                  <div className="space-y-3">
                    {selectedEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg bg-zinc-800/50 p-3">
                        <p className="text-sm text-zinc-200 font-medium">{entry.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className={cn("h-2 w-2 rounded-full", getStatusColor(entry.status))} />
                          <span className="text-xs text-zinc-400 capitalize">{entry.status}</span>
                        </div>
                        {entry.content_type && (
                          <span className="text-xs text-zinc-500 mt-1 block capitalize">
                            {entry.content_type.replace("_", " ")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No content scheduled</p>
                )
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <CalendarIcon className="h-8 w-8 text-zinc-700 mb-2" />
                  <p className="text-sm text-zinc-500">Click a day to see details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
