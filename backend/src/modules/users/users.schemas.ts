import { z } from 'zod';
import { userRole } from '../../db/schema.js';
import { email, name, password, phone } from '../auth/auth.schemas.js';

const role = z.enum(userRole.enumValues);

export const userIdParams = z.object({ id: z.uuid('Invalid user id') });

export const listUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  role: role.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const createUserBody = z.object({
  name,
  email,
  password,
  phone: phone.optional(),
  role: role.default('agent'),
});

export const updateUserBody = z
  .object({
    name: name.optional(),
    phone: phone.nullable().optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

export const resetPasswordBody = z.object({ newPassword: password });
