"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, ShieldAlert, ShieldCheck, UploadCloud, X } from "lucide-react";

import { apiFetch } from "@bytedance-aigc/ui/lib/auth";
import { uploadImageWithReview } from "@bytedance-aigc/ui/lib/upload-image";
import type { UploadReviewResult } from "@bytedance-aigc/ui/lib/upload-image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@bytedance-aigc/ui/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bytedance-aigc/ui/components/ui/tabs";

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

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
}

interface StockItem {
  id: string;
  url: string;
  title: string;
  scene: string;
  subject: string;
}

const STOCK_LIBRARY: StockItem[] = [
  {
    id: "stock-1",
    url: "/covers/cover-1.webp",
    title: "城市天际线",
    scene: "城市",
    subject: "建筑",
  },
  { id: "stock-2", url: "/covers/cover-2.webp", title: "山间晨雾", scene: "自然", subject: "山景" },
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
  { id: "stock-5", url: "/covers/cover-5.webp", title: "夜色街道", scene: "城市", subject: "街景" },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PASSED: { label: "通过", className: "bg-emerald-500/90 text-white" },
  WARNED: { label: "警告", className: "bg-amber-500/90 text-white" },
  BLOCKED: { label: "拦截", className: "bg-red-500/90 text-white" },
};

export function AssetPicker({ open, onClose, onSelect }: AssetPickerProps) {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadReviewResult | null>(null);
  const [warnAsset, setWarnAsset] = useState<AssetItem | null>(null);
  const [tab, setTab] = useState("mine");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/assets/mine?limit=50");
      if (res.ok) {
        const data = (await res.json()) as { items: AssetItem[] };
        setItems(data.items);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadAssets();
  }, [open, loadAssets]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await uploadImageWithReview(file);
      console.log("[素材审核]", result.reviewStatus, result.reviewMessage, result);
      setUploadResult(result);
      await loadAssets();
      if (result.reviewStatus === "PASSED") {
        onSelect(result.image!.url);
        onClose();
      }
      // WARNED/BLOCKED: 留在面板展示审核结果
    } catch (err) {
      console.log("[素材审核] 上传异常", err);
      setUploadResult({
        reviewStatus: "BLOCKED",
        reviewMessage: err instanceof Error ? err.message : "上传失败",
      });
    } finally {
      setUploading(false);
    }
  }

  function handleAssetClick(item: AssetItem) {
    console.log("[素材点击]", item.id, "reviewStatus:", item.reviewStatus);
    // WARNED 素材提示用户确认
    if (item.reviewStatus === "WARNED") {
      setWarnAsset(item);
      return;
    }
    onSelect(item.url);
    onClose();
  }

  function handleStockClick(item: StockItem) {
    onSelect(item.url);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择图片</DialogTitle>
          <DialogDescription>从素材库选择或上传新图片插入文章</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="mine" className="flex-1">
              我的素材
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">
              上传图片
            </TabsTrigger>
            <TabsTrigger value="stock" className="flex-1">
              开放图库
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-3 max-h-[50vh] overflow-y-auto">
            {/* WARNED 素材确认 */}
            {warnAsset && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
                <p className="flex-1 text-sm text-amber-700 dark:text-amber-300">
                  该素材命中合规警告，确定使用吗？
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(warnAsset.url);
                    setWarnAsset(null);
                    onClose();
                  }}
                  className="px-2 py-1 rounded text-xs font-medium bg-foreground/10 hover:bg-foreground/20 transition"
                >
                  仍使用
                </button>
                <button
                  type="button"
                  onClick={() => setWarnAsset(null)}
                  className="p-1 rounded hover:bg-foreground/10 transition"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            )}

            {loading && <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>}
            {!loading && items.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                暂无素材，切换到「上传图片」添加
              </div>
            )}
            {!loading && items.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {items.map((item) => {
                  const cfg = STATUS_CONFIG[item.reviewStatus ?? ""];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleAssetClick(item)}
                      className="rounded-md border border-border overflow-hidden hover:ring-2 hover:ring-ring transition text-left relative"
                    >
                      <div className="aspect-square bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={item.aiPrompt ?? item.key}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {cfg && (
                        <span
                          className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.className}`}
                        >
                          {cfg.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => void handleUpload(e)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex flex-col items-center justify-center gap-2 w-full py-12 rounded-lg border-2 border-dashed border-border hover:border-foreground/30 transition disabled:opacity-50"
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {uploading ? "上传中…" : "点击选择图片上传"}
              </span>
              <span className="text-xs text-muted-foreground/60">
                支持 JPG / PNG / WebP / GIF，最大 5MB
              </span>
            </button>

            {/* 上传审核结果 */}
            {uploadResult && (
              <ReviewBanner
                reviewStatus={uploadResult.reviewStatus}
                message={uploadResult.reviewMessage}
                onConfirm={() => {
                  if (uploadResult.image) {
                    onSelect(uploadResult.image.url);
                    onClose();
                  }
                }}
                onDismiss={() => setUploadResult(null)}
              />
            )}
          </TabsContent>

          <TabsContent value="stock" className="mt-3 max-h-[50vh] overflow-y-auto">
            <p className="mb-2 text-xs text-muted-foreground">点击图片直接插入文章</p>
            <div className="grid grid-cols-3 gap-2">
              {STOCK_LIBRARY.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleStockClick(item)}
                  className="rounded-md border border-border overflow-hidden hover:ring-2 hover:ring-ring transition text-left"
                >
                  <div className="aspect-square bg-muted relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent text-white text-[11px] flex items-center gap-1">
                      <ImagePlus className="h-3 w-3" />
                      插入
                    </div>
                  </div>
                  <div className="px-1.5 py-1 text-[11px] font-medium truncate">{item.title}</div>
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** 统一的审核结果展示条 */
function ReviewBanner({
  reviewStatus,
  message,
  onConfirm,
  onDismiss,
}: {
  reviewStatus: string;
  message: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const isAllow = reviewStatus === "PASSED";
  const isWarn = reviewStatus === "WARNED";
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
    <div className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 ${bg}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${text}`}>
          {isAllow ? "合规校验通过" : isBlock ? "素材已被拦截" : "合规警告"}
        </p>
        <p className={`text-xs mt-0.5 ${text} opacity-80`}>{message}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isWarn && (
          <button
            type="button"
            onClick={onConfirm}
            className="px-2 py-1 rounded text-xs font-medium bg-foreground/10 hover:bg-foreground/20 transition"
          >
            仍使用
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded hover:bg-foreground/10 transition"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
