import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const ExportFormatSchema = z.enum(['mp4-h264', 'mp4-hevc', 'jpeg', 'png', 'webp']);
export const ExportResolutionSchema = z.enum(['original', '1080', '1440', '2160']);
export const ExportStatusSchema = z.enum(['queued', 'processing', 'ready', 'failed']);

const ExportCreateSchema = z.object({
  assetId: z.uuidv4(),
  format: ExportFormatSchema,
  resolution: ExportResolutionSchema,
  quality: z.int().min(1).max(100).default(90),
});
const ExportResponseSchema = ExportCreateSchema.extend({
  id: z.uuidv4(),
  status: ExportStatusSchema,
  fileName: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class ExportCreateDto extends createZodDto(ExportCreateSchema) {}
export class ExportResponseDto extends createZodDto(ExportResponseSchema) {}
