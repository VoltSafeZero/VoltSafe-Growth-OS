import { cn } from "@/lib/utils";

export interface InfoIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number | string;
  title?: string;
}

/**
 * Shared "circle-i" info icon. Renders as an inline SVG (not an image asset)
 * so it always tracks `currentColor` — correct in light mode, dark mode, and
 * any accent-color overrides — without shipping a raster asset per theme.
 *
 * Used for both the lucide `Info` icon replacement across pages and the
 * sidebar's field-help "i" indicator (see components/help/field-help.tsx).
 */
export function InfoIcon({ className, size = 16, title, ...props }: InfoIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? "Info"}
      className={cn("inline-block shrink-0 align-middle select-none", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="7.5" r="1.35" fill="currentColor" />
      <rect x="10.7" y="10.6" width="2.6" height="7" rx="1.1" fill="currentColor" />
    </svg>
  );
}

export default InfoIcon;
