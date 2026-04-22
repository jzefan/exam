export interface StudentImportClassOption {
  id: string;
  name: string;
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
  return value.trim().toLowerCase();
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
