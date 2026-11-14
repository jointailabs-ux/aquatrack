import { z } from "zod";

export const StaffRoleEnum = z.enum(["owner", "staff"]);
export const SalaryTypeEnum = z.enum(["MONTHLY", "FIXED_PERIOD"]);

export const StaffInputSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email("Valid email required").optional(),
  full_name: z.string().min(2, "Full name must be at least 2 characters").max(150),
  phone: z.string().min(6, "Phone number must be at least 6 digits").max(20),
  role: StaffRoleEnum.default("staff"),
  can_pos: z.boolean().default(false),
  can_warehouse: z.boolean().default(false),
  can_manage_customers: z.boolean().default(false),
  can_manage_orders: z.boolean().default(false),
  salary_amount: z.number().nonnegative("Salary must be non-negative").default(0),
  salary_type: SalaryTypeEnum.default("MONTHLY"),
  is_active: z.boolean().default(true),
});

export type StaffInput = z.infer<typeof StaffInputSchema>;

export const CreateStaffAccountSchema = z.object({
  email: z.string().email("Valid email address is required").optional().or(z.literal("")),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
  login_pin: z.string().length(6, "PIN must be exactly 6 digits").regex(/^\d{6}$/, "PIN must be 6 numeric digits").default("123456"),
  full_name: z.string().min(2, "Full name must be at least 2 characters").max(150),
  phone: z.string().min(6, "Phone number must be at least 6 digits").max(20),
  can_pos: z.boolean().default(false),
  can_warehouse: z.boolean().default(false),
  can_manage_customers: z.boolean().default(false),
  can_manage_orders: z.boolean().default(true),
  salary_amount: z.number().nonnegative("Salary must be non-negative").default(0),
  salary_type: SalaryTypeEnum.default("MONTHLY"),
});

export type CreateStaffAccountInput = z.infer<typeof CreateStaffAccountSchema>;

export const StaffPinLoginSchema = z.object({
  staff_id: z.string().uuid("Please select a valid staff member"),
  pin: z.string().length(6, "PIN must be exactly 6 digits").regex(/^\d{6}$/, "PIN must be 6 numeric digits"),
});

export type StaffPinLoginInput = z.infer<typeof StaffPinLoginSchema>;

export const UpdateStaffPermissionsSchema = z.object({
  can_pos: z.boolean(),
  can_warehouse: z.boolean(),
  can_manage_customers: z.boolean(),
  can_manage_orders: z.boolean(),
});

export type UpdateStaffPermissionsInput = z.infer<typeof UpdateStaffPermissionsSchema>;

export interface StaffRecord {
  id: string;
  full_name: string;
  phone: string;
  role: "owner" | "staff";
  avatar_url?: string | null;
  is_active: boolean;
  can_pos: boolean;
  can_warehouse: boolean;
  can_manage_customers: boolean;
  can_manage_orders: boolean;
  salary_amount: number;
  salary_type: "MONTHLY" | "FIXED_PERIOD";
  login_pin?: string | null;
  created_at: string;
  updated_at: string;
  email?: string;
}
