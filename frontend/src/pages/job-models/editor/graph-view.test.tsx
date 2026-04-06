import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GraphView } from './graph-view'

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
        {
          id: 'skill-2',
          name: 'Database Design',
          description: 'Data modeling',
          level: 'L3',
          sort_order: 2,
          knowledge_points: [],
        },
      ],
    },
    {
      id: 'dim-2',
      name: 'Soft Skills',
      description: 'People and communication',
      sort_order: 2,
      skills: [
        {
          id: 'skill-3',
          name: 'Team Leadership',
          description: 'Leading teams',
          level: 'L4',
          sort_order: 1,
          knowledge_points: [],
        },
      ],
    },
  ],
}

describe('GraphView', () => {
  it('renders job role node at top', () => {
    render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    expect(screen.getByText('Senior Backend Engineer')).toBeInTheDocument()
  })

  it('renders all dimensions', () => {
    render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    expect(screen.getByText('Technical Skills')).toBeInTheDocument()
    expect(screen.getByText('Soft Skills')).toBeInTheDocument()
  })

  it('renders all skills under dimensions', () => {
    render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    expect(screen.getByText('Backend Architecture')).toBeInTheDocument()
    expect(screen.getByText('Database Design')).toBeInTheDocument()
    expect(screen.getByText('Team Leadership')).toBeInTheDocument()
  })

  it('renders knowledge points under skills', () => {
    render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    expect(screen.getByText('Microservices Design')).toBeInTheDocument()
  })

  it('calls onSelectNode when clicking a node', () => {
    const onSelectNode = vi.fn()
    render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />
    )

    const dimensionNode = screen.getByText('Technical Skills')
    fireEvent.click(dimensionNode)

    expect(onSelectNode).toHaveBeenCalledWith('dim-1')
  })

  it('highlights selected node', () => {
    const { container } = render(
      <GraphView
        model={mockModel}
        selectedNodeId="skill-1"
        onSelectNode={vi.fn()}
      />
    )

    // Selected nodes should have visual distinction (border or different background)
    const selectedNode = container.querySelector('[data-node-id="skill-1"]')
    expect(selectedNode).toHaveClass('selected', 'ring-2')
  })

  it('displays correct level colors on nodes', () => {
    const { container } = render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    // L4 nodes should have darker color
    const l4Node = container.querySelector('[data-level="L4"]')
    expect(l4Node).toHaveClass('bg-red-500')

    // L3 nodes should have medium color
    const l3Node = container.querySelector('[data-level="L3"]')
    expect(l3Node).toHaveClass('bg-orange-500')
  })

  it('supports zoom and pan interactions', () => {
    const { container } = render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    // Check for ReactFlow controls
    const controls = container.querySelector('[class*="react-flow__controls"]')
    expect(controls).toBeInTheDocument()

    // Zoom in button should be clickable
    const zoomInButton = screen.getByRole('button', { name: /zoom in/i })
    expect(zoomInButton).toBeInTheDocument()
  })

  it('shows count of children in dimension nodes', () => {
    render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    // Technical Skills has 2 skills
    expect(screen.getByText('2 skills')).toBeInTheDocument()
    // Soft Skills has 1 skill
    expect(screen.getByText('1 skill')).toBeInTheDocument()
  })

  it('renders edges between hierarchy levels', () => {
    const { container } = render(
      <GraphView
        model={mockModel}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    )

    // Check for SVG edges (ReactFlow renders edges as SVG paths)
    const edges = container.querySelectorAll('[class*="react-flow__edges"]')
    expect(edges.length).toBeGreaterThan(0)
  })
})
