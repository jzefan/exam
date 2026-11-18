export interface StudentImportClassOption {
  id: string;
  name: string;
}

/** A same-school class returned by the pre-import name lookup. */
export interface StudentImportClassMatch extends StudentImportClassOption {
  member_count: number;
  created_by_name?: string | null;
}

export interface StudentImportClassLookup {
  name: string;
  matches: StudentImportClassMatch[];
}

export interface ParsedStudentImportRow {
  full_name: string;
  phone: string;
  student_id: string;
  class_name: string;
}

export interface StudentBatchImportItem {
  full_name: string;
  phone: string | null;
  student_id: string;
  class_id?: string;
}

function normalizeCellValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function getStudentImportAccount(row: Pick<ParsedStudentImportRow, "phone" | "student_id">): string {
  return row.phone.trim() || row.student_id.trim();
}

function normalizeName(value: string): string {
  // Mirrors the backend's school-level class identity: surrounding and doubled
  // whitespace must not make the same class look new.
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeHeader(value: unknown): string {
  return normalizeCellValue(value).replace(/\s+/g, "").toLowerCase();
}

function findColumnIndex(row: unknown[], aliases: string[]): number {
  const normalizedAliases = new Set(aliases.map((item) => normalizeHeader(item)));
  return row.findIndex((cell) => normalizedAliases.has(normalizeHeader(cell)));
}

const nameAliases = ["姓名", "学生姓名", "名称", "full_name", "name"];
const phoneAliases = ["手机号", "手机", "联系电话", "电话", "phone", "mobile"];
const studentIdAliases = ["学号", "学生学号", "student_id", "studentid", "student no", "studentno"];
const classAliases = ["班级", "班级名称", "行政班", "class_name", "class"];

function parseSheetRows(rows: unknown[][]): ParsedStudentImportRow[] {
  const headerRowIndex = rows.findIndex((row) => {
    const nameIndex = findColumnIndex(row, nameAliases);
    const phoneIndex = findColumnIndex(row, phoneAliases);
    const studentIdIndex = findColumnIndex(row, studentIdAliases);
    return nameIndex >= 0 && (phoneIndex >= 0 || studentIdIndex >= 0);
  });

  if (headerRowIndex < 0) {
    return [];
  }

  const header = rows[headerRowIndex];
  const nameIndex = findColumnIndex(header, nameAliases);
  const phoneIndex = findColumnIndex(header, phoneAliases);
  const studentIdIndex = findColumnIndex(header, studentIdAliases);
  const classIndex = findColumnIndex(header, classAliases);

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => {
      const fullName = normalizeCellValue(row[nameIndex]);
      const phone = phoneIndex >= 0 ? normalizeCellValue(row[phoneIndex]) : "";
      const studentId = studentIdIndex >= 0 ? normalizeCellValue(row[studentIdIndex]) : "";

      return {
        full_name: fullName,
        phone,
        student_id: studentId,
        class_name: classIndex >= 0 ? normalizeCellValue(row[classIndex]) : "",
      };
    })
    .filter((item) => item.full_name && (item.phone || item.student_id));
}

export async function parseStudentImportFile(file: File): Promise<ParsedStudentImportRow[]> {
  const XLSX = await import("xlsx");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);

  if (workbook.SheetNames.length === 0) {
    throw new Error("文件中没有可读取的工作表。");
  }

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });

  if (rows.length === 0) {
    throw new Error("文件内容为空，请检查模板。");
  }

  const students = parseSheetRows(rows);

  if (students.length === 0) {
    throw new Error("未找到有效数据，请确保至少包含“姓名”，并提供“手机号”或“学号”。");
  }

  return students;
}

