import type { AuthProvider } from "@refinedev/core";
import axios from "axios";
import { purgeAll as purgeAllDrafts, purgeAllExcept as purgeOtherDrafts } from "../lib/exam-draft";
import { notifyAuthChanged } from "../lib/active-user";
import type { ILoginResponse, IRoleOption, ITokenResponse, IUser } from "../types";
import { getUserRole } from "../types/rbac";

const API_URL = "/api";
export const ONBOARDING_REASON_STORAGE_KEY = "exam_onboarding_reason";

/**
 * Auth failures that are not failures: the password checked out but the account
 * holds several roles, so the login page has to show a second step. Refine's
 * `login()` only reports success/failure, so the pending choice travels beside it
 * instead of inside the response.
 */
export const ROLE_SELECTION_REQUIRED = "role-selection-required";

export type PendingRoleSelection = {
  username: string;
  selectionToken: string;
  roles: IRoleOption[];
};

let pendingRoleSelection: PendingRoleSelection | null = null;

export function getPendingRoleSelection(): PendingRoleSelection | null {
  return pendingRoleSelection;
}

export function clearPendingRoleSelection(): void {
  pendingRoleSelection = null;
}

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

/** Where a freshly authenticated session should land. */
export function getRedirectAfterLogin(data: ITokenResponse): string {
  const isStudent = data.user.organizations.some(
    (o) => o.role_name === "student" || o.role_name === "assessee",
  );
  if (data.user.must_change_password && isStudent) {
    return "/student/force-change-password";
  }
  return "/";
}

/** Second login step: trade the role ticket for a real session. */
export async function loginWithSelectedRole(
  selectionToken: string,
  roleName: string,
): Promise<{ redirectTo: string }> {
  try {
    const { data } = await axios.post<ITokenResponse>(`${API_URL}/auth/login/select-role`, {
      selection_token: selectionToken,
      role_name: roleName,
    });
    storeAuthSession(data);
    clearPendingRoleSelection();
    return { redirectTo: getRedirectAfterLogin(data) };
  } catch (error) {
    clearPendingRoleSelection();
    throw new Error(getLoginErrorMessage(error));
  }
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

export function isRoleSelectionResponse(
  data: ILoginResponse,
): data is Extract<ILoginResponse, { requires_role_selection: true }> {
  return (data as { requires_role_selection?: boolean }).requires_role_selection === true;
}

export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    try {
      const { data } = await axios.post<ILoginResponse>(`${API_URL}/auth/login`, {
        username,
        password,
      });
      if (isRoleSelectionResponse(data)) {
        pendingRoleSelection = {
          username: String(username),
          selectionToken: data.selection_token,
          roles: data.roles,
        };
        return {
          success: false,
          error: {
            name: ROLE_SELECTION_REQUIRED,
            message: "该账号有多个角色，请选择登录身份",
          },
        };
      }
      storeAuthSession(data);
      return { success: true, redirectTo: getRedirectAfterLogin(data) };
    } catch (error) {
      clearPendingRoleSelection();
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
      const { data } = await axios.post<ILoginResponse>(`${API_URL}/auth/login`, {
        username,
        password,
      });
      if (isRoleSelectionResponse(data)) {
        // A brand-new account has a single role, so this only happens when the
        // phone already belonged to a multi-role account.
        return {
          success: false,
          error: {
            name: "需要选择身份",
            message: "该账号有多个角色，请前往登录页选择身份后登录",
          },
        };
      }
      storeAuthSession(data);
      return { success: true, redirectTo: getRedirectAfterLogin(data) };
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
