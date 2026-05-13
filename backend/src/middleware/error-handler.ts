import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { isProduction } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: error.flatten()
        }
      });
      return;
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    requestLogSafe(app, normalized);
    reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
        details: isProduction ? undefined : normalized.message
      }
    });
  });
}

function requestLogSafe(app: FastifyInstance, error: Error) {
  app.log.error({ err: error }, "Unhandled request error");
}
