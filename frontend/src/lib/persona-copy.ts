export type UserPersona = "teacher" | "assessor";

export type PersonaCopy = {
  persona: UserPersona;
  person: string;
  personPlural: string;
  group: string;
  allPeople: string;
  unassignedGroup: string;
  unassignedPeople: string;
  management: string;
};

const TEACHER_COPY: PersonaCopy = {
  persona: "teacher",
  person: "学生",
  personPlural: "学生",
  group: "班级",
  allPeople: "全部学生",
  unassignedGroup: "未分班",
  unassignedPeople: "未分班学生",
  management: "学生管理",
};

const ASSESSOR_COPY: PersonaCopy = {
  persona: "assessor",
  person: "考生",
  personPlural: "考生",
  group: "部门",
  allPeople: "全部考生",
  unassignedGroup: "未分部门",
  unassignedPeople: "未分部门考生",
  management: "考生管理",
};

export function resolveUserPersona(persona: string | null | undefined): UserPersona {
  return persona === "assessor" ? "assessor" : "teacher";
}

export function getPersonaCopy(persona: string | null | undefined): PersonaCopy {
  return resolveUserPersona(persona) === "assessor" ? ASSESSOR_COPY : TEACHER_COPY;
}
