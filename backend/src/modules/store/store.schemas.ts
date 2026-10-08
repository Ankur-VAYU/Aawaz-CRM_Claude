import { z } from 'zod';
import { isValidGstin, isValidPan } from '../../lib/gst.js';

const text = (max: number) => z.string().trim().min(1).max(max);

export const createStoreBody = z.object({
  name: text(120),
  ownerName: text(120),
  city: text(80),
  state: text(60).optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'PIN code must be 6 digits').optional(),
  givesCredit: z.boolean().default(true),
  address: text(200).optional(),
});

export const updateStoreBody = createStoreBody
  .partial()
  .extend({
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'PIN code must be 6 digits').nullable().optional(),
    address: text(200).nullable().optional(),
    /** Allow sharing misunderstood commands so voice understanding can be improved. */
    voiceLogOptIn: z.boolean().optional(),
    summaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM')
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

const upper = z.string().trim().toUpperCase();

export const taxBody = z
  .object({
    gstin: upper.refine(isValidGstin, 'Invalid GSTIN').nullable().optional(),
    pan: upper.refine(isValidPan, 'Invalid PAN').nullable().optional(),
    legalName: text(160).nullable().optional(),
    /** Required with a GSTIN: regular (tax invoices) or composition (bill of supply). */
    gstScheme: z.enum(['regular', 'composition']).nullable().optional(),
    /** Whether item prices already include GST (MRP). */
    pricesIncludeTax: z.boolean().optional(),
  })
  .refine((b) => !(b.gstin && b.pan) || b.gstin.slice(2, 12) === b.pan, {
    message: 'PAN does not match the GSTIN',
    path: ['pan'],
  });

export const preferencesBody = z.object({
  language: z.enum(['hi', 'hinglish', 'en']),
  replyStyle: z.enum(['voice_text', 'text']),
});
