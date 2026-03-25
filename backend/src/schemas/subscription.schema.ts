import { z } from 'zod';

export const subscriptionCreateSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().max(100).optional(),
  price: z.number().min(0),
  billing_cycle: z.enum(['monthly', 'yearly', 'quarterly']),
  status: z.enum(['active', 'cancelled', 'paused', 'trial']).optional().default('active'),
  next_billing_date: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  logo_url: z.string().url().max(2000).optional(),
  website_url: z.string().url().max(2000).optional(),
  renewal_url: z.string().url().max(2000).optional(),
  notes: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).optional(),
  email_account_id: z.string().uuid().optional(),
});

export const subscriptionUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.string().max(100).optional(),
  price: z.number().min(0).optional(),
  billing_cycle: z.enum(['monthly', 'yearly', 'quarterly']).optional(),
  status: z.enum(['active', 'cancelled', 'paused', 'trial']).optional(),
  next_billing_date: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  logo_url: z.string().url().max(2000).optional(),
  website_url: z.string().url().max(2000).optional(),
  renewal_url: z.string().url().max(2000).optional(),
  notes: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).optional(),
});
