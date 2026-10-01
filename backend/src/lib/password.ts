import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Used when a login email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('aawaz-dummy-password', ROUNDS);
export const fakeVerify = (plain: string) => bcrypt.compare(plain, DUMMY_HASH);
