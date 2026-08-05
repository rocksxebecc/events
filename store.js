// ==========================================================================
// CampusEventX — Supabase Data Store
// All localStorage operations replaced with async Supabase queries
// ==========================================================================

import { supabase } from './supabase.js';

// ─── Auth ──────────────────────────────────────────────────────────────────

export async function signUp({ email, password, name, roll, dept, year, phone }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }   // passed to trigger → profiles.name
  });
  if (error) throw error;

  const isAdmin = email.trim().toLowerCase() === 'nikhildeosani@gmail.com';
  const role = isAdmin ? 'admin' : 'student';

  // Update the profile row with ALL student details on signup
  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        name,
        roll:         roll  || null,
        dept:         dept  || null,
        year:         year  || null,
        phone:        phone || null,
        role,
        email:        email.trim().toLowerCase(),
        status:       'active',
        is_verified:  false,
        last_login:   new Date().toISOString(),
        last_seen:    new Date().toISOString(),
        login_count:  1,
      })
      .eq('id', data.user.id);
    if (profileError) console.error('Profile update error:', profileError);

    // Log activity
    await logActivity('USER_SIGNUP', `New user ${name || email} registered`, data.user.id, email);
  }

  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  if (data.user) {
    // Check if user profile is banned or blocked
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role, name')
      .eq('id', data.user.id)
      .single();

    if (profile && (profile.status === 'banned' || profile.status === 'blocked')) {
      await supabase.auth.signOut();
      throw new Error(`Your account has been ${profile.status.toUpperCase()} by the administrator.`);
    }

    // Update email in profile and record login stats
    await supabase.from('profiles').update({
      email:       email.trim().toLowerCase(),
      last_login:  new Date().toISOString(),
      last_seen:   new Date().toISOString(),
    }).eq('id', data.user.id);

    // Increment login_count via RPC (ignores error gracefully — column may not exist yet)
    try {
      await supabase.rpc('update_user_login_stats', { p_user_id: data.user.id });
    } catch (_) { /* migration not run yet — safe to ignore */ }

    // Log login activity
    await logActivity('USER_LOGIN', `User ${profile?.name || email} logged in`, data.user.id, email);
  }

  return data;
}

export async function signOut() {
  const session = await getSession();
  if (session?.user) {
    await logActivity('USER_LOGOUT', `User ${session.user.email} logged out`, session.user.id, session.user.email);
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}


// ─── Profile ───────────────────────────────────────────────────────────────

export async function getProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn('getProfile query error:', error.message);
  }

  const session = await getSession();
  const email = session?.user?.email?.trim()?.toLowerCase();

  const profile = data || {
    id: userId,
    name: session?.user?.user_metadata?.full_name || (email ? email.split('@')[0] : 'Student'),
    email: email || '',
    role: (email === 'nikhildeosani@gmail.com' || email === 'nikhlideosani1@gmail.com') ? 'admin' : 'student'
  };

  if (!profile.username) {
    profile.username = localStorage.getItem(`cx_user_username_${userId}`) || (profile.email ? profile.email.split('@')[0] : '');
  }

  if (email === 'nikhildeosani@gmail.com' && profile.role !== 'admin') {
    profile.role = 'admin';
    try {
      await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId);
    } catch (e) {
      console.warn('Auto profile update role failed:', e);
    }
  }

  return profile;
}

export async function updateProfile(userId, updates) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, last_seen: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (!error && data) {
      if (updates.username) localStorage.setItem(`cx_user_username_${userId}`, updates.username);
      return data;
    }

    // Fallback if username column does not exist yet in Supabase schema
    if (error && (error.message?.includes('username') || error.code === 'PGRST204')) {
      const { username, ...safeUpdates } = updates;
      if (username) localStorage.setItem(`cx_user_username_${userId}`, username);

      const { data: fallbackData, error: fbError } = await supabase
        .from('profiles')
        .update({ ...safeUpdates, last_seen: new Date().toISOString() })
        .eq('id', userId)
        .select()
        .single();

      if (!fbError && fallbackData) {
        fallbackData.username = username || localStorage.getItem(`cx_user_username_${userId}`) || '';
        return fallbackData;
      }
      if (fbError) throw fbError;
    }

    if (error) throw error;
  } catch (err) {
    if (updates.username) localStorage.setItem(`cx_user_username_${userId}`, updates.username);
    throw err;
  }
}

/** Silently update last_seen heartbeat — called periodically while user is active */
export async function touchLastSeen(userId) {
  if (!userId) return;
  try {
    await supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', userId);
  } catch (_) { /* silent */ }
}

// ─── Events ────────────────────────────────────────────────────────────────

export async function getEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createEvent(eventData) {
  const session = await getSession();
  const payload = { ...eventData, created_by: session?.user?.id };
  if (payload.capacity !== null && payload.capacity !== undefined && payload.capacity !== '' && !isNaN(parseInt(payload.capacity, 10))) {
    payload.capacity = parseInt(payload.capacity, 10);
  } else {
    payload.capacity = 99999; // Unlimited default
  }

  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  await logActivity('EVENT_CREATED', `Event "${data.title}" created`, session?.user?.id, session?.user?.email);

  // Notify ALL users about the new event
  try {
    await createNotification({
      userId: 'ALL',
      title: '📅 New Campus Event Published!',
      message: `"${data.title}" has just been added. Check it out and register before slots fill up!`,
      type: 'event',
      linkTab: 'upcoming'
    });
  } catch (_) {}

  return data;
}

export async function updateEvent(id, eventData) {
  const session = await getSession();
  const payload = { ...eventData };
  if (payload.capacity !== null && payload.capacity !== undefined && payload.capacity !== '' && !isNaN(parseInt(payload.capacity, 10))) {
    payload.capacity = parseInt(payload.capacity, 10);
  } else {
    payload.capacity = 99999; // Unlimited default
  }

  const { data, error } = await supabase
    .from('events')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  await logActivity('EVENT_UPDATED', `Event "${data.title}" updated`, session?.user?.id, session?.user?.email);
  return data;
}

/**
 * Upload an event banner image.
 * Tries Supabase Storage bucket 'event-banners' first.
 * Falls back to base64 data URL if bucket doesn't exist or upload fails.
 */
