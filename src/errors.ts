const ERROR_HINTS: Record<number, string> = {
  400: 'Check the request parameters for missing or invalid values',
  401: 'Check AIVEN_TOKEN is valid. Get a new token at: https://console.aiven.io/profile/auth',
  403: 'Your token lacks permission for this operation. Check your user role and permissions.',
  404: 'Verify the project, service, or resource name exists and is spelled correctly',
  409: 'Resource may already exist or be in a conflicting state. Try listing existing resources first.',
  422: 'The request was well-formed but contains semantic errors. Check field values.',
  429: 'Rate limit exceeded. Wait a moment and try again.',
  500: 'Aiven API internal error. Try again later or check https://status.aiven.io',
  502: 'Aiven API gateway error. Try again later.',
  503: 'Aiven API temporarily unavailable. Try again later.',
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AivenError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly moreInfo?: string;

  constructor(status: number, apiMessage: string, errorCode?: string, moreInfo?: string) {
    const lines: string[] = [`Aiven API Error (${status}): ${apiMessage}`];

    const hint = ERROR_HINTS[status];
    if (hint) {
      lines.push(`Hint: ${hint}`);
    }
    if (errorCode) {
      lines.push(`Error code: ${errorCode}`);
    }
    if (moreInfo) {
      lines.push(`More info: ${moreInfo}`);
    }

    super(lines.join('\n'));
    this.name = 'AivenError';
    this.status = status;
    if (errorCode) this.errorCode = errorCode;
    if (moreInfo) this.moreInfo = moreInfo;
  }
}
