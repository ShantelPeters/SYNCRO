import { z } from 'zod';
import { safeUrlSchema } from './common';

const webhookEventSchema = z.enum([
  'subscription.renewal_due',
  'subscription.renewed',
  'subscription.renewal_failed',
  'subscription.cancelled',
  'subscription.risk_score_changed',
  'reminder.sent',
]);

export const createWebhookSchema = z.object({
  url: safeUrlSchema,
  events: z
    .array(webhookEventSchema)
    .min(1, 'At least one event type is required')
    .max(6, 'Maximum 6 event types per webhook'),
  description: z
    .string()
    .max(255, 'Description must not exceed 255 characters')
    .optional(),
});

export const updateWebhookSchema = z.object({
  url: safeUrlSchema.optional(),
  events: z
    .array(webhookEventSchema)
    .min(1, 'At least one event type is required')
    .max(6, 'Maximum 6 event types per webhook')
    .optional(),
  enabled: z.boolean().optional(),
  description: z
    .string()
    .max(255, 'Description must not exceed 255 characters')
    .optional(),
});
