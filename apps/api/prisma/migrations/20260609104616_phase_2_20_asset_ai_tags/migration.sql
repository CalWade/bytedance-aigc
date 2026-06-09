-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiPrompt" TEXT,
ADD COLUMN     "sceneTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "subjectTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
