import Link from "next/link";
import Image from "next/image";
import type { PostDto } from "@bytedance-aigc/shared";
import { QualityBadge } from "./QualityBadge";

export function PostCard({ post }: { post: PostDto }) {
  return (
    <Link
      href={`/post/${post.id}`}
      className="block border rounded-lg p-3 hover:shadow-md transition-shadow"
    >
      <div className="relative aspect-video mb-2">
        <Image
          src={`/covers/cover-${post.coverIndex}.webp`}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover rounded"
        />
      </div>
      <h3 className="font-medium line-clamp-2">{post.title}</h3>
      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{post.excerpt}</p>
      <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
        <div className="flex items-center gap-1.5">
          <span>{post.authorHandle}</span>
          <QualityBadge score={post.qualityOverall} size="sm" />
        </div>
        <span>
          Q {post.qualityOverall.toFixed(0)} · H {post.hotnessMock.toFixed(0)}
        </span>
      </div>
    </Link>
  );
}
