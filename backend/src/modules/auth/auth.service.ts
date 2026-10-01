import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { refreshTokens, users, type User } from '../../db/schema.js';
import { conflict, unauthorized } from '../../lib/errors.js';
import { fakeVerify, hashPassword, verifyPassword } from '../../lib/password.js';
import { toPublicUser } from '../../lib/serialize.js';
import { generateRefreshToken, hashToken } from '../../lib/tokens.js';

const PG_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === PG_UNIQUE_VIOLATION || e?.cause?.code === PG_UNIQUE_VIOLATION;
}

export class AuthService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly db: Db,
    private readonly refreshTtlDays: number,
  ) {}

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    phone?: string | null;
    role?: User['role'];
  }) {
    const passwordHash = await hashPassword(input.password);
    try {
      const [user] = await this.db
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          passwordHash,
          phone: input.phone ?? null,
          role: input.role ?? 'agent',
        })
        .returning();
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An account with this email already exists');
      throw err;
    }
  }

  async login(emailAddr: string, plainPassword: string, deviceName?: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, emailAddr)).limit(1);
    if (!user) {
      await fakeVerify(plainPassword);
      throw unauthorized('Invalid email or password');
    }
    const ok = await verifyPassword(plainPassword, user.passwordHash);
    if (!ok) throw unauthorized('Invalid email or password');
    if (!user.isActive) throw unauthorized('Account is deactivated');

    const [updated] = await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return this.issueSession(updated, crypto.randomUUID(), deviceName);
  }

  /** Issues an access token plus a new refresh token in the given family. */
  async issueSession(user: User, familyId: string, deviceName?: string | null, tx: Db = this.db) {
    const refreshToken = generateRefreshToken();
    await tx.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId,
      deviceName: deviceName ?? null,
      expiresAt: new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000),
    });
    const accessToken = this.app.jwt.sign({ sub: user.id, role: user.role });
    const { exp } = this.app.jwt.decode<{ exp: number }>(accessToken)!;
    return {
      user: toPublicUser(user),
      accessToken,
      accessTokenExpiresIn: exp - Math.floor(Date.now() / 1000),
      refreshToken,
      tokenType: 'Bearer' as const,
    };
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new one issued.
   * Presenting an already-revoked token is treated as theft and revokes the whole family.
   */
  async refresh(presented: string) {
    const tokenHash = hashToken(presented);
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (!row) throw unauthorized('Invalid refresh token');

    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw unauthorized('Refresh token has been revoked');
    }
    if (row.expiresAt.getTime() <= Date.now()) throw unauthorized('Refresh token has expired');

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || !user.isActive) throw unauthorized('Account is not active');

    const session = await this.db.transaction(async (tx) => {
      // Conditional update guards against two concurrent refreshes with the same token.
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (revoked.length === 0) return null;
      return this.issueSession(user, row.familyId, row.deviceName, tx as unknown as Db);
    });
    if (!session) {
      await this.revokeFamily(row.familyId);
      throw unauthorized('Refresh token has been revoked');
    }
    return session;
  }

  /** Revokes the session (token family) the given refresh token belongs to. Idempotent. */
  async logout(presented: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, hashToken(presented)), eq(refreshTokens.userId, userId)))
      .limit(1);
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeAllForUser(userId: string, tx: Db = this.db) {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  private async revokeFamily(familyId: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async changePassword(user: User, currentPassword: string, newPassword: string, deviceName?: string) {
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw unauthorized('Current password is incorrect');
    const passwordHash = await hashPassword(newPassword);
    // Signs out every device, then starts a fresh session for the caller.
    return this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [updated] = await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, user.id))
        .returning();
      await this.revokeAllForUser(user.id, tx);
      return this.issueSession(updated, crypto.randomUUID(), deviceName, tx);
    });
  }
}
