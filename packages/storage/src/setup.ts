import { createS3ObjectStorageFromEnv } from './index.js';

const storage = createS3ObjectStorageFromEnv();

let lastError: unknown;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    await storage.ensureBucket();
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

throw lastError;
