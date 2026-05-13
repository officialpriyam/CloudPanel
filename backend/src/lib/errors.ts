export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "APP_ERROR",
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function notFound(message = "Resource not found"): never {
  throw new AppError(404, message, "NOT_FOUND");
}

export function forbidden(message = "Forbidden"): never {
  throw new AppError(403, message, "FORBIDDEN");
}

export function unauthorized(message = "Unauthorized"): never {
  throw new AppError(401, message, "UNAUTHORIZED");
}

export function badRequest(message = "Invalid request", details?: unknown): never {
  throw new AppError(400, message, "BAD_REQUEST", details);
}
