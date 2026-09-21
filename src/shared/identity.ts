import { z } from 'zod';

/** Runtime contract for the owner id the Worker resolved for the current request. */
export const identitySchema = z.strictObject({
  userId: z.string().trim().min(1).max(200),
});