export async function uploadEventBannerImage(file) {
  const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
  const fileName = `banner_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const { data, error } = await supabase.storage
      .from('event-banners')
      .upload(fileName, file, { cacheControl: '3600', upsert: false, contentType: file.type });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('event-banners')
      .getPublicUrl(fileName);

    if (urlData?.publicUrl) return urlData.publicUrl;
    throw new Error('No public URL returned');
  } catch (storageErr) {
    // Fallback: convert to base64 data URL so it still works without a storage bucket
    console.warn('Supabase Storage unavailable, using base64 fallback:', storageErr.message);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }
}

export async function deleteEvent(id) {
  const session = await getSession();
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id);
  if (error) throw error;

  await logActivity('EVENT_DELETED', `Event ${id} deleted`, session?.user?.id, session?.user?.email);
}

// ─── Enrollments ───────────────────────────────────────────────────────────

/** Returns list of event_ids the current user is enrolled in */
export async function getMyEnrollments(userId) {
  if (!userId) return [];
  const normUserId = String(userId || '');
  const enrolledSet = new Set();

  const session = await getSession();
  const userEmail = session?.user?.email?.trim()?.toLowerCase();

  // 1. Check local storage cache (by userId and by email)
  try {
    const key = `cx_user_enrollments_${normUserId}`;
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    saved.forEach(id => enrolledSet.add(String(id).toLowerCase()));

    if (userEmail) {
      const emailKey = `cx_user_enrollments_${userEmail}`;
      const emailSaved = JSON.parse(localStorage.getItem(emailKey) || '[]');
      emailSaved.forEach(id => enrolledSet.add(String(id).toLowerCase()));
    }
  } catch (_) {}

  // 2. Fetch from Supabase by user_id
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select('event_id, enrolled_at')
      .eq('user_id', userId);

    if (!error && data) {
      data.forEach(e => {
        if (e.event_id) enrolledSet.add(String(e.event_id).toLowerCase());
      });
    } else if (error) {
      console.warn('getMyEnrollments query warning:', error.message);
    }
  } catch (err) {
    console.error('getMyEnrollments error:', err);
  }

  // 3. If userEmail exists, also check for any profile with matching email
  if (userEmail) {
    try {
      const { data: matchingProfiles } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', userEmail);

      const pIds = (matchingProfiles || []).map(p => p.id).filter(Boolean);
      if (pIds.length > 0) {
        const { data: emailEnrollments } = await supabase
          .from('enrollments')
          .select('event_id')
          .in('user_id', pIds);

        (emailEnrollments || []).forEach(e => {
          if (e.event_id) enrolledSet.add(String(e.event_id).toLowerCase());
        });
      }
    } catch (_) {}
  }

  // Cache back to local storage
  try {
    const key = `cx_user_enrollments_${normUserId}`;
    localStorage.setItem(key, JSON.stringify(Array.from(enrolledSet)));
    if (userEmail) {
      const emailKey = `cx_user_enrollments_${userEmail}`;
      localStorage.setItem(emailKey, JSON.stringify(Array.from(enrolledSet)));
    }
  } catch (_) {}

  return Array.from(enrolledSet).map(id => ({ event_id: id }));
}

/** Returns enrollment count for each event as { event_id, count } */
export async function getEnrollmentCounts() {
  const { data, error } = await supabase
    .from('enrollments')
    .select('event_id');
  if (error) throw error;

  const counts = {};
  (data || []).forEach(({ event_id }) => {
    if (event_id) {
      const lowerKey = String(event_id).toLowerCase();
      counts[lowerKey] = (counts[lowerKey] || 0) + 1;
    }
  });

  return counts;
}

export async function enrollInEvent(eventId, userId) {
  const normEventId = String(eventId || '').toLowerCase();
  const normUserId = String(userId || '');

  let supabaseSuccess = false;
  try {
    const { error } = await supabase
      .from('enrollments')
      .insert({ event_id: eventId, user_id: userId });
    if (error) {
      if (error.code === '23505') throw new Error('You are already enrolled in this event!');
      console.warn('Supabase enrollInEvent insert warning:', error.message);
    } else {
      supabaseSuccess = true;
    }
  } catch (err) {
    if (err.message && err.message.includes('already enrolled')) throw err;
    console.warn('Supabase enrollInEvent warning:', err);
  }

  const session = await getSession();
  const userEmail = session?.user?.email?.trim()?.toLowerCase();

  // Update local storage cache fallback
  try {
    const key = `cx_user_enrollments_${normUserId}`;
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (!saved.includes(normEventId)) {
      saved.push(normEventId);
      localStorage.setItem(key, JSON.stringify(saved));
    }

    if (userEmail) {
      const emailKey = `cx_user_enrollments_${userEmail}`;
      const emailSaved = JSON.parse(localStorage.getItem(emailKey) || '[]');
      if (!emailSaved.includes(normEventId)) {
        emailSaved.push(normEventId);
        localStorage.setItem(emailKey, JSON.stringify(emailSaved));
      }
    }
  } catch (_) {}

  await logActivity('EVENT_ENROLLED', `Enrolled in event ${eventId}`, userId, session?.user?.email);
}

export async function unenrollFromEvent(eventId, userId) {
  const normEventId = String(eventId || '').toLowerCase();
  const normUserId = String(userId || '');

  try {
    await supabase
      .from('enrollments')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', userId);
  } catch (_) {}

  // Update local storage cache fallback
  try {
    const key = `cx_user_enrollments_${normUserId}`;
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    const updated = saved.filter(id => String(id).toLowerCase() !== normEventId);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (_) {}

  const session = await getSession();
  await logActivity('EVENT_UNENROLLED', `Unenrolled from event ${eventId}`, userId, session?.user?.email);
}


/** Admin only — get full roster with profile details for one event */
export async function getEventRoster(eventId) {
  const { data, error } = await supabase
    .from('enrollments')
    .select(`
      enrolled_at,
      profiles (
        id, name, roll, email:id, dept, year
      )
    `)
    .eq('event_id', eventId);
  if (error) throw error;
  return data || [];
}

/** Admin only — get full roster with profile + auth email (manual join, no FK required) */
export async function getEventRosterWithEmails(eventId) {
  // Step 1: Get enrollments for this event
  const { data: enrollments, error: enrollError } = await supabase
    .from('enrollments')
    .select('user_id, enrolled_at')
    .eq('event_id', eventId);

  if (enrollError) throw enrollError;
  if (!enrollments || enrollments.length === 0) return [];

  // Step 2: Fetch profiles for those user_ids
  const userIds = enrollments.map(e => e.user_id).filter(Boolean);

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, roll, dept, year, phone, email')
    .in('id', userIds);

  if (profileError) {
    console.warn('Profile fetch for roster failed:', profileError);
  }

  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  // Step 3: Merge
  return enrollments.map(e => ({
    user_id: e.user_id,
    enrolled_at: e.enrolled_at,
    profiles: profileMap.get(e.user_id) || { name: 'Unknown', roll: '—', dept: '—', year: '—' }
  }));
}

/** Admin — Remove a specific student from an event enrollment */
export async function adminRemoveEnrollment(eventId, userId) {
  const { error } = await supabase
    .from('enrollments')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', userId);
  if (error) throw error;
  const session = await getSession();
  await logActivity('ADMIN_REMOVE_ENROLLMENT', `Admin removed user ${userId} from event ${eventId}`, userId, session?.user?.email);
}

/** Admin — Update a student's profile field directly */
export async function adminUpdateProfile(userId, fields) {
  const { data, error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Admin User Management ──────────────────────────────────────────────────

/** Fetch all user profiles for Admin User Panel */
export async function getAllUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Admin Action — Change user role ('admin' or 'student') with original admin protection */
export async function setUserRole(userId, newRole) {
  // 1. Fetch target user profile to check protection
  const { data: targetUser } = await supabase
    .from('profiles')
    .select('email, name, role')
    .eq('id', userId)
    .maybeSingle();

  const targetEmail = (targetUser?.email || '').trim().toLowerCase();
  if (targetEmail === 'nikhildeosani@gmail.com' && newRole !== 'admin') {
    throw new Error('The original admin (nikhildeosani@gmail.com) is protected and cannot be removed as admin!');
  }

  // 2. Perform DB update
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;

  // 3. Log Activity & Send Notification
  const targetName = data?.name || targetUser?.name || data?.email || targetEmail || userId;
  const isGranting = newRole === 'admin';

  await logActivity(
    isGranting ? 'USER_PROMOTED_ADMIN' : 'USER_DEMOTED_ADMIN',
    isGranting ? `Granted Admin privileges to user ${targetName} (${data?.email || targetEmail})` : `Revoked Admin privileges from user ${targetName} (${data?.email || targetEmail})`,
    userId,
    data?.email || targetEmail || session?.user?.email
  );

  try {
    if (isGranting) {
      await createNotification({
        userId: userId,
        title: '👑 Admin Access Granted',
        message: 'You have been granted Admin privileges! You now have full access to the Admin Panel.',
        type: 'system',
        linkTab: 'admin'
      });
    } else {
      await createNotification({
        userId: userId,
        title: 'ℹ️ Role Updated',
        message: 'Your Admin privileges have been revoked by the primary administrator.',
        type: 'info',
        linkTab: 'profile'
      });
    }
  } catch (notifErr) {
    console.warn('Failed to dispatch role notification:', notifErr);
  }

  return data;
}

/** Admin Action — Set user status to 'active', 'banned', or 'blocked' */
export async function setUserStatus(userId, status) {
  // Check target user to protect primary admin
  const { data: targetUser } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  const targetEmail = (targetUser?.email || '').trim().toLowerCase();
  if (targetEmail === 'nikhildeosani@gmail.com' && (status === 'banned' || status === 'blocked')) {
    throw new Error('The original admin (nikhildeosani@gmail.com) is protected and cannot be banned or blocked.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ status })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;

  const session = await getSession();
  await logActivity(
    `USER_${status.toUpperCase()}`,
    `User profile status changed to ${status.toUpperCase()}`,
    userId,
    data?.email || session?.user?.email
  );
  return data;
}

/** Admin Action — Delete user profile and clear associated data */
export async function deleteUserProfile(userId) {
  // Check target user to protect primary admin
  const { data: targetUser } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  const targetEmail = (targetUser?.email || '').trim().toLowerCase();
  if (targetEmail === 'nikhildeosani@gmail.com') {
    throw new Error('The original admin (nikhildeosani@gmail.com) is protected and cannot be deleted.');
  }

  // First clear enrollments
  await supabase.from('enrollments').delete().eq('user_id', userId);
  
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId);
  if (error) throw error;

  await logActivity('USER_DELETED', `User profile ${userId} deleted by admin`, userId);
}

// ─── Activity Logging ───────────────────────────────────────────────────────

/** Record a platform activity log */
export async function logActivity(actionType, details, userId = null, userEmail = null) {
  try {
    let finalUserId = userId;
    let finalUserEmail = userEmail;

    if (!finalUserId || !finalUserEmail) {
      const session = await getSession();
      if (session?.user) {
        finalUserId = finalUserId || session.user.id;
        finalUserEmail = finalUserEmail || session.user.email;
      }
    }

    await supabase.from('activity_logs').insert({
      user_id: finalUserId,
      user_email: finalUserEmail,
      action_type: actionType,
      details
    });
  } catch (err) {
    console.warn('Activity logging warning:', err);
  }
}

/** Fetch recent activity logs for Admin Panel */
export async function getActivityLogs(limit = 100) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ─── Career & Mentors API ───────────────────────────────────────────────────

const LOCAL_MENTORS_KEY = 'cx_mentors_v1';
const LOCAL_MENTOR_APPS_KEY = 'cx_mentor_applications_v1';

function getLocalMentors() {
  const raw = localStorage.getItem(LOCAL_MENTORS_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  return [];
}

function saveLocalMentors(mentors) {
  localStorage.setItem(LOCAL_MENTORS_KEY, JSON.stringify(mentors));
}

function getLocalMentorApps() {
  const raw = localStorage.getItem(LOCAL_MENTOR_APPS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => a.id !== 'app-sample-1' && a.id !== 'app-sample-2');
      }
    } catch {}
  }
  return [];
}

function saveLocalMentorApps(apps) {
  localStorage.setItem(LOCAL_MENTOR_APPS_KEY, JSON.stringify(apps));
}

/** Fetch all appointed mentors (joined with their profile details) */
export async function getMentors() {
  let dbMentors = [];
  try {
    const { data, error } = await supabase
      .from('mentors')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) dbMentors = data;
    else if (error) console.warn('Supabase mentors fetch error:', error.message);
  } catch (err) {
    console.warn('Supabase mentors catch error:', err.message);
  }

  const localMentors = getLocalMentors();
  const dbUserIds = new Set(dbMentors.map(m => m.user_id).filter(Boolean));
  const dbIds = new Set(dbMentors.map(m => m.id));

  let merged = [...dbMentors];
  for (const lm of localMentors) {
    if (!dbIds.has(lm.id) && (!lm.user_id || !dbUserIds.has(lm.user_id))) {
      merged.push(lm);
      if (lm.user_id) dbUserIds.add(lm.user_id);
    }
  }

  // Filter out sample pre-example mentors
  const sampleKeywords = ['deepmind', 'aws', 'stripe', 'senior cloud architect', 'vp of product design', 'ai research lead'];
  merged = merged.filter(m => {
    const t = (m.title || '').toLowerCase();
    return !sampleKeywords.some(kw => t.includes(kw));
  });

  try {
    const userIds = Array.from(new Set(merged.map(m => m.user_id).filter(Boolean)));
    let profileMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, email, roll, dept, year, phone')
        .in('id', userIds);
      if (profiles) profileMap = new Map(profiles.map(p => [p.id, p]));
    }
    return merged.map(m => {
      const p = m.user_id ? profileMap.get(m.user_id) : null;
      const fallbackName = m.name || 'Appointed Mentor';
      return {
        ...m,
        profiles: p || m.profiles || { name: fallbackName, email: '' }
      };
    });
  } catch {
    return merged;
  }
}

/** Admin Action — Appoint an existing registered user as a mentor */
export async function createMentor({ userId, title, expertise, bio, available_slots }) {
  const session = await getSession();
  const slotsArray = Array.isArray(available_slots) 
    ? available_slots 
    : (available_slots || '').split(',').map(s => s.trim()).filter(Boolean);

  let mentorName = 'Appointed Mentor';
  let mentorEmail = '';
  if (userId) {
    try {
      const { data: p } = await supabase.from('profiles').select('name, email').eq('id', userId).single();
      if (p) {
        mentorName = p.name || p.email || mentorName;
        mentorEmail = p.email || '';
      }
    } catch {}
  }

  const payload = {
    user_id: userId,
    name: mentorName,
    title,
    expertise,
    bio,
    available_slots: slotsArray,
    created_by: session?.user?.id
  };

  try {
    let data, error;
    // Attempt 1: Insert full payload (has user_id & name)
    const res1 = await supabase
      .from('mentors')
      .insert(payload)
      .select('*')
      .single();

    data = res1.data;
    error = res1.error;

    // Fallback if 'name' or 'user_id' column doesn't exist in Supabase DB schema
    if (error && (error.message?.includes('user_id') || error.message?.includes('name') || error.code === 'PGRST204')) {
      console.warn('Retrying mentor insert with compatible payload schema:', error.message);
      const subPayload = {
        title,
        expertise,
        bio,
        available_slots: slotsArray,
        created_by: session?.user?.id
      };
      if (!error.message?.includes('user_id')) subPayload.user_id = userId;
      if (!error.message?.includes('name')) subPayload.name = mentorName;

      const res2 = await supabase.from('mentors').insert(subPayload).select('*').single();
      data = res2.data;
      error = res2.error;
    }

    if (error) {
      if (error.code === '23505') throw new Error('This user is already appointed as a mentor!');
      throw error;
    }

    await logActivity('MENTOR_APPOINTED', `Appointed user ${mentorName} as mentor (${title})`, session?.user?.id, session?.user?.email);

    // Notify ALL users about the new mentor
    try {
      await createNotification({
        userId: 'ALL',
        title: '💼 New Mentor Available!',
        message: `${mentorName} (${title}) is now available for 1-on-1 guidance sessions. Book your slot today!`,
        type: 'mentor',
        linkTab: 'career'
      });
    } catch (_) {}

    return {
      ...data,
      profiles: { name: mentorName, email: mentorEmail }
    };
  } catch (err) {
    if (err.message?.includes('already appointed')) throw err;
    console.error('Supabase createMentor error:', err.message || err);

    const localMentors = getLocalMentors();
    if (localMentors.some(m => m.user_id === userId)) {
      throw new Error('This user is already appointed as a mentor!');
    }

    const mentorObj = {
      id: 'mentor-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ...payload,
      profiles: { name: mentorName, email: mentorEmail },
      created_at: new Date().toISOString()
    };

    localMentors.unshift(mentorObj);
    saveLocalMentors(localMentors);

    try {
      await logActivity('MENTOR_APPOINTED', `Appointed user as mentor (${title})`, session?.user?.id, session?.user?.email);
    } catch {}

    return mentorObj;
  }
}

/** Admin Action — Remove an appointed mentor */
export async function deleteMentor(id) {
  const session = await getSession();
  try {
    const { error } = await supabase
      .from('mentors')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    console.warn('Supabase deleteMentor error:', err.message);
  }

  const localMentors = getLocalMentors().filter(m => m.id !== id);
  saveLocalMentors(localMentors);

  await logActivity('MENTOR_REMOVED', `Removed mentor ID ${id}`, session?.user?.id, session?.user?.email);
}

const LOCAL_APPOINTMENTS_KEY = 'cx_booked_appointments_v1';

function getLocalAppointments() {
  const raw = localStorage.getItem(LOCAL_APPOINTMENTS_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  return [];
}

function saveLocalAppointments(appts) {
  localStorage.setItem(LOCAL_APPOINTMENTS_KEY, JSON.stringify(appts));
}

/** Student Action — Book guidance appointment slot with mentor */
export async function bookAppointment({ mentorId, slotTime, guidanceTopic, studentName }) {
  const session = await getSession();
  if (!session?.user) throw new Error('You must be logged in to book an appointment.');

  // Find mentor user details for notification
  let mentorUserId = null;
  let mentorTitle = 'Campus Mentor';
  let mentorName = 'Appointed Mentor';
  try {
    const { data: mentor } = await supabase
      .from('mentors')
      .select('id, user_id, title, name')
      .eq('id', mentorId)
      .single();

    if (mentor) {
      mentorUserId = mentor.user_id;
      mentorTitle = mentor.title || mentorTitle;
      mentorName = mentor.name || mentorName;
    }
  } catch {}

  // Check if slot has active/cancelled bookings
  try {
    const { data: existingAppts } = await supabase
      .from('mentor_appointments')
      .select('id, status')
      .eq('mentor_id', mentorId)
      .eq('slot_time', slotTime);

    if (existingAppts && existingAppts.length > 0) {
      const activeAppt = existingAppts.find(a => a.status !== 'cancelled');
      if (activeAppt) {
        throw new Error(`Slot "${slotTime}" is already booked for this mentor. Please pick another slot.`);
      }
      // If there are only cancelled bookings, delete them from Supabase so re-booking succeeds
      const cancelledIds = existingAppts.filter(a => a.status === 'cancelled').map(a => a.id);
      if (cancelledIds.length > 0) {
        await supabase.from('mentor_appointments').delete().in('id', cancelledIds);
      }
    }
  } catch (err) {
    if (err.message?.includes('already booked')) throw err;
    console.warn('Check existing appointments warning:', err.message);
  }

  const appointmentObj = {
    mentor_id: mentorId,
    user_id: session.user.id,
    student_name: studentName || session.user.email,
    student_email: session.user.email,
    slot_time: slotTime,
    guidance_topic: guidanceTopic || 'Career & Guidance Session',
    status: 'pending'   // Awaiting mentor acceptance
  };

  let data = null;
  try {
    const res = await supabase
      .from('mentor_appointments')
      .insert(appointmentObj)
      .select()
      .single();

    if (res.error) {
      if (res.error.code === '23505') throw new Error(`Slot "${slotTime}" is already booked for this mentor. Please pick another slot.`);
      console.warn('Supabase mentor_appointments insert warning:', res.error.message);
    } else {
      data = res.data;
    }
  } catch (err) {
    if (err.message?.includes('already booked')) throw err;
    console.warn('bookAppointment Supabase error, using local fallback:', err.message);
  }

  const finalAppt = data || {
    id: 'appt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    ...appointmentObj,
    created_at: new Date().toISOString()
  };

  // Cache locally so both student and mentor see it immediately (remove old cancelled entries for this slot first)
  let localAppts = getLocalAppointments().filter(a => !(a.mentor_id === mentorId && a.slot_time === slotTime && a.status === 'cancelled'));
  if (!localAppts.some(a => a.id === finalAppt.id)) {
    localAppts.unshift(finalAppt);
    saveLocalAppointments(localAppts);
  }

  // Log activity notification for student
  await logActivity('APPOINTMENT_BOOKED', `Booked mentorship slot "${slotTime}" with ${mentorName}`, session.user.id, session.user.email);

  // Notify the mentor about the new booking
  if (mentorUserId) {
    try {
      await createNotification({
        userId: mentorUserId,
        title: '🎟️ New Session Booking Request',
        message: `${studentName || session.user.email} has booked your "${slotTime}" slot. Go to Career tab to accept or decline.`,
        type: 'booking',
        linkTab: 'career'
      });
    } catch (_) {}
  }

  return finalAppt;
}

/** Fetch student's booked appointments AND mentor's incoming student bookings */
export async function getMyAppointments(userId) {
  if (!userId) return [];

  // 1. Fetch appointments where current user is the student (user_id = userId)
  let studentAppointments = [];
  try {
    const { data, error } = await supabase
      .from('mentor_appointments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) studentAppointments = data;
  } catch (err) {
    console.warn('getMyAppointments student fetch error:', err.message);
  }

  // 2. Check if current user is an appointed mentor and fetch incoming bookings
  let mentorAppointments = [];
  let mentorIds = [];
  try {
    let mentorRecs = [];
    const { data: mentors1 } = await supabase
      .from('mentors')
      .select('id, title, user_id, name')
      .or(`user_id.eq.${userId},created_by.eq.${userId}`);

    if (mentors1 && mentors1.length > 0) {
      mentorRecs = mentors1;
    } else {
      // Fallback by profile name/email
      const { data: prof } = await supabase.from('profiles').select('name, email').eq('id', userId).single();
      if (prof) {
        const queryOr = [];
        if (prof.name) queryOr.push(`name.ilike.${prof.name}`);
        if (prof.email) queryOr.push(`name.ilike.${prof.email}`);
        if (queryOr.length > 0) {
          const { data: mentors2 } = await supabase.from('mentors').select('id, title, user_id, name').or(queryOr.join(','));
          if (mentors2) mentorRecs = mentors2;
        }
      }
    }

    if (mentorRecs.length > 0) {
      mentorIds = mentorRecs.map(m => m.id);
      const { data: appts, error: apptErr } = await supabase
        .from('mentor_appointments')
        .select('*')
        .in('mentor_id', mentorIds)
        .order('created_at', { ascending: false });

      if (!apptErr && appts) {
        mentorAppointments = appts.map(a => ({
          ...a,
          is_mentor_booking: true
        }));
      }
    }
  } catch (err) {
    console.warn('getMyAppointments mentor fetch error:', err.message);
  }

  // 3. Merge local storage appointments cache
  const localAppts = getLocalAppointments();
  const mentorIdSet = new Set(mentorIds);
  for (const la of localAppts) {
    if (la.user_id === userId) {
      studentAppointments.push(la);
    } else if (mentorIdSet.has(la.mentor_id)) {
      mentorAppointments.push({ ...la, is_mentor_booking: true });
    }
  }

  // Deduplicate and combine
  const seenIds = new Set();
  const combined = [];

  for (const a of [...mentorAppointments, ...studentAppointments]) {
    if (a && a.id && !seenIds.has(a.id)) {
      seenIds.add(a.id);
      combined.push(a);
    }
  }

  // Fetch profiles & mentor details for combined appointments
  const allMentorIds = Array.from(new Set(combined.map(a => a.mentor_id).filter(Boolean)));
  const studentUserIds = Array.from(new Set(combined.map(a => a.user_id).filter(Boolean)));

  let mentorMap = new Map();
  if (allMentorIds.length > 0) {
    try {
      const { data: mentors } = await supabase.from('mentors').select('*').in('id', allMentorIds);
      if (mentors) mentorMap = new Map(mentors.map(m => [m.id, m]));
    } catch {}
  }

  let profileMap = new Map();
  if (studentUserIds.length > 0) {
    try {
      const { data: profiles } = await supabase.from('profiles').select('id, name, email, roll, dept, year, phone').in('id', studentUserIds);
      if (profiles) profileMap = new Map(profiles.map(p => [p.id, p]));
    } catch {}
  }

  return combined.map(a => {
    const m = mentorMap.get(a.mentor_id) || {};
    const mentorUser = m.user_id ? profileMap.get(m.user_id) : null;
    const studentUser = profileMap.get(a.user_id) || null;

    return {
      ...a,
      student_profile: studentUser,
      mentors: {
        ...m,
        profiles: mentorUser || { name: m.name || 'Appointed Mentor', email: '' }
      }
    };
  });
}

/** Fetch all appointments for Admin overview */
export async function getAllAppointments() {
  const { data, error } = await supabase
    .from('mentor_appointments')
    .select(`
      *,
      mentors (
        name, title
      )
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Cancel / withdraw a booked appointment */
export async function cancelAppointment(appointmentId) {
  const session = await getSession();

  // Mark as cancelled in localStorage on THIS device immediately
  try {
    const localAppts = getLocalAppointments();
    const updated = localAppts.map(a =>
      a.id === appointmentId ? { ...a, status: 'cancelled' } : a
    );
    saveLocalAppointments(updated);
  } catch (_) {}

  // UPDATE status to 'cancelled' in Supabase (NOT delete).
  // This lets the student fetch the cancelled status on next load.
  try {
    const { error } = await supabase
      .from('mentor_appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointmentId);
    if (error) {
      // Fallback: delete if UPDATE fails (e.g. no UPDATE policy yet)
      console.warn('Update failed, trying delete:', error.message);
      await supabase.from('mentor_appointments').delete().eq('id', appointmentId);
    }
  } catch (err) {
    console.warn('Supabase cancelAppointment error:', err.message);
  }

  await logActivity('APPOINTMENT_CANCELLED', `Cancelled appointment ID ${appointmentId}`, session?.user?.id, session?.user?.email);
}

/** Permanently remove/dismiss an appointment */
export async function deleteAppointment(appointmentId) {
  try {
    const localAppts = getLocalAppointments();
    const filtered = localAppts.filter(a => a.id !== appointmentId);
    saveLocalAppointments(filtered);
  } catch (_) {}

  try {
    await supabase.from('mentor_appointments').delete().eq('id', appointmentId);
  } catch (_) {}
}



/** Mentor Action — Accept an incoming student booking */
export async function acceptAppointment(appointmentId) {
  const session = await getSession();

  // Update in localStorage immediately
  try {
    const localAppts = getLocalAppointments();
    const updated = localAppts.map(a =>
      a.id === appointmentId ? { ...a, status: 'confirmed' } : a
    );
    saveLocalAppointments(updated);
  } catch (_) {}

  // Update in Supabase
  try {
    const { error } = await supabase
      .from('mentor_appointments')
      .update({ status: 'confirmed' })
      .eq('id', appointmentId);
    if (error) console.warn('Supabase acceptAppointment warning:', error.message);
  } catch (err) {
    console.warn('Supabase acceptAppointment error:', err.message);
  }

  await logActivity('APPOINTMENT_ACCEPTED', `Mentor accepted appointment ID ${appointmentId}`, session?.user?.id, session?.user?.email);

  // Notify the student that their session was confirmed
  try {
    const { data: appt } = await supabase
      .from('mentor_appointments')
      .select('user_id, slot_time')
      .eq('id', appointmentId)
      .single();

    if (appt?.user_id) {
      await createNotification({
        userId: appt.user_id,
        title: '✅ Guidance Session Confirmed!',
        message: `Your mentorship booking for "${appt.slot_time}" has been accepted! Go to Career tab to start chatting with your mentor.`,
        type: 'booking',
        linkTab: 'career'
      });
    }
  } catch (_) {}
}



/** Student Action — Submit application to become a campus mentor */
export async function submitMentorApplication({ title, expertise, bio, available_slots }) {
  const session = await getSession();
  if (!session?.user) throw new Error('You must be logged in to apply for mentorship.');

  const slotsArray = Array.isArray(available_slots) 
    ? available_slots 
    : (available_slots || '').split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    user_id: session.user.id,
    title,
    expertise,
    bio,
    available_slots: slotsArray,
    status: 'pending'
  };

  try {
    const { data, error } = await supabase
      .from('mentor_applications')
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('You already have a pending mentorship application under review!');
      throw error;
    }

    await logActivity('MENTOR_APP_SUBMITTED', JSON.stringify(payload), session.user.id, session.user.email);
    return data;
  } catch (err) {
    if (err.message?.includes('already have a pending')) throw err;
    console.warn('Supabase mentor_applications insert error:', err.message);

    try {
      await logActivity('MENTOR_APP_SUBMITTED', JSON.stringify(payload), session.user.id, session.user.email);
    } catch {}

    const localApps = getLocalMentorApps();
    const existingPending = localApps.find(a => a.user_id === session.user.id && a.status === 'pending');
    if (existingPending) throw new Error('You already have a pending mentorship application under review!');

    const appObj = {
      id: 'app-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ...payload,
      created_at: new Date().toISOString()
    };

    localApps.push(appObj);
    saveLocalMentorApps(localApps);

    return appObj;
  }
}

