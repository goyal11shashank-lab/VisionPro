import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { SettingsProvider } from './context/SettingsContext.js';
import { MainLayout } from './components/layout/MainLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { BusinessesPage } from './pages/admin/BusinessesPage.js';
import { UsersPage } from './pages/admin/UsersPage.js';
import { RolesPage } from './pages/admin/RolesPage.js';
import { BusinessSettingsPage } from './pages/admin/BusinessSettingsPage.js';
import { AuditLogsPage } from './pages/admin/AuditLogsPage.js';
import { DealerMainWarehouseAvailabilityPage } from './pages/inventory/DealerMainWarehouseAvailabilityPage.js';
import { DealerOrdersListPage } from './pages/sales/DealerOrdersListPage.js';
import { DealerControlCenterPage } from './pages/dealers/DealerControlCenterPage.js';
import { DealerDashboardPage } from './pages/dashboard/DealerDashboardPage.js';
import { DealerOnboardingPage } from './pages/dealers/DealerOnboardingPage.js';
import { DealerPaymentAdvicesList } from './pages/dealers/DealerPaymentAdvicesList.js';
import { ModulePlaceholderPage } from './pages/admin/ModulePlaceholderPage.js';
import { CategoriesPage } from './pages/master/CategoriesPage.js';
import { CoatingsPage } from './pages/master/CoatingsPage.js';
import { BasesPage } from './pages/master/BasesPage.js';
import { UniqueItemsPage } from './pages/master/UniqueItemsPage.js';
import { OpticalBatchesPage } from './pages/master/OpticalBatchesPage.js';
import { PartiesPage } from './pages/parties/PartiesPage.js';
import { PurchaseInvoicesPage } from './pages/purchases/PurchaseInvoicesPage.js';
import { PurchaseOrdersPage } from './pages/purchases/PurchaseOrdersPage.js';
import { CreatePurchaseInvoicePage } from './pages/purchases/CreatePurchaseInvoicePage.js';
import { PurchaseLotsPage } from './pages/purchases/PurchaseLotsPage.js';
import { SupplierLedgerPage } from './pages/parties/SupplierLedgerPage.js';
import { CustomerLedgerPage } from './pages/parties/CustomerLedgerPage.js';
import { SalesOrdersPage } from './pages/sales/SalesOrdersPage.js';
import { SalesInvoicesPage } from './pages/sales/SalesInvoicesPage.js';
import { NormalSalesVoucherPage } from './pages/sales/NormalSalesVoucherPage.js';
import { SalesInvoicePrintPage } from './pages/sales/SalesInvoicePrintPage.js';
import { SalesReturnsPage } from './pages/sales/SalesReturnsPage.js';
import { PurchaseReturnsPage } from './pages/purchases/PurchaseReturnsPage.js';
import { CustomerReceiptsPage } from './pages/accounts/CustomerReceiptsPage.js';
import { SupplierPaymentsPage } from './pages/accounts/SupplierPaymentsPage.js';
import { OutstandingAgingPage } from './pages/accounts/OutstandingAgingPage.js';
import { ReportsCenterPage } from './pages/reports/ReportsCenterPage.js';
import { StockReservationsPage } from './pages/sales/StockReservationsPage.js';
import { OpeningStockPage } from './pages/inventory/OpeningStockPage.js';
import { RefreshCw, ShieldCheck, Building2, LogOut } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, isLoading, currentBusiness, accessibleBusinesses, logout, hasPermission, roles, refreshUser } = useAuth();
  const [currentPath, setCurrentPath] = useState<string>('/dashboard');

  const canConfigureDealer = Boolean(
    user?.isSuperAdmin ||
    hasPermission('admin:manage_settings') ||
    hasPermission('business:edit') ||
    roles?.some(r => r.code === 'MANAGER' || r.code === 'ADMIN' || r.code === 'SUPER_ADMIN')
  );

  React.useEffect(() => {
    if (
      currentBusiness?.businessType === 'DEALER' &&
      currentBusiness.onboardingCompleted !== true &&
      canConfigureDealer
    ) {
      if (currentPath === '/' || currentPath === '/dashboard' || currentPath === '/dealer/dashboard') {
        setCurrentPath('/dealer/onboarding');
      }
    }
  }, [currentBusiness?.id, currentBusiness?.businessType, currentBusiness?.onboardingCompleted, canConfigureDealer]);

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

  // If user has zero accessible businesses and is not super admin, show clean unassigned message
  if (!user.isSuperAdmin && (!currentBusiness || accessibleBusinesses.length === 0)) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 shadow-xl border border-slate-200 text-center space-y-4">
          <div className="w-14 h-14 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto">
            <Building2 className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">No Authorized Business Assigned</h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Welcome, <strong className="text-slate-800">{user.fullName || user.username}</strong>. Your login account
              is active, but an administrator has not yet assigned you to any Dealer or Main Warehouse business.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 border border-slate-200 text-left space-y-1">
            <p className="font-semibold text-slate-700">Next Steps:</p>
            <p>1. Contact your Main Warehouse or Dealer Administrator.</p>
            <p>2. Ask them to assign your account (@{user.username}) to your business location.</p>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>
      </div>
    );
  }

  const getPageTitle = (targetPath = pathOnly): string => {
    if (targetPath.startsWith('/sales/voucher/edit/') || targetPath.startsWith('/sales/invoices/edit/')) {
      return 'Alteration Sales Voucher';
    }

    switch (targetPath) {
      case '/':
      case '/dashboard':
        return 'Enterprise Dashboard';
      case '/admin/businesses':
        return 'Business Entities & Multi-Tenancy';
      case '/admin/users':
        return 'System Users & Access';
      case '/admin/roles':
        return 'Roles & Permissions Matrix';
      case '/settings':
      case '/admin/settings':
        return 'Application Settings Center';
      case '/admin/business-settings':
        return 'Business Settings & Profile';
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
      case '/master/stock-items':
      case '/stock-items':
      case '/master/unique-items':
      case '/unique-items':
        return 'Stock Items Master';
      case '/master/batches':
        return 'Optical Batches & Permanent Barcodes';
      case '/inventory/dealer-availability':
      case '/dealer/availability':
      case '/inventory/main-warehouse':
        return 'Main Warehouse Stock Availability';
      case '/dealer/orders':
      case '/inventory/dealer-orders':
        return 'My Warehouse Orders';
      case '/sales/pos':
        return 'Optical POS & Billing';
      case '/sales/invoices/new':
      case '/sales/voucher/new':
      case '/sales/voucher':
      case '/sales/new':
        return 'Create Sales Invoice';
      case '/sales/invoices':
        return 'Sales Invoices Register';
      case '/sales/prescriptions':
        return 'Prescriptions (Rx) Management';
      case '/sales/orders':
        return 'Sales Invoices & Orders';
      case '/sales/returns':
        return 'Sales Returns & Credit Notes';
      case '/sales/reservations':
      case '/sales/stock-reservations':
        return 'Stock Reservations Management';
      case '/inventory/opening-stock':
      case '/master/opening-stock':
        return 'Opening Stock Management';
      case '/purchases/orders':
      case '/purchase/orders':
        return 'Purchase Orders';
      case '/purchases/invoices':
      case '/purchase/invoices':
        return 'Purchase Invoices Register';
      case '/purchase/returns':
      case '/purchases/returns':
        return 'Purchase Returns & Debit Notes';
      case '/purchase/voucher/new':
      case '/purchase/voucher':
      case '/purchase/new':
      case '/purchases/voucher/new':
      case '/purchases/voucher':
      case '/purchases/new':
        return 'Normal Purchase Voucher';
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
      case '/dealers':
      case '/sales/dealers':
        return 'Dealer Control Center';
      case '/dealer/dashboard':
        return 'Dealer Operations Dashboard';
      case '/dealer/onboarding':
        return 'Dealer Setup Wizard';
      default:
        return 'Optical Billing & Management';
    }
  };

  const [pathOnly, queryString] = currentPath.split('?');
  const searchParams = new URLSearchParams(queryString || (typeof window !== 'undefined' ? window.location.search : ''));
  const orderIdParam = searchParams.get('orderId');

  const renderContent = () => {
    switch (pathOnly) {
      case '/dealer/onboarding':
        if (currentBusiness?.businessType === 'MAIN') {
          return <DashboardPage onNavigate={setCurrentPath} />;
        }
        return (
          <DealerOnboardingPage
            onNavigate={setCurrentPath}
            onComplete={() => {
              setCurrentPath('/dealer/dashboard');
              refreshUser();
            }}
          />
        );
      case '/':
      case '/dashboard':
        if (currentBusiness?.businessType === 'DEALER') {
          return <DealerDashboardPage onNavigate={setCurrentPath} />;
        }
        return <DashboardPage onNavigate={setCurrentPath} />;
      case '/dealer/dashboard':
        return <DealerDashboardPage onNavigate={setCurrentPath} />;
      case '/dealers':
      case '/sales/dealers':
      case '/admin/dealers':
        return <DealerControlCenterPage onNavigate={setCurrentPath} />;
      case '/admin/businesses':
        return <BusinessesPage />;
      case '/admin/users':
        return <UsersPage />;
      case '/admin/roles':
        return <RolesPage />;
      case '/settings':
      case '/admin/settings':
        return <BusinessSettingsPage initialTab="general" />;
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
      case '/master/stock-items':
      case '/stock-items':
      case '/master/unique-items':
      case '/unique-items':
        return <UniqueItemsPage />;
      case '/master/batches':
        return <OpticalBatchesPage onNavigate={setCurrentPath} />;
      case '/inventory/dealer-availability':
      case '/dealer/availability':
      case '/inventory/main-warehouse':
        return <DealerMainWarehouseAvailabilityPage onNavigate={setCurrentPath} />;
      case '/dealer/orders':
      case '/inventory/dealer-orders':
        return <DealerOrdersListPage onNavigate={setCurrentPath} />;
      case '/dealer/payments':
      case '/dealer/payment-advices':
        return (
          <div className="p-6 max-w-7xl mx-auto space-y-6">
            <DealerPaymentAdvicesList onNavigate={setCurrentPath} />
          </div>
        );

      // Sales Submodules
      case '/sales/orders':
        return (
          <SalesOrdersPage
            onNavigateToInvoice={(orderId) => {
              const target = `/sales/invoices/new?orderId=${orderId}`;
              if (typeof window !== 'undefined') {
                window.history.pushState(null, '', target);
              }
              setCurrentPath(target);
            }}
          />
        );
      case '/sales/invoices':
        return <SalesInvoicesPage onNavigate={setCurrentPath} />;
      case '/sales/pos':
        return <SalesInvoicesPage initialOpenPos={true} onNavigate={setCurrentPath} />;
      case '/sales/invoices/new':
      case '/sales/voucher/new':
      case '/sales/voucher':
      case '/sales/new':
        return <NormalSalesVoucherPage onNavigate={setCurrentPath} orderId={orderIdParam} />;
      default:
        if (pathOnly.startsWith('/sales/invoices/') && pathOnly.endsWith('/print')) {
          const invId = pathOnly.replace('/sales/invoices/', '').replace('/print', '');
          return (
            <SalesInvoicePrintPage
              invoiceId={invId}
              onBack={() => setCurrentPath('/sales/invoices')}
            />
          );
        }
        if (pathOnly.startsWith('/sales/voucher/') && pathOnly.endsWith('/print')) {
          const invId = pathOnly.replace('/sales/voucher/', '').replace('/print', '');
          return (
            <SalesInvoicePrintPage
              invoiceId={invId}
              onBack={() => setCurrentPath('/sales/invoices')}
            />
          );
        }
        if (pathOnly.startsWith('/sales/voucher/edit/')) {
          const editId = pathOnly.replace('/sales/voucher/edit/', '');
          return (
            <NormalSalesVoucherPage
              editInvoiceId={editId}
              onNavigate={setCurrentPath}
              onBack={() => setCurrentPath('/sales/invoices')}
              onSuccess={() => setCurrentPath('/sales/invoices')}
            />
          );
        }
        if (pathOnly.startsWith('/sales/invoices/edit/')) {
          const editId = pathOnly.replace('/sales/invoices/edit/', '');
          return (
            <NormalSalesVoucherPage
              editInvoiceId={editId}
              onNavigate={setCurrentPath}
              onBack={() => setCurrentPath('/sales/invoices')}
              onSuccess={() => setCurrentPath('/sales/invoices')}
            />
          );
        }
        break;
    }

    switch (pathOnly) {
      case '/sales/returns':
        return <SalesReturnsPage />;
      case '/sales/customer-ledger':
        return <CustomerLedgerPage />;
      case '/sales/reservations':
      case '/sales/stock-reservations':
        return <StockReservationsPage onNavigate={setCurrentPath} />;
      case '/inventory/opening-stock':
      case '/master/opening-stock':
        return <OpeningStockPage onNavigate={setCurrentPath} />;

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
      case '/purchase/voucher/new':
      case '/purchase/voucher':
      case '/purchase/new':
      case '/purchases/voucher/new':
      case '/purchases/voucher':
      case '/purchases/new':
        return (
          <CreatePurchaseInvoicePage
            onBack={() => setCurrentPath('/purchase/invoices')}
            onSuccess={() => setCurrentPath('/purchase/invoices')}
          />
        );

      case '/purchases/orders':
      case '/purchase/orders':
        return <PurchaseOrdersPage onNavigate={setCurrentPath} />;

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
        if (pathOnly.startsWith('/dealers/')) {
          const dealerId = pathOnly.replace('/dealers/', '');
          return <DealerControlCenterPage onNavigate={setCurrentPath} initialDealerId={dealerId} />;
        }
        if (currentBusiness?.businessType === 'DEALER') {
          return <DealerDashboardPage onNavigate={setCurrentPath} />;
        }
        return <DashboardPage onNavigate={setCurrentPath} />;
    }
  };

  return (
    <MainLayout
      currentPath={currentPath}
      onNavigate={setCurrentPath}
      title={getPageTitle()}
    >
      <div key={currentBusiness?.id || 'no-business'}>
        {renderContent()}
      </div>
    </MainLayout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <AppContent />
      </SettingsProvider>
    </AuthProvider>
  );
}
