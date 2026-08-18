import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User, Business } from '../types/index.js';
import { apiRequest, getStoredToken, setStoredToken, removeStoredToken, setStoredBusinessId, getStoredBusinessId } from '../api/client.js';

interface AuthContextType {
  user: User | null;
  currentBusiness: Business | null;
  accessibleBusinesses: Business[];
  roles: Array<{ id: string; name: string; code: string }>;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identifier: string, password: string, businessId?: string) => Promise<void>;
  bootstrapAdmin: (data: any) => Promise<void>;
  logout: () => Promise<void>;
  switchBusiness: (businessId: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (permissionCode: string) => boolean;
  hasAnyPermission: (permissionCodes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [currentBusiness, setCurrentBusiness] = useState<Business | null>(null);
  const [accessibleBusinesses, setAccessibleBusinesses] = useState<Business[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchCurrentUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setCurrentBusiness(null);
      setAccessibleBusinesses([]);
      setRoles([]);
      setPermissions([]);
      setIsLoading(false);
      return;
    }

    try {
      const data = await apiRequest('/api/auth/me');
      setUser(data.user);
      setCurrentBusiness(data.currentBusiness);
      setAccessibleBusinesses(data.accessibleBusinesses || []);
      setRoles(data.roles || []);
      setPermissions(data.permissions || []);
      if (data.currentBusiness?.id) {
        setStoredBusinessId(data.currentBusiness.id);
      }
    } catch (err: any) {
      console.warn('[AuthContext] Session expired or invalid token:', err.message);
      removeStoredToken();
      setUser(null);
      setCurrentBusiness(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const login = async (identifier: string, password: string, businessId?: string) => {
    setIsLoading(true);
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password, businessId }),
      });

      if (res.token) {
        setStoredToken(res.token);
      }
      if (res.currentBusiness?.id) {
        setStoredBusinessId(res.currentBusiness.id);
      }

      setUser(res.user);
      setCurrentBusiness(res.currentBusiness);
      setAccessibleBusinesses(res.accessibleBusinesses || []);
      setRoles(res.roles || []);
      setPermissions(res.permissions || []);
    } finally {
      setIsLoading(false);
    }
  };

  const bootstrapAdmin = async (data: any) => {
    setIsLoading(true);
    try {
      const res = await apiRequest('/api/auth/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      if (res.token) {
        setStoredToken(res.token);
      }
      if (res.currentBusiness?.id) {
        setStoredBusinessId(res.currentBusiness.id);
      }

      setUser(res.user);
      setCurrentBusiness(res.currentBusiness);
      setAccessibleBusinesses(res.accessibleBusinesses || []);
      setRoles(res.roles || []);
      setPermissions(res.permissions || []);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // Ignore network errors during logout
    } finally {
      removeStoredToken();
      setUser(null);
      setCurrentBusiness(null);
      setAccessibleBusinesses([]);
      setRoles([]);
      setPermissions([]);
    }
  };

  const switchBusiness = async (businessId: string) => {
    setIsLoading(true);
    try {
      const res = await apiRequest('/api/auth/switch-business', {
        method: 'POST',
        body: JSON.stringify({ targetBusinessId: businessId }),
      });

      if (res.token) {
        setStoredToken(res.token);
      }
      setStoredBusinessId(businessId);
      await fetchCurrentUser();
    } finally {
      setIsLoading(false);
    }
  };

  const hasPermission = useCallback((code: string): boolean => {
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    return permissions.includes(code);
  }, [user, permissions]);

  const hasAnyPermission = useCallback((codes: string[]): boolean => {
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    return codes.some(c => permissions.includes(c));
  }, [user, permissions]);

  const value = useMemo(() => ({
    user,
    currentBusiness,
    accessibleBusinesses,
    roles,
    permissions,
    isAuthenticated: !!user,
    isLoading,
    login,
    bootstrapAdmin,
    logout,
    switchBusiness,
    refreshUser: fetchCurrentUser,
    hasPermission,
    hasAnyPermission,
  }), [
    user,
    currentBusiness,
    accessibleBusinesses,
    roles,
    permissions,
    isLoading,
    fetchCurrentUser,
    hasPermission,
    hasAnyPermission,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
