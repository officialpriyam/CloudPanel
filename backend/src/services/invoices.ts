import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { formatMinor } from "../lib/money.js";

export async function createInvoicePdf(invoiceId: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { user: true }
  });
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 48 });
  doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(22).text("CloudPanel Invoice");
  doc.moveDown();
  doc.fontSize(12).text(`Invoice: ${invoice.number}`);
  doc.text(`Customer: ${invoice.user.name} <${invoice.user.email}>`);
  doc.text(`Issued: ${invoice.issuedAt.toISOString().slice(0, 10)}`);
  doc.moveDown();
  doc.text(`Subtotal: ${formatMinor(invoice.subtotal, invoice.currency)}`);
  doc.text(`Tax: ${formatMinor(invoice.tax, invoice.currency)}`);
  doc.fontSize(14).text(`Total: ${formatMinor(invoice.total, invoice.currency)}`);
  doc.end();

  return finished;
}
