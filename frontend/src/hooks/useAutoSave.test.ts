import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAutoSave } from './useAutoSave'

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes with correct default state', () => {
    const mockSave = vi.fn()

    const { result } = renderHook(() => useAutoSave(mockSave))

    expect(result.current.isSaving).toBe(false)
    expect(result.current.lastSavedAt).toBe(null)
  })

  it('debounces save calls for 2 seconds', async () => {
    const mockSave = vi.fn()

    const { result } = renderHook(() => useAutoSave(mockSave))

    // Call debouncedSave multiple times
    act(() => {
      result.current.debouncedSave({ name: 'Test' })
      result.current.debouncedSave({ name: 'Test 2' })
      result.current.debouncedSave({ name: 'Test 3' })
    })

    // Immediately after, save should not have been called
    expect(mockSave).not.toHaveBeenCalled()

    // Advance time by 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // Now save should be called once with the latest data
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave).toHaveBeenCalledWith({ name: 'Test 3' })
  })

  it('calls forceSave immediately without debounce', async () => {
    const mockSave = vi.fn()

    const { result } = renderHook(() => useAutoSave(mockSave))

    act(() => {
      result.current.forceSave({ name: 'Test' })
    })

    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave).toHaveBeenCalledWith({ name: 'Test' })
  })

  it('sets isSaving to true when save is in progress', async () => {
    let resolvePromise: () => void
    const savePromise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })

    const mockSave = vi.fn(() => savePromise)

    const { result } = renderHook(() => useAutoSave(mockSave))

    act(() => {
      result.current.forceSave({ name: 'Test' })
    })

    expect(result.current.isSaving).toBe(true)

    act(() => {
      resolvePromise!()
    })

    await waitFor(() => {
      expect(result.current.isSaving).toBe(false)
    })
  })

  it('updates lastSavedAt after successful save', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useAutoSave(mockSave))

    const beforeSave = new Date()

    act(() => {
      result.current.forceSave({ name: 'Test' })
    })

    await waitFor(() => {
      expect(result.current.lastSavedAt).not.toBe(null)
    })

    expect(result.current.lastSavedAt!.getTime()).toBeGreaterThanOrEqual(
      beforeSave.getTime()
    )
  })

  it('handles save errors gracefully', async () => {
    const mockError = new Error('Save failed')
    const mockSave = vi.fn().mockRejectedValue(mockError)
    const onError = vi.fn()

    const { result } = renderHook(() => useAutoSave(mockSave, { onError }))

    act(() => {
      result.current.forceSave({ name: 'Test' })
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(mockError)
    })

    expect(result.current.isSaving).toBe(false)
  })

  it('cancels pending debounced save on unmount', () => {
    const mockSave = vi.fn()

    const { unmount } = renderHook(() => useAutoSave(mockSave))

    // Trigger debounced save but don't advance time
    // This is implicitly tested by checking save isn't called after unmount
    const { result } = renderHook(() => useAutoSave(mockSave))

    act(() => {
      result.current.debouncedSave({ name: 'Test' })
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // Save should not be called since we unmounted before the timeout
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('allows custom debounce delay', async () => {
    const mockSave = vi.fn()

    const { result } = renderHook(() =>
      useAutoSave(mockSave, { debounceDelay: 500 })
    )

    act(() => {
      result.current.debouncedSave({ name: 'Test' })
    })

    expect(mockSave).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockSave).toHaveBeenCalledTimes(1)
  })

  it('properly queues multiple debounced calls', async () => {
    const mockSave = vi.fn()

    const { result } = renderHook(() => useAutoSave(mockSave))

    // Call 1
    act(() => {
      result.current.debouncedSave({ name: 'Test 1' })
    })

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Call 2 (resets timer)
    act(() => {
      result.current.debouncedSave({ name: 'Test 2' })
    })

    expect(mockSave).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSave).toHaveBeenCalledWith({ name: 'Test 2' })
  })
})
