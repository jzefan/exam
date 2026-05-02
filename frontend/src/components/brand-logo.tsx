import { cn } from "@/lib/utils";

export const BRAND_LOGO_SRC = "/brand/icon-256.svg";

type BrandLogoMarkProps = {
  alt?: string;
  className?: string;
  imageClassName?: string;
};

export function BrandLogoMark({
  alt = "",
  className,
  imageClassName,
}: BrandLogoMarkProps) {
  return (
    <span
      className={cn(
        "brand-logo-mark inline-flex shrink-0 overflow-hidden rounded-[22%]",
        className,
      )}
    >
      <img
        src={BRAND_LOGO_SRC}
        alt={alt}
        draggable={false}
        className={cn("h-full w-full object-cover", imageClassName)}
      />
    </span>
  );
}
