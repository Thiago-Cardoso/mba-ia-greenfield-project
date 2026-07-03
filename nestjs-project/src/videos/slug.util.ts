import { randomBytes } from 'crypto';

// URL-safe alphabet identical to nanoid's default (64 chars)
const ALPHABET =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function generateVideoSlug(size = 11): string {
  const bytes = randomBytes(size);
  let result = '';
  for (let i = 0; i < size; i++) {
    result += ALPHABET[bytes[i] & 63];
  }
  return result;
}
