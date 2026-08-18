import { Request, Response, NextFunction } from 'express';

export function requirePermission(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required to access this resource.',
      });
      return;
    }

    if (req.user.isSuperAdmin) {
      next();
      return;
    }

    const hasPerm = req.user.permissions && req.user.permissions.includes(permissionCode);
    if (!hasPerm) {
      res.status(403).json({
        error: 'FORBIDDEN_PERMISSION_DENIED',
        message: `Permission denied. Required permission: '${permissionCode}'`,
        requiredPermission: permissionCode,
      });
      return;
    }

    next();
  };
}

export function requireAnyPermission(permissionCodes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required to access this resource.',
      });
      return;
    }

    if (req.user.isSuperAdmin) {
      next();
      return;
    }

    const hasAny = permissionCodes.some(code => req.user?.permissions?.includes(code));
    if (!hasAny) {
      res.status(403).json({
        error: 'FORBIDDEN_PERMISSION_DENIED',
        message: `Permission denied. One of the following permissions is required: ${permissionCodes.join(', ')}`,
        requiredPermissions: permissionCodes,
      });
      return;
    }

    next();
  };
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.',
    });
    return;
  }

  if (!req.user.isSuperAdmin) {
    res.status(403).json({
      error: 'FORBIDDEN_SUPER_ADMIN_REQUIRED',
      message: 'This operation strictly requires Super Administrator privileges.',
    });
    return;
  }

  next();
}
