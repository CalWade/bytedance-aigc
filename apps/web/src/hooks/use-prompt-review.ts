"use client";

import { useCallback, useRef, useState } from "react";
import type { PromptReviewResponse } from "@bytedance-aigc/shared";

import { apiFetch } from "@/lib/auth";

const DEBOUNCE_MS = 800;

export interface UsePromptReviewState {
  loading: boolean;
  result: PromptReviewResponse | null;
  trigger: (text: string) => void;
  dismiss: () => void;
}

/**
 * topic / hint 失焦 800ms 防抖 → POST /reviews/prompt。
 * 同 sessionId 内连续多次失焦合并为一次审核。
 */
export function usePromptReview(): UsePromptReviewState {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptReviewResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const trigger = useCallback((text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length === 0) {
      setResult(null);
      return;
    }
    timerRef.current = setTimeout(async () => {
      inflightRef.current?.abort();
      const ac = new AbortController();
      inflightRef.current = ac;
      setLoading(true);
      try {
        const res = await apiFetch("/reviews/prompt", {
          method: "POST",
          body: JSON.stringify({ text: text.trim() }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setResult(null);
          return;
        }
        const body = (await res.json()) as PromptReviewResponse;
        if (body.recommendation !== "ALLOW") {
          setResult(body);
        } else {
          setResult(null);
        }
      } catch {
        // abort 或网络错误 → silent
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const dismiss = useCallback(() => {
    setResult(null);
  }, []);

  return { loading, result, trigger, dismiss };
}
