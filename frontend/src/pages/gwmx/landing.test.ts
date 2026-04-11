import { describe, it, expect } from "vitest"
import { getHomeRoute } from "@/utils/role-routing"

/**
 * Landing CTA target rule (mirrors logic in landing.tsx):
 * - Not logged in → /login
 * - Logged in → role default home route
 */
function ctaTargetFor(role: string | null): string {
  if (!role) return "/login"
  return getHomeRoute(role)
}

describe("GwmxLanding CTA target", () => {
  it("unauthenticated user goes to /login", () => {
    expect(ctaTargetFor(null)).toBe("/login")
  })

  it("enterprise_admin goes to /gwmx/job-models", () => {
    expect(ctaTargetFor("enterprise_admin")).toBe("/gwmx/job-models")
  })

  it("enterprise_user goes to /gwmx/job-models", () => {
    expect(ctaTargetFor("enterprise_user")).toBe("/gwmx/job-models")
  })

  it("school_admin goes to /gwmx/job-models", () => {
    expect(ctaTargetFor("school_admin")).toBe("/gwmx/job-models")
  })

  it("teacher goes to /dashboard", () => {
    expect(ctaTargetFor("teacher")).toBe("/dashboard")
  })

  it("platform_admin goes to /dashboard", () => {
    expect(ctaTargetFor("platform_admin")).toBe("/dashboard")
  })

  it("student goes to /student", () => {
    expect(ctaTargetFor("student")).toBe("/student")
  })
})
