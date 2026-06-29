import { cn } from "@/lib/utils";

export const ICP_RECORD_NUMBER = "苏ICP备2026042154号-1";
export const ICP_RECORD_URL = "https://beian.miit.gov.cn/";

type IcpRecordLinkProps = {
  className?: string;
};

export function IcpRecordLink({ className }: IcpRecordLinkProps) {
  return (
    <a
      href={ICP_RECORD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {ICP_RECORD_NUMBER}
    </a>
  );
}
