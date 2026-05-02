import { useEffect } from "react"
import { useLocation, useSearchParams } from "react-router-dom"

export type Brand = {
  key: "gwmx" | "default"
  name: string
  fullName: string
  browserTitle: string
}

export const BRANDS: Record<Brand["key"], Brand> = {
  gwmx: { key: "gwmx", name: "工教桥", fullName: "工教桥岗位能力建模平台", browserTitle: "云教桥" },
  default: { key: "default", name: "智评线", fullName: "智评线考试管理平台", browserTitle: "智评线" },
}

const STORAGE_KEY = "brand"

function resolveBrandKey(pathname: string, search: URLSearchParams): Brand["key"] {
  if (pathname.startsWith("/gwmx")) return "gwmx"
  if (search.get("brand") === "gwmx") return "gwmx"
  if (typeof window !== "undefined" && sessionStorage.getItem(STORAGE_KEY) === "gwmx") {
    return "gwmx"
  }
  return "default"
}

export function useBrand(): Brand {
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const key = resolveBrandKey(pathname, searchParams)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (pathname.startsWith("/gwmx")) {
      sessionStorage.setItem(STORAGE_KEY, "gwmx")
    } else if (pathname !== "/login" && pathname !== "/register") {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  }, [pathname])

  return BRANDS[key]
}
