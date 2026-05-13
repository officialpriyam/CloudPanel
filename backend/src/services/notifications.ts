import nodemailer from "nodemailer";
import twilio from "twilio";
import { request } from "undici";
import { env } from "../config/env.js";

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string }) {
  if (!env.SMTP_HOST) {
    return { skipped: true, reason: "SMTP is not configured" };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text
  });
  return { skipped: false };
}

export async function sendSms(input: { to: string; body: string }) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    return { skipped: true, reason: "Twilio is not configured" };
  }
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  await client.messages.create({ from: env.TWILIO_FROM, to: input.to, body: input.body });
  return { skipped: false };
}

export async function sendOpsAlert(message: string) {
  const deliveries: Array<Promise<unknown>> = [];
  if (env.DISCORD_WEBHOOK_URL) {
    deliveries.push(request(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message })
    }));
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    deliveries.push(request(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
    }));
  }
  await Promise.allSettled(deliveries);
}
