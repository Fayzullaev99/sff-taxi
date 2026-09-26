import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  // public so the OpenAPI generator can document what this pipe accepts
  constructor(readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Ma’lumotlar noto‘g‘ri',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
