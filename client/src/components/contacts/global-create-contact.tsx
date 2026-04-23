import { useEffect, useState } from "react";
import { CreateContactDialog } from "./create-contact-dialog";
import { queryClient } from "@/lib/queryClient";

export function GlobalCreateContact() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-create-contact", handler);
    return () => window.removeEventListener("open-create-contact", handler);
  }, []);

  return (
    <CreateContactDialog
      open={open}
      onOpenChange={setOpen}
      accountId={null}
      onCreated={() => {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      }}
    />
  );
}
