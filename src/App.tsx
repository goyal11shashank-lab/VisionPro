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
import { CategoriesPage } from './pages/master/CategoriesPage.js';
import { CoatingsPage } from './pages/master/CoatingsPage.js';
import { BasesPage } from './pages/master/BasesPage.js';
import { PrimaryItemsPage } from './pages/master/PrimaryItemsPage.js';
import { UniqueItemsPage } from './pages/master/UniqueItemsPage.js';
import { OpticalBatchesPage } from './pages/master/OpticalBatchesPage.js';
import { PartiesPage } from './pages/parties/PartiesPage.js';
import { PurchaseInvoicesPage } from './pages/purchases/PurchaseInvoicesPage.js';
import { PurchaseLotsPage } from './pages/purchases/PurchaseLotsPage.js';
import { SupplierLedgerPage } from './pages/parties/SupplierLedgerPage.js';
import { CustomerLedgerPage } from './pages/parties/CustomerLedgerPage.js';
import { SalesOrdersPage } from './pages/sales/SalesOrdersPage.js';
import { SalesInvoicesPage } from './pages/sales/SalesInvoicesPage.js';
import { SalesReturnsPage } from './pages/sales/SalesReturnsPage.js';
import { PurchaseReturnsPage } from './pages/purchases/PurchaseReturnsPage.js';
import { CustomerReceiptsPage } from './pages/accounts/CustomerReceiptsPage.js';
import { SupplierPaymentsPage } from './pages/accounts/SupplierPaymentsPage.js';
import { OutstandingAgingPage } from './pages/accounts/OutstandingAgingPage.js';
import { ReportsCenterPage } from './pages/reports/ReportsCenterPage.js';
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
      case '/master/categories':
        return 'Optical Categories Master';
      case '/master/bases':
        return 'Optical Bases & Compatibility';
      case '/master/coatings':
        return 'Optical Coatings Master';
      case '/master/primary-items':
        return 'Primary Items Master';
      case '/master/unique-items':
        return 'Unique Items & Commercial SKUs';
      case '/master/batches':
        return 'Optical Batches & Permanent Barcodes';
      case '/sales/pos':
        return 'Optical POS & Billing';
      case '/sales/prescriptions':
        return 'Prescriptions (Rx) Management';
      case '/sales/orders':
        return 'Sales Invoices & Orders';
      case '/sales/returns':
        return 'Sales Returns & Credit Notes';
      case '/purchases/orders':
      case '/purchases/invoices':
      case '/purchase/invoices':
        return 'Purchase Invoices & Bills';
      case '/purchase/returns':
      case '/purchases/returns':
        return 'Purchase Returns & Debit Notes';
      case '/purchase/lots':
      case '/purchases/lots':
        return 'Purchase Lots & Costing';
      case '/inventory/frames':
        return 'Frames & Sunglasses Catalog';
      case '/inventory/lenses':
        return 'Ophthalmic & Contact Lenses';
      case '/parties':
        return 'Party Master Directory';
      case '/parties/customers':
        return 'Customer Master Directory';
      case '/parties/suppliers':
        return 'Supplier & Vendor Directory';
      case '/parties/ledger':
      case '/parties/supplier-ledger':
        return 'Supplier & Party Ledger';
      case '/accounts/receipts':
        return 'Customer Receipts & Advances';
      case '/accounts/payments':
        return 'Supplier Payments & Advances';
      case '/accounts/outstanding':
        return 'Outstanding Aging & Party Statements';
      case '/accounts/ledgers':
        return 'Accounting & Financial Ledgers';
      case '/reports':
      case '/reports/inventory':
        return 'Inventory Stock Matrix Report';
      case '/reports/stock-ledger':
        return 'Stock Movement Ledger Register';
      case '/reports/sales':
        return 'Sales Invoices & Returns Register';
      case '/reports/purchases':
        return 'Purchase Invoices & Debit Notes Register';
      case '/reports/outstanding':
        return 'Outstanding Aging & Credit Limits';
      case '/reports/party-statement':
        return 'Party Statement (Ledger)';
      case '/reports/payments':
        return 'Payments & Receipts Register';
      case '/reports/analytics':
        return 'Product & Optical Power Analytics';
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

      // Master Data Submodules
      case '/master/categories':
        return <CategoriesPage />;
      case '/master/bases':
        return <BasesPage />;
      case '/master/coatings':
        return <CoatingsPage />;
      case '/master/primary-items':
        return <PrimaryItemsPage />;
      case '/master/unique-items':
        return <UniqueItemsPage />;
      case '/master/batches':
        return <OpticalBatchesPage />;

      // Sales Submodules
      case '/sales/orders':
        return <SalesOrdersPage />;
      case '/sales/invoices':
      case '/sales/pos':
        return <SalesInvoicesPage />;
      case '/sales/returns':
        return <SalesReturnsPage />;
      case '/sales/customer-ledger':
        return <CustomerLedgerPage />;

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
      case '/purchases/invoices':
      case '/purchase/invoices':
        return <PurchaseInvoicesPage />;

      case '/purchases/returns':
      case '/purchase/returns':
        return <PurchaseReturnsPage />;

      case '/purchases/lots':
      case '/purchase/lots':
        return <PurchaseLotsPage />;

      // Inventory Submodules
      case '/inventory/stock':
      case '/inventory/frames':
      case '/inventory/lenses':
        return <ReportsCenterPage initialTab="inventory" />;

      // Parties Submodules
      case '/parties':
        return <PartiesPage initialType="ALL" />;
      case '/parties/suppliers':
        return <PartiesPage initialType="SUPPLIER" />;
      case '/parties/customers':
        return <PartiesPage initialType="CUSTOMER" />;
      case '/parties/ledger':
      case '/parties/supplier-ledger':
        return <SupplierLedgerPage />;

      // Accounts Submodules
      case '/accounts/receipts':
        return <CustomerReceiptsPage />;
      case '/accounts/payments':
        return <SupplierPaymentsPage />;
      case '/accounts/outstanding':
        return <OutstandingAgingPage onNavigate={setCurrentPath} />;
      case '/accounts/ledgers':
        return <ReportsCenterPage initialTab="party-statement" />;

      // Reports Center
      case '/reports':
      case '/reports/inventory':
        return <ReportsCenterPage initialTab="inventory" />;
      case '/reports/stock-ledger':
        return <ReportsCenterPage initialTab="stock-ledger" />;
      case '/reports/sales':
        return <ReportsCenterPage initialTab="sales" />;
      case '/reports/purchases':
        return <ReportsCenterPage initialTab="purchases" />;
      case '/reports/outstanding':
        return <ReportsCenterPage initialTab="outstanding" />;
      case '/reports/party-statement':
        return <ReportsCenterPage initialTab="party-statement" />;
      case '/reports/payments':
        return <ReportsCenterPage initialTab="payments" />;
      case '/reports/analytics':
        return <ReportsCenterPage initialTab="analytics" />;

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
