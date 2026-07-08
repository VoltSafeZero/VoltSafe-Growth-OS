import { useEffect, useState } from "react";
import { SaveUrlToCortexModal } from "./save-url-to-cortex-modal";

export function GlobalSaveUrlToCortex() {
  const [open, setOpen] = useState(false);
  const [initialUrl, setInitialUrl] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setInitialUrl(typeof detail.url === "string" ? detail.url : "");
      setOpen(true);
    };
    window.addEventListener("open-save-url-to-cortex", handler);
    return () => window.removeEventListener("open-save-url-to-cortex", handler);
  }, []);

  return (
    <SaveUrlToCortexModal open={open} onOpenChange={setOpen} initialUrl={initialUrl} />
  );
}
