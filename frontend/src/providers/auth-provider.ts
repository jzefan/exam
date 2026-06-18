import type { AuthProvider } from "@refinedev/core";
import axios from "axios";
import { purgeAll as purgeAllDrafts, purgeAllExcept as purgeOtherDrafts } from "../lib/exam-draft";
import { notifyAuthChanged } from "../lib/active-user";
import type { ITokenResponse, IUser } from "../types";
import { getUserRole } from "../types/rbac";

const API_URL = "/api";
export const ONBOARDING_REASON_STORAGE_KEY = "exam_onboarding_reason";

function storeAuthSession(data: ITokenResponse) {
  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem("user", JSON.stringify(data.user));
  if (data.onboarding_reason) {
    localStorage.setItem(ONBOARDING_REASON_STORAGE_KEY, data.onboarding_reason);
  } else {
    localStorage.removeItem(ONBOARDING_REASON_STORAGE_KEY);
  }
  notifyAuthChanged();
  purgeOtherDrafts(data.user.id);
}

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

function getRegisterErrorMessage(error: unknown): string {
  const detail = getResponseDetail(error);
  if (detail === "Username already exists") {
    return "该用户名已存在，请更换后重试";
  }
  if (detail === "Email already exists") {
    return "该邮箱已被注册，请更换邮箱或直接登录";
  }
  return detail ?? "注册失败，请稍后重试";
}

export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    try {
      const { data } = await axios.post<ITokenResponse>(`${API_URL}/auth/login`, {
        username,
        password,
      });
      storeAuthSession(data);
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
    localStorage.removeItem(ONBOARDING_REASON_STORAGE_KEY);
    notifyAuthChanged();
    purgeAllDrafts();
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
      username: user.username,
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
    let accountCreated = false;
    try {
      const normalizedEmail = email?.trim();
      const roleName = persona === "assessor" ? "evaluator" : "teacher";
      await axios.post(`${API_URL}/auth/register`, {
        username,
        email: normalizedEmail ? normalizedEmail : null,
        password,
        full_name,
        role_name: role_name || roleName,
        persona: persona || "teacher",
      });
      accountCreated = true;
      const { data } = await axios.post<ITokenResponse>(`${API_URL}/auth/login`, {
        username,
        password,
      });
      storeAuthSession(data);
      return { success: true, redirectTo: "/" };
    } catch (error) {
      if (accountCreated) {
        return {
          success: false,
          error: { name: "自动登录失败", message: "账号已创建成功，请前往登录页登录" },
        };
      }
      return { success: false, error: { name: "注册失败", message: getRegisterErrorMessage(error) } };
    }
  },
};
