import type { AnchorHTMLAttributes } from "react";
import { downloadResource } from "@/lib/resource-url";
import { useToast } from "@/hooks/use-toast";

export function ResourceLink({
  href,
  filename,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { filename: string }) {
  const { toast } = useToast();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (!href) return;
        event.preventDefault();
        void downloadResource(href, filename).catch((error: Error) =>
          toast({ title: error.message, variant: "destructive" }),
        );
      }}
    >
      {children}
    </a>
  );
}
