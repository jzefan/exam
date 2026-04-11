/** Map user role to their default home route */
export function getHomeRoute(role: string): string {
  if (role === "student") return "/student"
  if (["enterprise_user", "enterprise_admin", "school_admin"].includes(role)) return "/gwmx/job-models"
  return "/dashboard"
}

/** Roles allowed to access student layout routes */
export const STUDENT_ROLES = ["student"]

/** Roles allowed to see teacher/admin features */
export const TEACHER_ROLES = ["teacher", "platform_admin"]

/** Roles allowed to see enterprise/job-model features */
export const ENTERPRISE_ROLES = ["enterprise_user", "enterprise_admin", "school_admin", "platform_admin"]

/** Roles allowed to manage student accounts */
export const STUDENT_MANAGEMENT_ROLES = ["teacher", "school_admin", "platform_admin"]

/** Roles allowed to manage system users */
export const USER_MANAGEMENT_ROLES = ["platform_admin"]

export function canAccessJobModels(role: string): boolean {
  return ENTERPRISE_ROLES.includes(role)
}

export function canManageStudents(role: string): boolean {
  return STUDENT_MANAGEMENT_ROLES.includes(role)
}

export function canManageUsers(role: string): boolean {
  return USER_MANAGEMENT_ROLES.includes(role)
}
