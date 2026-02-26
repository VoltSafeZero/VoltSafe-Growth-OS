import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

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
  const handleExport = () => {
    const link = document.createElement("a");
    link.href = endpoint;
    link.download = filename || "export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} data-testid={testId}>
      <Download className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}
