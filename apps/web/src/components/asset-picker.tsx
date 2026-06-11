"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, UploadCloud } from "lucide-react";

import { apiFetch } from "@bytedance-aigc/ui/lib/auth";
import { uploadImage } from "@bytedance-aigc/ui/lib/upload-image";
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

export function AssetPicker({ open, onClose, onSelect }: AssetPickerProps) {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    try {
      const result = await uploadImage(file);
      await loadAssets();
      // 上传成功后自动选中插入
      onSelect(result.url);
      onClose();
    } catch {
      // uploadImage 内部会抛出带 HTTP 状态的错误
    } finally {
      setUploading(false);
    }
  }

  function handleStockClick(item: StockItem) {
    onSelect(item.url);
    onClose();
  }

  function handleAssetClick(item: AssetItem) {
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
            {loading && <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>}
            {!loading && items.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                暂无素材，切换到「上传图片」添加
              </div>
            )}
            {!loading && items.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleAssetClick(item)}
                    className="rounded-md border border-border overflow-hidden hover:ring-2 hover:ring-ring transition text-left"
                  >
                    <div className="aspect-square bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.aiPrompt ?? item.key}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </button>
                ))}
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
