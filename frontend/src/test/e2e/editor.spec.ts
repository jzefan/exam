import { test, expect } from '@playwright/test'

test.describe('Competency Editor', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to job models page
    await page.goto('/job-models')
    // Assume a model exists with ID 'test-model-1'
    await page.goto('/job-models/test-project/models/test-model-1')
    // Click Edit button to open editor
    await page.click('button:has-text("Edit")')
    await page.waitForURL('**/editor')
  })

  test('loads editor with tree and graph views', async ({ page }) => {
    // Verify toolbar is visible
    expect(await page.isVisible('button:has-text("Tree View")')).toBe(true)
    expect(await page.isVisible('button:has-text("Graph View")')).toBe(true)

    // Verify tree view is visible by default (desktop)
    const treePanel = page.locator('[data-testid="tree-panel"]')
    await expect(treePanel).toBeVisible()

    // Verify graph view is visible
    const graphPanel = page.locator('[data-testid="graph-panel"]')
    await expect(graphPanel).toBeVisible()

    // Verify properties panel
    const propsPanel = page.locator('[data-testid="properties-panel"]')
    await expect(propsPanel).toBeVisible()
  })

  test('expands and collapses tree nodes', async ({ page }) => {
    // Find first expand button
    const expandButton = page.locator('button[aria-label="Expand Technical Skills"]').first()
    await expect(expandButton).toBeVisible()

    // Click to expand
    await expandButton.click()
    await page.waitForTimeout(100)

    // Skills should now be visible
    const skill = page.locator('text=Backend Architecture')
    await expect(skill).toBeVisible()

    // Click to collapse
    await expandButton.click()
    await page.waitForTimeout(100)

    // Skills should be hidden
    await expect(skill).not.toBeVisible()
  })

  test('edits node name inline', async ({ page }) => {
    // Expand tree to show a skill
    await page.click('button[aria-label="Expand Technical Skills"]')
    await page.waitForTimeout(100)

    // Double-click on a skill name to edit
    const skillName = page.locator('text=Backend Architecture').first()
    await skillName.dblclick()

    // Input should appear
    const input = page.locator('input[value="Backend Architecture"]')
    await expect(input).toBeVisible()

    // Clear and type new name
    await input.fill('Advanced Backend Architecture')
    await input.press('Enter')

    // New name should be saved
    await expect(page.locator('text=Advanced Backend Architecture')).toBeVisible()

    // Auto-save should trigger
    const saveStatus = page.locator('[data-testid="save-status"]')
    await expect(saveStatus).toContainText('Saved')
  })

  test('changes skill level via dropdown', async ({ page }) => {
    // Expand tree to show skill
    await page.click('button[aria-label="Expand Technical Skills"]')
    await page.waitForTimeout(100)

    // Click on skill to select it
    await page.click('text=Backend Architecture')

    // Wait for properties panel to update
    await page.waitForSelector('[data-testid="level-dropdown"]')

    // Change level
    const levelSelect = page.locator('[data-testid="level-dropdown"]')
    await levelSelect.selectOption('L5')

    // Save should be enabled
    const saveButton = page.locator('button:has-text("Save")').first()
    await expect(saveButton).toHaveClass(/bg-green/)

    // Click save
    await saveButton.click()

    // Verify save completed
    const saveStatus = page.locator('[data-testid="save-status"]')
    await expect(saveStatus).toContainText('Saved')
  })

  test('auto-saves changes after 2 second debounce', async ({ page }) => {
    // Expand tree
    await page.click('button[aria-label="Expand Technical Skills"]')
    await page.waitForTimeout(100)

    // Edit a node name
    const dimName = page.locator('text=Technical Skills').first()
    await dimName.dblclick()

    const input = page.locator('input[value="Technical Skills"]')
    await input.fill('New Technical Skills')
    await input.press('Enter')

    // Verify isDirty indicator appears
    const dirtyIndicator = page.locator('[data-testid="dirty-indicator"]')
    await expect(dirtyIndicator).toBeVisible()

    // Wait for auto-save (2 seconds)
    await page.waitForTimeout(2500)

    // Verify auto-save completed
    const saveStatus = page.locator('[data-testid="save-status"]')
    await expect(saveStatus).toContainText('Last saved')
  })

  test('switches between tree and graph views', async ({ page }) => {
    // Tree view should be visible
    const treePanel = page.locator('[data-testid="tree-panel"]')
    await expect(treePanel).toBeVisible()

    // Click Graph View button
    const graphViewButton = page.locator('button:has-text("Graph View")')
    await graphViewButton.click()

    // Wait for graph to render
    await page.waitForSelector('[data-testid="graph-panel"] .react-flow__node')

    // Tree panel should be hidden (on desktop, it's not hidden but shows graph)
    // Graph nodes should be visible
    const graphNode = page.locator('text=Technical Skills').filter({
      hasNot: page.locator('[data-testid="tree-panel"]'),
    })
    await expect(graphNode).toBeVisible()

    // Switch back to tree
    const treeViewButton = page.locator('button:has-text("Tree View")')
    await treeViewButton.click()

    // Tree should be visible again
    await expect(treePanel).toBeVisible()
  })

  test('selects nodes in graph view and updates properties panel', async ({ page }) => {
    // Click Graph View button
    await page.click('button:has-text("Graph View")')
    await page.waitForSelector('[data-testid="graph-panel"] .react-flow__node')

    // Click on a skill node in graph
    await page.click('text=Backend Architecture')

    // Properties panel should update
    const nameInput = page.locator('input[value="Backend Architecture"]')
    await expect(nameInput).toBeVisible()

    // Verify level is shown
    const levelBadge = page.locator('[data-testid="level-display"]:has-text("L4")')
    await expect(levelBadge).toBeVisible()
  })

  test('publishes model with version note', async ({ page }) => {
    // Make sure model is clean (no unsaved changes)
    const saveButton = page.locator('button:has-text("Save")').first()
    if (await saveButton.isEnabled()) {
      await saveButton.click()
      await page.waitForTimeout(500)
    }

    // Click Publish button
    const publishButton = page.locator('button:has-text("Publish")')
    await publishButton.click()

    // Version note dialog should appear
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Enter version note
    const textarea = dialog.locator('textarea')
    await textarea.fill('Initial production release')

    // Click confirm
    const confirmButton = dialog.locator('button:has-text("Publish")')
    await confirmButton.click()

    // Verify success notification
    const notification = page.locator('[data-testid="notification"]:has-text("Published")')
    await expect(notification).toBeVisible()

    // Verify status changes to published
    const statusBadge = page.locator('[data-testid="model-status"]')
    await expect(statusBadge).toContainText('published')
  })

  test('displays correct node counts in status bar', async ({ page }) => {
    // Get initial node count
    const statusBar = page.locator('[data-testid="status-bar"]')
    const nodeCountText = await statusBar.textContent()

    // Should show dimensions, skills, and knowledge points
    expect(nodeCountText).toMatch(/nodes/)
    expect(nodeCountText).toMatch(/v\d+/) // Version
  })

  test('maintains expand/collapse state across view switches', async ({ page }) => {
    // Expand Technical Skills in tree
    await page.click('button[aria-label="Expand Technical Skills"]')
    await page.waitForTimeout(100)

    // Verify skills are visible
    await expect(page.locator('text=Backend Architecture')).toBeVisible()

    // Switch to graph view
    await page.click('button:has-text("Graph View")')
    await page.waitForSelector('[data-testid="graph-panel"] .react-flow__node')

    // Switch back to tree
    await page.click('button:has-text("Tree View")')

    // Skills should still be visible (state maintained)
    await expect(page.locator('text=Backend Architecture')).toBeVisible()
  })

  test('searches and filters nodes by name', async ({ page }) => {
    // Find search input
    const searchInput = page.locator('[data-testid="tree-search"]')
    await searchInput.fill('Backend')

    // Only Backend-related items should be visible
    await expect(page.locator('text=Backend Architecture')).toBeVisible()

    // Other skills should be filtered out
    const otherSkill = page.locator('text=Database Design')
    await expect(otherSkill).not.toBeVisible()

    // Clear search
    await searchInput.clear()

    // All skills should be visible again
    await expect(page.locator('text=Backend Architecture')).toBeVisible()
    await expect(page.locator('text=Database Design')).toBeVisible()
  })

  test('deletes a knowledge point', async ({ page }) => {
    // Expand to knowledge point
    await page.click('button[aria-label="Expand Technical Skills"]')
    await page.click('button[aria-label="Expand Backend Architecture"]')
    await page.waitForTimeout(100)

    // Click on knowledge point to select it
    const kpName = page.locator('text=Microservices Design').first()
    await kpName.click()

    // Click delete button in properties panel
    const deleteButton = page.locator('button:has-text("Delete")').nth(1)
    await deleteButton.click()

    // Confirm deletion
    const confirmButton = page.locator('button:has-text("Confirm")')
    await confirmButton.click()

    // Verify it's deleted (auto-saved)
    const saveStatus = page.locator('[data-testid="save-status"]')
    await expect(saveStatus).toContainText('Saved')

    // Knowledge point should no longer be visible
    await expect(page.locator('text=Microservices Design')).not.toBeVisible()
  })

  test('displays version badge in status bar', async ({ page }) => {
    // Status bar should show version
    const versionBadge = page.locator('[data-testid="version-badge"]')
    await expect(versionBadge).toBeVisible()

    // Should show v1 or higher
    const versionText = await versionBadge.textContent()
    expect(versionText).toMatch(/v\d+/)
  })

  test('shows last saved time in status bar', async ({ page }) => {
    // Make a change
    const dimName = page.locator('text=Technical Skills').first()
    await dimName.dblclick()

    const input = page.locator('input[value="Technical Skills"]')
    await input.fill('Updated Technical Skills')
    await input.press('Enter')

    // Wait for auto-save
    await page.waitForTimeout(2500)

    // Status bar should show last saved time
    const statusBar = page.locator('[data-testid="status-bar"]')
    const statusText = await statusBar.textContent()
    expect(statusText).toMatch(/Last saved|just now|moments ago/)
  })
})

