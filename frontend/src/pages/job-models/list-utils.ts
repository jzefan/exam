type JobModelLike = {
  id: string
  current_version_id?: string | null
  job_role?: string
  industry_name?: string | null
  direction_name?: string | null
  current_version?: {
    id: string
    version?: number
    version_note?: string | null
    is_current?: boolean
    source_type?: string
  } | null
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
