import Stripe from "stripe";
import { GatewayProvider } from "@prisma/client";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { creditUser } from "./billing.js";

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" })
  : undefined;

export async function createTopupSession(input: {
  userId: string;
  email: string;
  amount: number;
  currency: string;
}) {
  if (!stripe) {
    throw new AppError(503, "Stripe is not configured", "GATEWAY_NOT_CONFIGURED");
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.email,
    client_reference_id: input.userId,
    success_url: `${env.FRONTEND_URL}/billing?payment=success`,
    cancel_url: `${env.FRONTEND_URL}/billing?payment=cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: input.amount,
          product_data: {
            name: "CloudPanel credits"
          }
        }
      }
    ],
    metadata: {
      userId: input.userId,
      amount: String(input.amount)
    }
  });
  return { provider: GatewayProvider.STRIPE, checkoutUrl: session.url, reference: session.id };
}

export async function handleStripeWebhook(rawBody: string, signature?: string) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(503, "Stripe webhooks are not configured", "GATEWAY_NOT_CONFIGURED");
  }
  if (!signature) {
    throw new AppError(400, "Missing Stripe signature", "WEBHOOK_SIGNATURE_MISSING");
  }
  const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id ?? session.metadata?.userId;
    const amount = Number(session.amount_total ?? session.metadata?.amount);
    if (userId && Number.isFinite(amount) && amount > 0) {
      await creditUser({
        userId,
        amount,
        currency: session.currency ?? "usd",
        gateway: GatewayProvider.STRIPE,
        gatewayRef: session.id,
        description: "Stripe credit top-up"
      });
    }
  }
  return { received: true, type: event.type };
}

export function assertGatewayConfigured(provider: GatewayProvider) {
  if (provider === GatewayProvider.STRIPE && !env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "Stripe is not configured", "GATEWAY_NOT_CONFIGURED");
  }
  if (provider === GatewayProvider.RAZORPAY && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) {
    throw new AppError(503, "Razorpay is not configured", "GATEWAY_NOT_CONFIGURED");
  }
  if (provider === GatewayProvider.PAYPAL && (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)) {
    throw new AppError(503, "PayPal is not configured", "GATEWAY_NOT_CONFIGURED");
  }
}
