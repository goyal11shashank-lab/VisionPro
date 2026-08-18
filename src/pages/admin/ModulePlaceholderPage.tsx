import React from 'react';
import { Layers, ShieldCheck, Database, ArrowRight, Construction, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface Props {
  moduleName: string;
  moduleKey: string;
  description: string;
  roadmapItems: string[];
}

export const ModulePlaceholderPage: React.FC<Props> = ({
  moduleName,
  moduleKey,
  description,
  roadmapItems,
}) => {
  const { currentBusiness, hasPermission } = useAuth();

  return (
    <div className="space-y-6">
      {/* Module Overview Card */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                Stage 2 Sequential Module
              </span>
              <span className="text-xs text-slate-400 font-mono">[{moduleKey.toUpperCase()}]</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {moduleName} Module
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl">{description}</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-blue-600" />
              <span>Multi-Tenant PostgreSQL Ready</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Active Context: <strong className="text-slate-700">{currentBusiness?.name}</strong>
            </p>
          </div>
        </div>

        {/* Foundation & Architecture Specs */}
        <div className="pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Role-Based Access Control (RBAC)</span>
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Permission checking is enforced strictly at the API controller level. Hiding buttons is never used as a security mechanism.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <Database className="w-4 h-4 text-purple-600" />
              <span>Precision Decimal & Audit Trail</span>
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Financial calculations use exact PostgreSQL `numeric(15,2)` types. All mutations generate immutable audit records.
            </p>
          </div>
        </div>
      </div>

      {/* Planned Feature Blueprint */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <span>Sequential Development Scope for {moduleName}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {roadmapItems.map((item, index) => (
            <div
              key={index}
              className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span className="text-slate-700 font-medium">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
