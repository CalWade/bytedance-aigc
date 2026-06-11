"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiFetch, setToken, setUser, type AuthUser } from "@bytedance-aigc/ui/lib/auth";
import { Button } from "@bytedance-aigc/ui/components/ui/button";
import { Input } from "@bytedance-aigc/ui/components/ui/input";
import { Label } from "@bytedance-aigc/ui/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bytedance-aigc/ui/components/ui/tabs";

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

type Method = "phone" | "email" | "handle";

const QUICK_FILLS = ["demo-author", "admin", "tech-author", "life-author"] as const;

export default function LoginPage() {
  const router = useRouter();
  const [method, setMethod] = React.useState<Method>("phone");

  // phone tab
  const [phone, setPhone] = React.useState("13800000001");
  const [code, setCode] = React.useState("");
  const [codeCooldown, setCodeCooldown] = React.useState(0);

  // email tab
  const [email, setEmail] = React.useState("demo-author@example.com");
  const [password, setPassword] = React.useState("");

  // handle tab
  const [handle, setHandle] = React.useState<string>("demo-author");

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (codeCooldown <= 0) return;
    const t = window.setTimeout(() => setCodeCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [codeCooldown]);

  async function sendCode() {
    setError(null);
    try {
      const res = await apiFetch("/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ scene: "login", phone }),
        auth: false,
      });
      if (!res.ok) {
        setError("验证码发送失败");
        return;
      }
      const data = (await res.json()) as { demoCode?: string };
      setCodeCooldown(60);
      if (data.demoCode) {
        // demo 环境直接显式回填,生产应去掉这一行
        setCode(data.demoCode);
      }
    } catch {
      setError("网络错误");
    }
  }

  async function doLogin() {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        method === "phone"
          ? { method: "phone", phone, code }
          : method === "email"
            ? { method: "email", email, password }
            : { method: "handle", handle };
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
        auth: false,
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError("用户不存在");
        } else if (res.status === 400) {
          const d = (await res.json().catch(() => null)) as { message?: string } | null;
          setError(d?.message ?? "请求格式不正确");
        } else {
          setError(`登录失败 (HTTP ${res.status})`);
        }
        return;
      }
      const data = (await res.json()) as LoginResponse;
      setToken(data.accessToken);
      setUser(data.user);
      router.push("/drafts/mine");
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await doLogin();
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm flex flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">登录</h1>
          <p className="text-[13px] text-muted-foreground">
            还没账号?
            <Link href="/register" className="ml-1 text-foreground underline underline-offset-2">
              去注册
            </Link>
          </p>
        </div>

        <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="phone">手机号</TabsTrigger>
            <TabsTrigger value="email">邮箱</TabsTrigger>
            <TabsTrigger value="handle">Handle</TabsTrigger>
          </TabsList>

          <TabsContent value="phone" className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-phone">手机号</Label>
              <Input
                id="login-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="13800000000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-code">验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="login-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位验证码"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={sendCode}
                  disabled={codeCooldown > 0 || !/^1[3-9]\d{9}$/.test(phone)}
                  className="shrink-0"
                >
                  {codeCooldown > 0 ? `${codeCooldown}s` : "发送验证码"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                训练营 demo:验证码固定 <code>123456</code>,点发送会自动回填。
              </p>
            </div>
          </TabsContent>

          <TabsContent value="email" className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">邮箱</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">密码</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
              />
              <p className="text-[11px] text-muted-foreground">
                Demo 用户密码统一为 <code>demo1234</code>。
              </p>
            </div>
          </TabsContent>

          <TabsContent value="handle" className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_FILLS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHandle(h)}
                  className="text-xs rounded border border-border px-2.5 py-1 hover:bg-accent transition-colors"
                >
                  {h}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-handle">Handle</Label>
              <Input
                id="login-handle"
                type="text"
                autoComplete="username"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                训练营 demo 兼容入口,直接以 handle 登录已 seed 的用户。
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "登录中…" : "登录"}
        </Button>
      </form>
    </main>
  );
}
