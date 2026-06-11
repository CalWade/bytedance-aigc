import { apiBaseUrl, getToken } from "./auth";

export interface UploadedImage {
  id: string;
  key: string;
  url: string;
  mime: string;
  size: number;
  reviewStatus?: string;
}

export type ReviewStatus = "PASSED" | "WARNED" | "BLOCKED";

/** 上传结果：包含审核状态和可读原因 */
export interface UploadReviewResult {
  /** 上传成功时返回素材信息 */
  image?: UploadedImage;
  /** 审核状态 */
  reviewStatus: ReviewStatus;
  /** 人类可读的审核结果描述 */
  reviewMessage: string;
}

/**
 * 走原生 fetch 而不是 apiFetch:apiFetch 会盲目把 Content-Type 设成 application/json,
 * 而 FormData 必须让浏览器自动算 boundary。这里手动加 Authorization。
 *
 * 返回 UploadReviewResult，无论 ALLOW/WARN/BLOCK 都有明确的结构化结果。
 * BLOCK 时 image 为 undefined（素材未入库）。
 */
export async function uploadImageWithReview(file: File): Promise<UploadReviewResult> {
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

  // BLOCK: 后端返回 400，素材未入库
  if (res.status === 400) {
    const body = await parseJsonBody(res);
    const message = body?.message ?? "素材合规校验未通过";
    return { reviewStatus: "BLOCKED", reviewMessage: message };
  }

  // 其他非 200
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed (HTTP ${res.status})${text ? ": " + text : ""}`);
  }

  // ALLOW 或 WARN
  const image = (await res.json()) as UploadedImage;
  const status = (image.reviewStatus ?? "PASSED") as ReviewStatus;
  const message = status === "WARNED" ? "素材命中合规警告维度" : "合规校验通过";
  return { image, reviewStatus: status, reviewMessage: message };
}

/** 向后兼容：只返回 image，BLOCK 时抛错 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const result = await uploadImageWithReview(file);
  if (result.reviewStatus === "BLOCKED") {
    throw new Error(result.reviewMessage);
  }
  return result.image!;
}

async function parseJsonBody(res: Response): Promise<{ message?: string } | null> {
  try {
    return (await res.json()) as { message?: string };
  } catch {
    return null;
  }
}
