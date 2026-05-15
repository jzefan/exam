import type { AuthProvider } from "@refinedev/core";
import axios from "axios";
import type { ITokenResponse, IUser } from "../types";
import { getUserRole } from "../types/rbac";

const API_URL = "/api";

function getResponseDetail(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    return typeof detail === "string" ? detail : undefined;
  }
  return undefined;
}

function getLoginErrorMessage(error: unknown): string {
  const detail = getResponseDetail(error);
  if (detail === "External guests must use invitation links to access exams") {
    return "访客账号请使用邀请链接进入考试";
  }
  if (detail === "Invalid credentials" || detail === undefined) {
    return "用户名或密码错误，请检查后重试";
  }
  return detail;
}

export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    try {
      const { data } = await axios.post<ITokenResponse>(`${API_URL}/auth/login`, {
        username,
        password,
      });
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      const isStudent = data.user.organizations.some(
        (o) => o.role_name === "student" || o.role_name === "assessee",
      );
      if (data.user.must_change_password && isStudent) {
        return { success: true, redirectTo: "/student/force-change-password" };
      }
      return { success: true, redirectTo: "/" };
    } catch (error) {
      return { success: false, error: { name: "登录失败", message: getLoginErrorMessage(error) } };
    }
  },

  logout: async () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      return { authenticated: false, redirectTo: "/login" };
    }
    return { authenticated: true };
  },

  getPermissions: async () => {
    const userStr = localStorage.getItem("user");
    if (!userStr) return null;
    const user: IUser = JSON.parse(userStr);
    return getUserRole(user);
  },

  getIdentity: async () => {
    const userStr = localStorage.getItem("user");
    if (!userStr) return null;
    const user: IUser = JSON.parse(userStr);
    return {
      id: user.id,
      name: user.full_name,
      must_change_password: user.must_change_password,
      persona: user.persona,
      primary_org: user.primary_org,
      organizations: user.organizations,
      avatar: undefined,
    };
  },

  onError: async (error) => {
    if (error?.statusCode === 401) {
      return { logout: true, redirectTo: "/login" };
    }
    return { error };
  },

  register: async ({ username, email, password, full_name, role_name, persona }: Record<string, string>) => {
    try {
      const normalizedEmail = email?.trim();
      await axios.post(`${API_URL}/auth/register`, {
        username,
        email: normalizedEmail ? normalizedEmail : null,
        password,
        full_name,
        role_name: role_name || "student",
        persona: persona || "teacher",
      });
      return { success: true, redirectTo: "/login" };
    } catch {
      return { success: false, error: { name: "Register Error", message: "Registration failed" } };
    }
  },
};
