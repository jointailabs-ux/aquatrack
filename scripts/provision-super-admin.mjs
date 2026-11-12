/**
 * AquaTrack ERP — Secure Owner & Business Provisioning Script
 * 
 * Single-Location Operations Architecture:
 * - Provisions the primary business entity in business_settings.
 * - Provisions the default central warehouse.
 * - Provisions the business Owner account with role = 'owner'.
 * - Checks and handles every Supabase API error explicitly.
 * - Requires explicit real environment variables; zero fictional defaults.
 * - Pre-flight verification of target auth user and profile before mutating state.
 * - Separates new-user creation from existing-user promotion.
 * - Uses service-role administrative authentication (auth.role() = 'service_role').
 * - NEVER prints passwords, tokens, or credentials to stdout or logs.
 * 
 * Required Environment Variables:
 *   OWNER_EMAIL              Target Owner email address (or ADMIN_EMAIL)
 *   OWNER_PASSWORD           Strong password (minimum 12 characters)
 *   OWNER_NAME               Full legal name of the business owner
 *   OWNER_PHONE              Official telephone number (+91...)
 *   BUSINESS_NAME            Registered legal name of the enterprise
 *   BUSINESS_TAX_ID          GSTIN / Tax ID
 *   BUSINESS_PHONE           Contact number for the facility
 *   BUSINESS_ADDRESS         Physical address of the facility / warehouse
 *   CONFIRM_PROVISIONING     Must be set to "YES" to proceed
 * 
 * Optional Flag:
 *   ALLOW_ROLE_PROMOTION     Set to "YES" to promote an existing non-owner account
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// 1. Load environment variables from .env.local if present
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("[ERROR] Missing SUPABASE_URL or SUPABASE_SECRET_KEY in server environment.");
  process.exit(1);
}

// 2. Safety Gate & Variable Validation
const confirmation = process.env.CONFIRM_PROVISIONING;
if (confirmation !== "YES") {
  console.error("================================================================================");
  console.error("[SAFETY HALT] Explicit confirmation required.");
  console.error('Set CONFIRM_PROVISIONING="YES" to execute owner and business provisioning.');
  console.error("================================================================================");
  process.exit(1);
}

const email = (process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL)?.trim();
const password = process.env.OWNER_PASSWORD || process.env.ADMIN_PASSWORD;
const fullName = (process.env.OWNER_NAME || process.env.ADMIN_NAME)?.trim();
const phone = (process.env.OWNER_PHONE || process.env.ADMIN_PHONE)?.trim();
const allowPromotion = process.env.ALLOW_ROLE_PROMOTION === "YES";

const businessName = (process.env.BUSINESS_NAME || process.env.ORGANIZATION_NAME)?.trim();
const taxId = (process.env.BUSINESS_TAX_ID || process.env.ORGANIZATION_TAX_ID)?.trim();
const businessPhone = (process.env.BUSINESS_PHONE || process.env.BRANCH_PHONE || phone)?.trim();
const businessAddress = (process.env.BUSINESS_ADDRESS || process.env.BRANCH_ADDRESS)?.trim();

if (!email || !password || !fullName || !phone) {
  console.error("[ERROR] Missing required administrator parameters (OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME, OWNER_PHONE).");
  process.exit(1);
}

if (password.length < 12) {
  console.error("[ERROR] Security Mandate: Password must be at least 12 characters long.");
  process.exit(1);
}

if (!businessName || !taxId || !businessAddress) {
  console.error("[ERROR] Missing required business parameters (BUSINESS_NAME, BUSINESS_TAX_ID, BUSINESS_ADDRESS).");
  process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 3. Paginated Auth User Search Helper
async function findAuthUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 50;
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to query auth users: ${error.message}`);
    }
    if (!data || !data.users || data.users.length === 0) break;

    const found = data.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase());
    if (found) return found;

    if (data.users.length < perPage) break;
    page++;
  }
  return null;
}

async function provisionOwnerAndBusiness() {
  console.log("================================================================================");
  console.log("AquaTrack ERP — Single-Location Owner & Business Provisioning");
  console.log("================================================================================");
  console.log(`Business Name:       ${businessName}`);
  console.log(`Tax ID / GSTIN:      ${taxId}`);
  console.log(`Target Owner Name:   ${fullName}`);
  console.log(`Target Owner Email:  ${email}`);
  console.log(`Target Owner Phone:  ${phone}`);
  console.log("--------------------------------------------------------------------------------");

  // PHASE 1: PRE-FLIGHT AUTH & PROFILE INSPECTION
  const existingUser = await findAuthUserByEmail(email);
  let existingProfile = null;

  if (existingUser) {
    console.log(`[PRE-FLIGHT] Located existing auth account (User ID: ${existingUser.id})`);

    const { data: prof, error: profErr } = await adminClient
      .from("profiles")
      .select("id, role, is_active, full_name")
      .eq("id", existingUser.id)
      .maybeSingle();

    if (profErr) {
      console.error("[ERROR] Failed to query existing profile for user:", profErr.message);
      process.exit(1);
    }
    existingProfile = prof;

    if (existingProfile && existingProfile.role !== "owner" && !allowPromotion) {
      console.error("================================================================================");
      console.error(`[SAFETY HALT] Target account (${email}) exists with role '${existingProfile.role}'.`);
      console.error("Silent elevation to 'owner' is strictly prohibited.");
      console.error('To deliberately elevate this account, set ALLOW_ROLE_PROMOTION="YES".');
      console.error("================================================================================");
      process.exit(1);
    }
  }

  // PHASE 2: ENSURE BUSINESS SETTINGS
  let businessSettingsId;
  const { data: existingSettings, error: searchSettingsErr } = await adminClient
    .from("business_settings")
    .select("id, name, tax_id")
    .limit(1)
    .maybeSingle();

  if (searchSettingsErr) {
    console.error("[ERROR] Failed to query business_settings:", searchSettingsErr.message);
    process.exit(1);
  }

  if (existingSettings) {
    businessSettingsId = existingSettings.id;
    console.log(`[OK] Located Existing Business Profile: ${existingSettings.name} (ID: ${businessSettingsId})`);
  } else {
    const { data: newSettings, error: newSettingsErr } = await adminClient
      .from("business_settings")
      .insert({
        name: businessName,
        trade_name: businessName,
        tax_id: taxId,
        phone: businessPhone,
        address: businessAddress,
        currency: "INR",
        default_jar_deposit: 150.0,
      })
      .select("id, name")
      .single();

    if (newSettingsErr) {
      console.error("[ERROR] Failed to insert business_settings:", newSettingsErr.message);
      process.exit(1);
    }
    businessSettingsId = newSettings.id;
    console.log(`[OK] Created Business Profile: ${newSettings.name} (ID: ${businessSettingsId})`);
  }

  // PHASE 3: ENSURE DEFAULT CENTRAL WAREHOUSE
  let warehouseId;
  const { data: existingWarehouse, error: searchWarehouseErr } = await adminClient
    .from("warehouses")
    .select("id, name")
    .eq("is_default", true)
    .maybeSingle();

  if (searchWarehouseErr) {
    console.error("[ERROR] Failed to query warehouses:", searchWarehouseErr.message);
    process.exit(1);
  }

  if (existingWarehouse) {
    warehouseId = existingWarehouse.id;
    console.log(`[OK] Located Existing Central Warehouse: ${existingWarehouse.name} (ID: ${warehouseId})`);
  } else {
    // Create Warehouse Location
    const { data: whLoc, error: whLocErr } = await adminClient
      .from("locations")
      .insert({
        type: "WAREHOUSE",
        name: "Central Warehouse",
        address: businessAddress,
        is_active: true,
      })
      .select("id")
      .single();

    if (whLocErr) {
      console.error("[ERROR] Failed to create warehouse location:", whLocErr.message);
      process.exit(1);
    }

    const { data: newWarehouse, error: newWarehouseErr } = await adminClient
      .from("warehouses")
      .insert({
        location_id: whLoc.id,
        name: "Central Warehouse Depot",
        address: businessAddress,
        is_default: true,
      })
      .select("id, name")
      .single();

    if (newWarehouseErr) {
      console.error("[ERROR] Failed to create central warehouse:", newWarehouseErr.message);
      process.exit(1);
    }
    warehouseId = newWarehouse.id;
    console.log(`[OK] Created Central Warehouse: ${newWarehouse.name} (ID: ${warehouseId})`);
  }

  // PHASE 4: PROVISION OWNER USER
  let finalUserId;

  if (existingUser) {
    finalUserId = existingUser.id;

    if (existingProfile) {
      console.log(`[PROVISION] Updating existing profile for user ${finalUserId} to owner...`);
      const { error: updateProfErr } = await adminClient
        .from("profiles")
        .update({
          full_name: fullName,
          phone,
          role: "owner",
          is_active: true,
          can_pos: true,
          can_warehouse: true,
          can_manage_customers: true,
          can_manage_orders: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", finalUserId);

      if (updateProfErr) {
        console.error("[ERROR] Failed to update existing user profile:", updateProfErr.message);
        process.exit(1);
      }
      console.log("[OK] Existing profile updated to owner.");
    } else {
      console.log(`[PROVISION] Inserting profile for existing auth user ${finalUserId}...`);
      const { error: insertProfErr } = await adminClient
        .from("profiles")
        .insert({
          id: finalUserId,
          full_name: fullName,
          phone,
          role: "owner",
          is_active: true,
          can_pos: true,
          can_warehouse: true,
          can_manage_customers: true,
          can_manage_orders: true,
        });

      if (insertProfErr) {
        console.error("[ERROR] Failed to insert profile for existing auth user:", insertProfErr.message);
        process.exit(1);
      }
      console.log("[OK] Profile created for existing auth user.");
    }
  } else {
    console.log(`[PROVISION] Creating new auth user for ${email}...`);
    const { data: newAuthData, error: createAuthErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: "owner" },
    });

    if (createAuthErr || !newAuthData?.user) {
      console.error("[ERROR] Failed to create auth user:", createAuthErr?.message);
      process.exit(1);
    }

    finalUserId = newAuthData.user.id;
    console.log(`[OK] Created Auth User (ID: ${finalUserId})`);

    const { error: insertProfErr } = await adminClient
      .from("profiles")
      .insert({
        id: finalUserId,
        full_name: fullName,
        phone,
        role: "owner",
        is_active: true,
        can_pos: true,
        can_warehouse: true,
        can_manage_customers: true,
        can_manage_orders: true,
      });

    if (insertProfErr) {
      console.error("[ERROR] Failed to insert profile for new auth user:", insertProfErr.message);
      console.log("[ROLLBACK] Deleting orphaned auth user...");
      await adminClient.auth.admin.deleteUser(finalUserId);
      process.exit(1);
    }
    console.log("[OK] Created Owner Profile.");
  }

  console.log("--------------------------------------------------------------------------------");
  console.log("[STATUS] SUCCESS: Owner & Business provisioned securely!");
  console.log(`  User ID:         ${finalUserId}`);
  console.log(`  Email:           ${email}`);
  console.log(`  Role:            owner`);
  console.log(`  Business ID:     ${businessSettingsId}`);
  console.log(`  Warehouse ID:    ${warehouseId}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("Zero credentials or secret keys were printed or logged.");
  console.log("================================================================================");
}

provisionOwnerAndBusiness().catch((err) => {
  console.error("[UNHANDLED EXCEPTION]", err.message || err);
  process.exit(1);
});
