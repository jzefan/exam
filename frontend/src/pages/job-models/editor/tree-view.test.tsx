import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TreeView } from './tree-view'

const mockJobModel = {
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
          knowledge_points: [
            {
              id: 'kp-1',
              name: 'Microservices Design',
              description: 'Building modular systems',
              difficulty: '高级',
              sort_order: 1,
            },
          ],
        },
      ],
    },
  ],
}

describe('TreeView', () => {
  it('renders job role at root', () => {
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set()}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument()
  })

  it('renders all dimensions under job role', () => {
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set(['role-1'])}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Technical Skills')).toBeInTheDocument()
  })

  it('expands/collapses dimensions on toggle', () => {
    const onToggleExpand = vi.fn()
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set()}
        onToggleExpand={onToggleExpand}
        onSelect={vi.fn()}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const expandButtons = screen.getAllByRole('button', { name: /expand/i })
    fireEvent.click(expandButtons[0])

    expect(onToggleExpand).toHaveBeenCalled()
  })

  it('filters nodes by search text', async () => {
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set(['role-1', 'dim-1', 'skill-1'])}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const searchInput = screen.getByPlaceholderText(/search/i)
    await userEvent.type(searchInput, 'Microservices')

    expect(screen.getByText('Microservices Design')).toBeInTheDocument()
    expect(screen.queryByText('Technical Skills')).not.toBeInTheDocument()
  })

  it('supports multi-select with Ctrl+click', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set(['role-1', 'dim-1', 'skill-1'])}
        onToggleExpand={vi.fn()}
        onSelect={onSelect}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const skillNode = screen.getByText('Backend Architecture')
    fireEvent.click(skillNode, { ctrlKey: true })

    expect(onSelect).toHaveBeenCalledWith('skill-1', true)
  })

  it('displays skill level badges', () => {
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set(['role-1', 'dim-1'])}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('L4')).toBeInTheDocument()
  })

  it('calls onNameChange when node name is edited', async () => {
    const onNameChange = vi.fn()
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set(['role-1', 'dim-1'])}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onNameChange={onNameChange}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const dimName = screen.getByText('Technical Skills')
    fireEvent.doubleClick(dimName)

    const input = screen.getByDisplayValue('Technical Skills')
    await userEvent.clear(input)
    await userEvent.type(input, 'New Technical Skills')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onNameChange).toHaveBeenCalledWith('dim-1', 'New Technical Skills')
  })

  it('displays child count badges', () => {
    render(
      <TreeView
        model={mockJobModel}
        selectedNodeIds={new Set()}
        expandedNodeIds={new Set()}
        onToggleExpand={vi.fn()}
        onSelect={vi.fn()}
        onNameChange={vi.fn()}
        onLevelChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    // Dimension has 1 skill
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
