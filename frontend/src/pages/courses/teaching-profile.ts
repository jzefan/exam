// Shared teaching-profile shape + helpers.
//
// 教学画像（教学阶段/难度偏好/教学目标/补充说明）在「学期」和「出题技能」两处共用
// 同一套字段，可互相复制。组件见 teaching-profile-copy.tsx。

export interface TeachingProfile {
  teaching_stage?: string | null;
  difficulty_preference?: string | null;
  teaching_goal?: string | null;
  note?: string | null;
}

export interface TeachingProfileSource {
  id: string;
  name: string;
  profile: TeachingProfile;
}

/** 画像是否填写了任意一项（用于过滤掉空画像的来源）。 */
export function teachingProfileHasContent(
  profile: TeachingProfile | Record<string, unknown> | null | undefined,
): boolean {
  if (!profile) return false;
  const p = profile as TeachingProfile;
  return Boolean(p.teaching_stage || p.difficulty_preference || p.teaching_goal || p.note);
}
