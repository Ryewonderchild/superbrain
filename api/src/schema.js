import { z } from "zod";

export const itemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.string().trim().min(1).max(48).default("Concept"),
  summary: z.string().trim().max(2000).optional().default(""),
  content: z.string().trim().max(60000).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
  source: z.string().trim().max(500).optional().default("")
});

export const itemUpdateSchema = itemSchema.partial();

export const linkSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  type: z.string().trim().min(1).max(64).default("RELATED_TO"),
  note: z.string().trim().max(1000).optional().default("")
});

export const linkUpdateSchema = z.object({
  type: z.string().trim().min(1).max(64).optional(),
  note: z.string().trim().max(1000).optional()
});
