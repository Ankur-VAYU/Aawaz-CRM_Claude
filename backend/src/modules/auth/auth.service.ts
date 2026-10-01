import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { otpCodes, refreshTokens, stores, users, type User } from '../../db/schema.js';
import { tooManyRequests, unauthorized } from '../../lib/errors.js';
import { generateRefreshToken, hashToken } from '../../lib/tokens.js';
import type { MessageSender } from '../../messaging/sender.js';

const OTP_RESEND_SECONDS = 30;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;

export interface AuthOptions {
  otpSecret: string;
  otpTtlSeconds: number;
  otpDevEcho: boolean;
  refreshTtlDays: number;
}

export class AuthService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly db: Db,
    private readonly sender: MessageSender,
    private readonly opts: AuthOptions,
  ) {}

  private hashOtp(phone: string, code: string) {
    return crypto.createHmac('sha256', this.opts.otpSecret).update(`${phone}:${code}`).digest('hex');
  }

  async requestOtp(phone: string) {
    const [stats] = await this.db
      .select({
        lastHour: sql<number>`count(*)::int`,
        latest: sql<Date | null>`max(${otpCodes.createdAt})`,
      })
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, sql`now() - interval '1 hour'`)));

    if (stats.latest) {
      const waited = (Date.now() - new Date(stats.latest).getTime()) / 1000;
      if (waited < OTP_RESEND_SECONDS) {
        throw tooManyRequests('Please wait before requesting another code', Math.ceil(OTP_RESEND_SECONDS - waited));
      }
    }
    if (stats.lastHour >= OTP_MAX_PER_HOUR) {
      throw tooManyRequests('Too many codes requested. Try again in an hour', 3600);
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.db.insert(otpCodes).values({
      phone,
      codeHash: this.hashOtp(phone, code),
      expiresAt: new Date(Date.now() + this.opts.otpTtlSeconds * 1000),
    });
    await this.sender.send({
      to: phone,
      kind: 'otp',
      body: `AwaazCRM code: ${code}. Kisi ko na batayein. ${Math.round(this.opts.otpTtlSeconds / 60)} minute mein khatam.`,
    });
    return {
      expiresIn: this.opts.otpTtlSeconds,
      resendAfter: OTP_RESEND_SECONDS,
      ...(this.opts.otpDevEcho ? { devCode: code } : {}),
    };
  }

  async verifyOtp(phone: string, code: string, deviceName?: string) {
    const [otp] = await this.db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, new Date())))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!otp) throw unauthorized('Code expired or not requested. Request a new code');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw tooManyRequests('Too many wrong attempts. Request a new code');

    const expected = Buffer.from(otp.codeHash, 'hex');
    const given = Buffer.from(this.hashOtp(phone, code), 'hex');
    if (!crypto.timingSafeEqual(expected, given)) {
      await this.db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, otp.id));
      throw unauthorized('Wrong code');
    }

    // Consume atomically so the same code can't be used twice in parallel.
    const consumed = await this.db
      .update(otpCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    if (!consumed.length) throw unauthorized('Code already used. Request a new code');

    const [existing] = await this.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (existing && !existing.isActive) throw unauthorized('Account is deactivated');
    const [user] = existing
      ? await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, existing.id)).returning()
      : await this.db
          .insert(users)
          .values({ phone, lastLoginAt: new Date() })
          .onConflictDoUpdate({ target: users.phone, set: { lastLoginAt: new Date() } })
          .returning();

    const [store] = await this.db.select().from(stores).where(eq(stores.ownerId, user.id)).limit(1);
    const session = await this.issueSession(user, crypto.randomUUID(), deviceName);
    return { ...session, isNewUser: !existing, store: store ?? null };
  }

  /** Issues an access token plus a new refresh token in the given family. */
  async issueSession(user: User, familyId: string, deviceName?: string | null, tx: Db = this.db) {
    const refreshToken = generateRefreshToken();
    await tx.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId,
      deviceName: deviceName ?? null,
      expiresAt: new Date(Date.now() + this.opts.refreshTtlDays * 24 * 60 * 60 * 1000),
    });
    const accessToken = this.app.jwt.sign({ sub: user.id });
    const { exp } = this.app.jwt.decode<{ exp: number }>(accessToken)!;
    return {
      user,
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
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(presented)))
      .limit(1);
    if (!row) throw unauthorized('Invalid refresh token');

    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw unauthorized('Refresh token has been revoked');
    }
    if (row.expiresAt.getTime() <= Date.now()) throw unauthorized('Refresh token has expired');

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || !user.isActive) throw unauthorized('Account is not active');

    const session = await this.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // Conditional update guards against two concurrent refreshes with the same token.
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (revoked.length === 0) return null;
      return this.issueSession(user, row.familyId, row.deviceName, tx);
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

  async revokeAllForUser(userId: string) {
    await this.db
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
}