/** Admin Action — Fetch all mentorship applications with user profile info */
export async function getMentorApplications() {
  let dbApps = [];
  try {
    const { data, error } = await supabase
      .from('mentor_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) dbApps = data;
    else if (error) console.warn('Supabase mentor_applications fetch error:', error.message);
  } catch (err) {
    console.warn('Supabase mentor_applications catch error:', err.message);
  }

  // Cross-device fallback: check activity_logs for MENTOR_APP_SUBMITTED events
  try {
    const { data: logEntries } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('action', 'MENTOR_APP_SUBMITTED')
      .order('created_at', { ascending: false });

    if (logEntries && logEntries.length > 0) {
      const dbUserIds = new Set(dbApps.map(a => a.user_id));
      for (const log of logEntries) {
        if (!log.user_id || dbUserIds.has(log.user_id)) continue;
        try {
          const parsed = JSON.parse(log.details);
          if (parsed && parsed.title) {
            dbApps.push({
              id: 'log-app-' + log.id,
              user_id: log.user_id,
              title: parsed.title,
              expertise: parsed.expertise,
              bio: parsed.bio,
              available_slots: parsed.available_slots || [],
              status: parsed.status || 'pending',
              created_at: log.created_at
            });
            dbUserIds.add(log.user_id);
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('Activity log fallback check error:', e);
  }

  // Merge Supabase apps and local storage apps (deduping by user_id)
  const localApps = getLocalMentorApps();
  const dbUserIds = new Set(dbApps.map(a => a.user_id));
  const mergedApps = [...dbApps];
  for (const lApp of localApps) {
    if (!dbUserIds.has(lApp.user_id)) {
      mergedApps.push(lApp);
      dbUserIds.add(lApp.user_id);
    }
  }

  // Attach profile info for applicants
  try {
    const userIds = Array.from(new Set(mergedApps.map(a => a.user_id).filter(Boolean)));
    let profileMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, email, roll, dept, year, phone')
        .in('id', userIds);
      if (profiles) profileMap = new Map(profiles.map(p => [p.id, p]));
    }

    return mergedApps.map(a => {
      const p = a.user_id ? profileMap.get(a.user_id) : null;
      return {
        ...a,
        profiles: p || a.profiles || { name: 'Student Applicant', email: a.user_id || '—' }
      };
    });
  } catch (e) {
    console.warn('Profiles merge error in getMentorApplications:', e);
    return mergedApps;
  }
}

/** Admin Action — Approve mentorship application and create mentor entry */
export async function approveMentorApplication(applicationId) {
  const session = await getSession();

  let app = null;

  try {
    const { data, error } = await supabase
      .from('mentor_applications')
      .select('*')
      .eq('id', applicationId)
      .single();
    if (!error && data) app = data;
  } catch {}

  if (!app) {
    const localApps = getLocalMentorApps();
    app = localApps.find(a => a.id === applicationId);
  }

  if (!app) throw new Error('Application not found.');

  // Create mentor entry
  await createMentor({
    userId: app.user_id,
    title: app.title,
    expertise: app.expertise,
    bio: app.bio,
    available_slots: app.available_slots
  });

  // Update status
  app.status = 'approved';

  try {
    await supabase
      .from('mentor_applications')
      .update({ status: 'approved' })
      .eq('id', applicationId);
  } catch {}

  const localApps = getLocalMentorApps();
  const localItem = localApps.find(a => a.id === applicationId);
  if (localItem) {
    localItem.status = 'approved';
    saveLocalMentorApps(localApps);
  }

  await logActivity('MENTOR_APP_APPROVED', `Approved mentorship application ${applicationId}`, session?.user?.id, session?.user?.email);
  return app;
}

/** Admin Action — Reject mentorship application */
export async function rejectMentorApplication(applicationId) {
  const session = await getSession();

  try {
    await supabase
      .from('mentor_applications')
      .update({ status: 'rejected' })
      .eq('id', applicationId);
  } catch {}

  const localApps = getLocalMentorApps();
  const localItem = localApps.find(a => a.id === applicationId);
  if (localItem) {
    localItem.status = 'rejected';
    saveLocalMentorApps(localApps);
  }

  await logActivity('MENTOR_APP_REJECTED', `Rejected mentorship application ${applicationId}`, session?.user?.id, session?.user?.email);
  return { id: applicationId, status: 'rejected' };
}

// ─── Social Hub & Friends System ──────────────────────────────────────────
const LOCAL_POSTS_KEY = 'cx_social_posts_v1';
const LOCAL_FRIENDS_KEY = 'cx_friend_requests_v1';

export async function getSocialPosts() {
  let posts = [];
  try {
    const { data, error } = await supabase
      .from('social_posts')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      posts = data;
    }
  } catch (_) {}

  if (posts.length === 0) {
    const saved = localStorage.getItem(LOCAL_POSTS_KEY);
    if (saved) {
      try {
        const local = JSON.parse(saved);
        posts = local.filter(p => p.id !== 'post-1' && p.id !== 'post-2');
      } catch (_) {}
    }
  }

  // Hydrate author profiles so name/dept updates dynamically reflect on all posts!
  try {
    const users = await getAllUsers();
    const userMap = new Map(users.map(u => [u.id, u]));

    posts = posts.map(p => {
      const author = p.user_id ? userMap.get(p.user_id) : null;
      if (author) {
        return {
          ...p,
          author_name: author.name || author.email || p.author_name,
          author_dept: author.dept || p.author_dept,
          author_year: author.year || p.author_year,
          author_username: author.username || (author.email ? author.email.split('@')[0] : '')
        };
      }
      return p;
    });
  } catch (_) {}

  return posts;
}

/** Upload a media File to Supabase Storage and return its public URL */
export async function uploadPostMedia(file) {
  if (!file) return null;

  const session = await getSession();
  const userId = session?.user?.id || 'anon';
  const ext = file.name.split('.').pop() || 'bin';
  const fileName = `${userId}_${Date.now()}.${ext}`;
  const filePath = `posts/${fileName}`;

  try {
    const { data, error } = await supabase.storage
      .from('post-media')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });

    if (error) {
      console.warn('Supabase storage upload error:', error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('post-media')
      .getPublicUrl(filePath);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn('uploadPostMedia error:', err.message);
    return null;
  }
}

export async function createSocialPost({ type, content, image, authorName, authorDept, authorYear }) {
  const session = await getSession();
  const isValidUuid = session?.user?.id && /^[0-9a-fA-F-]{36}$/.test(session.user.id);
  const userId = isValidUuid ? session.user.id : null;

  const insertPayload = {
    type: type || 'post',
    content: content.trim(),
    image: image?.trim() || '',
    author_name: authorName || session?.user?.email || 'Anonymous Student',
    author_dept: authorDept || 'General Department',
    author_year: authorYear || 'Student'
  };

  if (userId) {
    insertPayload.user_id = userId;
  }

  try {
    const { data, error } = await supabase
      .from('social_posts')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.warn('Supabase social_posts insert warning:', error);
    } else if (data) {
      await logActivity('SOCIAL_POST', `User shared a ${type} post`, userId, session?.user?.email);
      return data;
    }
  } catch (err) {
    console.warn('Supabase post creation error:', err);
  }

  // Fallback to local storage
  const newPost = {
    id: 'post-' + Date.now(),
    user_id: userId || 'guest-user-' + Date.now(),
    ...insertPayload,
    likes_count: 0,
    liked_by: [],
    created_at: new Date().toISOString()
  };

  const posts = await getSocialPosts();
  posts.unshift(newPost);
  localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts));
  return newPost;
}

