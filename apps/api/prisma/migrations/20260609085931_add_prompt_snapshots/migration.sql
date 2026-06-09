-- CreateTable
CREATE TABLE "prompt_snapshots" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "fewShots" JSONB NOT NULL,
    "designNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_snapshots_promptId_createdAt_idx" ON "prompt_snapshots"("promptId", "createdAt");

-- AddForeignKey
ALTER TABLE "prompt_snapshots" ADD CONSTRAINT "prompt_snapshots_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
