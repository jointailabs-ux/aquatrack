-- ==============================================================================
-- Migration: 20261115000001_staff_pin_login_and_auth_fix.sql
-- Description: Add 6-digit staff login PIN and allow seamless service-role user creation
-- ==============================================================================

-- 1. Add login_pin column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_pin VARCHAR(6);

UPDATE public.profiles 
SET login_pin = '123456' 
WHERE login_pin IS NULL;

-- 2. Allow service-role and internal auth hooks to insert profiles
CREATE OR REPLACE FUNCTION public.check_profile_insert_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller_role VARCHAR;
BEGIN
    v_is_service_role := (
        auth.role() = 'service_role' OR 
        current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') OR
        current_setting('request.jwt.claim.role', true) = 'service_role'
    );

    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL AND current_setting('request.jwt.claim.sub', true) IS NULL THEN
        RETURN NEW;
    END IF;

    v_caller_role := public.get_user_role();

    IF v_caller_role = 'owner' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access denied: unauthorized profile creation.';
END;
$$;

-- 3. Fix check_profile_update_privileges for service_role and internal updates
CREATE OR REPLACE FUNCTION public.check_profile_update_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller_role VARCHAR;
BEGIN
    v_is_service_role := (
        auth.role() = 'service_role' OR 
        current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') OR
        current_setting('request.jwt.claim.role', true) = 'service_role'
    );

    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL AND current_setting('request.jwt.claim.sub', true) IS NULL THEN
        RETURN NEW;
    END IF;

    v_caller_role := public.get_user_role();

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller has no active profile.';
    END IF;

    IF NEW.id = auth.uid() THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot alter their own role.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Security violation: users cannot alter their own active status.';
        END IF;
    ELSE
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Access denied: only the owner can modify other staff profiles.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 4. Fix handle_new_user to read role, phone, and login_pin from user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_owner BOOLEAN;
    v_role VARCHAR;
    v_pin VARCHAR;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'owner') INTO v_has_owner;

    v_role := COALESCE(NEW.raw_user_meta_data->>'role', CASE WHEN NOT v_has_owner THEN 'owner' ELSE 'staff' END);
    v_pin := COALESCE(NEW.raw_user_meta_data->>'login_pin', '123456');

    INSERT INTO public.profiles (
        id,
        full_name,
        phone,
        role,
        login_pin,
        is_active,
        can_pos,
        can_warehouse,
        can_manage_customers,
        can_manage_orders,
        can_deliveries,
        can_manage_suppliers,
        can_manage_expenses,
        can_manage_salaries,
        salary_amount,
        salary_type
    ) VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, 'AquaTrack Staff'),
        COALESCE(NEW.raw_user_meta_data->>'phone', '9999999999'),
        v_role,
        v_pin,
        true,
        COALESCE((NEW.raw_user_meta_data->>'can_pos')::boolean, v_role = 'owner'),
        COALESCE((NEW.raw_user_meta_data->>'can_warehouse')::boolean, v_role = 'owner'),
        COALESCE((NEW.raw_user_meta_data->>'can_manage_customers')::boolean, v_role = 'owner'),
        COALESCE((NEW.raw_user_meta_data->>'can_manage_orders')::boolean, true),
        COALESCE((NEW.raw_user_meta_data->>'can_deliveries')::boolean, true),
        COALESCE((NEW.raw_user_meta_data->>'can_manage_suppliers')::boolean, v_role = 'owner'),
        COALESCE((NEW.raw_user_meta_data->>'can_manage_expenses')::boolean, v_role = 'owner'),
        COALESCE((NEW.raw_user_meta_data->>'can_manage_salaries')::boolean, v_role = 'owner'),
        COALESCE((NEW.raw_user_meta_data->>'salary_amount')::numeric, 0.00),
        COALESCE(NEW.raw_user_meta_data->>'salary_type', 'MONTHLY')
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        role = EXCLUDED.role,
        login_pin = COALESCE(EXCLUDED.login_pin, profiles.login_pin),
        is_active = true,
        updated_at = pg_catalog.now();

    RETURN NEW;
END;
$$;

