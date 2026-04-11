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
  phone: string;
  student_id: string;
  class_id?: string;
}

function normalizeCellValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export async function parseStudentImportFile(file: File): Promise<ParsedStudentImportRow[]> {
  const XLSX = await import("xlsx");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);

  if (workbook.SheetNames.length === 0) {
    throw new Error("文件中没有可读取的工作表。");
  }

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

  if (rows.length === 0) {
    throw new Error("文件内容为空，请检查模板。");
  }

  const students = rows
    .map((row) => ({
      full_name: normalizeCellValue(row["姓名"] ?? row["name"]),
      phone: normalizeCellValue(row["手机号"] ?? row["phone"]),
      student_id: normalizeCellValue(row["学号"] ?? row["student_id"]),
      class_name: normalizeCellValue(row["班级"] ?? row["class_name"] ?? row["class"]),
    }))
    .filter((item) => item.full_name && item.phone);

  if (students.length === 0) {
    throw new Error("未找到有效数据，请确保至少包含“姓名”和“手机号”列。");
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
    let classId = fallbackClassId;
    const className = row.class_name.trim();

    if (!classId && className) {
      const normalizedClassName = normalizeName(className);
      let classItem = classMap.get(normalizedClassName);

      if (!classItem) {
        classItem = await createClass(className);
        classMap.set(normalizedClassName, classItem);
        nextClasses.push(classItem);
      }

      classId = classItem.id;
    }

    students.push({
      full_name: row.full_name,
      phone: row.phone,
      student_id: row.student_id,
      ...(classId ? { class_id: classId } : {}),
    });
  }

  return { students, classes: nextClasses };
}