export async function toggleLikePost(postId, currentUserId) {
  const posts = await getSocialPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return;

  if (!post.liked_by) post.liked_by = [];
  const index = post.liked_by.indexOf(currentUserId);
  if (index >= 0) {
    post.liked_by.splice(index, 1);
    post.likes_count = Math.max(0, (post.likes_count || 1) - 1);
  } else {
    post.liked_by.push(currentUserId);
    post.likes_count = (post.likes_count || 0) + 1;
  }

  localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts));

  try {
    await supabase.from('social_posts').update({
      likes_count: post.likes_count
    }).eq('id', postId);
  } catch (_) {}

  return post;
}

/** Delete a social post by ID — removes from DB and local cache */
export async function deleteSocialPost(postId) {
  const session = await getSession();
  if (!session?.user) throw new Error('You must be logged in to delete a post.');

  // Remove from Supabase
  try {
    const { error } = await supabase
      .from('social_posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', session.user.id);  // enforces ownership server-side

    if (error) console.warn('Supabase deleteSocialPost warning:', error.message);
  } catch (err) {
    console.warn('deleteSocialPost DB error:', err.message);
  }

  // Remove from localStorage cache
  try {
    const saved = localStorage.getItem(LOCAL_POSTS_KEY);
    if (saved) {
      const posts = JSON.parse(saved).filter(p => p.id !== postId);
      localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts));
    }
  } catch (_) {}
}

