"use client";

import * as React from "react";
import { User, MapPin, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";

export default function CustomerProfilePage() {
  const { addToast } = useToast();
  const [name, setName] = React.useState("Sunita Sharma");
  const [email, setEmail] = React.useState("sunita.sharma@example.com");
  const [phone, setPhone] = React.useState("+91 98450 12345");
  const [addressLine, setAddressLine] = React.useState("Flat 402, Sai Nilaya Apts, 12th Main");
  const [landmark, setLandmark] = React.useState("Near Indiranagar Metro Station");
  const [pincode, setPincode] = React.useState("560038");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    addToast({
      type: "success",
      title: "Profile Updated",
      message: "Your delivery address and contact details have been saved.",
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title="Profile & Delivery Address"
        description="Manage your account contact information and default delivery drop-off point."
      />

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Contact Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                label="Phone Number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Default Delivery Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Apartment / House / Street"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              required
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Landmark / Locality"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
              />
              <Input
                label="PIN Code"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                required
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" className="gap-2">
            <Check className="h-4 w-4" />
            Save Profile Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
