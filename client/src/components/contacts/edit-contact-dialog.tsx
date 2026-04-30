import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ContactRecord = {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  persona?: string | null;
  role_type?: string | null;
  preferred_contact_method?: string | null;
  relationship_strength?: string | null;
  is_primary?: boolean | null;
  notes?: string | null;
};

type FormState = {
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  persona: string;
  roleType: string;
  preferredContactMethod: string;
  relationshipStrength: string;
  isPrimary: boolean;
  notes: string;
};

const STRENGTH_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "unknown", label: "Unknown" },
  { value: "weak", label: "Weak" },
  { value: "developing", label: "Developing" },
  { value: "good", label: "Good" },
  { value: "strong", label: "Strong" },
];

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "No preference" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "sms", label: "Text / SMS" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "in_person", label: "In person" },
];

const ROLE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "—" },
  { value: "decision_maker", label: "Decision maker" },
  { value: "champion", label: "Champion" },
  { value: "influencer", label: "Influencer" },
  { value: "user", label: "End user" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "technical", label: "Technical" },
  { value: "finance", label: "Finance" },
  { value: "executive", label: "Executive" },
];

function deriveFromName(name?: string | null): { first: string; last: string } {
  if (!name) return { first: "", last: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function buildInitial(c: ContactRecord | null | undefined): FormState {
  const derived = deriveFromName(c?.name);
  return {
    firstName: c?.first_name ?? derived.first ?? "",
    lastName: c?.last_name ?? derived.last ?? "",
    title: c?.title ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    linkedinUrl: c?.linkedin_url ?? "",
    persona: c?.persona ?? "",
    roleType: c?.role_type ?? "none",
    preferredContactMethod: c?.preferred_contact_method ?? "none",
    relationshipStrength: c?.relationship_strength ?? "unknown",
    isPrimary: !!c?.is_primary,
    notes: c?.notes ?? "",
  };
}

export function EditContactDialog({
  open,
  onOpenChange,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactRecord | null | undefined;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => buildInitial(contact));

  // Keep form in sync if a different contact gets passed in or the dialog re-opens.
  useEffect(() => {
    if (open) setForm(buildInitial(contact));
  }, [open, contact?.id]);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!contact?.id) throw new Error("Missing contact id");
      const first = form.firstName.trim();
      const last = form.lastName.trim();
      const fullName = [first, last].filter(Boolean).join(" ").trim();
      if (!fullName) throw new Error("First or last name is required");

      const body: Record<string, any> = {
        firstName: first || null,
        lastName: last || null,
        name: fullName,
        title: form.title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        linkedinUrl: form.linkedinUrl.trim() || null,
        persona: form.persona.trim() || null,
        roleType: form.roleType === "none" ? null : form.roleType,
        preferredContactMethod:
          form.preferredContactMethod === "none" ? null : form.preferredContactMethod,
        relationshipStrength:
          form.relationshipStrength === "unknown" ? null : form.relationshipStrength,
        isPrimary: form.isPrimary,
        notes: form.notes.trim() || null,
      };
      return await apiRequest("PUT", `/api/contacts/${contact.id}`, body);
    },
    onSuccess: () => {
      toast({ title: "Contact updated" });
      // Invalidate the most common contact-related cache keys.
      if (contact?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id] });
        queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}/profile`] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save changes",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="dialog-edit-contact"
      >
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
          <DialogDescription>
            Update {contact?.name || "this contact"}'s details. Changes save instantly.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-first">First name *</Label>
              <Input
                id="edit-contact-first"
                value={form.firstName}
                onChange={(e) => setField("firstName", e.target.value)}
                data-testid="input-edit-contact-first-name"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-last">Last name</Label>
              <Input
                id="edit-contact-last"
                value={form.lastName}
                onChange={(e) => setField("lastName", e.target.value)}
                data-testid="input-edit-contact-last-name"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-title">Title</Label>
            <Input
              id="edit-contact-title"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="e.g. Marina Manager"
              data-testid="input-edit-contact-title"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-email">Email</Label>
              <Input
                id="edit-contact-email"
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                placeholder="name@example.com"
                data-testid="input-edit-contact-email"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-phone">Phone</Label>
              <Input
                id="edit-contact-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="+1 555 123 4567"
                data-testid="input-edit-contact-phone"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-linkedin">LinkedIn URL</Label>
            <Input
              id="edit-contact-linkedin"
              type="url"
              value={form.linkedinUrl}
              onChange={(e) => setField("linkedinUrl", e.target.value)}
              placeholder="https://linkedin.com/in/…"
              data-testid="input-edit-contact-linkedin"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Role type</Label>
              <Select
                value={form.roleType}
                onValueChange={(v) => setField("roleType", v)}
              >
                <SelectTrigger data-testid="select-edit-contact-role-type">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Preferred contact</Label>
              <Select
                value={form.preferredContactMethod}
                onValueChange={(v) => setField("preferredContactMethod", v)}
              >
                <SelectTrigger data-testid="select-edit-contact-pref-method">
                  <SelectValue placeholder="No preference" />
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Relationship</Label>
              <Select
                value={form.relationshipStrength}
                onValueChange={(v) => setField("relationshipStrength", v)}
              >
                <SelectTrigger data-testid="select-edit-contact-strength">
                  <SelectValue placeholder="Unknown" />
                </SelectTrigger>
                <SelectContent>
                  {STRENGTH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-persona">Persona</Label>
            <Input
              id="edit-contact-persona"
              value={form.persona}
              onChange={(e) => setField("persona", e.target.value)}
              placeholder="e.g. Operations lead, Technical buyer"
              data-testid="input-edit-contact-persona"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="edit-contact-primary"
              checked={form.isPrimary}
              onCheckedChange={(v) => setField("isPrimary", v === true)}
              data-testid="checkbox-edit-contact-primary"
            />
            <Label
              htmlFor="edit-contact-primary"
              className="text-sm font-normal cursor-pointer"
            >
              Primary contact for this account
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-notes">Notes</Label>
            <Textarea
              id="edit-contact-notes"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={4}
              placeholder="Anything useful to remember about this person…"
              data-testid="textarea-edit-contact-notes"
            />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
              data-testid="button-edit-contact-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              data-testid="button-edit-contact-save"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" /> Save changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
