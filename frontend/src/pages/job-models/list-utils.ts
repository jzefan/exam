type JobModelLike = {
  id: string
  project_id: string
}

export function normalizeJobModelsResponse(payload: unknown): JobModelLike[] {
  if (Array.isArray(payload)) {
    return payload as JobModelLike[]
  }

  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: JobModelLike[] }).data
  }

  return []
}
