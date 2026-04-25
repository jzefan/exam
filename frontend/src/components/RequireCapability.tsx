import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { userHasCapability } from "@/lib/capabilities";
import { getCurrentRoles } from "@/lib/current-user";

interface Props {
  capability: string;
  fallbackRoute?: string;
  children: ReactNode;
}

export function RequireCapability({ capability, fallbackRoute = "/", children }: Props) {
  if (!userHasCapability(getCurrentRoles(), capability)) {
    return <Navigate to={fallbackRoute} replace />;
  }
  return <>{children}</>;
}
