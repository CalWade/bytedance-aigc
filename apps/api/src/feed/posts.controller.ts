import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import type { PostDetailDto, PostDto } from "@bytedance-aigc/shared";
import { hotnessMockBase, normalizeHotness } from "@bytedance-aigc/shared";
import { Public } from "../auth/public.decorator";
import { FeedService } from "./feed.service";
import { AuthorPostsQueryDto } from "./feed.dto";

@Controller()
export class PostsController {
  constructor(private readonly feed: FeedService) {}

  @Public()
  @Get("post/:id")
  async getPost(@Param("id") id: string): Promise<PostDetailDto> {
    const draft = await this.feed.getPostDetail(id);
    if (!draft) {
      throw new NotFoundException({ code: "POST_NOT_FOUND", message: "稿件不存在或已下架" });
    }

    const hotnessRaw = hotnessMockBase(draft.id);
    const quality = readQ(draft.lastReview?.quality);
    // Phase 2.15:优先 publishedTitle/publishedBody,二发期间老线上版仍可见
    const liveTitle = draft.publishedTitle ?? draft.title;
    const liveBody = draft.publishedBody ?? draft.body;
    return {
      id: draft.id,
      title: liveTitle,
      authorId: draft.authorId,
      authorHandle: draft.author.handle,
      publishedAt: (draft.publishedAt ?? draft.updatedAt).toISOString(),
      qualityOverall: quality,
      hotnessMock: normalizeHotness(hotnessRaw, [hotnessRaw]),
      coverIndex: (Math.abs(hashId(draft.id)) % 5) + 1,
      excerpt: "",
      body: liveBody,
      qualityRecommendation: draft.lastReview?.recommendation ?? "ALLOW",
    };
  }

  @Public()
  @Get("authors/:id/posts")
  async getAuthorPosts(
    @Param("id") id: string,
    @Query() q: AuthorPostsQueryDto,
  ): Promise<{ items: PostDto[] }> {
    const items = await this.feed.getAuthorPosts(id, q.limit);
    return { items };
  }
}

function readQ(q: unknown): number {
  if (typeof q !== "object" || q === null) return 0;
  const v = (q as Record<string, unknown>).overall;
  return typeof v === "number" ? v : 0;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}
