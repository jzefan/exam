import type { AccessControlProvider } from "@refinedev/core";

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const userStr = localStorage.getItem("user");
    if (!userStr) {
      return { can: false, reason: "Not authenticated" };
    }
    const user = JSON.parse(userStr);
    const role = user.role;

    // Admin can do everything
    if (role === "admin") {
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

    // Student permissions
    if (role === "student") {
      if (resource === "exams" && (action === "list" || action === "show")) {
        return { can: true };
      }
      return { can: false, reason: "Students have limited access" };
    }

    return { can: true };
  },
};
