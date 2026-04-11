import { describe, it, expect } from "vitest"
import { getUserRole } from "./rbac"

describe("getUserRole", () => {
  it("returns role_name from primary_org", () => {
    expect(getUserRole({ primary_org: { role_name: "enterprise_admin" } })).toBe("enterprise_admin")
  })

  it("returns 'student' when primary_org is null", () => {
    expect(getUserRole({ primary_org: null })).toBe("student")
  })

  it("returns 'student' when primary_org is undefined", () => {
    expect(getUserRole({})).toBe("student")
  })

  it("returns platform_admin role", () => {
    expect(getUserRole({ primary_org: { role_name: "platform_admin" } })).toBe("platform_admin")
  })

  it("returns teacher role", () => {
    expect(getUserRole({ primary_org: { role_name: "teacher" } })).toBe("teacher")
  })

  it("returns school_admin role", () => {
    expect(getUserRole({ primary_org: { role_name: "school_admin" } })).toBe("school_admin")
  })
})
