/**
 * Settings space access policy (client side).
 *
 * The owner requires every Settings page to be Super Administrator only.
 * This module is the single source of truth for which routes are settings
 * routes and who may see them. Enforcement happens here for direct navigation,
 * in Sidebar.tsx for navigation visibility, and on the server via
 * requireSuperAdmin on settings writes (server/routes/businesses.ts).
 */

export interface SettingsAccessUser {
  isSuperAdmin?: boolean;
}

export const SETTINGS_PATHS: ReadonlySet<string> = new Set([
  '/settings',
  '/admin/settings',
  '/admin/business-settings',
  '/admin/gst-settings',
  '/admin/barcode-settings',
  '/settings/transaction-message',
  '/admin/transaction-message',
  '/admin/transaction-message-settings',
  '/settings/interface',
  '/admin/interface-settings',
]);

export function isSettingsPath(pathOnly: string): boolean {
  return SETTINGS_PATHS.has(pathOnly);
}

/** True when the given user must be blocked from a settings route. */
export function settingsAccessDenied(pathOnly: string, user: SettingsAccessUser | null | undefined): boolean {
  return isSettingsPath(pathOnly) && !user?.isSuperAdmin;
}
