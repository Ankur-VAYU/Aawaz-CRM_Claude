import type { User } from '../db/schema.js';

export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}
