/** Only attach credentials to our upload API, never to third-party resources. */
export function isProtectedResourceUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith("/api/uploads/files/")
    );
  } catch {
    return false;
  }
}

export async function fetchResourceBlob(url: string, signal?: AbortSignal) {
  const token = localStorage.getItem("access_token");
  const response = await fetch(url, {
    signal,
    headers:
      token && isProtectedResourceUrl(url)
        ? { Authorization: `Bearer ${token}` }
        : {},
  });
  if (!response.ok)
    throw new Error(
      response.status === 404 || response.status === 403
        ? "资料不存在或无权访问"
        : "资料加载失败，请重试",
    );
  return response.blob();
}

export async function downloadResource(url: string, filename: string) {
  if (!isProtectedResourceUrl(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const blob = await fetchResourceBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