export async function getFriendRequests() {
  let requests = [];
  try {
    const { data, error } = await supabase
      .from('friend_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      requests = data;
    }
  } catch (_) {}

  if (requests.length === 0) {
    const saved = localStorage.getItem(LOCAL_FRIENDS_KEY);
    if (saved) {
      try { requests = JSON.parse(saved); } catch (_) {}
    }
  }

  // Hydrate sender/receiver names dynamically from latest profiles table!
  try {
    const users = await getAllUsers();
    const userMap = new Map(users.map(u => [u.id, u]));

    requests = requests.map(r => {
      const sender = r.sender_id ? userMap.get(r.sender_id) : null;
      const receiver = r.receiver_id ? userMap.get(r.receiver_id) : null;
      return {
        ...r,
        sender_name: sender?.name || r.sender_name || sender?.email,
        sender_dept: sender?.dept || r.sender_dept,
        sender_year: sender?.year || r.sender_year,
        receiver_name: receiver?.name || r.receiver_name || receiver?.email,
        receiver_dept: receiver?.dept || r.receiver_dept,
        receiver_year: receiver?.year || r.receiver_year
      };
    });
  } catch (_) {}

  localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(requests));
  return requests;
}

export async function sendFriendRequest(receiverUser, senderProfile) {
  const requests = await getFriendRequests();
  const session = await getSession();

  const senderId = senderProfile?.id || session?.user?.id || senderProfile?.email || 'user-sender';
  const receiverId = receiverUser?.id || receiverUser?.email || 'user-receiver';

  const senderName = senderProfile?.name || senderProfile?.email || session?.user?.email || 'Student Member';
  const receiverName = receiverUser?.name || receiverUser?.email || 'Student Member';

  const senderEmail = senderProfile?.email || session?.user?.email || '';
  const senderUsername = senderProfile?.username || (senderEmail ? senderEmail.split('@')[0] : '');

  const receiverEmail = receiverUser?.email || '';
  const receiverUsername = receiverUser?.username || (receiverEmail ? receiverEmail.split('@')[0] : '');

  const existing = requests.find(r => 
    (r.sender_id === senderId && r.receiver_id === receiverId) ||
    (r.sender_id === receiverId && r.receiver_id === senderId) ||
    (r.sender_name && r.sender_name.toLowerCase() === senderName.toLowerCase() && r.receiver_name && r.receiver_name.toLowerCase() === receiverName.toLowerCase())
  );

  if (existing) {
    if (existing.status === 'accepted') throw new Error(`You are already friends with ${receiverName}!`);
    if (existing.status === 'pending') throw new Error(`Friend request is already pending with ${receiverName}.`);
  }

  const basePayload = {
    sender_id: String(senderId),
    receiver_id: String(receiverId),
    sender_name: senderName,
    receiver_name: receiverName,
    sender_dept: senderProfile?.dept || 'Engineering',
    sender_year: senderProfile?.year || 'Student',
    receiver_dept: receiverUser.dept || '',
    receiver_year: receiverUser.year || '',
    status: 'pending'
  };

  try {
    const { data, error } = await supabase
      .from('friend_requests')
      .insert(basePayload)
      .select()
      .single();

    if (error) {
      console.warn('Supabase friend_requests insert warning:', error);
    } else if (data) {
      await logActivity('FRIEND_REQUEST_SENT', `Sent friend request to ${basePayload.receiver_name}`, senderId);

      // Notify the receiver about the friend request
      try {
        await createNotification({
          userId: String(receiverId),
          title: '🤝 New Friend Request',
          message: `${senderName} wants to connect with you on campus! Check your Social Hub to accept or decline.`,
          type: 'friend',
          linkTab: 'social'
        });
      } catch (_) {}

      return data;
    }
  } catch (err) {
    console.warn('Supabase friend request creation error:', err);
  }

  // Fallback to local storage
  const newReq = {
    id: 'req-' + Date.now(),
    ...basePayload,
    sender_email: senderEmail,
    sender_username: senderUsername,
    receiver_email: receiverEmail,
    receiver_username: receiverUsername,
    created_at: new Date().toISOString()
  };

  requests.push(newReq);
  localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(requests));

  try {
    await logActivity('FRIEND_REQUEST_SENT', `Sent friend request to ${payload.receiver_name}`, senderId);
  } catch (_) {}

  return newReq;
}

