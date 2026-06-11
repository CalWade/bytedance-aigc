const TOKEN_KEY = "bytedance-aigc.accessToken";
const USER_KEY = "bytedance-aigc.user";

export interface AuthUser {
  id: string;
  handle: string;
  /**
   * RBAC mini (2026-06-11)。
   * optional 是为兼容升级前签发的老 token / localStorage 缓存:缺失时视为 AUTHOR(不显示 admin 入口)。
   * 后端 AdminGuard 也对 undefined 做 fail-closed,前后端一致。
   */
  role?: "AUTHOR" | "ADMIN";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setUser(user: AuthUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

export interface ApiFetchOptions extends RequestInit {
  auth?: boolean;
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { auth = true, headers, ...rest } = options;
  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("Content-Type") && rest.body) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }
  const url = `${apiBaseUrl()}${path}`;

  // 后端冷启动时可能还没就绪，连接失败自动重试
  const maxRetries = 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { ...rest, headers: finalHeaders });
    } catch (err) {
      if (attempt >= maxRetries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
