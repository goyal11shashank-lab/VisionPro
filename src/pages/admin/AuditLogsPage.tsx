import React, { useEffect, useState } from 'react';
import {
  History,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { AuditLogItem } from '../../types/index.js';

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  // Selected Log for detail diff modal
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const fetchLogs = async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
      });
      if (moduleFilter) params.append('module', moduleFilter);
      if (actionFilter) params.append('action', actionFilter);
      if (search) params.append('search', search);

      const res = await apiRequest(`/api/audit-logs?${params.toString()}`);
      setLogs(res.logs || []);
      setPagination(res.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
    } catch (err: any) {
      setError(err.message || 'Failed to fetch audit records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [moduleFilter, actionFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <History className="w-5 h-5 text-blue-600" />
            <span>Immutable Audit Trail</span>
          </h2>
          <p className="text-xs text-slate-500">
            Cryptographically linked record of user authentications, data creations, modifications, and system events
          </p>
        </div>

        <button
          onClick={() => fetchLogs(pagination.page)}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors flex items-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Logs</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold text-sm">✕</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by entity type..."
              className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Modules</option>
              <option value="AUTH">AUTH</option>
              <option value="USERS">USERS</option>
              <option value="ROLES">ROLES</option>
              <option value="BUSINESS">BUSINESS</option>
              <option value="SETTINGS">SETTINGS</option>
              <option value="SALES">SALES</option>
              <option value="PURCHASE">PURCHASE</option>
              <option value="INVENTORY">INVENTORY</option>
              <option value="ACCOUNTS">ACCOUNTS</option>
            </select>
          </div>

          <div>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Actions</option>
              <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
              <option value="LOGIN_FAILED">LOGIN_FAILED</option>
              <option value="LOGOUT">LOGOUT</option>
              <option value="CREATE_USER">CREATE_USER</option>
              <option value="UPDATE_USER_STATUS">UPDATE_USER_STATUS</option>
              <option value="RESET_PASSWORD">RESET_PASSWORD</option>
              <option value="CREATE_ROLE">CREATE_ROLE</option>
              <option value="UPDATE_ROLE_PERMISSIONS">UPDATE_ROLE_PERMISSIONS</option>
              <option value="UPDATE_BUSINESS_SETTINGS">UPDATE_BUSINESS_SETTINGS</option>
              <option value="SWITCH_BUSINESS">SWITCH_BUSINESS</option>
              <option value="SYSTEM_INITIALIZATION">SYSTEM_INITIALIZATION</option>
            </select>
          </div>
        </form>
      </div>

      {/* Logs Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 border-b border-slate-100 uppercase tracking-wider text-[10px] font-semibold">
              <tr>
                <th className="px-5 py-3.5">Timestamp</th>
                <th className="px-5 py-3.5">User</th>
                <th className="px-5 py-3.5">Module</th>
                <th className="px-5 py-3.5">Action</th>
                <th className="px-5 py-3.5">Entity / Target</th>
                <th className="px-5 py-3.5">Client Info</th>
                <th className="px-5 py-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Fetching audit logs from PostgreSQL...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                    No audit records found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{log.userName || 'System / Anonymous'}</div>
                      {log.username && (
                        <div className="text-slate-400 font-mono text-[10px]">@{log.username}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {log.module}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        log.action.includes('SUCCESS') || log.action.includes('CREATE')
                          ? 'bg-emerald-100 text-emerald-800'
                          : log.action.includes('FAILED') || log.action.includes('BLOCKED')
                          ? 'bg-red-100 text-red-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-slate-800 font-medium">{log.entityType}</div>
                      {log.entityId && (
                        <div className="text-slate-400 font-mono text-[10px] truncate max-w-[120px]">
                          {log.entityId}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-[11px] font-mono whitespace-nowrap">
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {(log.previousValue || log.newValue) ? (
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors"
                        >
                          View Values
                        </button>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <strong>{logs.length}</strong> of <strong>{pagination.total}</strong> events
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={pagination.page <= 1 || loading}
              onClick={() => fetchLogs(pagination.page - 1)}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {pagination.page} of {pagination.totalPages || 1}</span>
            <button
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => fetchLogs(pagination.page + 1)}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Value Diff / Detail Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">
                  Audit Entry Payload: {selectedLog.action}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedLog.module} / {selectedLog.entityType} • {new Date(selectedLog.createdAt).toLocaleString()}
                </p>
              </div>
              <button onClick={() => setSelectedLog(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 custom-scrollbar text-xs">
              {selectedLog.previousValue && (
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-red-700 uppercase tracking-wider text-[10px]">
                    Previous State (Before Modification)
                  </h4>
                  <pre className="p-3 bg-red-50/50 border border-red-100 rounded-xl text-red-950 font-mono text-[11px] overflow-x-auto">
                    {typeof selectedLog.previousValue === 'string'
                      ? selectedLog.previousValue
                      : JSON.stringify(selectedLog.previousValue, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.newValue && (
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-emerald-700 uppercase tracking-wider text-[10px]">
                    Recorded State (New / Modified Values)
                  </h4>
                  <pre className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl text-emerald-950 font-mono text-[11px] overflow-x-auto">
                    {typeof selectedLog.newValue === 'string'
                      ? selectedLog.newValue
                      : JSON.stringify(selectedLog.newValue, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.userAgent && (
                <div className="pt-2 border-t border-slate-100 text-slate-400 text-[10px]">
                  <strong>User Agent:</strong> {selectedLog.userAgent}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
