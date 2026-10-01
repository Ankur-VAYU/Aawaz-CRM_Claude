import { z } from 'zod';

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Invalid email address').max(255));

// bcrypt only uses the first 72 bytes, so reject longer passwords instead of silently truncating.
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

export const name = z.string().trim().min(1, 'Name is required').max(120);
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Phone must be 7-15 digits, optionally starting with +');
const deviceName = z.string().trim().max(120).optional();

export const registerBody = z.object({
  name,
  email,
  password,
  phone: phone.optional(),
  deviceName,
});

export const loginBody = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
  deviceName,
});

export const refreshBody = z.object({ refreshToken: z.string().min(1) });

export const updateMeBody = z
  .object({ name: name.optional(), phone: phone.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
  deviceName,
});
