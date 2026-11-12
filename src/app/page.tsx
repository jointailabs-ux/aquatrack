import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import {
  Droplets,
  Truck,
  RotateCcw,
  Receipt,
  LayoutDashboard,
  ShoppingCart,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50/50 via-background to-background flex flex-col">
      {/* Top Header */}
      <header className="border-b border-border/80 bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Droplets className="h-6 w-6" />
            </div>
            <div>
              <span className="font-bold text-lg text-foreground tracking-tight block">
                AquaTrack <span className="text-primary font-normal">ERP</span>
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest block font-medium">
                Single-Location Operations Platform
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button size="sm" className="gap-2">
                Sign In to System
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-12 flex flex-col justify-center">
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-12">
          <div className="inline-flex items-center gap-2 mb-2">
            <Badge variant="primary" className="px-3 py-1 text-xs">
              Single Location • Streamlined Architecture
            </Badge>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground leading-tight">
            Complete Management for{" "}
            <span className="text-primary bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary-700 to-primary-900">
              Water Distribution & Bottling
            </span>
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Engineered for single-depot water distributors: 20L reusable jar custody accounting, driver delivery execution, counter POS sales, and double-entry managerial reports.
          </p>
        </div>

        {/* Gateway Cards for the Three Core Workflows */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full mb-12">
          {/* 1. Owner & Operations Portal */}
          <Card className="flex flex-col justify-between hover:border-primary/50 transition-all border-border shadow-xs">
            <CardHeader className="p-6">
              <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                <LayoutDashboard className="h-6 w-6" />
              </div>
              <CardTitle className="text-lg">Owner Command Center</CardTitle>
              <CardDescription>
                Full administrative access to customers, suppliers, inventory, purchases, expenses, staff salaries, and net profit.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <ul className="text-xs text-muted-foreground space-y-1.5 mb-6">
                <li className="flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-primary" />
                  Full vs Empty Jar Custody Engine
                </li>
                <li className="flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                  Real-time Unpaid Invoices & A/R
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  Accrual Sales, COGS & Net Profit
                </li>
              </ul>
              <Link href="/dashboard" className="w-full block">
                <Button className="w-full gap-2">
                  Enter Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* 2. Mobile Delivery Driver Interface */}
          <Card className="flex flex-col justify-between hover:border-primary/50 transition-all border-border shadow-xs">
            <CardHeader className="p-6">
              <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                <Truck className="h-6 w-6" />
              </div>
              <CardTitle className="text-lg">Driver Delivery App</CardTitle>
              <CardDescription>
                Mobile-optimized interface for route delivery staff. Record actual delivered quantities, empties collected, and cash/UPI.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <ul className="text-xs text-muted-foreground space-y-1.5 mb-6">
                <li className="flex items-center gap-2">
                  <Truck className="h-3.5 w-3.5 text-primary" />
                  Assigned Route Stops & Customer Info
                </li>
                <li className="flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-primary" />
                  Decoupled Jar Drop & Empty Counter
                </li>
                <li className="flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                  Instant UPI & Cash Recording
                </li>
              </ul>
              <Link href="/driver" className="w-full block">
                <Button variant="secondary" className="w-full gap-2 border-border">
                  Launch Delivery App
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* 3. Counter POS & Beverage Sales */}
          <Card className="flex flex-col justify-between hover:border-primary/50 transition-all border-border shadow-xs">
            <CardHeader className="p-6">
              <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                <ShoppingCart className="h-6 w-6" />
              </div>
              <CardTitle className="text-lg">Point of Sale (POS)</CardTitle>
              <CardDescription>
                Fast walk-in counter sales for water jars and packaged beverages with automatic inventory deduction and receipts.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <ul className="text-xs text-muted-foreground space-y-1.5 mb-6">
                <li className="flex items-center gap-2">
                  <ShoppingCart className="h-3.5 w-3.5 text-primary" />
                  Touch-friendly Product Catalog & Cart
                </li>
                <li className="flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-primary" />
                  Automatic Beverage Stock Decrement
                </li>
                <li className="flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                  Cash, UPI & Instant Bill Printing
                </li>
              </ul>
              <Link href="/dashboard/pos" className="w-full block">
                <Button variant="outline" className="w-full gap-2">
                  Launch Counter POS
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground bg-card">
        <p>AquaTrack ERP • Single-Location Water Distribution Platform</p>
        <p className="mt-1">
          Architected with Next.js App Router, TypeScript, Tailwind CSS & Supabase PostgreSQL.
        </p>
      </footer>
    </div>
  );
}
