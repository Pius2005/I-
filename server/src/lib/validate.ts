import { z, type ZodTypeAny } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    data: items,
    meta: {
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
    },
  };
}

export function validate<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}

export const idParam = z.object({ id: z.string().min(1) });
