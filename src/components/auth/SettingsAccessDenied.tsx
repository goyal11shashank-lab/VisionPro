/**
 * Shown in place of any Settings page when a non Super Administrator reaches a
 * settings route directly (deep link, back button, bookmark).
 */
export default function SettingsAccessDenied() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl p-6 shadow-xl border border-slate-200 text-center space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Super Administrator Access Required</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          Settings can only be viewed and changed by the Super Administrator. Please contact the business owner
          if you need a setting changed.
        </p>
      </div>
    </div>
  );
}
