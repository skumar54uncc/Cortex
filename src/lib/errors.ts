/**
 * Typed errors for SW ↔ UI — prefer codes over raw exception strings.
 */

export const ERROR_CODES = {
  NANO_UNAVAILABLE: "nano_unavailable",
  CLOUD_NOT_CONFIGURED: "cloud_not_configured",
  CLOUD_API_KEY_INVALID: "cloud_api_key_invalid",
  CLOUD_API_RATE_LIMITED: "cloud_api_rate_limited",
  CLOUD_API_QUOTA_EXCEEDED: "cloud_api_quota_exceeded",
  QUESTION_TOO_LONG: "question_too_long",
  NO_INDEXED_CONTENT: "no_indexed_content",
  NO_RESULTS_IN_RANGE: "no_results_in_range",
  EMBEDDING_FAILED: "embedding_failed",
  STORAGE_FULL: "storage_full",
  RATE_LIMITED: "rate_limited",
  INVALID_URL: "invalid_url",
  FOREIGN_SENDER: "foreign_sender",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface CortexErrorShape {
  code: ErrorCode;
  userMessage: string;
  userAction?: string;
  recoverable: boolean;
}

export const ERROR_MESSAGES: Record<ErrorCode, CortexErrorShape> = {
  [ERROR_CODES.NANO_UNAVAILABLE]: {
    code: ERROR_CODES.NANO_UNAVAILABLE,
    userMessage:
      "On-device AI is not available in this browser profile.",
    userAction:
      "Enable Cloud Chat in Cortex settings, or use a Chrome build with built-in AI.",
    recoverable: true,
  },
  [ERROR_CODES.CLOUD_NOT_CONFIGURED]: {
    code: ERROR_CODES.CLOUD_NOT_CONFIGURED,
    userMessage: "Cloud Chat is not set up.",
    userAction:
      "Open Cortex settings and add your Gemini API key from Google AI Studio.",
    recoverable: true,
  },
  [ERROR_CODES.CLOUD_API_KEY_INVALID]: {
    code: ERROR_CODES.CLOUD_API_KEY_INVALID,
    userMessage: "The Gemini API key was rejected.",
    userAction: "Check the key in settings or create a new one in Google AI Studio.",
    recoverable: true,
  },
  [ERROR_CODES.CLOUD_API_RATE_LIMITED]: {
    code: ERROR_CODES.CLOUD_API_RATE_LIMITED,
    userMessage: "Gemini rate limit reached.",
    userAction: "Wait a few minutes and try again.",
    recoverable: true,
  },
  [ERROR_CODES.CLOUD_API_QUOTA_EXCEEDED]: {
    code: ERROR_CODES.CLOUD_API_QUOTA_EXCEEDED,
    userMessage: "Gemini quota exceeded for this key.",
    userAction: "Check usage in Google AI Studio or switch keys.",
    recoverable: true,
  },
  [ERROR_CODES.QUESTION_TOO_LONG]: {
    code: ERROR_CODES.QUESTION_TOO_LONG,
    userMessage: "That question is too long.",
    userAction: "Shorten your message and try again.",
    recoverable: true,
  },
  [ERROR_CODES.NO_INDEXED_CONTENT]: {
    code: ERROR_CODES.NO_INDEXED_CONTENT,
    userMessage: "Nothing in your library matched.",
    userAction: "Browse some pages, then ask again.",
    recoverable: true,
  },
  [ERROR_CODES.NO_RESULTS_IN_RANGE]: {
    code: ERROR_CODES.NO_RESULTS_IN_RANGE,
    userMessage: "No indexed visits in that time range.",
    userAction: "Try a wider time range or different keywords.",
    recoverable: true,
  },
  [ERROR_CODES.EMBEDDING_FAILED]: {
    code: ERROR_CODES.EMBEDDING_FAILED,
    userMessage: "Semantic indexing failed for part of your library.",
    userAction: "Retry later; keyword search may still work.",
    recoverable: true,
  },
  [ERROR_CODES.STORAGE_FULL]: {
    code: ERROR_CODES.STORAGE_FULL,
    userMessage: "Cortex storage limit reached.",
    userAction: "Clear old data from Cortex settings.",
    recoverable: true,
  },
  [ERROR_CODES.RATE_LIMITED]: {
    code: ERROR_CODES.RATE_LIMITED,
    userMessage: "Too many requests — slow down for a minute.",
    userAction: "Wait briefly, then try again.",
    recoverable: true,
  },
  [ERROR_CODES.INVALID_URL]: {
    code: ERROR_CODES.INVALID_URL,
    userMessage: "That link could not be opened.",
    userAction: undefined,
    recoverable: true,
  },
  [ERROR_CODES.FOREIGN_SENDER]: {
    code: ERROR_CODES.FOREIGN_SENDER,
    userMessage: "Request rejected.",
    userAction: undefined,
    recoverable: false,
  },
};

export function payloadFromCode(code: ErrorCode): {
  code: ErrorCode;
  message: string;
  userAction?: string;
  recoverable: boolean;
} {
  const row = ERROR_MESSAGES[code];
  return {
    code,
    message: row.userMessage,
    ...(row.userAction ? { userAction: row.userAction } : {}),
    recoverable: row.recoverable,
  };
}

/** Typed throwable — prefer over bare `Error` for user-facing flows. */
export class CortexError extends Error {
  readonly code: ErrorCode;

  constructor(
    code: ErrorCode,
    options?: { cause?: unknown; technicalDetail?: string }
  ) {
    const row = ERROR_MESSAGES[code];
    const msg = options?.technicalDetail
      ? `${row.userMessage} (${options.technicalDetail})`
      : row.userMessage;
    super(msg, options?.cause ? { cause: options.cause } : undefined);
    this.name = "CortexError";
    this.code = code;
  }

  toPayload(): ReturnType<typeof payloadFromCode> {
    return payloadFromCode(this.code);
  }
}
