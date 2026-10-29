import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');

function loadEnv() {
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

export const config = {
  PORT: parseInt(process.env.PORT || '3333', 10),
  MUITOVERDE_API_KEY: process.env.MUITOVERDE_API_KEY || '',
  MUITOVERDE_BASE_URL: (process.env.MUITOVERDE_BASE_URL || 'https://muitoverde.com.br')
    .replace('https://api.muitoverde.com.br', 'https://muitoverde.com.br')
    .replace(/\/$/, '')
};