test.describe('Editor Responsive Design', () => {
  test('hides tree view on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    // Navigate to editor
    await page.goto('/job-models/test-project/models/test-model-1/editor')
    await page.waitForURL('**/editor')

    // Tree panel should be hidden on mobile
    const treePanel = page.locator('[data-testid="tree-panel"]')
    const isHidden = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tree-panel"]')
      return el ? window.getComputedStyle(el).display === 'none' : false
    })
    expect(isHidden).toBe(true)

    // Graph/Properties should take full width
    const propsPanel = page.locator('[data-testid="properties-panel"]')
    await expect(propsPanel).toBeVisible()
  })

  test('stacks layouts on tablet', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 })

    await page.goto('/job-models/test-project/models/test-model-1/editor')
    await page.waitForURL('**/editor')

    // Both panels should be visible but stacked vertically
    const treePanel = page.locator('[data-testid="tree-panel"]')
    const propsPanel = page.locator('[data-testid="properties-panel"]')

    await expect(treePanel).toBeVisible()
    await expect(propsPanel).toBeVisible()

    // Check they are stacked (one below the other)
    const treeBound = await treePanel.boundingBox()
    const propsBound = await propsPanel.boundingBox()

    if (treeBound && propsBound) {
      // On tablet, tree should be above properties panel
      expect(treeBound.y + treeBound.height).toBeLessThanOrEqual(propsBound.y)
    }
  })
})