export async function acceptFriendRequest(requestId) {
  try {
    const { data, error } = await supabase
      .from('friend_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId)
      .select()
      .single();

    if (!error && data) return data;
  } catch (_) {}

  const requests = await getFriendRequests();
  const req = requests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'accepted';
  localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(requests));
  return req;
}

export async function rejectFriendRequest(requestId) {
  try {
    const { data, error } = await supabase
      .from('friend_requests')
      .update({ status: 'rejected' })
      .eq('id', requestId)
      .select()
      .single();

    if (!error && data) return data;
  } catch (_) {}

  const requests = await getFriendRequests();
  const req = requests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'rejected';
  localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(requests));
  return req;
}

export async function withdrawFriendRequest(targetUserIdOrReqId) {
  const session = await getSession();
  const currentUserId = session?.user?.id || 'current-user';

  try {
    await supabase
      .from('friend_requests')
      .delete()
      .or(`id.eq.${targetUserIdOrReqId},and(sender_id.eq.${currentUserId},receiver_id.eq.${targetUserIdOrReqId}),and(sender_id.eq.${targetUserIdOrReqId},receiver_id.eq.${currentUserId})`);
  } catch (err) {
    console.warn('Supabase withdraw friend request error:', err);
  }

  const requests = await getFriendRequests();
  const updated = requests.filter(r => 
    r.id !== targetUserIdOrReqId && 
    !(r.sender_id === currentUserId && r.receiver_id === targetUserIdOrReqId) &&
    !(r.sender_id === targetUserIdOrReqId && r.receiver_id === currentUserId)
  );

  localStorage.setItem(LOCAL_FRIENDS_KEY, JSON.stringify(updated));
  return true;
}

