import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UnsavedChangesModal } from '../components/common/UnsavedChangesModal.js';

export type PendingNavigation =
  | { type: 'path'; path: string }
  | { type: 'action'; action: () => void; message?: string };

export interface UnsavedChangesContextType {
  isDirty: boolean;
  dirtyMessage?: string;
  setDirty: (isDirty: boolean, dirtyMessage?: string) => void;
  navigate: (targetPath: string) => void;
  confirmAction: (action: () => void, customMessage?: string) => void;
  currentPath: string;
  setCurrentPath: React.Dispatch<React.SetStateAction<string>>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | undefined>(undefined);

export interface UnsavedChangesProviderProps {
  children: React.ReactNode;
  initialPath?: string;
}

export const UnsavedChangesProvider: React.FC<UnsavedChangesProviderProps> = ({
  children,
  initialPath,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (initialPath) return initialPath;
    if (typeof window !== 'undefined' && window.location) {
      const p = window.location.pathname + window.location.search;
      if (p && p !== '/' && p !== '') return p;
    }
    return '/dashboard';
  });
  const [isDirty, setIsDirtyState] = useState<boolean>(false);
  const [dirtyMessage, setDirtyMessage] = useState<string | undefined>(undefined);

  // Modal and pending navigation state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [pendingNav, setPendingNav] = useState<PendingNavigation | null>(null);

  // Ref tracking to avoid stale closures in global window listeners
  const isDirtyRef = useRef<boolean>(isDirty);
  isDirtyRef.current = isDirty;

  const setDirty = useCallback((dirty: boolean, message?: string) => {
    setIsDirtyState(dirty);
    setDirtyMessage(message);
    isDirtyRef.current = dirty;
  }, []);

  // 1. Browser-level beforeunload guard (protects tab close, browser close, external navigation, hard reload)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        // Standard modern browser confirmation invocation
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome, Edge, Safari, Firefox
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 2. Keyboard guard for F5 and Ctrl+R / Cmd+R where browser allows interception
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isDirtyRef.current) return;

      const isF5 = e.key === 'F5';
      const isCtrlR = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r';

      if (isF5 || isCtrlR) {
        e.preventDefault();
        setPendingNav({
          type: 'action',
          action: () => {
            window.location.reload();
          },
          message: 'Reloading will discard any unsaved changes on this page.',
        });
        setIsModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 3. Browser Back/Forward navigation guard (popstate)
  useEffect(() => {
    const handlePopState = () => {
      if (isDirtyRef.current) {
        // Push state back so the SPA doesn't immediately abandon the dirty view
        window.history.pushState(null, '', window.location.href);

        setPendingNav({
          type: 'action',
          action: () => {
            // User confirmed leaving; temporarily clear dirty ref so popstate doesn't re-trigger
            isDirtyRef.current = false;
            setIsDirtyState(false);
            window.history.back();
          },
          message: 'Going back will discard your unsaved voucher changes.',
        });
        setIsModalOpen(true);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Intercept internal path navigation
  const navigate = useCallback(
    (targetPath: string) => {
      if (targetPath === currentPath) return;

      if (isDirtyRef.current) {
        setPendingNav({ type: 'path', path: targetPath });
        setIsModalOpen(true);
      } else {
        if (typeof window !== 'undefined' && window.history) {
          window.history.pushState(null, '', targetPath);
        }
        setCurrentPath(targetPath);
      }
    },
    [currentPath]
  );

  // Intercept custom actions (such as business switching or logout)
  const confirmAction = useCallback((action: () => void, customMessage?: string) => {
    if (isDirtyRef.current) {
      setPendingNav({ type: 'action', action, message: customMessage });
      setIsModalOpen(true);
    } else {
      action();
    }
  }, []);

  // Modal Action: Stay on Page
  const handleStay = useCallback(() => {
    setIsModalOpen(false);
    setPendingNav(null);
  }, []);

  // Modal Action: Leave Without Saving
  const handleLeave = useCallback(() => {
    setIsModalOpen(false);
    isDirtyRef.current = false;
    setIsDirtyState(false);

    const nav = pendingNav;
    setPendingNav(null);

    if (nav) {
      if (nav.type === 'path') {
        if (typeof window !== 'undefined' && window.history) {
          window.history.pushState(null, '', nav.path);
        }
        setCurrentPath(nav.path);
      } else if (nav.type === 'action') {
        nav.action();
      }
    }
  }, [pendingNav]);

  const modalMessage =
    (pendingNav && pendingNav.type === 'action' && pendingNav.message) ||
    dirtyMessage ||
    'You have unsaved changes. If you leave this page, your changes may be lost.';

  return (
    <UnsavedChangesContext.Provider
      value={{
        isDirty,
        dirtyMessage,
        setDirty,
        navigate,
        confirmAction,
        currentPath,
        setCurrentPath,
      }}
    >
      {children}

      {/* Centrally Rendered Unsaved Changes Dialog */}
      <UnsavedChangesModal
        isOpen={isModalOpen}
        title="Unsaved Changes"
        message={modalMessage}
        onStay={handleStay}
        onLeave={handleLeave}
      />
    </UnsavedChangesContext.Provider>
  );
};

export const useUnsavedChanges = (): UnsavedChangesContextType => {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  }
  return context;
};
