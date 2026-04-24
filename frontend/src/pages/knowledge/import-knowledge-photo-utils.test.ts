import { describe, expect, it } from "vitest";

import {
  DEFAULT_CATALOG_IMAGE_MAX_EDGE,
  scaleDimensionsToMaxEdge,
} from "./import-knowledge-photo-utils";

describe("catalog photo import utils", () => {
  it("keeps images unchanged when already within the max edge", () => {
    expect(scaleDimensionsToMaxEdge(1200, 900)).toEqual({
      width: 1200,
      height: 900,
      scale: 1,
    });
  });

  it("scales large images down to the configured max edge", () => {
    expect(scaleDimensionsToMaxEdge(4000, 3000)).toEqual({
      width: DEFAULT_CATALOG_IMAGE_MAX_EDGE,
      height: 960,
      scale: 0.32,
    });
  });
});
