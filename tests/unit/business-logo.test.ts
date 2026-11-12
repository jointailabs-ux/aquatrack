import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BusinessSettingsSchema,
  BusinessSettingsInput,
} from "@/modules/settings/business-settings.schema";
import {
  uploadBusinessLogo,
  removeBusinessLogo,
  getBusinessSettings,
} from "@/modules/settings/business-settings.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Business Logo & Branding Persistence", () => {
  const dummySettingsId = "99999999-9999-4999-a999-999999999999";
  const dummyUserId = "11111111-1111-4111-a111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. BusinessSettingsSchema Validation", () => {
    it("accepts valid business settings without logo_url", () => {
      const input: BusinessSettingsInput = {
        name: "AquaTrack Distribution",
        phone: "+91 9876543210",
        address: "Industrial Area, Phase 2, Bangalore",
        currency: "INR",
        default_jar_deposit: 150,
      };

      const parsed = BusinessSettingsSchema.parse(input);
      expect(parsed.name).toBe("AquaTrack Distribution");
      expect(parsed.logo_url).toBeUndefined();
    });

    it("accepts valid business settings with a persistent logo_url", () => {
      const input: BusinessSettingsInput = {
        name: "AquaTrack Distribution",
        phone: "+91 9876543210",
        address: "Industrial Area, Phase 2, Bangalore",
        currency: "INR",
        default_jar_deposit: 150,
        logo_url: "https://bplpyitmcqqebpdyochz.supabase.co/storage/v1/object/public/branding/logo.png",
      };

      const parsed = BusinessSettingsSchema.parse(input);
      expect(parsed.logo_url).toContain("supabase.co/storage");
    });

    it("allows logo_url to be set to null for logo removal", () => {
      const input: BusinessSettingsInput = {
        name: "AquaTrack Distribution",
        phone: "+91 9876543210",
        address: "Industrial Area, Phase 2, Bangalore",
        currency: "INR",
        default_jar_deposit: 150,
        logo_url: null,
      };

      const parsed = BusinessSettingsSchema.parse(input);
      expect(parsed.logo_url).toBeNull();
    });
  });

  describe("2. uploadBusinessLogo Validation & Blocker Reporting", () => {
    it("rejects upload when no file is provided in FormData", async () => {
      const formData = new FormData();
      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(false);
      expect(res.error).toContain("No image file provided");
    });

    it("rejects upload when file exceeds 2MB limit", async () => {
      const oversizedBlob = new Blob([new Uint8Array(2.5 * 1024 * 1024)], {
        type: "image/png",
      });
      const file = new File([oversizedBlob], "large-logo.png", { type: "image/png" });

      const formData = new FormData();
      formData.append("logo", file);

      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(false);
      expect(res.error).toContain("must be under 2MB");
    });

    it("rejects upload for unsupported MIME types (e.g. PDF or plain text)", async () => {
      const textBlob = new Blob(["not-an-image"], { type: "text/plain" });
      const file = new File([textBlob], "document.txt", { type: "text/plain" });

      const formData = new FormData();
      formData.append("logo", file);

      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Unsupported file format");
    });

    it("requires authenticated user to upload branding", async () => {
      const imageBlob = new Blob([new Uint8Array(100)], { type: "image/png" });
      const file = new File([imageBlob], "logo.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("logo", file);

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
      });

      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Authentication required");
    });

    it("reports exact Storage Infrastructure Blocker when no branding storage bucket exists", async () => {
      const imageBlob = new Blob([new Uint8Array(100)], { type: "image/png" });
      const file = new File([imageBlob], "logo.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("logo", file);

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: dummyUserId } } }),
        },
        storage: {
          listBuckets: vi.fn().mockResolvedValue({ data: [], error: null }),
        },
      });

      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Storage Infrastructure Blocker");
      expect(res.error).toContain("No active Supabase Storage bucket found for business branding");
    });

    it("reports exact Database Persistence Blocker when 'logo_url' column is missing in business_settings", async () => {
      const imageBlob = new Blob([new Uint8Array(100)], { type: "image/png" });
      const file = new File([imageBlob], "logo.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("logo", file);

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: dummyUserId } } }),
        },
        storage: {
          listBuckets: vi.fn().mockResolvedValue({
            data: [{ name: "branding", public: true }],
            error: null,
          }),
          from: () => ({
            upload: vi.fn().mockResolvedValue({ data: { path: "logo.png" }, error: null }),
            getPublicUrl: vi.fn().mockReturnValue({
              data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/branding/logo.png" },
            }),
          }),
        },
        from: (table: string) => {
          if (table === "business_settings") {
            return {
              select: () => ({
                limit: () => ({
                  single: async () => ({
                    data: { id: dummySettingsId },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: async () => ({
                  data: null,
                  error: { message: "column \"logo_url\" of relation \"business_settings\" does not exist" },
                }),
              }),
            };
          }
          return {};
        },
      });

      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(false);
      expect(res.error).toContain("Database Persistence Blocker");
      expect(res.error).toContain("Ensure the 'logo_url' column exists in the 'business_settings' table");
    });

    it("successfully uploads and persists logo when storage bucket and column exist", async () => {
      const imageBlob = new Blob([new Uint8Array(100)], { type: "image/png" });
      const file = new File([imageBlob], "logo.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("logo", file);

      const targetUrl = "https://example.supabase.co/storage/v1/object/public/branding/business-logo-123.png";

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: dummyUserId } } }),
        },
        storage: {
          listBuckets: vi.fn().mockResolvedValue({
            data: [{ name: "branding", public: true }],
            error: null,
          }),
          from: () => ({
            upload: vi.fn().mockResolvedValue({ data: { path: "business-logo-123.png" }, error: null }),
            getPublicUrl: vi.fn().mockReturnValue({
              data: { publicUrl: targetUrl },
            }),
          }),
        },
        from: (table: string) => {
          if (table === "business_settings") {
            return {
              select: () => ({
                limit: () => ({
                  single: async () => ({
                    data: { id: dummySettingsId },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: async () => ({
                  data: { id: dummySettingsId, logo_url: targetUrl },
                  error: null,
                }),
              }),
            };
          }
          return {};
        },
      });

      const res = await uploadBusinessLogo(formData);

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.logo_url).toBe(targetUrl);
      }
    });
  });

  describe("3. removeBusinessLogo", () => {
    it("clears persistent logo_url from business_settings", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: dummyUserId } } }),
        },
        from: (table: string) => {
          if (table === "business_settings") {
            return {
              select: () => ({
                limit: () => ({
                  single: async () => ({
                    data: { id: dummySettingsId, logo_url: "https://example.com/logo.png" },
                    error: null,
                  }),
                }),
              }),
              update: (payload: Record<string, unknown>) => ({
                eq: async () => {
                  expect(payload.logo_url).toBeNull();
                  return { data: { id: dummySettingsId, logo_url: null }, error: null };
                },
              }),
            };
          }
          return {};
        },
      });

      const res = await removeBusinessLogo();

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.success).toBe(true);
      }
    });
  });
});

