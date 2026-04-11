type JobModelLike = {
  id: string
  project_id: string
  job_role?: string
  version?: number
  version_note?: string | null
  is_current?: boolean
  source_type?: string
  created_at?: string
  updated_at?: string
}

export function normalizeJobModelsResponse<T extends JobModelLike = JobModelLike>(
  payload: unknown
): T[] {
  if (Array.isArray(payload)) {
    return payload as T[]
  }

  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: T[] }).data
  }

  return []
}
