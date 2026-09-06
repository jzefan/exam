import { describe, expect, it } from "vitest";

import {
  DEFAULT_CATALOG_IMAGE_MAX_EDGE,
  findCatalogTwoColumnSplit,
  getCatalogRightColumnFocusCropRange,
  hasWideCatalogHeader,
  scaleDimensionsToMaxEdge,
} from "./import-knowledge-photo-utils";

describe("catalog photo import utils", () => {
  it("keeps images unchanged when already within the max edge", () => {
    expect(scaleDimensionsToMaxEdge(1513, 1240)).toEqual({
      width: 1513,
      height: 1240,
      scale: 1,
    });
  });

  it("scales large images down to the configured max edge", () => {
    expect(scaleDimensionsToMaxEdge(4000, 3000)).toEqual({
      width: DEFAULT_CATALOG_IMAGE_MAX_EDGE,
      height: 1536,
      scale: 0.512,
    });
  });

  it("finds the blank gutter of a two-column catalog", () => {
    const inkByColumn = Array.from({ length: 100 }, () => 6);
    inkByColumn.fill(0, 44, 56);

    expect(findCatalogTwoColumnSplit(inkByColumn, 100)).toBe(50);
  });

  it("keeps a single-column catalog as one image", () => {
    expect(findCatalogTwoColumnSplit(Array.from({ length: 100 }, () => 6), 100)).toBeNull();
  });

  it("only uses the deeper crop for a page-wide decorative header", () => {
    expect(hasWideCatalogHeader([...Array(56).fill(1), ...Array(44).fill(0)])).toBe(true);
    expect(hasWideCatalogHeader([...Array(54).fill(1), ...Array(46).fill(0)])).toBe(false);
  });

  it("creates a header-free right-column focus crop without trimming continuation pages", () => {
    expect(getCatalogRightColumnFocusCropRange(2105, 274, true)).toEqual({
      startY: 421,
      height: 674,
    });
    expect(getCatalogRightColumnFocusCropRange(2105, 168, false)).toEqual({
      startY: 168,
      height: 674,
    });
  });
});
