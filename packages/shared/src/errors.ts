/**
 * Phase 2.14 共享错误码常量。
 * 前后端共用,后端 throw ConflictException({ message: VERSION_CONFLICT, payload }),
 * 前端 fetch 拦截层据此分支走冲突 fork 流。
 */

export const VERSION_CONFLICT = "VERSION_CONFLICT";
