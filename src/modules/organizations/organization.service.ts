"use server";

import {
  getBusinessSettings,
  updateBusinessSettings,
} from "../settings/business-settings.service";
import { OrganizationInput, OrganizationRecord } from "./organization.schema";
import { ActionResponse } from "@/types/api.types";

export async function getCurrentOrganization(): Promise<ActionResponse<OrganizationRecord>> {
  return getBusinessSettings();
}

export async function updateOrganization(
  id: string,
  input: OrganizationInput
): Promise<ActionResponse<OrganizationRecord>> {
  return updateBusinessSettings(id, input);
}
