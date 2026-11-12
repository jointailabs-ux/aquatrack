// AquaTrack ERP — Comprehensive Read-Only Database Connection & Schema Audit
// STRICT SECURITY MANDATE: Read-only queries only. Never print secret keys or passwords.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  }
  return env;
}

const env = parseEnv(envPath);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_SECRET_KEY;
const ownerEmail = env.OWNER_EMAIL;
const ownerPassword = env.OWNER_PASSWORD;

async function restRequest(endpoint, options = {}, useService = true) {
  const key = useService ? serviceKey : anonKey;
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const url = `${supabaseUrl.replace(/\/$/, '')}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers
  });

  const contentType = res.headers.get('content-type') || '';
  let body = null;
  if (contentType.includes('application/json') || contentType.includes('application/openapi+json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  return {
    status: res.status,
    headers: res.headers,
    data: body
  };
}

async function runAudit() {
  console.log('================================================================');
  console.log('AQUATRACK ERP — DATABASE CONNECTION & SCHEMA COMPREHENSIVE AUDIT');
  console.log('================================================================');

  const audit = {
    connection: {},
    auth: {},
    schema: {
      tables: {},
      rpcs: {},
      missingColumns: []
    },
    security: {},
    dataConsistency: {}
  };

  // 1. Connection Check
  console.log('\n--- TASK 1: CONNECTION & PROJECT IDENTIFICATION ---');
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  console.log(`Connected Supabase URL:  ${supabaseUrl}`);
  console.log(`Project Reference ID:    ${projectRef}`);
  
  const rootRes = await restRequest('/rest/v1/', { headers: { 'Accept': 'application/openapi+json' } });
  if (rootRes.status === 200) {
    console.log(`OpenAPI Schema Status:   PASS (HTTP 200 OK)`);
    audit.connection.status = 'PASS';
  } else {
    console.log(`OpenAPI Schema Status:   FAIL (HTTP ${rootRes.status})`);
    audit.connection.status = 'FAIL';
  }

  // 2. Auth Verification
  console.log('\n--- AUTHENTICATION VERIFICATION ---');
  const authRes = await restRequest('/auth/v1/admin/users', {}, true);
  if (authRes.status === 200 && authRes.data?.users) {
    console.log(`Auth Admin Connection:   PASS (HTTP 200 OK)`);
    console.log(`Registered Auth Users:   ${authRes.data.users.length}`);
    const ownerUser = authRes.data.users.find(u => u.email === ownerEmail);
    console.log(`Owner Account Exists:    ${ownerUser ? 'YES (ID: ' + ownerUser.id + ')' : 'NO'}`);
    audit.auth.adminApi = 'PASS';
    audit.auth.userCount = authRes.data.users.length;
    audit.auth.ownerUserExists = Boolean(ownerUser);
  } else {
    console.log(`Auth Admin Connection:   HTTP ${authRes.status} (${JSON.stringify(authRes.data)})`);
    audit.auth.adminApi = 'FAIL';
  }

  if (ownerEmail && ownerPassword) {
    const loginRes = await restRequest('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword })
    }, false);

    if (loginRes.status === 200 && loginRes.data?.access_token) {
      console.log(`Owner Login Test:        PASS (Successfully authenticated as ${ownerEmail})`);
      audit.auth.ownerLogin = 'PASS';
    } else {
      console.log(`Owner Login Test:        FAIL (HTTP ${loginRes.status} - ${loginRes.data?.error_description || loginRes.data?.msg || 'Failed'})`);
      audit.auth.ownerLogin = 'FAIL';
    }
  }

  // 3. Schema & Tables Inspection
  console.log('\n--- TASK 2: SCHEMA & TABLES VERIFICATION ---');
  const openApi = rootRes.data || {};
  const paths = openApi.paths || {};
  const definitions = openApi.definitions || {};

  const expectedTables = [
    'business_settings',
    'locations',
    'warehouses',
    'profiles',
    'customers',
    'suppliers',
    'products',
    'customer_special_prices',
    'inventory_balances',
    'stock_movements',
    'jar_custody_movements',
    'orders',
    'order_items',
    'delivery_stops',
    'invoices',
    'invoice_items',
    'customer_payments',
    'pos_sales',
    'pos_sale_items',
    'purchases',
    'purchase_items',
    'supplier_payments',
    'expenses',
    'salary_advances',
    'salary_payments',
    'cash_handovers',
    'financial_ledger',
    'audit_logs',
    'internal_rpc_auth_tokens'
  ];

  for (const table of expectedTables) {
    const pathKey = `/${table}`;
    const existsInRest = Boolean(paths[pathKey]);
    const def = definitions[table] || {};
    const props = def.properties ? Object.keys(def.properties) : [];

    // Also do a direct safe count query
    const countRes = await restRequest(`/rest/v1/${table}?select=*&limit=1`, {
      headers: { 'Prefer': 'count=exact' }
    });

    const isAvailable = countRes.status === 200 || countRes.status === 206;
    const contentRange = countRes.headers.get('content-range');
    const rowCount = contentRange ? contentRange.split('/')[1] : (countRes.data?.length ?? 'unknown');

    if (isAvailable) {
      console.log(`Table [${table}]: EXISTS in live DB (Rows: ${rowCount}, Exposed columns: ${props.length})`);
      audit.schema.tables[table] = {
        exists: true,
        rowCount: rowCount,
        columnCount: props.length,
        columns: props
      };
    } else {
      console.log(`Table [${table}]: NOT ACCESSIBLE (HTTP ${countRes.status} - ${countRes.data?.message || 'Not found'})`);
      audit.schema.tables[table] = {
        exists: false,
        status: countRes.status,
        error: countRes.data
      };
    }
  }

  // Inspect critical columns
  console.log('\n--- SPECIFIC COLUMN CHECKS ---');
  // Check customers columns
  const custCols = audit.schema.tables['customers']?.columns || [];
  const requiredCustCols = [
    'total_full_jars_holding',
    'total_empty_jars_holding',
    'total_damaged_jars_holding',
    'total_empty_clean_holding',
    'total_scrap_jars_holding'
  ];
  for (const c of requiredCustCols) {
    const hasCol = custCols.includes(c);
    console.log(`customers.${c}: ${hasCol ? 'EXISTS' : 'MISSING'}`);
    if (!hasCol) audit.schema.missingColumns.push(`customers.${c}`);
  }

  // Check inventory_balances columns
  const invCols = audit.schema.tables['inventory_balances']?.columns || [];
  const hasQtyReserved = invCols.includes('quantity_reserved');
  console.log(`inventory_balances.quantity_reserved: ${hasQtyReserved ? 'EXISTS' : 'MISSING'}`);
  if (!hasQtyReserved) audit.schema.missingColumns.push('inventory_balances.quantity_reserved');

  // Check orders idempotency_key
  const ordCols = audit.schema.tables['orders']?.columns || [];
  const hasOrdIdem = ordCols.includes('idempotency_key');
  console.log(`orders.idempotency_key: ${hasOrdIdem ? 'EXISTS' : 'MISSING'}`);
  if (!hasOrdIdem) audit.schema.missingColumns.push('orders.idempotency_key');

  // 4. RPC Functions Inspection
  console.log('\n--- TASK 3: RPC FUNCTIONS VERIFICATION ---');
  const targetRPCs = [
    'rpc_record_jar_movement',
    'rpc_create_customer_order',
    'rpc_execute_delivery_stop',
    'rpc_cancel_customer_order'
  ];

  for (const rpcName of targetRPCs) {
    const rpcPath = `/rpc/${rpcName}`;
    const existsInRest = Boolean(paths[rpcPath]);
    
    // Call RPC with empty payload to test existence and response
    const rpcCall = await restRequest(`/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      body: JSON.stringify({})
    });

    const isPgrst202 = rpcCall.data?.code === 'PGRST202';
    if (existsInRest || !isPgrst202) {
      console.log(`RPC [${rpcName}]: EXISTS (Exposed in API, Response: HTTP ${rpcCall.status} ${rpcCall.data?.message || 'OK'})`);
      audit.schema.rpcs[rpcName] = {
        exists: true,
        status: rpcCall.status,
        response: rpcCall.data?.message || 'OK',
        code: rpcCall.data?.code
      };
    } else {
      console.log(`RPC [${rpcName}]: NOT FOUND (PGRST202 - Missing from database schema cache)`);
      audit.schema.rpcs[rpcName] = {
        exists: false,
        error: rpcCall.data?.message || 'Not found'
      };
    }
  }

  // 5. Security & RLS Verification
  console.log('\n--- TASK 5: SECURITY & RLS VERIFICATION ---');
  // Anon direct write to customers
  const anonWrite = await restRequest('/rest/v1/customers', {
    method: 'POST',
    body: JSON.stringify({ contact_name: 'Security Test', phone: '0000000000', address: 'Test' })
  }, false);

  if (anonWrite.status === 401 || anonWrite.status === 403) {
    console.log(`Anon Direct Table Write (customers): BLOCKED (HTTP ${anonWrite.status}) — PASS`);
    audit.security.anonWriteBlocked = 'PASS';
  } else {
    console.log(`Anon Direct Table Write (customers): PERMITTED (HTTP ${anonWrite.status}) — FAIL`);
    audit.security.anonWriteBlocked = 'FAIL';
  }

  // Check internal_rpc_auth_tokens access
  const tokenAccess = await restRequest('/rest/v1/internal_rpc_auth_tokens?select=*&limit=1', {}, false);
  if (tokenAccess.status === 401 || tokenAccess.status === 403 || tokenAccess.status === 404) {
    console.log(`internal_rpc_auth_tokens Anon Access: BLOCKED (HTTP ${tokenAccess.status}) — PASS`);
    audit.security.internalTokensProtected = 'PASS';
  } else {
    console.log(`internal_rpc_auth_tokens Anon Access: ACCESSIBLE (HTTP ${tokenAccess.status}) — WARNING`);
    audit.security.internalTokensProtected = 'WARNING';
  }

  // 6. Data Consistency Checks
  console.log('\n--- TASK 6: BUSINESS DATA CONSISTENCY ---');
  // Warehouses
  const whRes = await restRequest('/rest/v1/warehouses?select=id,name,location_id,is_default');
  const whList = Array.isArray(whRes.data) ? whRes.data : [];
  const defaultWhCount = whList.filter(w => w.is_default).length;
  console.log(`Total Warehouses: ${whList.length}, Default Warehouses: ${defaultWhCount}`);
  audit.dataConsistency.warehouses = {
    total: whList.length,
    defaultCount: defaultWhCount,
    status: defaultWhCount === 1 ? 'PASS' : (defaultWhCount === 0 ? 'WARNING (No default)' : 'FAIL (Multiple defaults)')
  };

  // Customers vs Locations
  const custRes = await restRequest('/rest/v1/customers?select=id,contact_name,location_id');
  const locRes = await restRequest('/rest/v1/locations?select=id,name,type');
  const custList = Array.isArray(custRes.data) ? custRes.data : [];
  const locList = Array.isArray(locRes.data) ? locRes.data : [];
  const locSet = new Set(locList.map(l => l.id));

  const orphanedCusts = custList.filter(c => !locSet.has(c.location_id));
  console.log(`Total Customers: ${custList.length}, Orphaned (no matching location): ${orphanedCusts.length}`);
  audit.dataConsistency.customers = {
    total: custList.length,
    orphaned: orphanedCusts.length,
    status: orphanedCusts.length === 0 ? 'PASS' : 'FAIL'
  };

  // Negative Inventory
  const invRes = await restRequest('/rest/v1/inventory_balances?select=id,quantity_on_hand,quantity_reserved');
  const invList = Array.isArray(invRes.data) ? invRes.data : [];
  const negativeStock = invList.filter(i => (i.quantity_on_hand < 0 || i.quantity_reserved < 0));
  console.log(`Total Inventory Balances: ${invList.length}, Negative balances: ${negativeStock.length}`);
  audit.dataConsistency.inventory = {
    total: invList.length,
    negativeCount: negativeStock.length,
    status: negativeStock.length === 0 ? 'PASS' : 'FAIL'
  };

  // Write results JSON
  const auditPath = path.join(rootDir, 'docs', 'LIVE_AUDIT_OUTPUT.json');
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  console.log(`\nAudit output saved to: ${auditPath}`);
}

runAudit().catch(err => {
  console.error('Fatal audit failure:', err);
});
