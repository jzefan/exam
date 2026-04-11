import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useAutoSave } from "./useAutoSave"

const mutateMock = vi.fn()
const toastMock = vi.fn()

vi.mock("@refinedev/core", () => ({
  useUpdate: () => ({
    mutate: mutateMock,
  }),
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}))

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mutateMock.mockReset()
    toastMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("initializes with default state", () => {
    const { result } = renderHook(() => useAutoSave())

    expect(result.current.isSaving).toBe(false)
    expect(result.current.lastSavedAt).toBe(null)
  })

  it("debounces and saves the latest payload", () => {
    const { result } = renderHook(() => useAutoSave(500))

    act(() => {
      result.current.debouncedSave({
        nodeId: "n1",
        resource: "nodes",
        updates: { name: "A" },
      })
      result.current.debouncedSave({
        nodeId: "n1",
        resource: "nodes",
        updates: { name: "B" },
      })
      vi.advanceTimersByTime(500)
    })

    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock).toHaveBeenCalledWith(
      {
        resource: "nodes",
        id: "n1",
        values: { name: "B" },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    )
  })

  it("forceSave flushes pending changes immediately", () => {
    const { result } = renderHook(() => useAutoSave(2000))

    act(() => {
      result.current.debouncedSave({
        nodeId: "n1",
        resource: "nodes",
        updates: { name: "Now" },
      })
      result.current.forceSave()
    })

    expect(mutateMock).toHaveBeenCalledTimes(1)
  })

  it("cancelPending drops queued changes", () => {
    const { result } = renderHook(() => useAutoSave(500))

    act(() => {
      result.current.debouncedSave({
        nodeId: "n1",
        resource: "nodes",
        updates: { name: "Drop me" },
      })
      result.current.cancelPending()
      vi.advanceTimersByTime(500)
    })

    expect(mutateMock).not.toHaveBeenCalled()
  })
})
