export type OrgType = "enterprise" | "school";

export interface IOrganization {
  id: string;
  name: string;
  type: OrgType;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IPermission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface IRole {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  org_id: string | null;
  permissions: IPermission[];
  created_at: string;
  updated_at: string;
}

export interface IUserOrgInfo {
  org_id: string;
  org_name: string;
  org_type: OrgType;
  role_id: string;
  role_name: string;
  role_display_name: string;
  is_primary: boolean;
}

export function getUserRole(user: { primary_org?: { role_name?: string } | null }): string {
  return user.primary_org?.role_name ?? "student";
}
