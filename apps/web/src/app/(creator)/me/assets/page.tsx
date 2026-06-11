"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  ImagePlus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { apiFetch, clearToken, getToken } from "@bytedance-aigc/ui/lib/auth";
import { uploadImageWithReview } from "@bytedance-aigc/ui/lib/upload-image";
import type { UploadReviewResult } from "@bytedance-aigc/ui/lib/upload-image";
import { Button } from "@bytedance-aigc/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bytedance-aigc/ui/components/ui/dialog";
import { Input } from "@bytedance-aigc/ui/components/ui/input";
import { Label } from "@bytedance-aigc/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bytedance-aigc/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bytedance-aigc/ui/components/ui/tabs";

interface AssetItem {
  id: string;
  key: string;
  url: string;
  mime: string;
  size: number;
  reviewStatus?: string;
  aiGenerated?: boolean;
  aiPrompt?: string;
  sceneTags?: string[];
  subjectTags?: string[];
  createdAt?: string;
}

interface StockItem {
  id: string;
  url: string;
  title: string;
  scene: string;
  subject: string;
}

/**
 * 开放图库:训练营 demo 用站内 cover-{1..5}.webp 充当无版权素材库。
 * 生产可换 Unsplash / Pexels;接口形态保持 StockItem 即可。
 */
const STOCK_LIBRARY: StockItem[] = [
  {
    id: "stock-1",
    url: "/covers/cover-1.webp",
    title: "城市天际线",
    scene: "城市",
    subject: "建筑",
  },
  {
    id: "stock-2",
    url: "/covers/cover-2.webp",
    title: "山间晨雾",
    scene: "自然",
    subject: "山景",
  },
  {
    id: "stock-3",
    url: "/covers/cover-3.webp",
    title: "工作台特写",
    scene: "室内",
    subject: "桌面",
  },
  {
    id: "stock-4",
    url: "/covers/cover-4.webp",
    title: "海岸线远景",
    scene: "自然",
    subject: "海洋",
  },
  {
    id: "stock-5",
    url: "/covers/cover-5.webp",
    title: "夜色街道",
    scene: "城市",
    subject: "街景",
  },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: AssetItem[] }
  | { kind: "error"; message: string };

