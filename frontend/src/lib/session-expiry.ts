import axios, { type AxiosInstance } from "axios";
import { courseWorkspaceEntry, safeCourseReturnTo } from "./course-workspace";

let redirectingToLogin = false;

function isAuthEndpoint(url: string) {
  return url.includes("/api/auth/login");
}

function normalizeUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

export function sessionLoginUrl(pathname: string, search = "") {
  const course = courseWorkspaceEntry(pathname);
  if (!course) return "/login";
  const relativePath = pathname.slice(course.basePath.length) || "/";
  const returnTo = safeCourseReturnTo(
    relativePath === "/login" || relativePath === "/register"
      ? new URLSearchParams(search).get("to")
      : relativePath + search,
  );
  return `${course.basePath}/login?to=${encodeURIComponent(returnTo)}`;
}

export function shouldExpireSession(
  url: string,
  authorization: string | null,
  currentToken: string | null,
) {
  return (
    !isAuthEndpoint(url) &&
    !!currentToken &&
    authorization === `Bearer ${currentToken}`
  );
}

function redirectToLogin() {
  if (redirectingToLogin) {
    return;
  }
  redirectingToLogin = true;
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
  const loginUrl = sessionLoginUrl(
    window.location.pathname,
    window.location.search,
  );
  if (window.location.pathname + window.location.search !== loginUrl) {
    window.location.replace(loginUrl);
    return;
  }
  redirectingToLogin = false;
}

function handleUnauthorized(url: string, authorization: string | null) {
  // Ignore anonymous requests and late responses from a signed-out/switched account.
  if (
    !shouldExpireSession(
      url,
      authorization,
      localStorage.getItem("access_token"),
    )
  ) {
    return;
  }
  redirectToLogin();
}

function attachAxiosUnauthorizedHandler(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.response?.status === 401) {
        handleUnauthorized(
          error.config?.url ?? "",
          String(error.config?.headers?.Authorization ?? ""),
        );
      }
      return Promise.reject(error);
    },
  );
}

export function setupSessionExpiryHandling() {
  attachAxiosUnauthorizedHandler(axios);

  const originalCreate = axios.create.bind(axios);
  axios.create = (...args) => {
    const instance = originalCreate(...args);
    attachAxiosUnauthorizedHandler(instance);
    return instance;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const authorization = headers.get("Authorization");
    const response = await originalFetch(input, init);
    if (response.status === 401) {
      handleUnauthorized(normalizeUrl(input), authorization);
    }
    return response;
  };
}
