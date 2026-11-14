"use client";

import * as React from "react";
import {
  Settings,
  Building2,
  RotateCcw,
  Warehouse,
  ShieldCheck,
  Upload,
  Trash2,
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  Sun,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  getBusinessSettings,
  updateBusinessSettings,
  uploadBusinessLogo,
  removeBusinessLogo,
} from "@/modules/settings/business-settings.service";
import { BusinessSettingsRecord } from "@/modules/settings/business-settings.schema";

export default function BusinessSettingsPage() {
  const { addToast } = useToast();
  const [settings, setSettings] = React.useState<BusinessSettingsRecord | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);

  // Form states
  const [name, setName] = React.useState("AquaTrack Water Solutions");
  const [tradeName, setTradeName] = React.useState("AquaTrack Purified Water");
  const [taxId, setTaxId] = React.useState("29AABCU9603R1ZX");
  const [phone, setPhone] = React.useState("+91 80 4123 4567");
  const [email, setEmail] = React.useState("contact@aquatrack.in");
  const [address, setAddress] = React.useState("Plot 12, Industrial Layout, Whitefield, Bangalore - 560066");
  const [defaultJarDeposit, setDefaultJarDeposit] = React.useState(150);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Logo state
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = React.useState(false);
  const [logoBlockerError, setLogoBlockerError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    async function load() {
      const res = await getBusinessSettings();
      if (res.success && res.data) {
        setSettings(res.data);
        setName(res.data.name);
        setTradeName(res.data.trade_name || "");
        setTaxId(res.data.tax_id || "");
        setPhone(res.data.phone);
        setEmail(res.data.email || "");
        setAddress(res.data.address);
        setDefaultJarDeposit(res.data.default_jar_deposit);
        if (res.data.logo_url) {
          setLogoUrl(res.data.logo_url);
        }
      }
    }
    load();
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      addToast({
        type: "error",
        title: "File Too Large",
        message: "Business logo must be under 2MB in size.",
      });
      return;
    }

    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      addToast({
        type: "error",
        title: "Unsupported Format",
        message: "Please upload a PNG, JPG, WebP, or SVG image.",
      });
      return;
    }

    setIsUploadingLogo(true);
    setLogoBlockerError(null);

    // Instant local preview
    const previewUrl = URL.createObjectURL(file);
    const previousLogo = logoUrl;
    setLogoUrl(previewUrl);

    try {
      const formData = new FormData();
      formData.append("logo", file);

      const res = await uploadBusinessLogo(formData);
      if (res.success && res.data?.logo_url) {
        setLogoUrl(res.data.logo_url);
        window.dispatchEvent(
          new CustomEvent("aquatrack_logo_updated", { detail: res.data.logo_url })
        );
        addToast({
          type: "success",
          title: "Logo Persisted",
          message: "Business logo saved to storage and persisted across devices.",
        });
      } else {
        setLogoUrl(previousLogo);
        const errMsg = res.error || "Failed to persist business logo.";
        setLogoBlockerError(errMsg);
        addToast({
          type: "error",
          title: "Logo Persistence Blocked",
          message: errMsg,
        });
      }
    } catch (err: unknown) {
      setLogoUrl(previousLogo);
      const errMsg = err instanceof Error ? err.message : "Failed to upload business logo.";
      setLogoBlockerError(errMsg);
      addToast({
        type: "error",
        title: "Upload Failed",
        message: errMsg,
      });
    } finally {
      setIsUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveLogo = async () => {
    setIsRemovingLogo(true);
    setLogoBlockerError(null);
    const previousLogo = logoUrl;
    setLogoUrl(null);

    try {
      const res = await removeBusinessLogo();
      if (res.success) {
        window.dispatchEvent(
          new CustomEvent("aquatrack_logo_updated", { detail: null })
        );
        addToast({
          type: "success",
          title: "Logo Removed",
          message: "Business logo cleared. Default branding restored across application.",
        });
      } else {
        setLogoUrl(previousLogo);
        const errMsg = res.error || "Failed to remove business logo.";
        setLogoBlockerError(errMsg);
        addToast({
          type: "error",
          title: "Removal Failed",
          message: errMsg,
        });
      }
    } catch (err: unknown) {
      setLogoUrl(previousLogo);
      const errMsg = err instanceof Error ? err.message : "Failed to remove business logo.";
      setLogoBlockerError(errMsg);
      addToast({
        type: "error",
        title: "Removal Failed",
        message: errMsg,
      });
    } finally {
      setIsRemovingLogo(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (settings) {
      await updateBusinessSettings(settings.id, {
        name,
        trade_name: tradeName,
        tax_id: taxId,
        phone,
        email,
        address,
        default_jar_deposit: defaultJarDeposit,
      });
    }

    setIsSubmitting(false);
    setIsEditing(false);
    addToast({
      type: "success",
      title: "Settings Saved",
      message: "Business profile and tax configuration updated.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Business Profile & Enterprise Settings
            </h1>
            <Badge variant="primary" className="text-xs">
              Single Location
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Configure primary enterprise information, GSTIN details, default jar deposit, and single warehouse depot.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setIsEditing(!isEditing)}
          variant={isEditing ? "outline" : "primary"}
          className="gap-2 text-xs"
        >
          <Settings className="h-4 w-4" />
          {isEditing ? "Cancel Editing" : "Edit Business Settings"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: Business Settings Form */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="border-border shadow-xs">
            <CardHeader className="p-5 pb-3 border-b border-border">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Enterprise Identification
              </CardTitle>
              <CardDescription className="text-xs">
                Printed on customer sale invoices, delivery manifests, and POS receipts.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-5">
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Legal Business Name *
                    </label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={!isEditing}
                      className="text-xs font-medium"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Trade Name / Brand
                    </label>
                    <Input
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      disabled={!isEditing}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      GSTIN (Tax ID)
                    </label>
                    <Input
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      disabled={!isEditing}
                      className="text-xs font-mono uppercase"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Phone Number *
                    </label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={!isEditing}
                      className="text-xs"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Contact Email
                    </label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={!isEditing}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Depot Physical Address *
                  </label>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    disabled={!isEditing}
                    className="text-xs"
                    required
                  />
                </div>

                {/* Default Jar Deposit Policy */}
                <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <RotateCcw className="h-4 w-4 text-primary" />
                        Default 20L Jar Security Deposit
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Assigned automatically to new customer accounts as refundable liability.
                      </p>
                    </div>
                    <div className="w-32">
                      <Input
                        type="number"
                        value={defaultJarDeposit}
                        onChange={(e) => setDefaultJarDeposit(Number(e.target.value))}
                        disabled={!isEditing}
                        className="text-xs font-bold text-right"
                      />
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSubmitting}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    >
                      {isSubmitting ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right 4 Cols: Single Depot Status & Security Architecture */}
        <div className="lg:col-span-4 space-y-4">
          {/* Logo & Branding Management */}
          {/* Theme & Appearance */}
          <Card className="border-border shadow-xs bg-card">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                Theme & Interface Appearance (থিম নির্বাচন)
              </CardTitle>
              <CardDescription className="text-xs">
                Switch between Light, Dark, or System mode.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20">
                <span className="text-muted-foreground font-medium">Color Mode:</span>
                <ThemeToggle variant="segmented" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                In Dark Mode, high-contrast luminous accents reduce eye strain in warehouse depots. In Light Mode, clean pastel cards ensure maximum daytime clarity.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border shadow-xs bg-card">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                Business Logo & Branding
              </CardTitle>
              <CardDescription className="text-xs">
                Displayed in sidebar navigation, invoices, and manifests.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-4 space-y-4">
              {/* Blocker alert if infrastructure is missing */}
              {logoBlockerError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-800 dark:text-rose-300 space-y-1">
                  <p className="font-bold flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Infrastructure Blocker
                  </p>
                  <p className="text-muted-foreground break-words leading-relaxed">
                    {logoBlockerError}
                  </p>
                </div>
              )}

              <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-border rounded-xl bg-muted/10 min-h-[140px]">
                {isUploadingLogo ? (
                  <div className="flex flex-col items-center justify-center text-center py-4 space-y-2">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    <p className="text-xs font-medium text-muted-foreground">Uploading to storage...</p>
                  </div>
                ) : logoUrl ? (
                  <div className="relative group flex items-center justify-center w-28 h-28 rounded-lg bg-background border border-border p-2 overflow-hidden shadow-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt="Business Logo Preview"
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-3 space-y-1.5">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">No Logo Configured</p>
                      <p className="text-[11px] text-muted-foreground">
                        PNG, JPG, SVG, or WebP up to 2MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleLogoUpload}
                accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                disabled={isUploadingLogo || isRemovingLogo}
                className="hidden"
              />

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isUploadingLogo || isRemovingLogo}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 text-xs gap-1.5"
                >
                  {isUploadingLogo ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      {logoUrl ? "Replace Logo" : "Upload Logo"}
                    </>
                  )}
                </Button>

                {logoUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isUploadingLogo || isRemovingLogo}
                    onClick={handleRemoveLogo}
                    className="text-xs gap-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                  >
                    {isRemovingLogo ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Removing...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-xs bg-card">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-primary" />
                Depot Architecture
              </CardTitle>
            </CardHeader>

            <CardContent className="p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20">
                <span className="text-muted-foreground">Operating Locations:</span>
                <Badge variant="primary" className="text-[10px]">
                  1 Central Depot
                </Badge>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20">
                <span className="text-muted-foreground">Branch Hierarchy:</span>
                <span className="font-bold text-foreground">Disabled (Simplified)</span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20">
                <span className="text-muted-foreground">Customer Self-Service:</span>
                <span className="font-bold text-foreground">Disabled (Internal Only)</span>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] text-emerald-800 dark:text-emerald-300 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  CIS Security Baseline Enforced
                </p>
                <p className="text-muted-foreground">
                  RLS enabled on every table. Dual-entry movements are immutable. Service-role triggers secured.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
