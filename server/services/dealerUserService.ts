import { Request } from 'express';
import { pool } from '../db/index.js';
import { hashPassword } from '../auth/password.js';
import { recordAuditLog } from './auditService.js';

export interface DealerUserRecord {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: string;
  isSuperAdmin: boolean;
  roleId: string | null;
  roleCode: string | null;
  roleName: string | null;
  isDefault: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  assignedAt: string;
}

export interface CreateDealerUserInput {
  fullName: string;
  username: string;
  email?: string;
  mobile?: string;
  password: string;
  confirmPassword?: string;
  roleId: string;
  isDefault?: boolean;
}

export interface AssignExistingUserInput {
  userId: string;
  roleId: string;
  isDefault?: boolean;
}

export interface UpdateUserProfileInput {
  fullName: string;
  email?: string;
  mobile?: string;
}

export class DealerUserService {
  /**
   * List all users assigned to a specific Dealer business
   */
  static async getDealerUsers(dealerBusinessId: string): Promise<{
    users: DealerUserRecord[];
    stats: { total: number; active: number; inactive: number };
  }> {
    const client = await pool.connect();
    try {
      const query = `
        SELECT 
          u.id,
          u.username,
          u.full_name as "fullName",
          u.email,
          u.mobile,
          u.status,
          u.is_super_admin as "isSuperAdmin",
          u.last_login_at as "lastLoginAt",
          u.created_at as "createdAt",
          uba.is_default as "isDefault",
          uba.created_at as "assignedAt",
          r.id as "roleId",
          r.code as "roleCode",
          r.name as "roleName"
        FROM user_business_access uba
        INNER JOIN users u ON u.id = uba.user_id
        LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.business_id = uba.business_id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE uba.business_id = $1
        ORDER BY uba.is_default DESC, u.full_name ASC
      `;

      const res = await client.query(query, [dealerBusinessId]);
      const users: DealerUserRecord[] = res.rows;

      let active = 0;
      let inactive = 0;
      for (const u of users) {
        if (u.status === 'ACTIVE') active++;
        else inactive++;
      }

      return {
        users,
        stats: {
          total: users.length,
          active,
          inactive,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Search users across the system who are NOT yet assigned to this Dealer business
   */
  static async searchCandidateUsers(
    dealerBusinessId: string,
    searchQuery: string
  ): Promise<any[]> {
    const client = await pool.connect();
    try {
      const q = (searchQuery || '').trim().toLowerCase();
      const searchParam = `%${q}%`;

      const query = `
        SELECT 
          u.id,
          u.username,
          u.full_name as "fullName",
          u.email,
          u.mobile,
          u.status,
          u.is_super_admin as "isSuperAdmin"
        FROM users u
        WHERE u.id NOT IN (
          SELECT user_id FROM user_business_access WHERE business_id = $1
        )
        AND u.status = 'ACTIVE'
        ${
          q
            ? `AND (
                LOWER(u.username) LIKE $2 
                OR LOWER(u.full_name) LIKE $2 
                OR LOWER(COALESCE(u.email, '')) LIKE $2 
                OR COALESCE(u.mobile, '') LIKE $2
              )`
            : ''
        }
        ORDER BY u.full_name ASC
        LIMIT 20
      `;

      const params = q ? [dealerBusinessId, searchParam] : [dealerBusinessId];
      const res = await client.query(query, params);
      return res.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Check if username, email, or mobile already exist in the database
   */
  static async checkUserDuplicates(
    username: string,
    email?: string,
    mobile?: string
  ): Promise<{
    hasDuplicate: boolean;
    reason?: 'USERNAME_TAKEN' | 'EMAIL_TAKEN' | 'MOBILE_TAKEN';
    existingUser?: {
      id: string;
      username: string;
      fullName: string;
      email: string | null;
      mobile: string | null;
    };
  }> {
    const client = await pool.connect();
    try {
      const cleanUsername = username.trim().toLowerCase();
      const cleanEmail = email?.trim().toLowerCase() || null;
      const cleanMobile = mobile?.trim() || null;

      // Check username first
      const userRes = await client.query(
        `SELECT id, username, full_name, email, mobile FROM users WHERE LOWER(username) = $1 LIMIT 1`,
        [cleanUsername]
      );
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        return {
          hasDuplicate: true,
          reason: 'USERNAME_TAKEN',
          existingUser: {
            id: u.id,
            username: u.username,
            fullName: u.full_name,
            email: u.email,
            mobile: u.mobile,
          },
        };
      }

      // Check email if provided
      if (cleanEmail) {
        const emailRes = await client.query(
          `SELECT id, username, full_name, email, mobile FROM users WHERE LOWER(email) = $1 LIMIT 1`,
          [cleanEmail]
        );
        if (emailRes.rows.length > 0) {
          const u = emailRes.rows[0];
          return {
            hasDuplicate: true,
            reason: 'EMAIL_TAKEN',
            existingUser: {
              id: u.id,
              username: u.username,
              fullName: u.full_name,
              email: u.email,
              mobile: u.mobile,
            },
          };
        }
      }

      // Check mobile if provided
      if (cleanMobile) {
        const mobileRes = await client.query(
          `SELECT id, username, full_name, email, mobile FROM users WHERE mobile = $1 LIMIT 1`,
          [cleanMobile]
        );
        if (mobileRes.rows.length > 0) {
          const u = mobileRes.rows[0];
          return {
            hasDuplicate: true,
            reason: 'MOBILE_TAKEN',
            existingUser: {
              id: u.id,
              username: u.username,
              fullName: u.full_name,
              email: u.email,
              mobile: u.mobile,
            },
          };
        }
      }

      return { hasDuplicate: false };
    } finally {
      client.release();
    }
  }

  /**
   * Create a new User and atomically assign access and role to the Dealer business
   */
  static async createDealerUser(
    dealerBusinessId: string,
    actorUserId: string,
    isSuperAdminActor: boolean,
    input: CreateDealerUserInput,
    req?: Request
  ): Promise<{
    success: boolean;
    user: DealerUserRecord;
    message: string;
  }> {
    const {
      fullName,
      username,
      email,
      mobile,
      password,
      confirmPassword,
      roleId,
      isDefault = true,
    } = input;

    // 1. Basic validation
    if (!fullName || !fullName.trim()) {
      throw new Error('Full Name is required');
    }
    if (!username || !username.trim()) {
      throw new Error('Username is required');
    }
    if (username.trim().length < 3) {
      throw new Error('Username must be at least 3 characters');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }
    if (!roleId) {
      throw new Error('Role assignment is required');
    }

    const client = await pool.connect();
    try {
      // 2. Validate role
      const roleRes = await client.query(`SELECT id, code, name FROM roles WHERE id = $1`, [roleId]);
      if (roleRes.rows.length === 0) {
        throw new Error('Invalid role specified');
      }
      const role = roleRes.rows[0];

      // Block normal admin from assigning SUPER_ADMIN
      if (role.code === 'SUPER_ADMIN' && !isSuperAdminActor) {
        throw new Error('Unauthorized: SUPER_ADMIN role cannot be assigned to dealer users');
      }

      // 3. Verify dealer business exists
      const bizRes = await client.query(`SELECT id, name, business_type FROM businesses WHERE id = $1`, [
        dealerBusinessId,
      ]);
      if (bizRes.rows.length === 0) {
        throw new Error('Dealer business not found');
      }
      const dealerBiz = bizRes.rows[0];

      // 4. Duplicate check
      const dupCheck = await this.checkUserDuplicates(username, email, mobile);
      if (dupCheck.hasDuplicate) {
        const reasonStr =
          dupCheck.reason === 'USERNAME_TAKEN'
            ? 'Username already taken'
            : dupCheck.reason === 'EMAIL_TAKEN'
            ? 'Email already registered'
            : 'Mobile number already registered';
        const err: any = new Error(reasonStr);
        err.code = 'DUPLICATE_USER';
        err.existingUser = dupCheck.existingUser;
        throw err;
      }

      // 5. Hash password with bcrypt
      const passwordHash = await hashPassword(password);

      await client.query('BEGIN');

      // 6. Insert new user
      const userInsertRes = await client.query(
        `INSERT INTO users (
          username, email, mobile, full_name, password_hash, is_super_admin, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, false, 'ACTIVE', NOW(), NOW()
        ) RETURNING id, username, full_name, email, mobile, status, is_super_admin, created_at`,
        [
          username.trim().toLowerCase(),
          email?.trim().toLowerCase() || null,
          mobile?.trim() || null,
          fullName.trim(),
          passwordHash,
        ]
      );
      const newUser = userInsertRes.rows[0];

      // 7. Insert user_business_access
      await client.query(
        `INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [newUser.id, dealerBusinessId, Boolean(isDefault)]
      );

      // 8. Insert user_roles
      await client.query(
        `INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, business_id, role_id) DO NOTHING`,
        [newUser.id, dealerBusinessId, role.id, actorUserId]
      );

      await client.query('COMMIT');

      // 9. Audit Logging
      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: actorUserId,
        action: 'USER_CREATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'User',
        entityId: newUser.id,
        newValue: {
          username: newUser.username,
          fullName: newUser.full_name,
          dealerBusinessId,
          dealerName: dealerBiz.name,
          roleCode: role.code,
          isDefault,
        },
        req,
      });

      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: actorUserId,
        action: 'USER_ROLE_ASSIGNED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'UserRole',
        entityId: newUser.id,
        newValue: {
          username: newUser.username,
          dealerBusinessId,
          roleId: role.id,
          roleCode: role.code,
        },
        req,
      });

      return {
        success: true,
        message: `User ${newUser.username} successfully created and assigned to ${dealerBiz.name}`,
        user: {
          id: newUser.id,
          username: newUser.username,
          fullName: newUser.full_name,
          email: newUser.email,
          mobile: newUser.mobile,
          status: newUser.status,
          isSuperAdmin: false,
          roleId: role.id,
          roleCode: role.code,
          roleName: role.name,
          isDefault: Boolean(isDefault),
          lastLoginAt: null,
          createdAt: newUser.created_at,
          assignedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Assign an existing active user to a Dealer business
   */
  static async assignExistingUser(
    dealerBusinessId: string,
    actorUserId: string,
    isSuperAdminActor: boolean,
    input: AssignExistingUserInput,
    req?: Request
  ): Promise<{
    success: boolean;
    user: DealerUserRecord;
    message: string;
  }> {
    const { userId, roleId, isDefault = false } = input;

    if (!userId) throw new Error('User ID is required');
    if (!roleId) throw new Error('Role ID is required');

    const client = await pool.connect();
    try {
      // 1. Verify user exists and is ACTIVE
      const userRes = await client.query(
        `SELECT id, username, full_name, email, mobile, status, is_super_admin, last_login_at, created_at
         FROM users WHERE id = $1`,
        [userId]
      );
      if (userRes.rows.length === 0) {
        throw new Error('User not found');
      }
      const existingUser = userRes.rows[0];
      if (existingUser.status !== 'ACTIVE') {
        throw new Error('Cannot assign an inactive user. Activate the user first.');
      }

      // 2. Verify role
      const roleRes = await client.query(`SELECT id, code, name FROM roles WHERE id = $1`, [roleId]);
      if (roleRes.rows.length === 0) {
        throw new Error('Invalid role specified');
      }
      const role = roleRes.rows[0];

      if (role.code === 'SUPER_ADMIN' && !isSuperAdminActor) {
        throw new Error('Unauthorized: SUPER_ADMIN role cannot be assigned to dealer users');
      }

      // 3. Verify dealer business
      const bizRes = await client.query(`SELECT id, name FROM businesses WHERE id = $1`, [dealerBusinessId]);
      if (bizRes.rows.length === 0) {
        throw new Error('Dealer business not found');
      }
      const dealerBiz = bizRes.rows[0];

      // 4. Check if user already assigned to this dealer
      const existingAccessRes = await client.query(
        `SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
        [userId, dealerBusinessId]
      );
      if (existingAccessRes.rows.length > 0) {
        throw new Error(`User ${existingUser.username} already has access to ${dealerBiz.name}`);
      }

      // Check if user currently has any default business
      const userDefaultsRes = await client.query(
        `SELECT id FROM user_business_access WHERE user_id = $1 AND is_default = true`,
        [userId]
      );
      const hasAnyDefault = userDefaultsRes.rows.length > 0;
      // If user has 0 defaults, make this one default automatically
      const willBeDefault = isDefault || !hasAnyDefault;

      await client.query('BEGIN');

      if (willBeDefault) {
        // Clear other defaults first to respect partial unique index
        await client.query(
          `UPDATE user_business_access SET is_default = false WHERE user_id = $1`,
          [userId]
        );
      }

      // Insert access row
      await client.query(
        `INSERT INTO user_business_access (user_id, business_id, is_default, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [userId, dealerBusinessId, willBeDefault]
      );

      // Delete any prior role mapping for this specific business
      await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND business_id = $2`,
        [userId, dealerBusinessId]
      );

      // Insert role
      await client.query(
        `INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, dealerBusinessId, role.id, actorUserId]
      );

      await client.query('COMMIT');

      // Audit Log
      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: actorUserId,
        action: 'USER_BUSINESS_ACCESS_GRANTED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'UserBusinessAccess',
        entityId: userId,
        newValue: {
          username: existingUser.username,
          dealerBusinessId,
          dealerName: dealerBiz.name,
          roleCode: role.code,
          isDefault: willBeDefault,
        },
        req,
      });

      return {
        success: true,
        message: `User ${existingUser.username} assigned to ${dealerBiz.name} as ${role.name}`,
        user: {
          id: existingUser.id,
          username: existingUser.username,
          fullName: existingUser.full_name,
          email: existingUser.email,
          mobile: existingUser.mobile,
          status: existingUser.status,
          isSuperAdmin: existingUser.is_super_admin,
          roleId: role.id,
          roleCode: role.code,
          roleName: role.name,
          isDefault: willBeDefault,
          lastLoginAt: existingUser.last_login_at,
          createdAt: existingUser.created_at,
          assignedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update role for a user in this specific Dealer business
   */
  static async updateUserRole(
    dealerBusinessId: string,
    targetUserId: string,
    roleId: string,
    actorUserId: string,
    isSuperAdminActor: boolean,
    req?: Request
  ): Promise<{ success: boolean; message: string; role: { id: string; code: string; name: string } }> {
    const client = await pool.connect();
    try {
      // 1. Verify access exists
      const accessRes = await client.query(
        `SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, dealerBusinessId]
      );
      if (accessRes.rows.length === 0) {
        throw new Error('User does not have access to this business');
      }

      // 2. Verify role
      const roleRes = await client.query(`SELECT id, code, name FROM roles WHERE id = $1`, [roleId]);
      if (roleRes.rows.length === 0) {
        throw new Error('Invalid role specified');
      }
      const role = roleRes.rows[0];

      if (role.code === 'SUPER_ADMIN' && !isSuperAdminActor) {
        throw new Error('Unauthorized: SUPER_ADMIN role cannot be assigned');
      }

      await client.query('BEGIN');

      // Remove existing role for this business
      await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, dealerBusinessId]
      );

      // Insert new role
      await client.query(
        `INSERT INTO user_roles (user_id, business_id, role_id, assigned_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [targetUserId, dealerBusinessId, role.id, actorUserId]
      );

      await client.query('COMMIT');

      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: actorUserId,
        action: 'USER_ROLE_CHANGED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'UserRole',
        entityId: targetUserId,
        newValue: {
          targetUserId,
          dealerBusinessId,
          roleId: role.id,
          roleCode: role.code,
        },
        req,
      });

      return {
        success: true,
        message: `Role updated to ${role.name}`,
        role: {
          id: role.id,
          code: role.code,
          name: role.name,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Set Dealer business as default for a user (transactionally updates other memberships)
   */
  static async setUserDefaultBusiness(
    targetUserId: string,
    targetBusinessId: string,
    actorUserId: string,
    req?: Request
  ): Promise<{ success: boolean; message: string }> {
    const client = await pool.connect();
    try {
      // 1. Verify access exists
      const accessRes = await client.query(
        `SELECT id FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, targetBusinessId]
      );
      if (accessRes.rows.length === 0) {
        throw new Error('User does not have access to this business');
      }

      await client.query('BEGIN');

      // Clear existing default
      await client.query(
        `UPDATE user_business_access SET is_default = false WHERE user_id = $1`,
        [targetUserId]
      );

      // Set target business as default
      await client.query(
        `UPDATE user_business_access SET is_default = true WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, targetBusinessId]
      );

      await client.query('COMMIT');

      await recordAuditLog({
        businessId: targetBusinessId,
        userId: actorUserId,
        action: 'USER_DEFAULT_BUSINESS_CHANGED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'UserBusinessAccess',
        entityId: targetUserId,
        newValue: {
          targetUserId,
          defaultBusinessId: targetBusinessId,
        },
        req,
      });

      return {
        success: true,
        message: 'Default business updated successfully',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Safely remove user access from a Dealer business.
   * Does NOT delete the user record or historical audit/voucher records.
   * Promotes another remaining business to default if this was default.
   */
  static async removeDealerUserAccess(
    dealerBusinessId: string,
    targetUserId: string,
    actorUserId: string,
    req?: Request
  ): Promise<{ success: boolean; message: string; remainingBusinessesCount: number }> {
    const client = await pool.connect();
    try {
      // 1. Check access
      const accessRes = await client.query(
        `SELECT id, is_default FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, dealerBusinessId]
      );
      if (accessRes.rows.length === 0) {
        throw new Error('User does not have access to this business');
      }
      const wasDefault = accessRes.rows[0].is_default;

      await client.query('BEGIN');

      // Remove roles for this business
      await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, dealerBusinessId]
      );

      // Remove business access row
      await client.query(
        `DELETE FROM user_business_access WHERE user_id = $1 AND business_id = $2`,
        [targetUserId, dealerBusinessId]
      );

      // If removed business was default, promote another remaining business if any
      const remainingRes = await client.query(
        `SELECT id, business_id FROM user_business_access WHERE user_id = $1 ORDER BY created_at ASC`,
        [targetUserId]
      );

      if (wasDefault && remainingRes.rows.length > 0) {
        const nextDefaultBizId = remainingRes.rows[0].business_id;
        await client.query(
          `UPDATE user_business_access SET is_default = true WHERE user_id = $1 AND business_id = $2`,
          [targetUserId, nextDefaultBizId]
        );
      }

      await client.query('COMMIT');

      await recordAuditLog({
        businessId: dealerBusinessId,
        userId: actorUserId,
        action: 'USER_BUSINESS_ACCESS_REMOVED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'UserBusinessAccess',
        entityId: targetUserId,
        newValue: {
          targetUserId,
          dealerBusinessId,
          wasDefault,
          remainingBusinessesCount: remainingRes.rows.length,
        },
        req,
      });

      return {
        success: true,
        message: 'User access to this dealer removed successfully',
        remainingBusinessesCount: remainingRes.rows.length,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Activate or Deactivate a user
   */
  static async toggleUserStatus(
    targetUserId: string,
    status: 'ACTIVE' | 'INACTIVE',
    actorUserId: string,
    req?: Request
  ): Promise<{ success: boolean; message: string; status: string }> {
    const client = await pool.connect();
    try {
      const userRes = await client.query(
        `SELECT id, username, full_name, status, is_super_admin FROM users WHERE id = $1`,
        [targetUserId]
      );
      if (userRes.rows.length === 0) {
        throw new Error('User not found');
      }
      const user = userRes.rows[0];

      if (user.is_super_admin && status === 'INACTIVE') {
        throw new Error('Cannot deactivate Super Administrator accounts');
      }

      await client.query(
        `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, targetUserId]
      );

      await recordAuditLog({
        businessId: req?.user?.currentBusinessId || undefined,
        userId: actorUserId,
        action: status === 'ACTIVE' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'User',
        entityId: targetUserId,
        newValue: {
          targetUserId,
          username: user.username,
          newStatus: status,
        },
        req,
      });

      return {
        success: true,
        message: `User ${user.username} is now ${status}`,
        status,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update user master profile details (Full name, email, mobile)
   */
  static async updateUserProfile(
    targetUserId: string,
    input: UpdateUserProfileInput,
    actorUserId: string,
    req?: Request
  ): Promise<{ success: boolean; message: string; user: any }> {
    const { fullName, email, mobile } = input;
    if (!fullName || !fullName.trim()) {
      throw new Error('Full Name is required');
    }

    const client = await pool.connect();
    try {
      const cleanEmail = email?.trim().toLowerCase() || null;
      const cleanMobile = mobile?.trim() || null;

      // Check email duplicate if changed
      if (cleanEmail) {
        const emailCheck = await client.query(
          `SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2 LIMIT 1`,
          [cleanEmail, targetUserId]
        );
        if (emailCheck.rows.length > 0) {
          throw new Error('Email is already in use by another account');
        }
      }

      // Check mobile duplicate if changed
      if (cleanMobile) {
        const mobileCheck = await client.query(
          `SELECT id FROM users WHERE mobile = $1 AND id != $2 LIMIT 1`,
          [cleanMobile, targetUserId]
        );
        if (mobileCheck.rows.length > 0) {
          throw new Error('Mobile number is already in use by another account');
        }
      }

      const res = await client.query(
        `UPDATE users
         SET full_name = $1, email = $2, mobile = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING id, username, full_name as "fullName", email, mobile, status`,
        [fullName.trim(), cleanEmail, cleanMobile, targetUserId]
      );

      if (res.rows.length === 0) {
        throw new Error('User not found');
      }

      await recordAuditLog({
        businessId: req?.user?.currentBusinessId || undefined,
        userId: actorUserId,
        action: 'USER_PROFILE_UPDATED',
        module: 'DEALER_ADMINISTRATION',
        entityType: 'User',
        entityId: targetUserId,
        newValue: {
          fullName: fullName.trim(),
          email: cleanEmail,
          mobile: cleanMobile,
        },
        req,
      });

      return {
        success: true,
        message: 'User profile updated successfully',
        user: res.rows[0],
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all business memberships and roles for a specific user (for the "Manage Access" modal)
   */
  static async getUserAccessSummary(targetUserId: string): Promise<{
    user: any;
    businesses: Array<{
      businessId: string;
      businessName: string;
      businessType: string;
      isDefault: boolean;
      roleId: string | null;
      roleCode: string | null;
      roleName: string | null;
      assignedAt: string;
    }>;
  }> {
    const client = await pool.connect();
    try {
      const userRes = await client.query(
        `SELECT id, username, full_name as "fullName", email, mobile, status, is_super_admin as "isSuperAdmin"
         FROM users WHERE id = $1`,
        [targetUserId]
      );
      if (userRes.rows.length === 0) {
        throw new Error('User not found');
      }

      const query = `
        SELECT 
          b.id as "businessId",
          b.name as "businessName",
          b.business_type as "businessType",
          uba.is_default as "isDefault",
          uba.created_at as "assignedAt",
          r.id as "roleId",
          r.code as "roleCode",
          r.name as "roleName"
        FROM user_business_access uba
        INNER JOIN businesses b ON b.id = uba.business_id
        LEFT JOIN user_roles ur ON ur.user_id = uba.user_id AND ur.business_id = uba.business_id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE uba.user_id = $1
        ORDER BY uba.is_default DESC, b.name ASC
      `;

      const res = await client.query(query, [targetUserId]);

      return {
        user: userRes.rows[0],
        businesses: res.rows,
      };
    } finally {
      client.release();
    }
  }
}
