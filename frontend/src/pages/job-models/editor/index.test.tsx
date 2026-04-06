import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPage } from './index'

// Mock Refine hooks
vi.mock('@refinedev/core', () => ({
  useShow: vi.fn(() => ({
    queryResult: {
      data: {
        data: {
          id: 'model-1',
          job_role_id: 'role-1',
          job_role: {
            id: 'role-1',
            title: 'Senior Backend Engineer',
            description: 'Builds scalable backend systems',
            industry: 'Technology',
            seniority_level: 'L4',
            created_at: '2026-04-04T00:00:00Z',
            updated_at: '2026-04-04T00:00:00Z',
          },
          version: 1,
          status: 'draft',
          dimensions: [
            {
              id: 'dim-1',
              name: 'Technical Skills',
              description: 'Core technical competencies',
              sort_order: 1,
              skills: [
                {
                  id: 'skill-1',
                  name: 'Backend Architecture',
                  description: 'System design',
                  level: 'L4',
                  sort_order: 1,
                  knowledge_points: [],
                },
              ],
            },
          ],
        },
      },
      isLoading: false,
      error: null,
    },
  })),
  useUpdate: vi.fn(() => ({
    mutate: vi.fn(),
    isLoading: false,
  })),
  useDelete: vi.fn(() => ({
    mutate: vi.fn(),
    isLoading: false,
  })),
}))

describe('EditorPage', () => {
  it('renders editor layout with all main sections', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      // Toolbar
      expect(screen.getByRole('button', { name: /tree view/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /graph view/i })).toBeInTheDocument()

      // Tree panel
      expect(screen.getByTestId('tree-panel')).toBeInTheDocument()

      // Properties panel
      expect(screen.getByTestId('properties-panel')).toBeInTheDocument()

      // Status bar
      expect(screen.getByTestId('status-bar')).toBeInTheDocument()
    })
  })

  it('initializes with tree view active', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      const treeButton = screen.getByRole('button', { name: /tree view/i })
      expect(treeButton).toHaveClass('bg-green-100')
    })
  })

  it('switches between tree and graph views', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      expect(screen.getByTestId('tree-panel')).toBeVisible()
    })

    const graphButton = screen.getByRole('button', { name: /graph view/i })
    fireEvent.click(graphButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /graph view/i })).toHaveClass(
        'bg-green-100'
      )
    })
  })

  it('loads model data on mount', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument()
    })
  })

  it('tracks isDirty state when model changes', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      expect(screen.getByText('Backend Architecture')).toBeInTheDocument()
    })

    // Edit a node name
    const dimName = screen.getByText('Technical Skills')
    fireEvent.doubleClick(dimName)

    const input = screen.getByDisplayValue('Technical Skills')
    await userEvent.clear(input)
    await userEvent.type(input, 'New Skills')

    // Save button should become enabled
    await waitFor(() => {
      const saveButton = screen.getByRole('button', { name: /save/i })
      expect(saveButton).not.toBeDisabled()
    })
  })

  it('expands/collapses nodes in tree view', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      expect(screen.getByText('Technical Skills')).toBeInTheDocument()
    })

    const expandButton = screen.getByRole('button', {
      name: /expand technical skills/i,
    })
    fireEvent.click(expandButton)

    await waitFor(() => {
      expect(screen.getByText('Backend Architecture')).toBeVisible()
    })

    fireEvent.click(expandButton)

    await waitFor(() => {
      expect(screen.queryByText('Backend Architecture')).not.toBeVisible()
    })
  })

  it('selects node and shows in properties panel', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      expect(screen.getByText('Technical Skills')).toBeInTheDocument()
    })

    // Expand to show skill
    const expandButton = screen.getByRole('button', {
      name: /expand technical skills/i,
    })
    fireEvent.click(expandButton)

    // Click on skill
    const skillName = screen.getByText('Backend Architecture')
    fireEvent.click(skillName)

    // Properties panel should show skill details
    await waitFor(() => {
      expect(screen.getByDisplayValue('Backend Architecture')).toBeInTheDocument()
      expect(screen.getByDisplayValue('L4')).toBeInTheDocument()
    })
  })

  it('provides EditorContext to child components', async () => {
    render(<EditorPage />)

    await waitFor(() => {
      // Components should be able to access context
      expect(screen.getByTestId('tree-panel')).toBeInTheDocument()
      expect(screen.getByTestId('graph-panel')).toBeInTheDocument()
    })
  })

  it('uses correct responsive layout classes', () => {
    const { container } = render(<EditorPage />)

    const treePanel = container.querySelector('[data-testid="tree-panel"]')
    expect(treePanel).toHaveClass('hidden', 'lg:flex')
  })

  it('shows Toaster for notifications', () => {
    render(<EditorPage />)

    // Toaster should be rendered (check for toast container)
    expect(screen.getByTestId('toaster')).toBeInTheDocument()
  })
})
