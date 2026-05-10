import { describe, expect, it } from "vitest";

import {
  buildPersistedResourceContent,
  KNOWLEDGE_RESOURCE_CONTENT_STORAGE_KEY,
  KNOWLEDGE_RESOURCE_TEXT_STORAGE_KEY,
  loadPersistedResourceContent,
  PERSISTED_RESOURCE_TEXT_LIMIT,
  persistResourceContent,
} from "./resource-content-storage";

describe("resource-content-storage", () => {
  it("drops images and truncates persisted text snapshots", () => {
    const sourceText = "a".repeat(PERSISTED_RESOURCE_TEXT_LIMIT + 50);

    const persisted = buildPersistedResourceContent({
      "material-1": {
        sourceText,
        images: ["data:image/jpeg;base64,abc"],
      },
    });

    expect(persisted).toEqual({
      "material-1": {
        sourceText: "a".repeat(PERSISTED_RESOURCE_TEXT_LIMIT),
      },
    });
  });

  it("loads old persisted content without reviving stored images", () => {
    const storage = window.localStorage;
    storage.setItem(
      KNOWLEDGE_RESOURCE_CONTENT_STORAGE_KEY,
      JSON.stringify({
        "material-1": {
          sourceText: "正文",
          images: ["data:image/jpeg;base64,abc"],
        },
      }),
    );

    expect(loadPersistedResourceContent(storage)).toEqual({
      "material-1": {
        sourceText: "正文",
        images: [],
      },
    });
  });

  it("persists compact content to both storage keys", () => {
    const storage = window.localStorage;
    storage.clear();

    persistResourceContent(storage, {
      "material-1": {
        sourceText: "正文",
        images: ["data:image/jpeg;base64,abc"],
      },
    });

    expect(storage.getItem(KNOWLEDGE_RESOURCE_CONTENT_STORAGE_KEY)).toBe(
      JSON.stringify({ "material-1": { sourceText: "正文" } }),
    );
    expect(storage.getItem(KNOWLEDGE_RESOURCE_TEXT_STORAGE_KEY)).toBe(
      JSON.stringify({ "material-1": "正文" }),
    );
  });
});
