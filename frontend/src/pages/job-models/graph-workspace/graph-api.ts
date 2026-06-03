import type {
  CreateSkillCourseMappingInput,
  JobModelGraphOverview,
  SaveGraphLayoutInput,
  SkillCourseMapping,
} from "./types"

const JSON_HEADERS = { "Content-Type": "application/json" }

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`)
  }
  return (await response.json()) as T
}

export async function fetchGraphOverview(signal?: AbortSignal): Promise<JobModelGraphOverview> {
  const response = await fetch("/api/job-models/graph/overview", {
    headers: authHeaders(),
    signal,
  })
  return readJson<JobModelGraphOverview>(response)
}

export async function createSkillCourseMapping(
  input: CreateSkillCourseMappingInput,
): Promise<SkillCourseMapping> {
  const response = await fetch("/api/job-models/graph/skill-course-mappings", {
    method: "POST",
    headers: { ...JSON_HEADERS, ...authHeaders() },
    body: JSON.stringify(input),
  })
  return readJson<SkillCourseMapping>(response)
}

export async function deleteSkillCourseMapping(mappingId: string): Promise<void> {
  const response = await fetch(`/api/job-models/graph/skill-course-mappings/${mappingId}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
}

export async function saveGraphLayout(
  scopeType: string,
  scopeId: string,
  layout: SaveGraphLayoutInput,
): Promise<void> {
  const response = await fetch(`/api/job-models/graph/layouts/${scopeType}/${scopeId}`, {
    method: "PUT",
    headers: { ...JSON_HEADERS, ...authHeaders() },
    body: JSON.stringify({ layout_json: layout }),
  })
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
}