// ─── Direct Peer-to-Peer Chat API ──────────────────────────────────────────
const LOCAL_CHAT_KEY = 'campus_chat_messages_v1';

export async function getChatMessages(userId1, userId2) {
  if (!userId1 || !userId2) return [];

  let dbMsgs = [];
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .or(`and(sender_id.eq.${userId1},receiver_id.eq.${userId2}),and(sender_id.eq.${userId2},receiver_id.eq.${userId1})`)
      .order('created_at', { ascending: true });

    if (!error && data) dbMsgs = data;
    else if (error) console.warn('Supabase chat fetch warning:', error.message);
  } catch (err) {
    console.warn('Supabase chat catch error:', err.message);
  }

  // Merge local storage cached messages
  let localMsgs = [];
  const saved = localStorage.getItem(LOCAL_CHAT_KEY);
  if (saved) {
    try { localMsgs = JSON.parse(saved); } catch (_) {}
  }

  const localRoomMsgs = localMsgs.filter(m => 
    (m.sender_id === userId1 && m.receiver_id === userId2) ||
    (m.sender_id === userId2 && m.receiver_id === userId1)
  );

  // Combine and deduplicate
  const seenIds = new Set(dbMsgs.map(m => m.id));
  const merged = [...dbMsgs];
  for (const lm of localRoomMsgs) {
    if (lm.id && !seenIds.has(lm.id)) {
      merged.push(lm);
      seenIds.add(lm.id);
    }
  }

  return merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function sendChatMessage({ sender_id, receiver_id, sender_name, receiver_name, message }) {
  if (!message || !message.trim()) return;

  const newMsg = {
    id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    sender_id: String(sender_id),
    receiver_id: String(receiver_id),
    sender_name: sender_name || 'Member',
    receiver_name: receiver_name || 'Friend',
    message: message.trim(),
    created_at: new Date().toISOString()
  };

  // Cache locally
  let allMsgs = [];
  const saved = localStorage.getItem(LOCAL_CHAT_KEY);
  if (saved) {
    try { allMsgs = JSON.parse(saved); } catch (_) {}
  }

  allMsgs.push(newMsg);
  localStorage.setItem(LOCAL_CHAT_KEY, JSON.stringify(allMsgs));

  // Store in Supabase database
  try {
    const { data: dbData, error } = await supabase.from('chat_messages').insert({
      sender_id: String(sender_id),
      receiver_id: String(receiver_id),
      message: newMsg.message
    }).select().single();

    // Trigger notification for message recipient
    try {
      await createNotification({
        userId: String(receiver_id),
        title: '💬 New Direct Chat Message',
        message: `${sender_name || 'A campus member'} sent you a message: "${newMsg.message.slice(0, 60)}"`,
        type: 'chat',
        linkTab: 'social'
      });
    } catch (_) {}

    if (!error && dbData) return dbData;
  } catch (err) {
    console.warn('Supabase chat insert catch warning:', err.message);
  }

  return newMsg;
}

