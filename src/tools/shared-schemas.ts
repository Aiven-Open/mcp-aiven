import { z } from 'zod';

export const REASONING_MAX_LENGTH = 2000;

export const SQL_QUERY_MAX_LENGTH = 256_000;

export const reasoningField = z
  .string()
  .min(1)
  .max(REASONING_MAX_LENGTH)
  .describe(
    `Brief explanation of why you are making this call. Used for audit logs and debugging. Max ${REASONING_MAX_LENGTH} characters.`
  );
