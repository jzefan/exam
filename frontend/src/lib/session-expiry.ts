import axios, { type AxiosInstance } from "axios";

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

function redirectToLogin() {
  if (redirectingToLogin) {
    return;
  }
  redirectingToLogin = true;
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
  if (window.location.pathname !== "/login") {
    window.location.replace("/login");
    return;
  }
  redirectingToLogin = false;
}

function handleUnauthorized(url: string) {
  if (isAuthEndpoint(url)) {
    return;
  }
  redirectToLogin();
}

function attachAxiosUnauthorizedHandler(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (response) => {
      if (response.status === 401) {
        handleUnauthorized(response.config.url ?? "");
      }
      return response;
    },
    (error) => {
      if (error?.response?.status === 401) {
        handleUnauthorized(error.config?.url ?? "");
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
    const response = await originalFetch(input, init);
    if (response.status === 401) {
      handleUnauthorized(normalizeUrl(input));
    }
    return response;
  };
}
