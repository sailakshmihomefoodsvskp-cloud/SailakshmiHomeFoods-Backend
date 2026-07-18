/**
 * User Controller — Supabase version
 * Replaces Mongoose User model operations.
 */

import {
  findUserByFirebaseUid,
  findUserByEmail,
  createUser,
  linkFirebaseUid,
  updateUserProfile,
  sanitizeUser,
} from '../models/userModel.js';

// ── Get Profile ──────────────────────────────────────────────────────────────

export const getProfile = async (req, res) => {
  try {
    const { uid, email } = req.user;

    let user = await findUserByFirebaseUid(uid);

    if (!user) {
      user = await findUserByEmail(email);
      if (user) {
        user = await linkFirebaseUid(user.id, uid);
      } else {
        // Auto-create to fix broken state
        user = await createUser({
          firebaseUid:  uid,
          email,
          name:         req.user.name || email.split('@')[0],
          authProvider: 'google',
        });
      }
    }

    return res.status(200).json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('❌ Get profile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
};

// ── Update Profile ───────────────────────────────────────────────────────────

export const updateProfile = async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { name, mobileNumber, address, state, country, pincode } = req.body;

    // Build update map (snake_case for Supabase)
    const updates = {};
    if (name          !== undefined) updates.name           = name;
    if (mobileNumber  !== undefined) updates.mobile_number  = mobileNumber;
    if (address       !== undefined) updates.address        = address;
    if (state         !== undefined) updates.state          = state;
    if (country       !== undefined) updates.country        = country;
    if (pincode       !== undefined) updates.pincode        = pincode;

    if (updates.name !== undefined && !String(updates.name).trim()) {
      return res.status(400).json({ success: false, message: 'Name cannot be empty' });
    }

    // Ensure user exists before update
    let user = await findUserByFirebaseUid(uid);
    if (!user) {
      user = await findUserByEmail(email);
      if (user && !user.firebase_uid) {
        await linkFirebaseUid(user.id, uid);
      }
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
    }

    const updated = await updateUserProfile(uid, updates);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: sanitizeUser(updated),
    });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};
