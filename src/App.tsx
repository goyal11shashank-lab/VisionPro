import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { MainLayout } from './components/layout/MainLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { UsersPage } from './pages/admin/UsersPage.js';
import { RolesPage } from './pages/admin/RolesPage.js';
import { BusinessSettingsPage } from './pages/admin/BusinessSettingsPage.js';
import { AuditLogsPage } from './pages/admin/AuditLogsPage.js';
import { ModulePlaceholderPage } from './pages/admin/ModulePlaceholderPage.js';
import { RefreshCw, ShieldCheck } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [currentPath, setCurrentPath] = useState<string>('/dashboard');

  if (isLoading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-950 text-white gap-4">
        <div className="p-3 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
          <span>Authenticating session with PostgreSQL...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const getPageTitle = (): string => {
    switch (currentPath) {
      case '/':
      case '/dashboard':
        return 'Enterprise Dashboard';
      case '/admin/users':
        return 'System Users & Access';
      case '/admin/roles':
        return 'Roles & Permissions Matrix';
      case '/admin/business-settings':
        return 'Business Legal Profile';
      case '/admin/gst-settings':
        return 'GST Compliance & Rates';
      case '/admin/barcode-settings':
        return 'Barcode Format & Labeling';
      case '/admin/audit-logs':
        return 'Immutable Audit Trail';
      case '/sales/pos':
        return 'Optical POS & Billing';
      case '/sales/prescriptions':
        return 'Prescriptions (Rx) Management';
      case '/sales/orders':
        return 'Sales Invoices & Orders';
      case '/purchases/orders':
        return 'Purchase Orders & Bills';
      case '/inventory/frames':
        return 'Frames & Sunglasses Catalog';
      case '/inventory/lenses':
        return 'Ophthalmic & Contact Lenses';
      case '/parties/customers':
        return 'Customer Master & History';
      case '/parties/suppliers':
        return 'Suppliers & Vendors';
      case '/accounts/ledgers':
        return 'Accounting & Financial Ledgers';
      default:
        return 'Optical Billing & Management';
    }
  };

  const renderContent = () => {
    switch (currentPath) {
      case '/':
      case '/dashboard':
        return <DashboardPage onNavigate={setCurrentPath} />;
      case '/admin/users':
        return <UsersPage />;
      case '/admin/roles':
        return <RolesPage />;
      case '/admin/business-settings':
        return <BusinessSettingsPage initialTab="general" />;
      case '/admin/gst-settings':
        return <BusinessSettingsPage initialTab="gst" />;
      case '/admin/barcode-settings':
        return <BusinessSettingsPage initialTab="barcode" />;
      case '/admin/audit-logs':
        return <AuditLogsPage />;

      // Sales Submodules
      case '/sales/pos':
      case '/sales/orders':
        return (
          <ModulePlaceholderPage
            moduleName="Sales & POS Billing"
            moduleKey="sales"
            description="Complete optical billing engine supporting barcode scanning, mixed prescription orders, discount approvals, multi-payment receipts, and GST invoices."
            roadmapItems={[
              'Fast Barcode Scanning & SKU Search',
              'Prescription (Rx) & Optometrist Tagging',
              'Itemized CGST, SGST & IGST Calculation',
              'Thermal & A4 GST Invoice PDF Generation',
              'Real-Time Stock Depletion on Final Invoice',
              'Advance Payments & Balance Ledger Tracking',
            ]}
          />
        );

      case '/sales/prescriptions':
        return (
          <ModulePlaceholderPage
            moduleName="Optical Prescription (Rx) Engine"
            moduleKey="sales"
            description="Comprehensive eye examination record manager capturing Spherical, Cylinder, Axis, Addition, Visual Acuity (6/6), IPD, and Optometrist notes."
            roadmapItems={[
              'Right Eye (OD) & Left Eye (OS) Sphere, Cyl, Axis & Add',
              'Distance & Near Visual Acuity Matrix',
              'Interpupillary Distance (IPD) & Segment Height',
              'Linking Prescriptions directly to Sales Invoices',
              'Patient Historical Prescription Evolution Comparison',
              'Direct WhatsApp / Email Rx Delivery',
            ]}
          />
        );

      // Purchase Submodules
      case '/purchases/orders':
        return (
          <ModulePlaceholderPage
            moduleName="Purchase & Vendor Bills"
            moduleKey="purchase"
            description="Procurement workflow for frame distributors and lens manufacturers with Inward Goods Receipt Notes (GRN) and automated cost calculation."
            roadmapItems={[
              'Purchase Order (PO) Drafting & Vendor Sending',
              'Goods Receipt Note (GRN) Verification with Batching',
              'Input Tax Credit (ITC) GST Breakdown',
              'Supplier Credit Terms & Due Date Tracking',
              'Weighted Average Cost (WAC) Stock Valuation',
              'Supplier Return with Debit Note Generation',
            ]}
          />
        );

      // Inventory Submodules
      case '/inventory/frames':
      case '/inventory/lenses':
        return (
          <ModulePlaceholderPage
            moduleName="Optical Inventory & Stock Control"
            moduleKey="inventory"
            description="Precision inventory management for spectacle frames, ophthalmic uncut & finished lenses, contact lenses, and sunglasses with serial barcode tracking."
            roadmapItems={[
              'Barcode Generation & 50x25 Thermal Label Printing',
              'Brand, Model, Color, Eye Size & Bridge Dimensions',
              'Power Grid Matrix for Single Vision, Bifocal & Progressive Lenses',
              'Batch/Lot Expiry Tracking for Contact Lens Solutions',
              'Minimum Reorder Alerts & Negative Stock Prevention',
              'Inter-Branch Stock Transfer with Gate Pass',
            ]}
          />
        );

      // Parties Submodules
      case '/parties/customers':
      case '/parties/suppliers':
        return (
          <ModulePlaceholderPage
            moduleName="Party Master & Customer Ledgers"
            moduleKey="parties"
            description="Centralized directory for patients, retail customers, suppliers, and ophthalmologists with running balances and contact history."
            roadmapItems={[
              'Customer Profile with Eye Clinic History',
              'Supplier Master with GSTIN & Bank Verification',
              'Doctor / Referral Commission Management',
              'Detailed Statement of Account & Outstanding Aging',
              'Payment Reminders via SMS & WhatsApp API',
              'Credit Limit Enforcement during Invoice Creation',
            ]}
          />
        );

      // Accounts Submodules
      case '/accounts/ledgers':
        return (
          <ModulePlaceholderPage
            moduleName="Double-Entry Financial Accounting"
            moduleKey="accounts"
            description="Automatic chart of accounts synchronization with Sales, Purchases, Cash/Bank payments, and GST returns (GSTR-1, GSTR-3B)."
            roadmapItems={[
              'Automated Journal Entry on Invoice Finalization',
              'Cash Book & Multi-Bank Account Reconciliation',
              'GST Returns Export (GSTR-1 JSON, GSTR-3B Summary)',
              'Profit & Loss Statement (P&L) with Real COGS',
              'Balance Sheet & Trial Balance',
              'Financial Year-End Closing & Balance Carry-Forward',
            ]}
          />
        );

      default:
        return <DashboardPage onNavigate={setCurrentPath} />;
    }
  };

  return (
    <MainLayout
      currentPath={currentPath}
      onNavigate={setCurrentPath}
      title={getPageTitle()}
    >
      {renderContent()}
    </MainLayout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
