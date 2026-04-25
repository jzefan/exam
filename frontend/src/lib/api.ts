import axios from "axios";

import { getGuestToken } from "@/pages/exam-invite/guest-session";

export const apiClient = axios.create();

apiClient.interceptors.request.use((config) => {
  const guestToken = getGuestToken();
  const regularToken = localStorage.getItem("access_token");
  const token = guestToken && config.url?.includes("/api/student/exams/") ? guestToken : regularToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
