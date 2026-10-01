import crypto from 'node:crypto';

export const generateRefreshToken = () => crypto.randomBytes(48).toString('base64url');
export const generateShareToken = () => crypto.randomBytes(24).toString('base64url');
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
