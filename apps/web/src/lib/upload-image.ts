import { apiBaseUrl, getToken } from "./auth";

export interface UploadedImage {
  id: string;
  key: string;
  url: string;
  mime: string;
  size: number;
}

/**
 * 走原生 fetch 而不是 apiFetch:apiFetch 会盲目把 Content-Type 设成 application/json,
 * 而 FormData 必须让浏览器自动算 boundary。这里手动加 Authorization。
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const fd = new FormData();
  fd.append("file", file);
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBaseUrl()}/assets/upload`, {
    method: "POST",
    body: fd,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed (HTTP ${res.status})${text ? ": " + text : ""}`);
  }
  return (await res.json()) as UploadedImage;
}
