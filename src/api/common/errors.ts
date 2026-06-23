export const Errors = {
  validation: (message: string) => ({ error: "VALIDATION_ERROR", message }),
  unauthorized: () => ({ error: "UNAUTHORIZED", message: "Authentication required." }),
  notFound: (message: string) => ({ error: "NOT_FOUND", message }),
  rateLimited: () => ({ error: "RATE_LIMITED", message: "Too many requests. Try again later." }),
  internal: () => ({ error: "INTERNAL_ERROR", message: "Something went wrong." }),
  replyTimeout: () => ({ error: "REPLY_TIMEOUT", message: "Reply took too long. Please try again." }),
  invalidOtp: () => ({ error: "INVALID_OTP", message: "Incorrect or expired code." }),
  userNotFound: () => ({ error: "USER_NOT_FOUND", message: "No meCove account linked to this number." }),
  conflict: (message: string) => ({ error: "CONFLICT", message }),
  forbidden: (message = "You do not have access to this resource.") => ({ error: "FORBIDDEN", message }),
};
