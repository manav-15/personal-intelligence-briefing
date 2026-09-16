import { z } from 'zod';

/** Runtime contract returned by the Worker health endpoint. */
export const healthSchema = z.object({ status: z.literal('ok') });
