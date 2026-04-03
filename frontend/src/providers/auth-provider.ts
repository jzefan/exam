import type { AuthProvider } from "@refinedev/core";
import axios from "axios";
import type { ITokenResponse, IUser } from "../types";
import { getUserRole } from "../types/rbac";

const API_URL = "/api";

export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    try {
      const { data } = await axios.post<ITokenResponse>(`${API_URL}/auth/login`, {
        username,
        password,
      });
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      return { success: true, redirectTo: "/" };
    } catch {
      return { success: false, error: { name: "Login Error", message: "Invalid credentials" } };
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
      primary_org: user.primary_org,
      avatar: undefined,
    };
  },

  onError: async (error) => {
    if (error?.statusCode === 401) {
      return { logout: true, redirectTo: "/login" };
    }
    return { error };
  },

  register: async ({ username, email, password, full_name }: Record<string, string>) => {
    try {
      await axios.post(`${API_URL}/auth/register`, {
        username,
        email,
        password,
        full_name,
      });
      return { success: true, redirectTo: "/login" };
    } catch {
      return { success: false, error: { name: "Register Error", message: "Registration failed" } };
    }
  },
};
