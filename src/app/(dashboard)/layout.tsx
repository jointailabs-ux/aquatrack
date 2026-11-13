"use client";

import * as React from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { BottomNav } from "@/components/layout/BottomNav";
import { MoreSheet } from "@/components/layout/MoreSheet";
import { AppSessionProvider } from "@/components/providers/AppSessionProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [isMoreSheetOpen, setIsMoreSheetOpen] = React.useState(false);

  const handleToggleSidebar = React.useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const handleOpenMore = React.useCallback(() => {
    setIsMoreSheetOpen(true);
  }, []);

  const handleCloseMore = React.useCallback(() => {
    setIsMoreSheetOpen(false);
  }, []);

  return (
    <AppSessionProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {/* Desktop Sidebar */}
        <div className="hidden md:flex shrink-0">
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
          />
        </div>

        {/* Mobile More Sheet / Drawer */}
        <MoreSheet
          isOpen={isMoreSheetOpen}
          onClose={handleCloseMore}
        />

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <Topbar onOpenMobileNav={handleOpenMore} />

          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 bg-muted/10 pb-20 md:pb-8 safe-area-bottom">
            <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
              {children}
            </div>
          </main>
        </div>

        {/* Fixed Mobile Bottom Navigation */}
        <BottomNav
          onOpenMore={handleOpenMore}
          isMoreOpen={isMoreSheetOpen}
        />
      </div>
    </AppSessionProvider>
  );
}