export async function buildStudentBatchImportItems({
  rows,
  classes,
  fallbackClassId,
  createClass,
}: {
  rows: ParsedStudentImportRow[];
  classes: StudentImportClassOption[];
  fallbackClassId?: string;
  createClass: (name: string) => Promise<StudentImportClassOption>;
}): Promise<{
  students: StudentBatchImportItem[];
  classes: StudentImportClassOption[];
}> {
  const classMap = new Map(classes.map((item) => [normalizeName(item.name), item]));
  const nextClasses = [...classes];
  const students: StudentBatchImportItem[] = [];

  for (const row of rows) {
    let classId: string | undefined;
    const className = row.class_name.trim();

    if (className) {
      const normalizedClassName = normalizeName(className);
      let classItem = classMap.get(normalizedClassName);

      if (!classItem) {
        classItem = await createClass(className);
        classMap.set(normalizedClassName, classItem);
        nextClasses.push(classItem);
      }

      classId = classItem.id;
    } else {
      classId = fallbackClassId;
    }

    students.push({
      full_name: row.full_name,
      phone: row.phone.trim() || null,
      student_id: row.student_id,
      ...(classId ? { class_id: classId } : {}),
    });
  }

  return { students, classes: nextClasses };
}

/**
 * Before creating classes for an import, resolve the unknown names against the
 * whole school. Class identity is school-scoped even though the teacher's class
 * list is scoped to their own students, so a same-named class created by a
 * colleague must be reused instead of duplicated. The caller owns the actual
 * confirmation UI; this helper only decides whether a prompt is needed.
 */
export async function prepareStudentImportClasses({
  rows,
  classes,
  lookup,
  confirm,
}: {
  rows: ParsedStudentImportRow[];
  classes: StudentImportClassOption[];
  lookup: (names: string[]) => Promise<StudentImportClassLookup[]>;
  confirm: (message: string) => boolean;
}): Promise<StudentImportClassOption[]> {
  // A name needs the school-wide lookup when the teacher's own list has no
  // match, or has several matches (legacy duplicates) and cannot say which one
  // is the real class.
  const visibleByName = new Map<string, StudentImportClassOption[]>();
  for (const item of classes) {
    const key = normalizeName(item.name);
    visibleByName.set(key, [...(visibleByName.get(key) ?? []), item]);
  }
  const needsResolution = new Map<string, string>();
  for (const row of rows) {
    const className = row.class_name.trim();
    if (!className) continue;
    const normalized = normalizeName(className);
    if ((visibleByName.get(normalized)?.length ?? 0) === 1) continue;
    if (!needsResolution.has(normalized)) {
      needsResolution.set(normalized, className);
    }
  }
  const missingNames = [...needsResolution.values()];
  if (missingNames.length === 0) {
    return classes;
  }

  const lookups = await lookup(missingNames);
  const conflicts = lookups
    .map(({ name, matches }) => ({
      name,
      matches: [...matches].sort((a, b) => b.member_count - a.member_count),
    }))
    .filter((item) => item.matches.length > 0);
  if (conflicts.length === 0) {
    return classes;
  }

  const lines = conflicts.map(({ name, matches }) => {
    const best = matches[0];
    const creator = best.created_by_name ? `，创建人 ${best.created_by_name}` : "";
    const extra = matches.length > 1 ? `，同校共 ${matches.length} 个同名班级` : "";
    return `·「${name}」→ 使用「${best.name}」（${best.member_count} 人${creator}${extra}）`;
  });
  const accepted = confirm(
    `同校已存在同名班级：\n${lines.join("\n")}\n\n是否直接使用已有班级继续导入？` +
      "选择“取消”将中止导入，请先修改表格中的班级名称。",
  );
  if (!accepted) {
    throw new Error("已取消导入：同校班级不能重名，请修改表格中的班级名称后重试。");
  }

  // Drop every visible class sharing the resolved name: `buildStudentBatchImportItems`
  // maps names to the last entry, so the chosen class must be the only one left.
  const resolvedNames = new Set(
    conflicts.map(({ matches }) => normalizeName(matches[0].name)),
  );
  const merged = classes.filter((item) => !resolvedNames.has(normalizeName(item.name)));
  const knownIds = new Set(merged.map((item) => item.id));
  for (const { matches } of conflicts) {
    const best = matches[0];
    if (!knownIds.has(best.id)) {
      knownIds.add(best.id);
      merged.push({ id: best.id, name: best.name });
    }
  }
  return merged;
}
