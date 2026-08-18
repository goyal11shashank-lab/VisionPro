import React, { useEffect, useState } from 'react';
import { Database, CheckCircle2, AlertTriangle, RefreshCw, X, Server, Layers, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { DatabaseHealth } from '../../types/index.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const DatabaseStatusModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/api/health');
      setHealth(data);
    } catch (e: any) {
      setError(e.message || 'Failed to query database status endpoint');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHealth();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-base">Database & Architecture Status</h3>
              <p className="text-xs text-slate-500">PostgreSQL / Netlify Database & Migration Inspector</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-600">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
              <span className="text-sm font-medium text-slate-500">Inspecting PostgreSQL schema & connection...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold">Database Check Failed</h4>
                <p className="text-xs mt-1">{error}</p>
              </div>
            </div>
          ) : health ? (
            <>
              {/* Primary Status Card */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                health.database.connected
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50/60 border-amber-200 text-amber-900'
              }`}>
                <div className="flex items-center gap-3">
                  {health.database.connected ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  )}
                  <div>
                    <h4 className="font-semibold text-sm">
                      {health.database.connected ? 'PostgreSQL Active & Synced' : 'Database Connection Pending'}
                    </h4>
                    <p className="text-xs opacity-80 mt-0.5">
                      {health.database.connected
                        ? `Connected with ${health.database.tablesCount} verified relational tables in PostgreSQL.`
                        : health.database.error || 'Please configure DATABASE_URL in environment settings.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={fetchHealth}
                  className="px-3 py-1.5 rounded-lg bg-white shadow-xs border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Recheck
                </button>
              </div>

              {/* Architecture Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Database Engine</span>
                  <div className="font-medium text-slate-900 flex items-center gap-2">
                    <Server className="w-4 h-4 text-blue-600" />
                    <span>PostgreSQL (Standard Relational)</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {health.database.version || 'Version negotiation active'}
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">ORM & Migrations</span>
                  <div className="font-medium text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-600" />
                    <span>Drizzle ORM + PostgreSQL DDL</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Version-controlled migration schema: 0000_initial.sql
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Deployment Target</span>
                  <div className="font-medium text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{health.deployment.platform}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Netlify Functions `/api/*` + Git deployment ready
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5">
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Security Layer</span>
                  <div className="font-medium text-slate-900">
                    Bcrypt + JWT + Multi-Tenant RBAC
                  </div>
                  <p className="text-xs text-slate-500">
                    Granular permissions + Immutable audit log
                  </p>
                </div>
              </div>

              {/* Verified Relational Tables List */}
              {health.database.tables && health.database.tables.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Verified Schema Tables ({health.database.tables.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {health.database.tables.map(tbl => (
                      <span
                        key={tbl}
                        className="px-2.5 py-1 rounded-md text-xs font-mono bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        {tbl}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
