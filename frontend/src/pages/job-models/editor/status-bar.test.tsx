import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from './status-bar'

describe('StatusBar', () => {
  it('displays node count', () => {
    render(
      <StatusBar
        nodeCount={42}
        version={1}
        lastSavedAt={new Date('2026-04-04T10:00:00Z')}
      />
    )

    expect(screen.getByText(/42 nodes/i)).toBeInTheDocument()
  })

  it('displays version badge', () => {
    render(
      <StatusBar
        nodeCount={10}
        version={3}
        lastSavedAt={new Date('2026-04-04T10:00:00Z')}
      />
    )

    expect(screen.getByText(/v3/)).toBeInTheDocument()
  })

  it('displays last saved time in human readable format', () => {
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000)

    render(
      <StatusBar
        nodeCount={10}
        version={1}
        lastSavedAt={fiveMinutesAgo}
      />
    )

    expect(screen.getByText(/last saved.*ago/i)).toBeInTheDocument()
  })

  it('shows "never" when lastSavedAt is null', () => {
    render(
      <StatusBar
        nodeCount={10}
        version={1}
        lastSavedAt={null}
      />
    )

    expect(screen.getByText(/never/i)).toBeInTheDocument()
  })

  it('has gradient background styling', () => {
    const { container } = render(
      <StatusBar
        nodeCount={10}
        version={1}
        lastSavedAt={new Date('2026-04-04T10:00:00Z')}
      />
    )

    const statusBar = container.firstChild
    expect(statusBar).toHaveClass('from-gray-50', 'to-gray-100')
  })

  it('displays all status information in correct format', () => {
    const lastSaved = new Date('2026-04-04T10:00:00Z')

    render(
      <StatusBar
        nodeCount={25}
        version={2}
        lastSavedAt={lastSaved}
      />
    )

    // Should have node count
    expect(screen.getByText(/25 nodes/)).toBeInTheDocument()

    // Should have version
    expect(screen.getByText(/v2/)).toBeInTheDocument()

    // Should have save time
    const statusText = screen.getByTestId('status-content').textContent
    expect(statusText).toMatch(/nodes.*v\d+.*last saved/i)
  })

  it('uses appropriate Tailwind classes for styling', () => {
    const { container } = render(
      <StatusBar
        nodeCount={10}
        version={1}
        lastSavedAt={new Date()}
      />
    )

    const versionBadge = screen.getByText(/v1/)
    expect(versionBadge).toHaveClass('px-2', 'py-1', 'rounded', 'text-sm')
  })
})
