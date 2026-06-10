import Link from "next/link";
import Image from "next/image";
import type { PostDto } from "@bytedance-aigc/shared";

interface PostCardProps {
  post: PostDto;
  priority?: boolean;
  index?: number;
}

export function PostCard({ post, priority = false }: PostCardProps) {
  return (
    <article className="card overflow-hidden hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-shadow">
      <Link href={`/post/${post.id}`} className="block group">
        <div className="relative aspect-[16/10] bg-[var(--bg)] overflow-hidden">
          <Image
            src={`/covers/cover-${post.coverIndex}.webp`}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            priority={priority}
            className="object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        </div>
        <div className="p-4">
          <h3 className="text-[16px] font-medium leading-snug text-[var(--text)] line-clamp-2 group-hover:text-[var(--brand)] transition-colors">
            {post.title}
          </h3>
          <p className="mt-2 text-[13px] text-[var(--text-2)] line-clamp-2 leading-[1.55]">
            {post.excerpt}
          </p>
          <div className="mt-3 flex items-center gap-3 text-[12px] text-[var(--text-3)]">
            <span className="truncate max-w-[120px]">@{post.authorHandle}</span>
            <span className="text-[var(--text-mute)]">·</span>
            <span>Q · {post.qualityOverall.toFixed(0)}</span>
            <span className="text-[var(--text-mute)]">·</span>
            <span>H · {post.hotnessMock.toFixed(0)}</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
