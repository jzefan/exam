import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PropertiesPanel } from './properties-panel'

const mockModel = {
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

describe('PropertiesPanel', () => {
  it('shows model overview when no node is selected', () => {
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId={null}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
  })

  it('shows dimension properties when dimension is selected', () => {
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="dim-1"
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByDisplayValue('Technical Skills')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Core technical competencies')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument() // Skill count
  })

  it('shows skill properties when skill is selected', () => {
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="skill-1"
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByDisplayValue('Backend Architecture')).toBeInTheDocument()
    expect(screen.getByDisplayValue('System design')).toBeInTheDocument()
    expect(screen.getByDisplayValue('L4')).toBeInTheDocument()
  })

  it('shows knowledge point properties when KP is selected', () => {
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="kp-1"
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByDisplayValue('Microservices Design')).toBeInTheDocument()
    expect(screen.getByDisplayValue('高级')).toBeInTheDocument()
  })

  it('allows editing dimension name', async () => {
    const onSave = vi.fn()
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="dim-1"
        onSave={onSave}
        onDelete={vi.fn()}
      />
    )

    const input = screen.getByDisplayValue('Technical Skills')
    await userEvent.clear(input)
    await userEvent.type(input, 'Advanced Technical Skills')

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'dim-1',
        nodeType: 'dimension',
        changes: expect.objectContaining({
          name: 'Advanced Technical Skills',
        }),
      })
    )
  })

  it('allows changing skill level', async () => {
    const onSave = vi.fn()
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="skill-1"
        onSave={onSave}
        onDelete={vi.fn()}
      />
    )

    const levelSelect = screen.getByDisplayValue('L4')
    fireEvent.change(levelSelect, { target: { value: 'L5' } })

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'skill-1',
        changes: expect.objectContaining({
          level: 'L5',
        }),
      })
    )
  })

  it('allows changing knowledge point difficulty', async () => {
    const onSave = vi.fn()
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="kp-1"
        onSave={onSave}
        onDelete={vi.fn()}
      />
    )

    const difficultySelect = screen.getByDisplayValue('高级')
    fireEvent.change(difficultySelect, { target: { value: '困难' } })

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'kp-1',
        changes: expect.objectContaining({
          difficulty: '困难',
        }),
      })
    )
  })

  it('calls onDelete with correct node info', async () => {
    const onDelete = vi.fn()
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="dim-1"
        onSave={vi.fn()}
        onDelete={onDelete}
      />
    )

    const deleteButton = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteButton)

    // Confirm deletion in alert
    const confirmButton = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmButton)

    expect(onDelete).toHaveBeenCalledWith('dim-1', 'dimension')
  })

  it('displays read-only dates for dimension', () => {
    render(
      <PropertiesPanel
        model={mockModel}
        selectedNodeId="dim-1"
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    // Check that created/updated dates are shown
    expect(screen.getByText(/created/i)).toBeInTheDocument()
    expect(screen.getByText(/updated/i)).toBeInTheDocument()
  })
})