export default function AssetsPage() {
  const router = useRouter();
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [sceneFilter, setSceneFilter] = React.useState("");
  const [subjectFilter, setSubjectFilter] = React.useState("");
  const [showGenerate, setShowGenerate] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadReview, setUploadReview] = React.useState<UploadReviewResult | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const loadCountRef = React.useRef(0);

  const loadAssets = React.useCallback(async () => {
    const params = new URLSearchParams();
    if (sceneFilter) params.set("scene", sceneFilter);
    if (subjectFilter) params.set("subject", subjectFilter);
    const path = params.toString()
      ? `/assets/search?${params.toString()}`
      : `/assets/mine?limit=50`;

    const thisLoad = ++loadCountRef.current;
    try {
      const res = await apiFetch(path);
      if (thisLoad !== loadCountRef.current) return;
      if (res.status === 401) {
        clearToken();
        window.location.replace("/login");
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: `加载失败 (HTTP ${res.status})` });
        return;
      }
      const json = (await res.json()) as { items: AssetItem[] };
      if (thisLoad !== loadCountRef.current) return;
      setState({ kind: "ready", items: json.items });
    } catch (err) {
      if (thisLoad !== loadCountRef.current) return;
      setState({ kind: "error", message: err instanceof Error ? err.message : "网络错误" });
    }
  }, [sceneFilter, subjectFilter, router]);

  React.useEffect(() => {
    if (!getToken()) {
      window.location.replace("/login");
      return;
    }
    void loadAssets();
  }, [loadAssets, router]);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const res = await apiFetch("/assets/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (res.ok) {
        setShowGenerate(false);
        setPrompt("");
        toast.success("AI 图已生成");
        await loadAssets();
      } else {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(body.message ?? `生成失败 (HTTP ${res.status})`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "网络错误");
    } finally {
      setGenerating(false);
    }
  }

  function pickFile() {
    fileInputRef.current?.click();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("仅支持图片文件");
      return;
    }
    setUploading(true);
    setUploadReview(null);
    try {
      const result = await uploadImageWithReview(file);
      setUploadReview(result);
      await loadAssets();
      if (result.reviewStatus === "PASSED") {
        toast.success("上传成功，合规校验通过");
      } else if (result.reviewStatus === "WARNED") {
        toast.warning("上传成功，但命中合规警告");
      } else {
        toast.error(result.reviewMessage);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  /**
   * 把开放图库里的图加到我的素材:抓 blob → 走 /assets/upload。
   * 训练营 demo 阶段简化处理;生产应做 server-to-server。
   */
  async function adoptStock(item: StockItem) {
    setUploading(true);
    setUploadReview(null);
    try {
      const blobRes = await fetch(item.url);
      const blob = await blobRes.blob();
      const file = new File([blob], `${item.id}.webp`, { type: blob.type || "image/webp" });
      const result = await uploadImageWithReview(file);
      setUploadReview(result);
      await loadAssets();
      if (result.reviewStatus === "PASSED") {
        toast.success(`已加入素材: ${item.title}`);
      } else if (result.reviewStatus === "WARNED") {
        toast.warning(`已加入素材，但命中合规警告: ${item.title}`);
      } else {
        toast.error(result.reviewMessage);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(assetId: string) {
    setDeleting(assetId);
    try {
      const res = await apiFetch(`/assets/${assetId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("已删除");
        await loadAssets();
      } else {
        toast.error("删除失败");
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setDeleting(null);
    }
  }

  const allSceneTags = new Set<string>();
  const allSubjectTags = new Set<string>();
  if (state.kind === "ready") {
    for (const item of state.items) {
      for (const t of item.sceneTags ?? []) allSceneTags.add(t);
      for (const t of item.subjectTags ?? []) allSubjectTags.add(t);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">素材库</h1>
        <Link href="/me/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← 工作台
        </Link>
      </div>

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">我的素材</TabsTrigger>
          <TabsTrigger value="stock">开放图库</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button type="button" onClick={pickFile} disabled={uploading} size="sm">
              <UploadCloud className="h-4 w-4" aria-hidden />
              {uploading ? "上传中…" : "上传图片"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />

            <Button type="button" variant="outline" size="sm" onClick={() => setShowGenerate(true)}>
              <Sparkles className="h-4 w-4" aria-hidden />
              AI 生图
            </Button>

            {/* 上传审核结果 */}
            {uploadReview && (
              <UploadReviewBanner
                reviewStatus={uploadReview.reviewStatus}
                message={uploadReview.reviewMessage}
                onDismiss={() => setUploadReview(null)}
              />
            )}

            <div className="flex items-center gap-2 ml-auto">
              <Select
                value={sceneFilter || "__all__"}
                onValueChange={(v) => setSceneFilter(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue placeholder="全部场景" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部场景</SelectItem>
                  {Array.from(allSceneTags).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={subjectFilter || "__all__"}
                onValueChange={(v) => setSubjectFilter(v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-8 w-[140px]">
                  <SelectValue placeholder="全部主体" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部主体</SelectItem>
                  {Array.from(allSubjectTags).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {state.kind === "loading" && <p className="text-sm text-muted-foreground">加载中…</p>}
          {state.kind === "error" && <p className="text-sm text-destructive">{state.message}</p>}
          {state.kind === "ready" && state.items.length === 0 && (
            <div className="text-sm text-muted-foreground rounded-lg border border-dashed border-border px-6 py-10 text-center">
              暂无素材。点击「上传图片」或「AI 生图」开始。
            </div>
          )}
          {state.kind === "ready" && state.items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {state.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border bg-card overflow-hidden shadow-sm relative"
                >
                  <div className="aspect-square bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.aiPrompt ?? item.key}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {item.reviewStatus === "WARNED" && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/90 text-white">
                      警告
                    </span>
                  )}
                  {item.reviewStatus === "PASSED" && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/90 text-white">
                      通过
                    </span>
                  )}
                  <div className="p-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      {item.aiGenerated ? (
                        <span className="inline-block w-fit text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">
                          AI 生成
                        </span>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={deleting === item.id}
                        className="p-1 rounded hover:bg-destructive/10 transition disabled:opacity-50"
                        aria-label="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(item.sceneTags ?? []).map((t) => (
                        <span
                          key={`s-${t}`}
                          className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                      {(item.subjectTags ?? []).map((t) => (
                        <span
                          key={`sub-${t}`}
                          className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <p className="text-sm text-muted-foreground mb-3">
            训练营 demo 内置图库,点击图片可加入「我的素材」。
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {STOCK_LIBRARY.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void adoptStock(item)}
                disabled={uploading}
                className="text-left rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:ring-2 hover:ring-ring transition disabled:opacity-50"
                aria-label={`加入素材:${item.title}`}
              >
                <div className="aspect-square bg-muted relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent text-white text-[12px] flex items-center gap-1">
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                    加入素材
                  </div>
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <div className="text-[13px] font-medium truncate">{item.title}</div>
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                      {item.scene}
                    </span>
                    <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                      {item.subject}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={showGenerate}
        onOpenChange={(o) => {
          setShowGenerate(o);
          if (!o) setPrompt("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 生图</DialogTitle>
            <DialogDescription>用一两句话描述想要的画面,生成会沉淀到我的素材。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-prompt">提示词</Label>
            <Input
              id="ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={500}
              placeholder="如:晨雾中的山间小路,胶片质感"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowGenerate(false);
                setPrompt("");
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || !prompt.trim()}
            >
              {generating ? "生成中…" : "生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** 统一的审核结果展示条 */
function UploadReviewBanner({
  reviewStatus,
  message,
  onDismiss,
}: {
  reviewStatus: string;
  message: string;
  onDismiss: () => void;
}) {
  const isAllow = reviewStatus === "PASSED";
  const isBlock = reviewStatus === "BLOCKED";

  const icon = isAllow ? (
    <ShieldCheck className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
  ) : (
    <ShieldAlert
      className={`h-4 w-4 mt-0.5 shrink-0 ${isBlock ? "text-red-500" : "text-amber-500"}`}
    />
  );

  const bg = isAllow
    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
    : isBlock
      ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
      : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900";

  const text = isAllow
    ? "text-emerald-700 dark:text-emerald-300"
    : isBlock
      ? "text-red-700 dark:text-red-300"
      : "text-amber-700 dark:text-amber-300";

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 ${bg}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${text}`}>
          {isAllow ? "合规校验通过" : isBlock ? "素材已被拦截" : "合规警告"}
        </p>
        <p className={`text-xs mt-0.5 ${text} opacity-80`}>{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded hover:bg-foreground/10 transition shrink-0"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}
