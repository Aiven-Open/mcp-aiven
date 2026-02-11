import type { AivenError } from './types.js';

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

export function formatError(error: AivenError): string {
  const lines: string[] = [];

  lines.push(`Aiven API Error (${error.status}): ${error.message}`);

  const hint = ERROR_HINTS[error.status];
  if (hint) {
    lines.push(`Hint: ${hint}`);
  }

  if (error.errorCode) {
    lines.push(`Error code: ${error.errorCode}`);
  }

  if (error.moreInfo) {
    lines.push(`More info: ${error.moreInfo}`);
  }

  return lines.join('\n');
}

export async function createErrorFromResponse(response: Response): Promise<AivenError> {
  let message = response.statusText || 'Unknown error';
  let errorCode: string | undefined;
  let moreInfo: string | undefined;

  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body['message'] === 'string') {
      message = body['message'];
    }
    if (typeof body['error_code'] === 'string') {
      errorCode = body['error_code'];
    }
    if (typeof body['more_info'] === 'string') {
      moreInfo = body['more_info'];
    }
  } catch {
    // Response body wasn't JSON, use status text
  }

  const result: AivenError = {
    message,
    status: response.status,
  };

  if (errorCode !== undefined) {
    result.errorCode = errorCode;
  }
  if (moreInfo !== undefined) {
    result.moreInfo = moreInfo;
  }

  return result;
}

export function createErrorFromException(err: unknown): AivenError {
  const message = err instanceof Error ? err.message : 'Unknown error occurred';
  return {
    message,
    status: 0,
  };
}
