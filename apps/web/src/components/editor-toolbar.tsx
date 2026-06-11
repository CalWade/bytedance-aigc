"use client";

import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeft,
  Heading1,
  Heading2,
  Bold,
  Italic,
  List,
  ListOrdered,
  ImageIcon,
  MoreHorizontal,
  History,
  Bookmark,
  Sparkles,
  Settings2,
  Save,
} from "lucide-react";
import { Button } from "@bytedance-aigc/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bytedance-aigc/ui/components/ui/dropdown-menu";
import { Separator } from "@bytedance-aigc/ui/components/ui/separator";
import { SaveStatus } from "./save-status";
import type { AutosaveStatus } from "@/lib/use-autosave";

interface EditorToolbarProps {
  editor: Editor | null;
  title: string;
  onTitleChange: (t: string) => void;
  saveState: AutosaveStatus;
  lastSavedAt: number | null;
  onOpenFast: () => void;
  onOpenPreflight: () => void;
  onOpenVersionHistory: () => void;
  onMarkVersion: () => void;
  onOpenPromptDrawer: () => void;
  namingNote: boolean;
  onUploadImage: () => void;
  uploading: boolean;
  uploadError: string | null;
  onSave: () => void;
  saving: boolean;
}

const fmtBtnClass = (active: boolean) =>
  `h-8 w-8 p-0 ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`;

export function EditorToolbar({
  editor,
  title,
  onTitleChange,
  saveState,
  lastSavedAt,
  onOpenFast,
  onOpenPreflight,
  onOpenVersionHistory,
  onMarkVersion,
  onOpenPromptDrawer,
  namingNote,
  onUploadImage,
  uploading,
  uploadError,
  onSave,
  saving,
}: EditorToolbarProps) {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="h-full px-3 flex items-center gap-2">
        {/* 左：返回 + 格式化 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push("/drafts/mine")}
          aria-label="返回草稿列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={fmtBtnClass(editor?.isActive("heading", { level: 1 }) ?? false)}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            aria-label="标题1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={fmtBtnClass(editor?.isActive("heading", { level: 2 }) ?? false)}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            aria-label="标题2"
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={fmtBtnClass(editor?.isActive("bold") ?? false)}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            aria-label="加粗"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={fmtBtnClass(editor?.isActive("italic") ?? false)}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            aria-label="斜体"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={fmtBtnClass(editor?.isActive("bulletList") ?? false)}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            aria-label="无序列表"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={fmtBtnClass(editor?.isActive("orderedList") ?? false)}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            aria-label="有序列表"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={fmtBtnClass(false)}
            disabled={uploading}
            onClick={onUploadImage}
            aria-label="插入图片"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* 中：标题 */}
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="flex-1 min-w-0 text-[15px] font-medium bg-transparent outline-none placeholder:text-muted-foreground/60"
          placeholder="输入标题…"
        />

        {/* 右：保存按钮 + 保存状态 + 操作 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onSave}
          disabled={saving || saveState === "saving"}
          aria-label="保存"
        >
          <Save className="h-4 w-4" />
        </Button>
        <SaveStatus status={saveState} lastSavedAt={lastSavedAt} />

        <Separator orientation="vertical" className="h-5 mx-1" />

        <Button variant="ghost" size="sm" onClick={onOpenFast} className="h-8 gap-1.5 text-[13px]">
          <Sparkles className="h-3.5 w-3.5" />
          FAST
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenPromptDrawer}
          className="h-8 gap-1.5 text-[13px]"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Prompt
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={onOpenVersionHistory}>
              <History className="mr-2 h-4 w-4" />
              版本历史
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMarkVersion} disabled={namingNote}>
              <Bookmark className="mr-2 h-4 w-4" />
              标记版本
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" onClick={onOpenPreflight} className="h-8 text-[13px]">
          发布
        </Button>

        {uploadError && <span className="text-[12px] text-destructive">{uploadError}</span>}
      </div>
    </header>
  );
}
