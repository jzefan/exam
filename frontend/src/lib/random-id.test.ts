import { afterEach, describe, expect, it, vi } from "vitest";

import { createRandomId } from "./random-id";

const originalCrypto = globalThis.crypto;

describe("createRandomId", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    vi.restoreAllMocks();
  });

  it("uses crypto.randomUUID when available", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: vi.fn(() => "native-uuid"),
      },
    });

    expect(createRandomId()).toBe("native-uuid");
  });

  it("falls back when crypto.randomUUID is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1713898800000);

    expect(createRandomId()).toBe("id-lvcr3ds0-4fzzzxjylrx");

    randomSpy.mockRestore();
    nowSpy.mockRestore();
  });
});
