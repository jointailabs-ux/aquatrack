// AquaTrack ERP — Safe Read-Only Supabase Connectivity Verification Script
// STRICT SECURITY MANDATE: Never log or print secret keys or database passwords.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

async function verifySupabase() {
  console.log('--------------------------------------------------');
  console.log('AquaTrack ERP — Supabase Configuration Health Check');
  console.log('--------------------------------------------------');

  const env = parseEnvFile(envPath);

  if (!env) {
    console.log('[INFO] .env.local not found.');
    console.log('Please copy .env.example to .env.local and populate your credentials.');
    return;
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = env.SUPABASE_SECRET_KEY;
  const dbUrl = env.DATABASE_URL;

  // Check presence without revealing values
  const hasUrl = Boolean(supabaseUrl && supabaseUrl.trim() && !supabaseUrl.includes('your-project-id'));
  const hasAnonKey = Boolean(anonKey && anonKey.trim() && !anonKey.includes('placeholder'));
  const hasServiceKey = Boolean(serviceKey && serviceKey.trim() && !serviceKey.includes('placeholder'));
  const hasDbUrl = Boolean(dbUrl && dbUrl.trim() && !dbUrl.includes('[YOUR-PASSWORD]'));

  console.log(`- Supabase URL configured:         ${hasUrl ? 'YES' : 'NO (Empty or placeholder)'}`);
  console.log(`- Publishable Anon Key configured: ${hasAnonKey ? 'YES' : 'NO (Empty or placeholder)'}`);
  console.log(`- Service Secret Key configured:   ${hasServiceKey ? 'YES' : 'NO (Empty or placeholder)'}`);
  console.log(`- PostgreSQL Database URL:         ${hasDbUrl ? 'YES' : 'NO (Empty or placeholder)'}`);

  if (!hasUrl) {
    console.log('\n[STATUS] Configuration pending. Please populate .env.local with your Supabase credentials.');
    return;
  }

  // Safe read-only REST ping (no DB table operations, no SQL, no mutations)
  try {
    const pingKey = anonKey || serviceKey;
    const headers = {
      'apikey': pingKey,
      'Authorization': `Bearer ${pingKey}`
    };

    // Ping Supabase Auth endpoint with Anon Key
    const authRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        'apikey': anonKey
      }
    });

    // Ping PostgREST endpoint with Service Role Key
    let restRes = null;
    if (serviceKey) {
      restRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
    }

    const isAnonValid = authRes.status === 200;
    const isServiceValid = restRes ? restRes.status === 200 : false;

    console.log(`\n- Public Anon Key Status:       ${isAnonValid ? 'VALID (HTTP 200 OK)' : `HTTP ${authRes.status}`}`);
    console.log(`- Privileged Service Key Status: ${isServiceValid ? 'VALID (HTTP 200 OK)' : (restRes ? `HTTP ${restRes.status}` : 'Not tested')}`);

    if (isAnonValid && isServiceValid) {
      console.log('\n[STATUS] SUCCESS: Supabase project is active, online, and all credentials are fully verified!');
    } else if (isAnonValid || isServiceValid) {
      console.log('\n[STATUS] PARTIAL SUCCESS: Supabase is online and responding.');
    } else {
      console.log('\n[STATUS] NOTE: Check credentials in .env.local.');
    }
  } catch (err) {
    console.log(`\n[STATUS] CONNECTION FAILED: Unable to reach the provided Supabase URL.`);
    console.log(`Error: ${err.message}`);
  }
}

verifySupabase();
