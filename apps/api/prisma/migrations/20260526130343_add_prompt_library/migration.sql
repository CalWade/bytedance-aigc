-- CreateEnum
CREATE TYPE "PromptOwner" AS ENUM ('PLATFORM', 'PRIVATE');

-- CreateEnum
CREATE TYPE "DraftToolType" AS ENUM ('REWRITE_FLUENT', 'EXPAND', 'TRANSFORM_STYLE', 'HEADLINE_SUB', 'HEADLINE_NEW', 'REWRITE_OPENING', 'ADD_FACTS', 'ADD_TOPIC', 'IMAGE_SUGGEST');

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "owner" "PromptOwner" NOT NULL,
    "authorId" TEXT,
    "tool" "DraftToolType" NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "fewShots" JSONB NOT NULL,
    "designNote" TEXT,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "sourcePromptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompts_owner_tool_idx" ON "prompts"("owner", "tool");

-- CreateIndex
CREATE INDEX "prompts_authorId_idx" ON "prompts"("authorId");

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_sourcePromptId_fkey" FOREIGN KEY ("sourcePromptId") REFERENCES "prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
