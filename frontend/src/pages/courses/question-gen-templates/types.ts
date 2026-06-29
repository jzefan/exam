// Types for course question-generation skills (出题技能).
// Mirrors backend app/question_gen_templates/schemas.py (internal name kept).

export interface StudentProfile {
  /** 教学阶段：college(大专) / undergraduate(本科) / postgraduate(研究生) / any(不限) */
  teaching_stage?: string | null;
  difficulty_preference?: string | null;
  /** 教学目标：希望学生达到的能力 */
  teaching_goal?: string | null;
  note?: string | null;
}

/** 非题库种子题（导入试卷识别 / 手动添加），带题型，便于覆盖各题型。
 *  与后端 app/question_gen_templates/schemas.py 的 ManualSeed 对应。 */
export interface ManualSeed {
  /** 题型：choice / true_false / fill_in / short_answer / essay / code */
  type?: string | null;
  /** 题干 */
  text: string;
  /** 选择题选项 {"A": "...", "B": "..."} */
  options?: Record<string, string> | null;
  answer?: string | null;
  analysis?: string | null;
  images?: Array<{ image_id?: string; url: string; alt?: string | null }>;
  answerImages?: Array<{ image_id?: string; url: string; alt?: string | null }>;
  answer_images?: Array<{ image_id?: string; url: string; alt?: string | null }>;
}

export interface SeedUsageEntry {
  id: string;
  name: string;
}

/** question_id -> 使用该题作为种子的出题技能列表 */
export type SeedUsageMap = Record<string, SeedUsageEntry[]>;

export interface GenRules {
  type_distribution?: Record<string, number>;
  difficulty_distribution?: Record<string, number>;
  style_rules?: string[];
  avoid_scenarios?: string[];
  default_scope_kp_ids?: string[];
}

export interface TemplateMaterialInput {
  resource_id: string;
  resource_title?: string | null;
  content_hash?: string | null;
  text: string;
  truncated?: boolean;
}

export interface TemplateMaterialResponse {
  id: string;
  resource_id: string;
  resource_title: string | null;
  content_hash: string | null;
  truncated: boolean;
  text_length: number;
  /** Full snapshot text (returned on the single-template detail, for editing). */
  text: string;
}

export interface TemplateSummary {
  id: string;
  course_kp_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  student_profile: StudentProfile | null;
  material_count: number;
  seed_count: number;
  updated_at: string;
}

export interface TemplateDetail {
  id: string;
  course_kp_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  student_profile: StudentProfile | null;
  seed_question_ids: string[];
  manual_seed_questions: ManualSeed[];
  gen_rules: GenRules | null;
  materials: TemplateMaterialResponse[];
  created_at: string;
  updated_at: string;
}

export interface TemplateCreatePayload {
  course_kp_id: string;
  name: string;
  description?: string | null;
  is_default?: boolean;
  student_profile?: StudentProfile | null;
  seed_question_ids?: string[];
  manual_seed_questions?: ManualSeed[];
  gen_rules?: GenRules | null;
  materials?: TemplateMaterialInput[];
}

export type TemplateUpdatePayload = Partial<Omit<TemplateCreatePayload, "course_kp_id">>;

export interface TemplateGenerateOverrides {
  type_distribution?: Record<string, number> | null;
  difficulty?: number | null;
  knowledge_point_ids?: string[] | null;
  extra_prompt?: string;
  model?: string | null;
}

// --- Step 3: generation run records ---
export interface RunSummary {
  id: string;
  template_id: string | null;
  status: string;
  generated_count: number;
  resolved_snapshot: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

// --- Step 2: knowledge-point extraction ---
export interface KnowledgePointCandidate {
  name: string;
  description?: string | null;
}

export interface CreatedKnowledgePoint {
  id: string;
  name: string;
  parent_id: string | null;
}
