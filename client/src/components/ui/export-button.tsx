import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useState } from "react";

export function ExportButton({
  endpoint,
  filename,
  label = "Export CSV",
  testId = "button-export-csv",
}: {
  endpoint: string;
  filename?: string;
  label?: string;
  testId?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "export.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading} data-testid={testId}>
      <Download className="mr-2 h-4 w-4" />
      {loading ? "Downloading…" : label}
    </Button>
  );
}
