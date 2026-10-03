import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
export * from './schema.js';
export function createDatabase(connectionString = process.env.DATABASE_URL ?? 'postgresql://sonavra:sonavra@localhost:5432/sonavra') {
  const pool = new Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }),
    connect: async () => { const client = await pool.connect(); client.release(); },
    disconnect: () => pool.end(),
  };
}
export type SonavraDatabase = ReturnType<typeof createDatabase>;
