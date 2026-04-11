import type { DataProvider } from "@refinedev/core";
import axios from "axios";

const API_URL = "/api";

const axiosInstance = axios.create();

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const dataProvider: DataProvider = {
  getList: async ({ resource, pagination, sorters, filters }) => {
    const { currentPage = 1, pageSize = 10 } = pagination ?? {};
    const current = currentPage;
    const _start = (current - 1) * pageSize;
    const _end = _start + pageSize;

    const params: Record<string, string | number> = {
      _start,
      _end,
    };

    if (sorters && sorters.length > 0) {
      params._sort = sorters[0].field;
      params._order = sorters[0].order.toUpperCase();
    }

    if (filters) {
      for (const filter of filters) {
        if ("field" in filter && filter.value !== undefined && filter.value !== "") {
          const operator = filter.operator === "contains" ? "like" : filter.operator;
          if (operator === "eq") {
            params[filter.field] = filter.value;
          } else if (operator === "in") {
            // Send comma-separated values for IN operator
            const val = Array.isArray(filter.value) ? filter.value.join(",") : filter.value;
            params[`${filter.field}_in`] = val;
          } else {
            params[`${filter.field}_${operator}`] = filter.value;
          }
        }
      }
    }

    const { data, headers } = await axiosInstance.get(`${API_URL}/${resource}`, { params });
    const total = Number(headers["x-total-count"] ?? data.length);
    const noBankCount = headers["x-no-bank-count"];

    return { data, total, ...(noBankCount != null && { meta: { noBankCount: Number(noBankCount) } }) };
  },

  getOne: async ({ resource, id }) => {
    const { data } = await axiosInstance.get(`${API_URL}/${resource}/${id}`);
    return { data };
  },

  create: async ({ resource, variables }) => {
    const { data } = await axiosInstance.post(`${API_URL}/${resource}`, variables);
    return { data };
  },

  update: async ({ resource, id, variables }) => {
    const method = resource === "exams" ? axiosInstance.patch : axiosInstance.put;
    const { data } = await method(`${API_URL}/${resource}/${id}`, variables);
    return { data };
  },

  deleteOne: async ({ resource, id }) => {
    const { data } = await axiosInstance.delete(`${API_URL}/${resource}/${id}`);
    return { data };
  },

  getApiUrl: () => API_URL,
};
