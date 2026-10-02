import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDatabase } from './index.js';

const { client, db } = createDatabase();

try {
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
} finally {
  await client.end();
}
