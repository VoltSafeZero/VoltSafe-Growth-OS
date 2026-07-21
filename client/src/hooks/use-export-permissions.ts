import { useQuery } from "@tanstack/react-query";

type BootstrapData = {
  authenticated: boolean;
  globalRole?: string;
  permissions?: Record<string, any>;
};

/**
 * Returns whether the current session user is permitted to export data
 * or download attachments.
 *
 * Derives from the /api/session/bootstrap response so there is no extra
 * network request. Admin/master_admin roles always return true regardless
 * of the explicit permission flags.
 */
export function useExportPermissions() {
  const { data } = useQuery<BootstrapData>({ queryKey: ["/api/session/bootstrap"] });

  const globalRole = data?.globalRole ?? "";
  const permissions = data?.permissions ?? {};

  const isAdmin = globalRole === "master_admin" || globalRole === "admin";

  // When the flag is absent (legacy user, migration pending) → allow by default
  const canExport: boolean = isAdmin || permissions["can_export"] !== false;
  const canDownload: boolean = isAdmin || permissions["can_download_attachment"] !== false;
  const canGenerateReport: boolean = isAdmin || permissions["can_generate_report"] !== false;

  return { canExport, canDownload, canGenerateReport, isAdmin };
}
