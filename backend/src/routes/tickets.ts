import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Role, TicketPriority, TicketStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { cursorQuerySchema, paginated } from "../lib/pagination.js";
import { forbidden, notFound } from "../lib/errors.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { requireAuth, requireRole } from "../services/auth.js";
import { writeAudit } from "../lib/audit.js";

const ticketCreateSchema = z.object({
  subject: z.string().min(3).max(180),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.NORMAL),
  body: z.string().min(5).max(8000)
});
const messageCreateSchema = z.object({
  body: z.string().min(1).max(8000),
  internal: z.boolean().default(false)
});
const idParams = z.object({ id: z.string() });

export async function ticketRoutes(app: FastifyInstance) {
  app.get("/tickets", async request => {
    const user = await requireAuth(request);
    const query = parseQuery(cursorQuerySchema, request);
    const items = await prisma.ticket.findMany({
      where: { userId: user.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.post("/tickets", async request => {
    const user = await requireAuth(request);
    const body = parseBody(ticketCreateSchema, request);
    const ticket = await prisma.ticket.create({
      data: {
        userId: user.id,
        subject: body.subject,
        priority: body.priority,
        messages: {
          create: { userId: user.id, body: body.body }
        }
      },
      include: { messages: true }
    });
    await writeAudit({ userId: user.id, action: "ticket.create", target: ticket.id, ip: request.ip });
    return { ticket };
  });

  app.get("/tickets/:id", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const ticket = await loadTicket(id, user.id, user.role);
    return { ticket };
  });

  app.post("/tickets/:id/messages", async request => {
    const user = await requireAuth(request);
    const { id } = parseParams(idParams, request);
    const body = parseBody(messageCreateSchema, request);
    const ticket = await loadTicket(id, user.id, user.role);
    if (body.internal && user.role === Role.CLIENT) {
      forbidden("Clients cannot create internal ticket notes");
    }
    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        userId: user.id,
        body: body.body,
        internal: body.internal
      }
    });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: user.role === Role.CLIENT ? TicketStatus.OPEN : TicketStatus.WAITING } });
    return { message };
  });

  app.get("/admin/tickets", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const query = parseQuery(cursorQuerySchema.extend({ status: z.nativeEnum(TicketStatus).optional() }), request);
    const items = await prisma.ticket.findMany({
      where: { status: query.status },
      include: { user: true, messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { id: "asc" },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1
    });
    return paginated(items, query.limit);
  });

  app.patch("/admin/tickets/:id", async request => {
    await requireRole(request, [Role.ADMIN, Role.OWNER, Role.SUPPORT]);
    const { id } = parseParams(idParams, request);
    const body = parseBody(z.object({ status: z.nativeEnum(TicketStatus) }), request);
    return { ticket: await prisma.ticket.update({ where: { id }, data: { status: body.status } }) };
  });
}

async function loadTicket(id: string, userId: string, role: Role) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
  if (!ticket) {
    notFound("Ticket not found");
  }
  if (role === Role.CLIENT && ticket.userId !== userId) {
    forbidden();
  }
  return ticket;
}
