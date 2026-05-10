export const KNOWLEDGE_RESOURCE_TEXT_STORAGE_KEY = "knowledge_resource_text_v1";
export const KNOWLEDGE_RESOURCE_CONTENT_STORAGE_KEY = "knowledge_resource_content_v1";
export const PERSISTED_RESOURCE_TEXT_LIMIT = 12_000;

export type StoredMaterialContent = {
  sourceText: string;
  images: string[];
};

type PersistedMaterialContent = {
  sourceText: string;
};

export function loadPersistedResourceContent(storage: Storage): Record<string, StoredMaterialContent> {
  const persisted = storage.getItem(KNOWLEDGE_RESOURCE_CONTENT_STORAGE_KEY);
  if (persisted) {
    try {
      const parsed = JSON.parse(persisted) as Record<
        string,
        PersistedMaterialContent | StoredMaterialContent
      >;
      return Object.fromEntries(
        Object.entries(parsed).map(([id, value]) => [
          id,
          {
            sourceText: typeof value?.sourceText === "string" ? value.sourceText : "",
            images: [],
          },
        ]),
      );
    } catch {
      // fall through to legacy text-only store
    }
  }

  const legacy = storage.getItem(KNOWLEDGE_RESOURCE_TEXT_STORAGE_KEY);
  if (!legacy) return {};
  try {
    const textById = JSON.parse(legacy) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(textById).map(([id, sourceText]) => [id, { sourceText, images: [] }]),
    );
  } catch {
    return {};
  }
}

export function buildPersistedResourceContent(
  contentById: Record<string, StoredMaterialContent>,
): Record<string, PersistedMaterialContent> {
  return Object.fromEntries(
    Object.entries(contentById)
      .filter(([, value]) => value.sourceText.trim())
      .map(([id, value]) => [
        id,
        {
          sourceText: value.sourceText.slice(0, PERSISTED_RESOURCE_TEXT_LIMIT),
        },
      ]),
  );
}

export function persistResourceContent(
  storage: Storage,
  contentById: Record<string, StoredMaterialContent>,
): void {
  const compactContent = buildPersistedResourceContent(contentById);
  storage.setItem(KNOWLEDGE_RESOURCE_CONTENT_STORAGE_KEY, JSON.stringify(compactContent));
  const legacyTextOnly = Object.fromEntries(
    Object.entries(compactContent).map(([id, value]) => [id, value.sourceText]),
  );
  storage.setItem(KNOWLEDGE_RESOURCE_TEXT_STORAGE_KEY, JSON.stringify(legacyTextOnly));
}