// ─── System Notifications API ──────────────────────────────────────────────
const LOCAL_NOTIFS_KEY = 'cx_user_notifications_v1';

export async function getUserNotifications(userId) {
  if (!userId) return [];

  let dbNotifs = [];
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .or(`user_id.eq.${userId},user_id.eq.ALL`)
      .order('created_at', { ascending: false });

    if (!error && data) dbNotifs = data;
  } catch (err) {
    console.warn('getUserNotifications DB warning:', err.message);
  }

  // Also check for unread chat messages targeted to this user
  let chatNotifs = [];
  try {
    const { data: unreadChats } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (unreadChats && unreadChats.length > 0) {
      chatNotifs = unreadChats.map(m => ({
        id: 'chat-notif-' + m.id,
        user_id: userId,
        title: '💬 New Direct Chat Message',
        message: `${m.sender_name || 'A campus member'} sent you a message: "${m.message}"`,
        type: 'chat',
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        link_tab: 'social',
        is_read: false,
        created_at: m.created_at
      }));
    }
  } catch (_) {}

  // Fetch local storage fallback
  let localNotifs = [];
  try {
    const saved = localStorage.getItem(LOCAL_NOTIFS_KEY);
    if (saved) {
      localNotifs = JSON.parse(saved).filter(n => n.user_id === userId || n.user_id === 'ALL');
    }
  } catch (_) {}

  // Combine and deduplicate
  const seenIds = new Set();
  const merged = [];

  // Read local read-status tracking
  let readIds = new Set();
  try {
    const savedRead = JSON.parse(localStorage.getItem('cx_read_notif_ids_v1') || '[]');
    readIds = new Set(savedRead);
  } catch (_) {}

  for (const n of [...dbNotifs, ...chatNotifs, ...localNotifs]) {
    if (n && n.id && !seenIds.has(n.id)) {
      seenIds.add(n.id);
      if (readIds.has(n.id)) {
        n.is_read = true;
      }
      merged.push(n);
    }
  }

  return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function createNotification({ userId = 'ALL', title, message, type = 'info', linkTab = null }) {
  const notifObj = {
    user_id: userId,
    title,
    message,
    type,
    link_tab: linkTab,
    is_read: false
  };

  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert(notifObj)
      .select()
      .single();

    if (!error && data) return data;
  } catch (err) {
    console.warn('createNotification DB warning:', err.message);
  }

  // Fallback to local storage
  const localNotif = {
    id: 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    ...notifObj,
    created_at: new Date().toISOString()
  };

  try {
    const saved = localStorage.getItem(LOCAL_NOTIFS_KEY);
    const list = saved ? JSON.parse(saved) : [];
    list.unshift(localNotif);
    localStorage.setItem(LOCAL_NOTIFS_KEY, JSON.stringify(list));
  } catch (_) {}

  return localNotif;
}

export async function markNotificationsAsRead(userId, notifIds = []) {
  if (!userId) return;

  // Persist read IDs in local storage
  try {
    const savedRead = new Set(JSON.parse(localStorage.getItem('cx_read_notif_ids_v1') || '[]'));
    notifIds.forEach(id => savedRead.add(id));
    localStorage.setItem('cx_read_notif_ids_v1', JSON.stringify(Array.from(savedRead)));
  } catch (_) {}

  try {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .or(`user_id.eq.${userId},user_id.eq.ALL`);
  } catch (_) {}

  try {
    const saved = localStorage.getItem(LOCAL_NOTIFS_KEY);
    if (saved) {
      const list = JSON.parse(saved).map(n => ({ ...n, is_read: true }));
      localStorage.setItem(LOCAL_NOTIFS_KEY, JSON.stringify(list));
    }
  } catch (_) {}
}

/** Admin only — get ALL student enrollments across ALL events with event & profile details */
export async function getAllStudentEnrollments() {
  let enrollments = [];
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, event_id, user_id, enrolled_at')
      .order('enrolled_at', { ascending: false });

    if (!error && data) {
      enrollments = data;
    }
  } catch (err) {
    console.warn('getAllStudentEnrollments error:', err);
  }

  // Fetch events
  const events = await getEvents();
  const eventMap = new Map((events || []).map(e => [e.id, e]));

  // Collect user_ids
  const userIds = Array.from(new Set(enrollments.map(e => e.user_id).filter(Boolean)));
  let profileMap = new Map();

  if (userIds.length > 0) {
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, roll, dept, year, phone, email')
        .in('id', userIds);
      if (profiles) {
        profileMap = new Map(profiles.map(p => [p.id, p]));
      }
    } catch (e) {
      console.warn('Profiles fetch warning in getAllStudentEnrollments:', e);
    }
  }

  return enrollments.map(enr => {
    const evt = eventMap.get(enr.event_id) || { title: 'Campus Event', category: 'General', date: enr.enrolled_at, venue: 'Main Auditorium' };
    const prof = profileMap.get(enr.user_id) || { name: 'Student Member', roll: '0000', email: 'student@campus.edu' };
    const rollSuffix = (prof.roll || '0000').slice(-4);
    const ticketCode = `CX-${(enr.event_id || '000000').slice(0, 6).toUpperCase()}-${rollSuffix}`;

    return {
      id: enr.id,
      event_id: enr.event_id,
      user_id: enr.user_id,
      enrolled_at: enr.enrolled_at,
      ticket_code: ticketCode,
      event: evt,
      profile: prof
    };
  });
}

/** Register student ticket check-in at event entry checkpoint */
export async function registerTicketCheckIn(ticketCode, eventId, userId) {
  const normCode = String(ticketCode || '').toUpperCase().trim();
  const timestamp = new Date().toISOString();

  try {
    const key = 'cx_checked_in_tickets';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved[normCode] = { checked_in_at: timestamp, checked_by: userId || 'admin', event_id: eventId };
    localStorage.setItem(key, JSON.stringify(saved));
  } catch (_) {}

  try {
    const session = await getSession();
    await logActivity('TICKET_CHECKED_IN', `Verified & registered check-in for ticket ${normCode}`, userId, session?.user?.email);
  } catch (_) {}

  return { ticketCode: normCode, checked_in_at: timestamp };
}

export function getTicketCheckInStatus(ticketCode) {
  const normCode = String(ticketCode || '').toUpperCase().trim();
  try {
    const key = 'cx_checked_in_tickets';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return saved[normCode] || null;
  } catch (_) {
    return null;
  }
}

/** Fetch user's current mentor application */
export async function getUserMentorApplication(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('mentor_applications')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && data) return data;
  } catch (_) {}

  const localApps = getLocalMentorApps();
  return localApps.find(a => a.user_id === userId) || null;
}

/** Withdraw / Cancel student's mentor application */
export async function withdrawMentorApplication(userId) {
  const session = await getSession();
  const uid = userId || session?.user?.id;
  if (!uid) throw new Error('User session not found.');

  try {
    await supabase
      .from('mentor_applications')
      .delete()
      .eq('user_id', uid);
  } catch (err) {
    console.warn('Supabase withdraw application notice:', err.message);
  }

  try {
    const localApps = getLocalMentorApps();
    const updated = localApps.filter(a => a.user_id !== uid);
    saveLocalMentorApps(updated);
  } catch (_) {}

  try {
    await logActivity('MENTOR_APP_WITHDRAWN', 'User withdrew mentorship application', uid, session?.user?.email);
  } catch (_) {}

  return true;
}



