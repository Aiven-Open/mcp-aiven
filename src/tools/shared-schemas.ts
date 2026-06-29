import { z } from 'zod';

export const REASONING_MAX_LENGTH = 2000;

export const SQL_QUERY_MAX_LENGTH = 256_000;

export const reasoningField = z
  .string()
  .min(1)
  .max(REASONING_MAX_LENGTH)
  .describe(
    `Brief explanation of why you are making this call. Used for audit logs and debugging. ` +
      `Do NOT include any PII or secrets (emails, names, credentials, tokens, connection URIs, IPs, or customer/project identifiers); describe intent only. ` +
      `Max ${REASONING_MAX_LENGTH} characters.`
  );
