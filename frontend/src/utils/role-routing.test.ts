import { describe, it, expect } from "vitest"
import {
  ENTERPRISE_ROLES,
  STUDENT_ROLES,
  TEACHER_ROLES,
  canAccessJobModels,
  canManageStudents,
  canManageUsers,
  getHomeRoute,
} from "./role-routing"

describe("getHomeRoute", () => {
  it("routes student to /student", () => {
    expect(getHomeRoute("student")).toBe("/student")
  })

  it("routes enterprise_admin to workbench", () => {
    expect(getHomeRoute("enterprise_admin")).toBe("/gwmx/workbench")
  })

  it("routes enterprise_user to workbench", () => {
    expect(getHomeRoute("enterprise_user")).toBe("/gwmx/workbench")
  })

  it("routes school_admin to workbench", () => {
    expect(getHomeRoute("school_admin")).toBe("/gwmx/workbench")
  })

  it("routes teacher to /dashboard", () => {
    expect(getHomeRoute("teacher")).toBe("/dashboard")
  })

  it("routes platform_admin to /dashboard", () => {
    expect(getHomeRoute("platform_admin")).toBe("/dashboard")
  })

  it("routes unknown role to /dashboard", () => {
    expect(getHomeRoute("")).toBe("/dashboard")
    expect(getHomeRoute("unknown")).toBe("/dashboard")
  })
})

describe("role access lists", () => {
  it("student aliases can access student routes", () => {
    expect(STUDENT_ROLES).toContain("student")
    expect(STUDENT_ROLES).toContain("assessee")
    expect(STUDENT_ROLES).not.toContain("enterprise_admin")
    expect(STUDENT_ROLES).not.toContain("teacher")
    expect(STUDENT_ROLES).not.toContain("platform_admin")
  })

  it("teacher and admin can access teaching features", () => {
    expect(TEACHER_ROLES).toContain("teacher")
    expect(TEACHER_ROLES).toContain("evaluator")
    expect(TEACHER_ROLES).toContain("enterprise_admin")
    expect(TEACHER_ROLES).toContain("platform_admin")
    expect(TEACHER_ROLES).not.toContain("student")
  })

  it("enterprise roles and admin can access job models", () => {
    expect(ENTERPRISE_ROLES).toContain("enterprise_user")
    expect(ENTERPRISE_ROLES).toContain("enterprise_admin")
    expect(ENTERPRISE_ROLES).toContain("school_admin")
    expect(ENTERPRISE_ROLES).toContain("platform_admin")
    expect(ENTERPRISE_ROLES).not.toContain("student")
    expect(ENTERPRISE_ROLES).not.toContain("teacher")
  })

  it("uses shared helpers for job-model access", () => {
    expect(canAccessJobModels("enterprise_user")).toBe(true)
    expect(canAccessJobModels("school_admin")).toBe(true)
    expect(canAccessJobModels("platform_admin")).toBe(true)
    expect(canAccessJobModels("teacher")).toBe(false)
  })

  it("uses shared helpers for student management access", () => {
    expect(canManageStudents("teacher")).toBe(true)
    expect(canManageStudents("school_admin")).toBe(true)
    expect(canManageStudents("platform_admin")).toBe(true)
    expect(canManageStudents("enterprise_user")).toBe(false)
  })

  it("uses shared helpers for user management access", () => {
    expect(canManageUsers("platform_admin")).toBe(true)
    expect(canManageUsers("teacher")).toBe(false)
    expect(canManageUsers("school_admin")).toBe(false)
  })
})
