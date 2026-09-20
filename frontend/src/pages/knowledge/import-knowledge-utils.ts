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

/* ------------------------------------------------------------------ *
 * 草稿目录编辑器（尚未导入的目录）
 * 与「我的课程 → 课程详情 → 目录」的编辑页对齐：一棵可展开的知识树 +
 * 右侧「改名 / 新增下级 / 删除」。区别只是这里操作内存里的草稿路径，
 * 所以全部是纯函数，不落库。
 * ------------------------------------------------------------------ */

export const DRAFT_ROOT_DEPTH = -1;
const DRAFT_KEY_SEPARATOR = "\u0000";

/** 草稿目录树的节点。`prefix` 是从根到该节点的完整路径（不含虚拟根）。 */
export type KnowledgeDraftTreeNode = {
  label: string;
  depth: number;
  prefix: string[];
  children: KnowledgeDraftTreeNode[];
};

/** 节点标识来自它的路径（根为空串）——改名后要重新算，否则会找不到节点。 */
export function draftKeyFromPrefix(prefix: string[]): string {
  return prefix.length === 0 ? "" : prefix.join(DRAFT_KEY_SEPARATOR);
}

export function draftNodeKey(node: KnowledgeDraftTreeNode): string {
  return draftKeyFromPrefix(node.prefix);
}

/** 路径是否以 `prefix` 这一段开头（含恰好相等的情况）。 */
function hasPathPrefix(path: KnowledgeImportPath, prefix: string[]): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, index) => path[index] === segment);
}

/** 去掉完全重复的路径（改名 / 新增后可能撞车）。 */
export function dedupeKnowledgeImportPaths(
  paths: KnowledgeImportPath[],
): KnowledgeImportPath[] {
  const seen = new Set<string>();
  const result: KnowledgeImportPath[] = [];

  for (const path of paths) {
    const cleaned = path.map((segment) => segment.trim()).filter(Boolean);
    if (cleaned.length === 0) continue;
    const key = cleaned.join(" > ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

/**
 * 把草稿路径建成一棵以 `rootName` 为根的树 —— 根对应课程本身，
 * 首层路径是这个根的子节点，与目录页的编辑树结构一致。
 */
export function buildKnowledgeDraftTree(
  rootName: string,
  paths: KnowledgeImportPath[],
): KnowledgeDraftTreeNode {
  const root: KnowledgeDraftTreeNode = {
    label: rootName,
    depth: DRAFT_ROOT_DEPTH,
    prefix: [],
    children: [],
  };

  for (const path of paths) {
    let siblings = root.children;
    for (let depth = 0; depth < path.length; depth += 1) {
      const label = path[depth];
      let node = siblings.find((item) => item.label === label);
      if (!node) {
        node = { label, depth, prefix: path.slice(0, depth + 1), children: [] };
        siblings.push(node);
      }
      siblings = node.children;
    }
  }

  return root;
}

export function findKnowledgeDraftNode(
  root: KnowledgeDraftTreeNode,
  key: string,
): KnowledgeDraftTreeNode | null {
  const stack: KnowledgeDraftTreeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as KnowledgeDraftTreeNode;
    if (draftNodeKey(node) === key) return node;
    stack.push(...node.children);
  }
  return null;
}

export function countKnowledgeDraftNodes(node: KnowledgeDraftTreeNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countKnowledgeDraftNodes(child),
    0,
  );
}

/** 重命名某个节点：所有经过该节点的路径在同一层级一起改名。 */
export function renameKnowledgeDraftNode(
  paths: KnowledgeImportPath[],
  prefix: string[],
  nextName: string,
): KnowledgeImportPath[] {
  const name = nextName.trim();
  if (prefix.length === 0 || !name) return paths;

  return dedupeKnowledgeImportPaths(
    paths.map((path) => {
      if (!hasPathPrefix(path, prefix)) return path;
      const next = [...path];
      next[prefix.length - 1] = name;
      return next;
    }),
  );
}

/** 在某个节点下新增子节点；`prefix` 为空数组时即在顶层新增。 */
export function addKnowledgeDraftChildren(
  paths: KnowledgeImportPath[],
  prefix: string[],
  names: string[],
): KnowledgeImportPath[] {
  const additions = names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => [...prefix, name]);

  if (additions.length === 0) return paths;
  return dedupeKnowledgeImportPaths([...paths, ...additions]);
}

/** 删除节点及其全部下级（与「删除知识点」的级联行为一致）。 */
export function removeKnowledgeDraftNode(
  paths: KnowledgeImportPath[],
  prefix: string[],
): KnowledgeImportPath[] {
  if (prefix.length === 0) return paths;
  return paths.filter((path) => !hasPathPrefix(path, prefix));
}
