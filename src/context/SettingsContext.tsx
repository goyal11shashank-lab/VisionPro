import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from './AuthContext';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../types/settings';

interface SettingsContextType {
  settings: AppSettings;
  lowStockThreshold: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  updateSettings: (newSettings: Partial<AppSettings>, lowStockThreshold?: number) => Promise<boolean>;
  restoreDefaults: () => Promise<boolean>;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentBusiness, isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(1.00);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!isAuthenticated || !currentBusiness) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<{
        lowStockThreshold: number;
        config?: any;
        settings?: AppSettings;
      }>('/api/businesses/settings');

      if (res && res.settings) {
        setSettings(res.settings);
      } else if (res && res.config && res.config.settings) {
        setSettings(res.config.settings);
      }
      if (res && res.lowStockThreshold !== undefined) {
        setLowStockThreshold(res.lowStockThreshold);
      }
    } catch (err: any) {
      console.warn('Could not fetch business settings, using defaults:', err.message);
      // Fallback to default settings
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, currentBusiness]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (
    newSettings: Partial<AppSettings>,
    newThreshold?: number
  ): Promise<boolean> => {
    try {
      setSaving(true);
      setError(null);

      const payload = {
        settings: newSettings,
        lowStockThreshold: newThreshold !== undefined ? newThreshold : lowStockThreshold,
      };

      const res = await apiRequest<{
        success: boolean;
        settings: AppSettings;
        lowStockThreshold: number;
      }>('/api/businesses/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (res && res.settings) {
        setSettings(res.settings);
        if (res.lowStockThreshold !== undefined) {
          setLowStockThreshold(res.lowStockThreshold);
        }
        return true;
      }
      return false;
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = async (): Promise<boolean> => {
    try {
      setSaving(true);
      setError(null);

      const res = await apiRequest<{
        success: boolean;
        settings: AppSettings;
        lowStockThreshold: number;
      }>('/api/businesses/settings/restore-defaults', {
        method: 'POST',
      });

      if (res && res.settings) {
        setSettings(res.settings);
        if (res.lowStockThreshold !== undefined) {
          setLowStockThreshold(res.lowStockThreshold);
        }
        return true;
      }
      return false;
    } catch (err: any) {
      setError(err.message || 'Failed to restore default settings');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        lowStockThreshold,
        loading,
        saving,
        error,
        updateSettings,
        restoreDefaults,
        refreshSettings: fetchSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useBusinessSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (!context) {
    // Return safe fallback if used outside provider
    return {
      settings: DEFAULT_APP_SETTINGS,
      lowStockThreshold: 1.00,
      loading: false,
      saving: false,
      error: null,
      updateSettings: async () => false,
      restoreDefaults: async () => false,
      refreshSettings: async () => {},
    };
  }
  return context;
};
