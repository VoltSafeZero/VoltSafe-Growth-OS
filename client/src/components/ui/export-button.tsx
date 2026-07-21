import { Button } from "@/components/ui/button";
import { Download, Lock } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export function ExportButton({
  endpoint,
  filename,
  label = "Export CSV",
  testId = "button-export-csv",
  canExport,
}: {
  endpoint: string;
  filename?: string;
  label?: string;
  testId?: string;
  /** When false the button renders as disabled with a lock icon. Omit to render normally. */
  canExport?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const blocked = canExport === false;

  const handleExport = async () => {
    if (blocked) {
      toast({
        title: "Export not permitted",
        description: "You have view-only access. Contact an administrator to request export access.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: "Export not permitted",
          description:
            body.message ??
            "You do not have permission to export this data. Contact an administrator.",
          variant: "destructive",
        });
        return;
      }
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
      toast({ title: "Export failed", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={loading || blocked}
      data-testid={testId}
      title={blocked ? "Export access not granted for your role" : undefined}
    >
      {blocked ? <Lock className="mr-2 h-4 w-4 text-muted-foreground" /> : <Download className="mr-2 h-4 w-4" />}
      {loading ? "Downloading…" : label}
    </Button>
  );
}
