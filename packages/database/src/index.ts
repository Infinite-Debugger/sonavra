import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

export * from './schema.js';

export function createDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const client = postgres(databaseUrl);
  return {
    client,
    db: drizzle(client),
  };
}
