import { read, utils } from "xlsx";

export type KnowledgeImportPath = string[];

export type KnowledgeImportPreviewNode = {
  label: string;
  depth: number;
  pathIndexes: number[];
  children: KnowledgeImportPreviewNode[];
};

const HEADER_HINT_RE = /(知识点|子知识|目录|章节|章|节|一级|二级|三级|四级|level)/i;
const SINGLE_CELL_SPLIT_RE = /\s*(?:>|＞|\/|／|→|➜|⟶)\s*/;

function normalizeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHeaderRow(row: string[]): boolean {
  const filled = row.filter(Boolean);
  return filled.length > 0 && filled.every((cell) => HEADER_HINT_RE.test(cell));
}

function splitSingleCellPath(cell: string): string[] {
  return cell
    .split(SINGLE_CELL_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("文件读取失败"));
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

export async function extractKnowledgeImportPaths(file: File): Promise<KnowledgeImportPath[]> {
  const workbook = read(await readFileAsArrayBuffer(file), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: "",
  });

  const normalizedRows = rows.map((row) => row.map(normalizeCell));
  const startIndex = normalizedRows[0] && looksLikeHeaderRow(normalizedRows[0]) ? 1 : 0;
  const unique = new Set<string>();
  const paths: KnowledgeImportPath[] = [];

  for (const row of normalizedRows.slice(startIndex)) {
    const filled = row.filter(Boolean);
    if (filled.length === 0) {
      continue;
    }

    const path = filled.length === 1 ? splitSingleCellPath(filled[0]) : filled;
    if (path.length === 0) {
      continue;
    }

    const key = path.join(" > ");
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);
    paths.push(path);
  }

  return paths;
}

export function summarizeKnowledgeImportPaths(paths: KnowledgeImportPath[]) {
  return {
    totalPaths: paths.length,
    maxDepth: paths.reduce((max, path) => Math.max(max, path.length), 0),
    rootCount: new Set(paths.map((path) => path[0])).size,
  };
}

export function getFirstKnowledgeImportRootName(paths: KnowledgeImportPath[]): string | null {
  for (const path of paths) {
    const rootName = path[0]?.trim();
    if (rootName) {
      return rootName;
    }
  }
  return null;
}

export function buildKnowledgeImportPreviewTree(
  paths: KnowledgeImportPath[],
): KnowledgeImportPreviewNode[] {
  const roots: KnowledgeImportPreviewNode[] = [];

  const findOrCreate = (
    siblings: KnowledgeImportPreviewNode[],
    label: string,
    depth: number,
    pathIndex: number,
  ) => {
    let node = siblings.find((item) => item.label === label);
    if (!node) {
      node = { label, depth, pathIndexes: [], children: [] };
      siblings.push(node);
    }
    node.pathIndexes.push(pathIndex);
    return node;
  };

  paths.forEach((path, pathIndex) => {
    let siblings = roots;
    path.forEach((label, depth) => {
      const node = findOrCreate(siblings, label, depth, pathIndex);
      siblings = node.children;
    });
  });

  return roots;
}
