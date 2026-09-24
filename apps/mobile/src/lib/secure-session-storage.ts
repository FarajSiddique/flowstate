import * as SecureStore from 'expo-secure-store';

// SecureStore values should stay under 2048 bytes, and a Supabase session is larger.
// Split each value into chunks of at most 500 code points (at most 2000 bytes of UTF-8)
// and record how many chunks there are under `<key>.chunks`.
const CHUNK_LENGTH = 500;

const countKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

async function chunkCount(key: string): Promise<number> {
  const count = Number(await SecureStore.getItemAsync(countKey(key)));

  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function removeChunks(key: string, from: number, to: number) {
  await Promise.all(
    Array.from({ length: Math.max(0, to - from) }, (_, offset) =>
      SecureStore.deleteItemAsync(chunkKey(key, from + offset)),
    ),
  );
}

// Supabase auth storage adapter backed by the iOS Keychain / Android Keystore.
export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await chunkCount(key);

    if (!count) {
      return null;
    }

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    );

    // A missing chunk means an interrupted write; treat it as signed out.
    return chunks.some((chunk) => chunk === null) ? null : chunks.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await chunkCount(key);
    // Split by code point so a surrogate pair never straddles two chunks.
    const codePoints = Array.from(value);
    const chunks = Array.from(
      { length: Math.max(1, Math.ceil(codePoints.length / CHUNK_LENGTH)) },
      (_, index) => codePoints.slice(index * CHUNK_LENGTH, (index + 1) * CHUNK_LENGTH).join(''),
    );

    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
    await removeChunks(key, chunks.length, previousCount);
  },

  async removeItem(key: string): Promise<void> {
    const count = await chunkCount(key);

    await SecureStore.deleteItemAsync(countKey(key));
    await removeChunks(key, 0, count);
  },
};
