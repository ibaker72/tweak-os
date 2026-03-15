"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface ExportButtonProps {
  filters?: Record<string, string>;
  exportType?: string;
}

export function ExportButton({ filters = {}, exportType }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams(filters);
      if (exportType) {
        params.set("export_type", exportType);
      }
      const res = await fetch(`/api/exports?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportType || "leads"}-export-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleExport} disabled={exporting}>
      <Download className="h-4 w-4" />
      {exporting ? "Exporting..." : "Export CSV"}
    </Button>
  );
}
