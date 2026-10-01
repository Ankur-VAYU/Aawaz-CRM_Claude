import { z } from 'zod';
import { normalizePhone } from '../../lib/phone.js';

export const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number' });
      return z.NEVER;
    }
    return normalized;
  });

export const name = z.string().trim().min(1, 'Name is required').max(120);
const deviceName = z.string().trim().max(120).optional();

export const requestOtpBody = z.object({ phone });
export const verifyOtpBody = z.object({
  phone,
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
  deviceName,
});
export const refreshBody = z.object({ refreshToken: z.string().min(1) });
export const updateMeBody = z.object({ name });
