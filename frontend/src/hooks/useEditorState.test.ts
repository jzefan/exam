import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorState } from './useEditorState'

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
      ],
    },
  ],
}

describe('useEditorState', () => {
  it('initializes with empty selections and expansions', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    expect(result.current.selectedNodeIds.size).toBe(0)
    expect(result.current.expandedNodeIds.size).toBe(0)
  })

  it('builds flat nodeMap from nested model', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    expect(result.current.nodeMap.get('role-1')).toBeDefined()
    expect(result.current.nodeMap.get('dim-1')).toBeDefined()
    expect(result.current.nodeMap.get('skill-1')).toBeDefined()
    expect(result.current.nodeMap.get('kp-1')).toBeDefined()
  })

  it('nodeMap includes correct node metadata', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    const skillNode = result.current.nodeMap.get('skill-1')
    expect(skillNode).toMatchObject({
      id: 'skill-1',
      name: 'Backend Architecture',
      type: 'skill',
      level: 'L4',
    })
  })

  it('toggleExpanded adds/removes node from expandedNodeIds', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    // Expand a node
    act(() => {
      result.current.toggleExpanded('dim-1')
    })

    expect(result.current.expandedNodeIds.has('dim-1')).toBe(true)

    // Collapse it
    act(() => {
      result.current.toggleExpanded('dim-1')
    })

    expect(result.current.expandedNodeIds.has('dim-1')).toBe(false)
  })

  it('toggleSelected adds/removes node from selectedNodeIds', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    // Select a node
    act(() => {
      result.current.toggleSelected('skill-1')
    })

    expect(result.current.selectedNodeIds.has('skill-1')).toBe(true)

    // Deselect it
    act(() => {
      result.current.toggleSelected('skill-1')
    })

    expect(result.current.selectedNodeIds.has('skill-1')).toBe(false)
  })

  it('supports multi-select behavior', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    act(() => {
      result.current.toggleSelected('skill-1')
      result.current.toggleSelected('dim-1')
    })

    expect(result.current.selectedNodeIds.has('skill-1')).toBe(true)
    expect(result.current.selectedNodeIds.has('dim-1')).toBe(true)
    expect(result.current.selectedNodeIds.size).toBe(2)
  })

  it('getSelectedNode returns first selected node info', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    act(() => {
      result.current.toggleSelected('skill-1')
    })

    const selectedNode = result.current.getSelectedNode()
    expect(selectedNode?.id).toBe('skill-1')
    expect(selectedNode?.type).toBe('skill')
  })

  it('getChildNodes returns children of a node', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    // Get skills under Technical Skills dimension
    const children = result.current.getChildNodes('dim-1')
    expect(children.length).toBe(1)
    expect(children[0].id).toBe('skill-1')
  })

  it('getNodesByType returns all nodes of specified type', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    const skills = result.current.getNodesByType('skill')
    expect(skills.length).toBe(1)
    expect(skills[0].id).toBe('skill-1')

    const kps = result.current.getNodesByType('knowledge_point')
    expect(kps.length).toBe(1)
    expect(kps[0].id).toBe('kp-1')
  })

  it('getNodePath returns ancestor chain', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    const path = result.current.getNodePath('kp-1')
    const nodeIds = path.map((n) => n.id)

    expect(nodeIds).toContain('role-1')
    expect(nodeIds).toContain('dim-1')
    expect(nodeIds).toContain('skill-1')
    expect(nodeIds).toContain('kp-1')
  })

  it('clearSelection empties selectedNodeIds', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    act(() => {
      result.current.toggleSelected('skill-1')
      result.current.toggleSelected('dim-1')
    })

    expect(result.current.selectedNodeIds.size).toBe(2)

    act(() => {
      result.current.clearSelection()
    })

    expect(result.current.selectedNodeIds.size).toBe(0)
  })

  it('expandAllAncestors expands all parents of a node', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    expect(result.current.expandedNodeIds.size).toBe(0)

    act(() => {
      result.current.expandAllAncestors('kp-1')
    })

    // All ancestors should be expanded
    expect(result.current.expandedNodeIds.has('role-1')).toBe(true)
    expect(result.current.expandedNodeIds.has('dim-1')).toBe(true)
    expect(result.current.expandedNodeIds.has('skill-1')).toBe(true)
  })

  it('getNodeStats returns counts', () => {
    const { result } = renderHook(() => useEditorState(mockModel))

    const stats = result.current.getNodeStats()
    expect(stats.totalNodes).toBe(4) // role + dim + skill + kp
    expect(stats.dimensions).toBe(1)
    expect(stats.skills).toBe(1)
    expect(stats.knowledgePoints).toBe(1)
  })
})
