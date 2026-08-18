import React, { useState } from 'react';
import { Sidebar } from './Sidebar.js';
import { Header } from './Header.js';

interface MainLayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  title: string;
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
  currentPath,
  onNavigate,
  title,
  children,
}) => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  return (
    <div className="flex h-screen w-full bg-[#f1f5f9] text-slate-900 overflow-hidden font-sans antialiased">
      {/* Scalable Sidebar Navigation */}
      <Sidebar
        currentPath={currentPath}
        onNavigate={onNavigate}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden bg-[#f1f5f9]">
        {/* Sticky Desktop/Mobile Header */}
        <Header
          title={title}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          onNavigate={onNavigate}
        />

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-7 custom-scrollbar">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
