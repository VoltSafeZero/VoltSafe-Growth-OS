import infoIconSrc from "@/assets/info-icon-light.png";
import { cn } from "@/lib/utils";

export function InfoIcon({ className, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src={infoIconSrc}
      alt="Info"
      draggable={false}
      className={cn("inline-block shrink-0 object-contain align-middle select-none", className)}
      {...props}
    />
  );
}

export default InfoIcon;
