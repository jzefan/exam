import type { AccessControlProvider } from "@refinedev/core";
import { getUserRole } from "../types/rbac";

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const userStr = localStorage.getItem("user");
    if (!userStr) {
      return { can: false, reason: "Not authenticated" };
    }
    const user = JSON.parse(userStr);
    const role = getUserRole(user);

    // Platform admin and enterprise admin can do everything
    if (role === "platform_admin" || role === "enterprise_admin" || role === "school_admin") {
      return { can: true };
    }

    // Teacher permissions
    if (role === "teacher") {
      const teacherResources = ["questions", "exams", "grading", "knowledge"];
      if (teacherResources.includes(resource ?? "")) {
        return { can: true };
      }
      // Teachers cannot manage users
      if (resource === "users") {
        return { can: false, reason: "Teachers cannot manage users" };
      }
    }

    // Student / enterprise_user permissions
    if (role === "student" || role === "enterprise_user") {
      if (resource === "exams" && (action === "list" || action === "show")) {
        return { can: true };
      }
      return { can: false, reason: "Students have limited access" };
    }

    return { can: true };
  },
};
