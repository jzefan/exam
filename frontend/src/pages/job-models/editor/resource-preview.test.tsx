import { render, screen, waitFor } from "@testing-library/react"
import JSZip from "jszip"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ResourcePreview } from "./resource-preview"

const fetchMock = vi.fn()

async function createPptxFixture() {
  const zip = new JSZip()
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp><p:txBody><a:p><a:r><a:t>程序流程控制</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:txBody><a:p><a:r><a:t>if / for / while</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  )
  return zip.generateAsync({ type: "arraybuffer" })
}

describe("ResourcePreview", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  it("previews pptx files client-side instead of routing through preview-html", async () => {
    fetchMock.mockResolvedValue(
      new Response(await createPptxFixture(), {
        status: 200,
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      }),
    )

    render(
      <ResourcePreview
        open
        onOpenChange={vi.fn()}
        resource={{
          id: "resource-1",
          resource_type: "document",
          title: "Ch03 程序流程控制.pptx",
          url: "/api/uploads/files/ch03.pptx",
          file_path: "/uploads/ch03.pptx",
          source: "upload",
        }}
      />,
    )

    expect(await screen.findByText("第 1 页")).toBeInTheDocument()
    expect(screen.getByText("程序流程控制")).toBeInTheDocument()
    expect(screen.getByText("if / for / while")).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/uploads/files/ch03.pptx",
        expect.objectContaining({ headers: expect.any(Object) }),
      )
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("preview-html"),
      expect.anything(),
    )
  })
})
