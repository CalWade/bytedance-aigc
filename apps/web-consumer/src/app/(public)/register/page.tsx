"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiFetch, setToken, setUser, type AuthUser } from "@bytedance-aigc/ui/lib/auth";
import { Button } from "@bytedance-aigc/ui/components/ui/button";
import { Input } from "@bytedance-aigc/ui/components/ui/input";
import { Label } from "@bytedance-aigc/ui/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bytedance-aigc/ui/components/ui/tabs";

interface RegisterResponse {
  accessToken: string;
  user: AuthUser;
}

type Method = "phone" | "email";

export default function RegisterPage() {
  const router = useRouter();
  const [method, setMethod] = React.useState<Method>("phone");

  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [codeCooldown, setCodeCooldown] = React.useState(0);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const [handle, setHandle] = React.useState("");

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
        body: JSON.stringify({ scene: "register", phone }),
        auth: false,
      });
      if (!res.ok) {
        setError("验证码发送失败");
        return;
      }
      const data = (await res.json()) as { demoCode?: string };
      setCodeCooldown(60);
      if (data.demoCode) setCode(data.demoCode);
    } catch {
      setError("网络错误");
    }
  }

  async function doRegister() {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        method === "phone"
          ? { method: "phone", phone, code, handle: handle || undefined }
          : { method: "email", email, password, handle: handle || undefined };
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
        auth: false,
      });
      if (!res.ok) {
        if (res.status === 409) {
          setError("该账号已注册");
        } else if (res.status === 400 || res.status === 401) {
          const d = (await res.json().catch(() => null)) as { message?: string } | null;
          setError(d?.message ?? "注册失败");
        } else {
          setError(`注册失败 (HTTP ${res.status})`);
        }
        return;
      }
      const data = (await res.json()) as RegisterResponse;
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
    await doRegister();
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm flex flex-col gap-5 rounded-xl border border-border bg-card p-7 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">注册</h1>
          <p className="text-[13px] text-muted-foreground">
            已有账号?
            <Link href="/login" className="ml-1 text-foreground underline underline-offset-2">
              去登录
            </Link>
          </p>
        </div>

        <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="phone">手机号</TabsTrigger>
            <TabsTrigger value="email">邮箱</TabsTrigger>
          </TabsList>

          <TabsContent value="phone" className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-phone">手机号</Label>
              <Input
                id="reg-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="13800000000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-code">验证码</Label>
              <div className="flex gap-2">
                <Input
                  id="reg-code"
                  type="text"
                  inputMode="numeric"
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
              <Label htmlFor="reg-email">邮箱</Label>
              <Input
                id="reg-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-password">密码</Label>
              <Input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                minLength={8}
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-handle">用户名 (可选)</Label>
          <Input
            id="reg-handle"
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="留空则自动派生"
            pattern="[a-zA-Z0-9_-]+"
            maxLength={30}
          />
          <p className="text-[11px] text-muted-foreground">
            英文字母、数字、下划线、连字符,2–30 位。
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "注册中…" : "注册"}
        </Button>
      </form>
    </main>
  );
}
