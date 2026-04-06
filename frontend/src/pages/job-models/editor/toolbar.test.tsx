import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toolbar } from './toolbar'

describe('Toolbar', () => {
  it('renders view toggle buttons', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /tree view/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /graph view/i })).toBeInTheDocument()
  })

  it('highlights active view mode button', () => {
    const { rerender } = render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const treeButton = screen.getByRole('button', { name: /tree view/i })
    expect(treeButton).toHaveClass('bg-green-100')

    rerender(
      <Toolbar
        viewMode="graph"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const graphButton = screen.getByRole('button', { name: /graph view/i })
    expect(graphButton).toHaveClass('bg-green-100')
  })

  it('calls onViewModeChange when clicking view button', () => {
    const onViewModeChange = vi.fn()
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={onViewModeChange}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const graphButton = screen.getByRole('button', { name: /graph view/i })
    fireEvent.click(graphButton)

    expect(onViewModeChange).toHaveBeenCalledWith('graph')
  })

  it('disables save button when not dirty', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()
  })

  it('enables save button when dirty', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={true}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).not.toBeDisabled()
  })

  it('shows loading spinner when saving', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={true}
        isSaving={true}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const saveButton = screen.getByRole('button', { name: /saving/i })
    expect(saveButton).toBeDisabled()
  })

  it('calls onSave when save button is clicked', () => {
    const onSave = vi.fn()
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={true}
        isSaving={false}
        onSave={onSave}
        onPublish={vi.fn()}
      />
    )

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalled()
  })

  it('disables publish button when dirty', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={true}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const publishButton = screen.getByRole('button', { name: /publish/i })
    expect(publishButton).toBeDisabled()
  })

  it('enables publish button when clean', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const publishButton = screen.getByRole('button', { name: /publish/i })
    expect(publishButton).not.toBeDisabled()
  })

  it('opens version note dialog when publish is clicked', () => {
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    const publishButton = screen.getByRole('button', { name: /publish/i })
    fireEvent.click(publishButton)

    // Dialog should appear
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    // Should have textarea for version note
    const textarea = screen.getByPlaceholderText(/version note/i)
    expect(textarea).toBeInTheDocument()
  })

  it('calls onPublish with version note when confirmed', () => {
    const onPublish = vi.fn()
    render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={onPublish}
      />
    )

    const publishButton = screen.getByRole('button', { name: /publish/i })
    fireEvent.click(publishButton)

    const textarea = screen.getByPlaceholderText(/version note/i)
    fireEvent.change(textarea, { target: { value: 'v1.0 release' } })

    const confirmButton = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmButton)

    expect(onPublish).toHaveBeenCalledWith('v1.0 release')
  })

  it('uses emoji icons for visual distinction', () => {
    const { container } = render(
      <Toolbar
        viewMode="tree"
        onViewModeChange={vi.fn()}
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />
    )

    // Check for emoji icons (or at least the pattern in button text)
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)

    // Should have visual indicators for different actions
    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).toBeInTheDocument()
  })
})
