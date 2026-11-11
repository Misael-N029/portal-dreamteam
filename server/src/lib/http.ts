import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = (msg = "No tienes permisos para esta acción") => new HttpError(403, msg);
export const notFound = (msg = "Recurso no encontrado") => new HttpError(404, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue.path.join(".");
    res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ");
      res.status(409).json({ error: `Ya existe un registro con ese ${target ?? "valor"}` });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Recurso no encontrado" });
      return;
    }
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "El archivo supera el tamaño máximo (5 MB)" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
};
