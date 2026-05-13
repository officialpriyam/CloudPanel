import type { FastifyRequest } from "fastify";
import type { z, ZodTypeAny } from "zod";
import { badRequest } from "./errors.js";

export function parseBody<TSchema extends ZodTypeAny>(schema: TSchema, request: FastifyRequest): z.output<TSchema> {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    badRequest("Invalid request body", result.error.flatten());
  }
  return result.data;
}

export function parseQuery<TSchema extends ZodTypeAny>(schema: TSchema, request: FastifyRequest): z.output<TSchema> {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    badRequest("Invalid query parameters", result.error.flatten());
  }
  return result.data;
}

export function parseParams<TSchema extends ZodTypeAny>(schema: TSchema, request: FastifyRequest): z.output<TSchema> {
  const result = schema.safeParse(request.params);
  if (!result.success) {
    badRequest("Invalid route parameters", result.error.flatten());
  }
  return result.data;
}
