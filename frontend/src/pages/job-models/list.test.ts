import { describe, expect, it } from "vitest";

import { normalizeJobModelsResponse } from "./list-utils";

describe("normalizeJobModelsResponse", () => {
  it("returns the original value when the response is already an array", () => {
    const models = [{ id: "m1", project_id: "p1" }];

    expect(normalizeJobModelsResponse(models)).toEqual(models);
  });

  it("extracts models from a wrapped data payload", () => {
    const models = [{ id: "m1", project_id: "p1" }];

    expect(normalizeJobModelsResponse({ data: models })).toEqual(models);
  });

  it("falls back to an empty array for invalid payloads", () => {
    expect(normalizeJobModelsResponse({ items: [] })).toEqual([]);
    expect(normalizeJobModelsResponse(null)).toEqual([]);
  });
});
