import type { IUser } from "@/types";

export function getStoredUser(): IUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IUser;
  } catch {
    return null;
  }
}

export function getCurrentRoles(): string[] {
  const user = getStoredUser();
  const roles = new Set<string>();
  if (user?.primary_org?.role_name) roles.add(user.primary_org.role_name);
  for (const org of user?.organizations ?? []) {
    if (org.role_name) roles.add(org.role_name);
  }
  return Array.from(roles);
}

export function getCurrentOrgType(): "school" | "enterprise" | null {
  return getStoredUser()?.primary_org?.org_type ?? null;
}
