import { useEffect, useState } from "react";
import { CreateContactDialog } from "./create-contact-dialog";
import { queryClient } from "@/lib/queryClient";

type ContactMode = "manual" | "card" | "url";

export function GlobalCreateContact() {
  const [open, setOpen] = useState(false);
  const [initialMode, setInitialMode] = useState<ContactMode>("manual");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const mode = detail.mode as ContactMode | undefined;
      if (mode === "manual" || mode === "card" || mode === "url") {
        setInitialMode(mode);
      } else {
        setInitialMode("manual");
      }
      setOpen(true);
    };
    window.addEventListener("open-create-contact", handler);
    return () => window.removeEventListener("open-create-contact", handler);
  }, []);

  return (
    <CreateContactDialog
      open={open}
      onOpenChange={setOpen}
      accountId={null}
      initialMode={initialMode}
      onCreated={() => {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      }}
    />
  );
}
