import { redirect } from "next/navigation";

/**
 * Returns, Breakage & Empty Jar Custody
 * Replaced Phase 7 placeholder with direct route to complete Jar Custody & Disposal module.
 */
export default function ReturnsPage() {
  redirect("/jars");
}
