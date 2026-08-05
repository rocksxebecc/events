// ==========================================================================
// CampusEventX — Main UI Controller (Supabase Edition)
// ==========================================================================

import { supabase } from './supabase.js';
import * as store from './store.js';

// ─── App State ─────────────────────────────────────────────────────────────
let currentSession = null;   // Supabase session
let currentProfile = null;   // profiles row { id, role, name, roll, dept, year, phone }
let allEvents = [];          // events[]
let enrollmentCounts = {};   // { event_id: count }
let myEnrollmentIds = new Set();  // Set of event_ids the current user is in

let currentTab = 'upcoming';
let tabHistory = [];  // stack for back-navigation
let currentSearch = '';
let currentCategory = 'ALL';
let activeRosterEventId = null;
let activeRosterData = [];
let allAdminUsers = [];
let allAdminLogs = [];
let allAdminMentorApps = [];
let allMentors = [];
let myAppointments = [];



// ─── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupStaticListeners();
  await bootApp();

  supabase.auth.onAuthStateChange(async (event, session) => {
    currentSession = session;
    if (session) {
      await loadProfile(session.user.id);
    } else {
      currentProfile = null;
      myEnrollmentIds = new Set();
    }
    updateAuthUI();
    renderEvents();
    updateStats();
  });
});

async function bootApp() {
  showLoading(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    currentSession = session;

    if (session) {
      await loadProfile(session.user.id);
      loadUserNotifications().catch(() => {});
    }

    await refreshEvents();
    updateAuthUI();
    renderEvents();
    updateStats();

    // ── Restore last-visited tab from URL hash on refresh ──
    const hash = window.location.hash.replace('#', '').trim();
    const validTabs = ['upcoming','past','enrolled','career','social','profile','settings','admin','about','changelog','create-event'];
    if (hash && validTabs.includes(hash)) {
      switchTab(hash);
    }

    // ── Background heartbeat & notification polling ──
    setInterval(() => {
      if (currentSession?.user?.id) {
        store.touchLastSeen(currentSession.user.id).catch(() => {});
        loadUserNotifications().catch(() => {});
      }
    }, 10 * 1000);

  } catch (err) {
    console.error('Boot error:', err);
    showToast('Failed to load events. Check your Supabase credentials.', 'warning');
  } finally {
    showLoading(false);
  }
}

async function loadProfile(userId) {
  if (!userId) return;
  try {
    currentProfile = await store.getProfile(userId);
  } catch (err) {
    console.error('Profile load error:', err);
  }
  try {
    const enrollments = await store.getMyEnrollments(userId);
    myEnrollmentIds = new Set((enrollments || []).map(e => e.event_id));
  } catch (err) {
    console.error('Enrollments load error:', err);
  }
}

async function refreshEvents() {
  try {
    allEvents = await store.getEvents();
    enrollmentCounts = await store.getEnrollmentCounts();
  } catch (err) {
    console.error('Events load error:', err);
  }
}

function isCurrentUserAdmin() {
  if (!currentSession || !currentSession.user) return false;
  const email = (currentSession.user.email || '').trim().toLowerCase();
  return currentProfile?.role === 'admin' || email === 'nikhildeosani@gmail.com';
}

/** Returns true only if the currently logged-in user is the original primary admin */
function isCurrentUserPrimaryAdmin() {
  if (!currentSession || !currentSession.user) return false;
  const email = (currentSession.user.email || currentProfile?.email || '').trim().toLowerCase();
  return email === 'nikhildeosani@gmail.com';
}

// ─── Auth UI ───────────────────────────────────────────────────────────────
function updateAuthUI() {
  const isLoggedIn = !!currentSession;
  const isAdmin = isCurrentUserAdmin();

  // Toggle admin-mode on body — CSS handles .admin-only visibility
  document.body.classList.toggle('admin-mode', isAdmin);
  document.body.classList.toggle('tab-upcoming', currentTab === 'upcoming');
  document.body.dataset.tab = currentTab;

  // Guest / user controls
  document.getElementById('guestControls').classList.toggle('hidden', isLoggedIn);
  document.getElementById('userControls').classList.toggle('hidden', !isLoggedIn);

  // My Enrolled tab opacity (only meaningful when logged in)
  document.getElementById('myEnrolledTabBtn').style.opacity = isLoggedIn ? '1' : '0.5';

  if (isLoggedIn && currentProfile) {
    const name = currentProfile.name || currentSession.user.email;
    const initial = name.charAt(0).toUpperCase();
    const avatarEl = document.getElementById('userAvatar');
    if (avatarEl) {
      avatarEl.textContent = initial;
      if (isAdmin) {
        avatarEl.style.boxShadow = '0 0 0 2px #22c55e, 0 0 8px rgba(34, 197, 94, 0.5)';
        avatarEl.title = `${name} (Admin)`;
      } else {
        avatarEl.style.boxShadow = '';
        avatarEl.title = name;
      }
    }
    const userNameEl = document.getElementById('navUserName');
    if (userNameEl) userNameEl.textContent = '';
  }
}

// ─── Static Event Listeners ────────────────────────────────────────────────
function setupStaticListeners() {
  // Auth modal opener
  document.getElementById('openAuthBtn').addEventListener('click', () => openModal('authModal'));

  // Auth tabs (Login / Register)
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', e => switchAuthTab(e.currentTarget.dataset.auth));
  });

  // Switch via link inside form
  document.querySelectorAll('.link-btn[data-auth]').forEach(btn => {
    btn.addEventListener('click', e => switchAuthTab(e.currentTarget.dataset.auth));
  });

  // Login form
  document.getElementById('loginForm').addEventListener('submit', handleLogin);

  // Register form
  document.getElementById('registerForm').addEventListener('submit', handleRegister);

  // Profile edit modal
  document.getElementById('openProfileBtn').addEventListener('click', openProfileModal);
  document.getElementById('profileForm').addEventListener('submit', handleProfileSave);

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // ── All 3 chrome dots = Back button ───────────────────────────────────────
  const chromeDots = document.querySelector('.chrome-dots');
  if (chromeDots) {
    chromeDots.style.cursor = 'pointer';
    chromeDots.title = 'Go Back';

    chromeDots.addEventListener('mouseenter', () => {
      chromeDots.querySelectorAll('.chrome-dot').forEach((dot, i) => {
        dot.innerHTML = i === 0
          ? '<span style="font-size:9px;font-weight:900;line-height:1;color:rgba(0,0,0,0.5);">&#8592;</span>'
          : '';
        dot.style.display = 'flex';
        dot.style.alignItems = 'center';
        dot.style.justifyContent = 'center';
      });
    });

    chromeDots.addEventListener('mouseleave', () => {
      chromeDots.querySelectorAll('.chrome-dot').forEach(dot => {
        dot.innerHTML = '';
      });
    });

    chromeDots.addEventListener('click', () => {
      if (tabHistory.length > 0) {
        const prev = tabHistory.pop();
        const savedHistory = [...tabHistory];
        switchTab(prev);
        tabHistory = savedHistory;
      } else {
        const savedHistory = [...tabHistory];
        switchTab('upcoming');
        tabHistory = savedHistory;
      }
    });
  }

  // Notification center button listeners
  document.getElementById('openNotifBtn')?.addEventListener('click', () => window.openNotificationModal());
  document.getElementById('markAllNotifsReadBtn')?.addEventListener('click', () => window.markAllNotificationsRead());

  // Admin create event buttons
  document.getElementById('adminCreateEventBtn')?.addEventListener('click', () => openAdminEventModal());
  document.getElementById('adminCreateEventBtn2')?.addEventListener('click', () => openAdminEventModal());
  document.getElementById('cancelNewEventBtn')?.addEventListener('click', () => switchTab('upcoming'));

  // Admin event form
  document.getElementById('adminEventForm').addEventListener('submit', handleSaveEvent);

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', e => switchTab(e.currentTarget.dataset.tab));
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  searchInput.addEventListener('input', e => {
    currentSearch = e.target.value.toLowerCase().trim();
    clearBtn.classList.toggle('hidden', !currentSearch);
    renderEvents();
  });
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    clearBtn.classList.add('hidden');
    renderEvents();
  });

  // Reset filters
  document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    currentSearch = '';
    document.getElementById('clearSearchBtn')?.classList.add('hidden');
    renderEvents();
  });

  // CSV export
  document.getElementById('exportCsvBtn').addEventListener('click', handleExportCsv);

  // Password eye toggles
  document.querySelectorAll('.eye-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      const targetId = e.currentTarget.dataset.target;
      const input = document.getElementById(targetId);
      input.type = input.type === 'password' ? 'text' : 'password';
      e.currentTarget.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });

  // Open Admin Panel button
  document.getElementById('openAdminPanelBtn')?.addEventListener('click', openAdminPanel);

  // Admin Modal Tab Switching
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const tab = e.currentTarget.dataset.adminTab;
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.adminTab === tab));
      document.getElementById('adminUsersTab').classList.toggle('active', tab === 'users');
      document.getElementById('adminActivityTab').classList.toggle('active', tab === 'activity');
      document.getElementById('adminAnalyticsTab').classList.toggle('active', tab === 'analytics');
      document.getElementById('adminApplicationsTab').classList.toggle('active', tab === 'applications');
      document.getElementById('adminTicketsTab')?.classList.toggle('active', tab === 'tickets');
      if (tab === 'analytics') renderAdminAnalytics();
      if (tab === 'applications') loadAdminMentorApps();
    });
  });

  // Admin Ticket Verification Search Form
  document.getElementById('adminTicketSearchForm')?.addEventListener('submit', handleVerifyTicketSearch);

  // Admin User Search & Filter & Appoint Admin Modal
  document.getElementById('adminUserSearchInput')?.addEventListener('input', renderAdminUsers);
  document.getElementById('adminUserStatusFilter')?.addEventListener('change', renderAdminUsers);
  document.getElementById('refreshAdminUsersBtn')?.addEventListener('click', loadAdminUsers);
  document.getElementById('openAppointAdminBtn')?.addEventListener('click', () => window.openAppointAdminModal());
  document.getElementById('appointAdminForm')?.addEventListener('submit', handleAppointAdminSubmit);
  document.getElementById('adminUserSelect')?.addEventListener('change', handleAdminUserSelectChange);

  // Career Sub-Tab Switcher
  initCareerSubTabs();

  // Admin Activity Filter
  document.getElementById('adminActivityFilter')?.addEventListener('change', renderAdminLogs);
  document.getElementById('refreshAdminLogsBtn')?.addEventListener('click', loadAdminLogs);
  document.getElementById('mentorAppsStatusFilter')?.addEventListener('change', renderAdminMentorApps);
  document.getElementById('refreshAdminAppsBtn')?.addEventListener('click', loadAdminMentorApps);

  // 3D Pie Chart Inspector click handlers
  document.getElementById('cardRoleChart')?.addEventListener('click', () => open3DPieInspector('role'));
  document.getElementById('cardStatusChart')?.addEventListener('click', () => open3DPieInspector('status'));

  // Apply as Mentor (Student) & Appoint Mentor (Admin)
  document.getElementById('openApplyMentorBtn')?.addEventListener('click', openApplyMentorModal);
  document.getElementById('applyMentorForm')?.addEventListener('submit', handleApplyMentor);
  document.getElementById('withdrawMentorAppBtn')?.addEventListener('click', handleWithdrawMentorApp);
  document.getElementById('openAppointMentorBtn')?.addEventListener('click', () => window.openAppointMentorModal());
  document.getElementById('appointMentorForm')?.addEventListener('submit', handleAppointMentor);

  // Book Appointment Form (Student)
  document.getElementById('bookAppointmentForm')?.addEventListener('submit', handleBookAppointment);

  // Direct Peer Chat Form
  document.getElementById('chatMessageForm')?.addEventListener('submit', handleSendChatMessage);

  // About Us & Changelog Modals
  document.getElementById('openAboutUsBtn')?.addEventListener('click', () => openModal('aboutModal'));
  document.getElementById('footerAboutBtn')?.addEventListener('click', () => openModal('aboutModal'));
  document.getElementById('openChangelogBtn')?.addEventListener('click', () => openModal('changelogModal'));

  // Social Sub-Tab Switching
  document.querySelectorAll('.social-tab-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const targetBtn = e.currentTarget.closest('.social-tab-btn') || e.currentTarget;
      const tab = targetBtn?.dataset?.socialTab;
      if (tab) window.switchSocialTab(tab);
    });
  });

  // Open Create Post Modal
  document.getElementById('openCreatePostModalBtn')?.addEventListener('click', () => openModal('createPostModal'));

  // Create Achievement / Task Post Form
  document.getElementById('createPostForm')?.addEventListener('submit', handleCreatePost);

  // Trigger media file upload
  document.getElementById('triggerMediaFileBtn')?.addEventListener('click', () => {
    document.getElementById('postMediaFile')?.click();
  });

  // Handle uploaded media file change
  document.getElementById('postMediaFile')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      showToast('File too large. Please select a photo or video under 50MB.', 'warning');
      return;
    }

    // Store the raw file for upload on submit
    currentUploadedFile = file;
    currentUploadedMediaData = '';  // will be set after upload

    // Use a blob URL for instant local preview — works for any size
    const blobUrl = URL.createObjectURL(file);
    const previewContainer = document.getElementById('postMediaPreview');
    if (!previewContainer) return;

    const isVideo = file.type.startsWith('video/');
    const removeBtnHtml = `<button type="button" id="removeMediaBtn" style="position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 50%; background: rgba(0,0,0,0.65); color: #fff; border: none; cursor: pointer; font-weight: 700; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; z-index: 5;" title="Remove media">✕</button>`;

    if (isVideo) {
      previewContainer.innerHTML = `${removeBtnHtml}<video src="${blobUrl}" controls style="width:100%;max-height:260px;object-fit:contain;display:block;"></video>`;
    } else {
      previewContainer.innerHTML = `${removeBtnHtml}<img src="${blobUrl}" alt="Media preview" style="width:100%;max-height:260px;object-fit:cover;display:block;" />`;
    }
    previewContainer.style.display = 'block';
    document.getElementById('removeMediaBtn')?.addEventListener('click', clearUploadedMedia);
  });

  // Social User Search Live Input
  document.getElementById('socialUserSearchInput')?.addEventListener('input', handleSocialUserSearch);

  // Profile Modal Tab Switching
  document.querySelectorAll('.profile-tab-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const tab = e.currentTarget.dataset.profileTab;
      document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.profileTab === tab));

      const formTab = document.getElementById('profileForm');
      const settingsTab = document.getElementById('profileSettingsTab');
      const helpTab = document.getElementById('profileHelpTab');

      if (formTab) {
        formTab.style.display = tab === 'details' ? 'flex' : 'none';
        formTab.style.flexDirection = 'column';
      }
      if (settingsTab) {
        settingsTab.style.display = tab === 'settings' ? 'flex' : 'none';
        settingsTab.style.flexDirection = 'column';
      }
      if (helpTab) {
        helpTab.style.display = tab === 'help' ? 'flex' : 'none';
        helpTab.style.flexDirection = 'column';
      }
    });
  });

  // Save Settings / Preferences Handler
  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    const notifyEvent = document.getElementById('settingNotifyEvent')?.checked;
    const notifyMentor = document.getElementById('settingNotifyMentor')?.checked;
    const notifyAnnounce = document.getElementById('settingNotifyAnnounce')?.checked;
    const notifySocial = document.getElementById('settingNotifySocial')?.checked;
    const theme = document.getElementById('settingThemeSelect')?.value;
    const motion = document.getElementById('settingGlassMotion')?.value;
    const gridDensity = document.getElementById('settingGridDensity')?.value;
    const showRoll = document.getElementById('settingShowRollOnPass')?.checked;
    const allowSearch = document.getElementById('settingAllowPeerSearch')?.checked;
    const offlineCache = document.getElementById('settingOfflineCache')?.checked;
    const autoCalendar = document.getElementById('settingAutoCalendar')?.checked;
    const showSeatZone = document.getElementById('settingShowSeatZone')?.checked;
    const hapticPass = document.getElementById('settingHapticPass')?.checked;
    const shareResume = document.getElementById('settingShareResume')?.checked;
    const mentorshipMode = document.getElementById('settingMentorshipMode')?.value;
    const enable2FA = document.getElementById('settingEnable2FA')?.checked;

    const privateAccount = document.getElementById('settingPrivateAccount')?.checked;
    const activityStatus = document.getElementById('settingActivityStatus')?.checked;
    const msgPerm = document.getElementById('settingMsgPerm')?.value;
    const quietMode = document.getElementById('settingQuietMode')?.checked;
    const dailyLimit = document.getElementById('settingDailyLimit')?.value;

    localStorage.setItem('cx_setting_notify_event', notifyEvent);
    localStorage.setItem('cx_setting_notify_mentor', notifyMentor);
    localStorage.setItem('cx_setting_notify_announce', notifyAnnounce);
    localStorage.setItem('cx_setting_notify_social', notifySocial);
    localStorage.setItem('cx_setting_theme', theme);
    localStorage.setItem('cx_setting_motion', motion);
    localStorage.setItem('cx_setting_grid_density', gridDensity);
    localStorage.setItem('cx_setting_show_roll', showRoll);
    localStorage.setItem('cx_setting_allow_search', allowSearch);
    localStorage.setItem('cx_setting_offline_cache', offlineCache);
    localStorage.setItem('cx_setting_auto_calendar', autoCalendar);
    localStorage.setItem('cx_setting_show_seat_zone', showSeatZone);
    localStorage.setItem('cx_setting_haptic_pass', hapticPass);
    localStorage.setItem('cx_setting_share_resume', shareResume);
    localStorage.setItem('cx_setting_mentorship_mode', mentorshipMode);
    localStorage.setItem('cx_setting_enable_2fa', enable2FA);
    localStorage.setItem('cx_setting_private_account', privateAccount);
    localStorage.setItem('cx_setting_activity_status', activityStatus);
    localStorage.setItem('cx_setting_msg_perm', msgPerm);
    localStorage.setItem('cx_setting_quiet_mode', quietMode);
    localStorage.setItem('cx_setting_daily_limit', dailyLimit);

    showToast('Settings & preferences saved successfully! ⚙️', 'success');
  });

  // Professional Settings Category Navigation Switcher
  document.querySelectorAll('.settings-nav-btn[data-settings-pane]').forEach(btn => {
    btn.addEventListener('click', e => {
      const targetPaneKey = e.currentTarget.dataset.settingsPane;
      if (!targetPaneKey) return;

      document.querySelectorAll('.settings-nav-btn[data-settings-pane]').forEach(b => {
        b.classList.toggle('active', b.dataset.settingsPane === targetPaneKey);
      });

      document.querySelectorAll('.settings-pane').forEach(pane => {
        const isTarget = pane.id === `settingsPane${targetPaneKey.charAt(0).toUpperCase() + targetPaneKey.slice(1)}`;
        pane.classList.toggle('active', isTarget);
      });
    });
  });

  // Clear App Cache Handler
  document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
    showToast('Local application cache cleared cleanly! 🧹', 'info');
  });

  // Export My Data Handler
  document.getElementById('exportUserDataBtn')?.addEventListener('click', () => {
    const exportData = {
      profile: currentProfile,
      exportedAt: new Date().toISOString(),
      platform: 'CampusEventX Portal'
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campuseventx_userData_${currentProfile?.name || 'student'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Campus data JSON exported successfully! 📥', 'success');
  });

  // Contact Helpdesk Support Form Handler
  document.getElementById('helpSupportForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const category = document.getElementById('helpCategory')?.value;
    const msg = document.getElementById('helpMessage')?.value.trim();
    if (!msg) return;

    showToast(`Support ticket submitted under "${category}". Our campus desk will reach out! 📨`, 'success');
    e.target.reset();
  });

  // Logout from Settings Tab
  document.getElementById('profileLogoutBtn')?.addEventListener('click', () => {
    closeModal('profileModal');
    handleLogout();
  });

  // All [data-close] buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', e => closeModal(e.currentTarget.dataset.close));
  });

  // Overlay click to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}


// ─── Auth Handlers ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.auth === tab));
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  clearAuthErrors();
}

function clearAuthErrors() {
  ['loginError', 'registerError'].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = '';
    el.classList.add('hidden');
  });
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginSubmitBtn');
  setButtonLoading(btn, true);
  clearAuthErrors();

  try {
    await store.signIn({
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    });
    closeModal('authModal');
    showToast('Welcome back! 🎉', 'success');
    await refreshEvents();
  } catch (err) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = err.message || 'Login failed. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('registerSubmitBtn');
  setButtonLoading(btn, true);
  clearAuthErrors();

  try {
    await store.signUp({
      email: document.getElementById('regEmail').value.trim(),
      password: document.getElementById('regPassword').value,
      name: document.getElementById('regName').value.trim(),
      roll: document.getElementById('regRoll').value.trim(),
      dept: document.getElementById('regDept').value,
      year: document.getElementById('regYear').value,
      phone: document.getElementById('regPhone').value.trim()
    });
    closeModal('authModal');
    showToast('Account created! Check your email to verify, then login.', 'success');
  } catch (err) {
    const errEl = document.getElementById('registerError');
    errEl.textContent = err.message || 'Registration failed. Please try again.';
    errEl.classList.remove('hidden');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleLogout() {
  try {
    await store.signOut();
    currentTab = 'upcoming';
    showToast('Logged out successfully.', 'info');
  } catch (err) {
    showToast('Logout failed: ' + err.message, 'warning');
  }
}

// ─── Profile Edit ──────────────────────────────────────────────────────────
function openProfileModal() {
  if (!currentProfile) return;
  document.getElementById('profileName').value = currentProfile.name || '';
  document.getElementById('profileUsername').value = currentProfile.username || (currentProfile.email ? currentProfile.email.split('@')[0] : 'user');
  document.getElementById('profileRoll').value = currentProfile.roll || '';
  document.getElementById('profilePhone').value = currentProfile.phone || '';
  document.getElementById('profileDept').value = currentProfile.dept || '';
  document.getElementById('profileYear').value = currentProfile.year || '1st Year';
  switchTab('profile');
}

async function handleProfileSave(e) {
  e.preventDefault();
  if (!currentSession) return;

  try {
    const usernameVal = document.getElementById('profileUsername').value.trim().replace(/^@/, '').toLowerCase();
    const updates = {
      name: document.getElementById('profileName').value.trim(),
      username: usernameVal,
      roll: document.getElementById('profileRoll').value.trim(),
      phone: document.getElementById('profilePhone').value.trim(),
      dept: document.getElementById('profileDept').value,
      year: document.getElementById('profileYear').value
    };
    currentProfile = await store.updateProfile(currentSession.user.id, updates);
    updateAuthUI();
    showToast('Profile & Username updated!', 'success');
    renderEvents();
    loadSocialPosts();
    loadFriendsAndRequests();
    handleSocialUserSearch();
  } catch (err) {
    showToast('Failed to update profile: ' + err.message, 'warning');
  }
}

// ─── Tabs ──────────────────────────────────────────────────────────────────
function switchTab(tabName) {
  if (!tabName) return;
  if (tabName === 'enrolled' && !currentSession) {
    openModal('authModal');
    showToast('Please log in to view your enrolled events.', 'info');
    return;
  }
  // Track history for back navigation (skip duplicates)
  if (currentTab !== tabName) {
    tabHistory.push(currentTab);
    if (tabHistory.length > 20) tabHistory.shift(); // cap history
  }
  currentTab = tabName;

  // Update URL hash silently so refresh restores this tab
  history.replaceState(null, '', '#' + tabName);

  document.body.classList.toggle('tab-upcoming', tabName === 'upcoming');
  document.body.dataset.tab = tabName;

  document.querySelectorAll('.tab-btn, .sidebar-ext-item').forEach(btn => {
    if (btn.dataset.tab) {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    }
  });
  const profileBtn = document.getElementById('openProfileBtn');
  if (profileBtn) profileBtn.classList.toggle('active', tabName === 'profile');

  // Update dynamic Interface Header Banner
  const banner = document.getElementById('tabBanner');
  const title = document.getElementById('tabBannerTitle');
  const subtitle = document.getElementById('tabBannerSubtitle');
  const badge = document.getElementById('tabBannerBadge');

  if (tabName === 'upcoming') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '📅 Upcoming Campus Events';
    if (subtitle) subtitle.textContent = 'Explore and enroll in active workshops, hackathons, and cultural fests.';
    if (badge) badge.textContent = 'LIVE GRID VIEW';
  } else if (tabName === 'past') {
    if (banner) banner.className = 'tab-banner tab-banner-past';
    if (title) title.textContent = '📜 Past Event Archives & History';
    if (subtitle) subtitle.textContent = 'Browse concluded campus events, timeline logs, and attendance records.';
    if (badge) badge.textContent = 'TIMELINE ARCHIVE VIEW';
  } else if (tabName === 'enrolled') {
    if (banner) banner.className = 'tab-banner tab-banner-enrolled';
    if (title) title.textContent = '🎟️ My Digital Event Passes & Wallet';
    if (subtitle) subtitle.textContent = 'Your boarding-pass style digital tickets with custom QR check-in passes.';
    if (badge) badge.textContent = 'BOARDING PASS VIEW';
  } else if (tabName === 'career') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '💼 Campus Career & Mentorship Hub';
    if (subtitle) subtitle.textContent = 'Connect 1-on-1 with appointed industry leaders, researchers, and tech mentors.';
    if (badge) badge.textContent = 'CAREER HUB VIEW';
  } else if (tabName === 'social') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '🌐 Campus Social Hub & Feed';
    if (subtitle) subtitle.textContent = 'Share updates, photos, videos, find peers, and view campus community posts.';
    if (badge) badge.textContent = 'SOCIAL FEED VIEW';
  } else if (tabName === 'about') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = 'ℹ️ About CampusEventX Platform';
    if (subtitle) subtitle.textContent = 'Centralized campus event management, student career guidance & social ecosystem.';
    if (badge) badge.textContent = 'PLATFORM OVERVIEW';
  } else if (tabName === 'changelog') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '📋 Platform Release Notes & Updates';
    if (subtitle) subtitle.textContent = 'Version history, release notes, and latest platform feature updates.';
    if (badge) badge.textContent = 'RELEASE NOTES VIEW';
  } else if (tabName === 'profile') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '👤 My Student Profile';
    if (subtitle) subtitle.textContent = 'View and update your personal information, department, and student ID.';
    if (badge) badge.textContent = 'PROFILE VIEW';
  } else if (tabName === 'settings') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '⚙️ Account Settings & Preferences';
    if (subtitle) subtitle.textContent = 'Notification preferences, digital pass privacy options, and account session logout.';
    if (badge) badge.textContent = 'SETTINGS VIEW';
  } else if (tabName === 'create-event') {
    if (banner) banner.className = 'tab-banner tab-banner-upcoming';
    if (title) title.textContent = '✨ Create / Publish Campus Event';
    if (subtitle) subtitle.textContent = 'Fill details below to publish a new event or update an existing one.';
    if (badge) badge.textContent = 'EVENT EDITOR VIEW';
  }

  const eventsSection = document.getElementById('eventsSection');
  const careerSection = document.getElementById('careerSection');
  const socialSection = document.getElementById('socialSection');
  const adminSection = document.getElementById('adminSection');
  const aboutSection = document.getElementById('aboutSection');
  const changelogSection = document.getElementById('changelogSection');
  const profileSection = document.getElementById('profileSection');
  const settingsSection = document.getElementById('settingsSection');
  const newEventSection = document.getElementById('newEventSection');
  const controlsSection = document.querySelector('.controls-section');

  const isEvents = ['upcoming', 'past', 'enrolled'].includes(tabName);
  const isCareer = tabName === 'career';
  const isSocial = tabName === 'social';
  const isAdminTab = tabName === 'admin';
  const isAbout = tabName === 'about';
  const isChangelog = tabName === 'changelog';
  const isProfile = tabName === 'profile';
  const isSettings = tabName === 'settings';
  const isCreateEvent = tabName === 'create-event';

  if (eventsSection) eventsSection.classList.toggle('hidden', !isEvents);
  if (controlsSection) controlsSection.classList.toggle('hidden', !isEvents);
  if (careerSection) careerSection.classList.toggle('hidden', !isCareer);
  if (socialSection) socialSection.classList.toggle('hidden', !isSocial);
  if (adminSection) adminSection.classList.toggle('hidden', !isAdminTab);
  if (aboutSection) aboutSection.classList.toggle('hidden', !isAbout);
  if (changelogSection) changelogSection.classList.toggle('hidden', !isChangelog);
  if (profileSection) profileSection.classList.toggle('hidden', !isProfile);
  if (settingsSection) settingsSection.classList.toggle('hidden', !isSettings);
  if (newEventSection) newEventSection.classList.toggle('hidden', !isCreateEvent);

  // Hide inline roster panel when switching tabs so it never lingers in My Tickets
  const rosterPanel = document.getElementById('inlineRosterPanel');
  if (rosterPanel && tabName !== 'upcoming') {
    rosterPanel.classList.add('hidden');
  }

  if (isCareer) {
    loadCareerData();
  } else if (isSocial) {
    const activeSubTab = document.querySelector('.social-tab-btn.active')?.dataset?.socialTab || 'feed';
    window.switchSocialTab(activeSubTab);
  } else if (isAdminTab) {
    loadAdminUsers();
    loadAdminActivityLogs();
    loadAdminAnalytics();
    loadAdminApplications();
  } else if (isProfile) {
    if (currentProfile) {
      document.getElementById('profileName').value = currentProfile.name || '';
      document.getElementById('profileRoll').value = currentProfile.roll || '';
      document.getElementById('profilePhone').value = currentProfile.phone || '';
      document.getElementById('profileDept').value = currentProfile.dept || '';
      document.getElementById('profileYear').value = currentProfile.year || '1st Year';
    }
  } else if (isCreateEvent) {
    // Ready for event entry
  } else if (tabName === 'enrolled') {
    // Reset search filter when opening My Tickets
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value) searchInput.value = '';
    currentSearch = '';

    if (currentSession?.user?.id) {
      loadProfile(currentSession.user.id).then(() => {
        renderEvents();
      });
    } else {
      renderEvents();
    }
  } else {
    renderEvents();
  }
}


// ─── Event Filtering ───────────────────────────────────────────────────────
function isEventPast(dateStr) {
  return new Date(dateStr) < new Date();
}

function getFilteredEvents() {
  return allEvents.filter(evt => {
    const isPast = isEventPast(evt.date);
    const eventIdLower = String(evt.id || '').toLowerCase();

    if (currentTab === 'upcoming' && isPast) return false;
    if (currentTab === 'past' && !isPast) return false;
    if (currentTab === 'enrolled' && !myEnrollmentIds.has(eventIdLower)) return false;
    if (currentSearch) {
      const q = currentSearch;
      if (!evt.title.toLowerCase().includes(q) &&
        !evt.venue.toLowerCase().includes(q) &&
        !(evt.speaker || '').toLowerCase().includes(q) &&
        !(evt.description || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

// ─── Render Events Grid ────────────────────────────────────────────────────
function renderEvents() {
  if (currentTab === 'enrolled') {
    renderMyTickets();
    return;
  }
  if (currentTab === 'past') {
    renderPastEvents();
    return;
  }
  renderUpcomingGrid();
}

// ── 1. UPCOMING: Colourful card grid ──────────────────────────────────────
function renderUpcomingGrid() {
  const events = getFilteredEvents();
  const grid = document.getElementById('eventsGrid');
  const emptyState = document.getElementById('emptyState');
  const isAdmin = isCurrentUserAdmin();

  updateBadges();

  // Update admin banner stat chips
  const bannerStatEl = document.getElementById('bannerStatEvents');
  const bannerEnrolledEl = document.getElementById('bannerStatEnrolled');
  if (bannerStatEl) bannerStatEl.textContent = events.length;
  if (bannerEnrolledEl) {
    const totalEnrolled = Object.values(enrollmentCounts).reduce((a, b) => a + (b || 0), 0);
    bannerEnrolledEl.textContent = totalEnrolled;
  }

  grid.className = 'events-grid';
  grid.innerHTML = '';

  if (events.length === 0) {
    grid.classList.add('hidden');
    emptyState.classList.remove('hidden');
    document.getElementById('emptyTitle').textContent = 'No Events Found';
    document.getElementById('emptyMessage').textContent = 'Try adjusting your search or selecting a different category.';
    return;
  }

  grid.classList.remove('hidden');
  emptyState.classList.add('hidden');

  events.forEach((evt, i) => {
    const isPast = isEventPast(evt.date);
    const count = enrollmentCounts[evt.id] || 0;
    const capacity = evt.capacity || 99999;
    const pct = Math.min(Math.round((count / capacity) * 100), 100);
    const isEnrolled = myEnrollmentIds.has(evt.id);
    const isFull = count >= capacity && capacity < 99999;

    const formattedDate = new Date(evt.date).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    let actionHtml = '';
    if (isAdmin) {
      actionHtml = `<div class="admin-card-actions">
        <button class="btn btn-secondary btn-sm view-roster-btn" data-id="${evt.id}">Roster (${count})</button>
        <button class="btn btn-secondary btn-sm edit-evt-btn" data-id="${evt.id}">Edit</button>
        <button class="btn btn-outline-danger btn-sm delete-evt-btn" data-id="${evt.id}">Delete</button>
      </div>`;
    } else if (isEnrolled) {
      actionHtml = `<button class="btn btn-accent view-pass-btn" data-id="${evt.id}">My Ticket</button>`;
    } else if (!currentSession) {
      actionHtml = `<button class="btn btn-primary open-auth-btn">Login to Enroll</button>`;
    } else if (isFull) {
      actionHtml = `<button class="btn btn-secondary" disabled>Seats Full</button>`;
    } else {
      actionHtml = `<button class="btn btn-primary enroll-btn" data-id="${evt.id}">Enroll Now</button>`;
    }

    const categoryColors = {
      'technical': 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
      'cultural':  'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
      'workshop':  'linear-gradient(135deg, #0f766e 0%, #115e59 100%)',
      'seminar':   'linear-gradient(135deg, #334155 0%, #475569 100%)',
      'sports':    'linear-gradient(135deg, #78350f 0%, #92400e 100%)',
    };
    const catKey = (evt.category || '').toLowerCase();
    const defaultBg = categoryColors[catKey] || 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';

    const card = document.createElement('div');
    card.className = `event-card${isEnrolled ? ' is-enrolled' : ''}`;
    card.style.animationDelay = `${i * 0.07}s`;
    card.innerHTML = `
      <div class="card-banner" ${!evt.banner ? `style="background: ${defaultBg};"` : ''}>
        ${evt.banner
        ? `<img src="${evt.banner}" alt="${evt.title}" loading="lazy" onerror="this.parentElement.style.background='${defaultBg}'; this.remove();" />`
        : `<div class="card-banner-icon">${evt.category?.charAt(0) || '🎓'}</div>`
      }
        <span class="card-category-badge">${evt.category}</span>
        <span class="card-status-badge upcoming">Upcoming</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${evt.title}</h3>
        <div class="card-meta">
          <div class="meta-item"><span>📅</span><span>${formattedDate}</span></div>
          <div class="meta-item"><span>📍</span><span>${evt.venue}</span></div>
          ${evt.speaker ? `<div class="meta-item"><span>🎤</span><span>${evt.speaker}</span></div>` : ''}
        </div>
        <p class="card-desc">${evt.description || ''}</p>
        <div class="card-capacity-bar">
          <div class="capacity-info">
            <span>Seats Filled</span>
            <span>${capacity >= 99999 ? `${count} Registered (Unlimited)` : `${count} / ${capacity} (${pct}%)`}</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${capacity >= 99999 ? '0' : pct}%"></div></div>
        </div>
        <div class="card-footer">
          <button class="btn btn-secondary detail-btn" data-id="${evt.id}">Details</button>
          ${actionHtml}
        </div>
      </div>`;
    grid.appendChild(card);
  });

  _attachGridListeners(grid);
}

// ── 2. PAST EVENTS: Dark archive list ──────────────────────────────────────
function renderPastEvents() {
  const events = getFilteredEvents();
  const grid = document.getElementById('eventsGrid');
  const emptyState = document.getElementById('emptyState');
  const isAdmin = isCurrentUserAdmin();

  updateBadges();
  grid.className = 'past-events-list';
  grid.innerHTML = '';

  if (events.length === 0) {
    grid.classList.remove('hidden');
    emptyState.classList.add('hidden');
    grid.innerHTML = `
      <div class="empty-tab-card empty-past-card">
        <div class="empty-tab-icon">📜</div>
        <h3>Archive Timeline Empty</h3>
        <p>No past events have concluded yet. Once upcoming events complete, they will automatically appear here with attendance records.</p>
      </div>`;
    return;
  }

  grid.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Group by month
  const groups = {};
  events.forEach(evt => {
    const d = new Date(evt.date);
    const key = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(evt);
  });

  Object.entries(groups).forEach(([month, evts]) => {
    const header = document.createElement('div');
    header.className = 'past-month-header';
    header.innerHTML = `<span class="past-month-label">${month}</span><div class="past-month-line"></div>`;
    grid.appendChild(header);

    evts.forEach((evt, i) => {
      const count = enrollmentCounts[evt.id] || 0;
      const formattedDate = new Date(evt.date).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const isEnrolled = myEnrollmentIds.has(evt.id);

      let actionHtml = '';
      if (isAdmin) {
        actionHtml = `<div class="admin-card-actions">
          <button class="btn btn-secondary btn-sm view-roster-btn" data-id="${evt.id}">👥 Roster (${count})</button>
          <button class="btn btn-secondary btn-sm edit-evt-btn" data-id="${evt.id}">✏️</button>
          <button class="btn btn-outline-danger btn-sm delete-evt-btn" data-id="${evt.id}">🗑️</button>
        </div>`;
      } else if (isEnrolled) {
        actionHtml = `<button class="btn btn-secondary btn-sm view-pass-btn" data-id="${evt.id}">🎟️ View Pass</button>`;
      } else {
        actionHtml = `<button class="btn btn-ghost btn-sm detail-btn" data-id="${evt.id}">View</button>`;
      }

      const row = document.createElement('div');
      row.className = `past-event-row${isEnrolled ? ' was-enrolled' : ''}`;
      row.style.animationDelay = `${i * 0.05}s`;
      row.innerHTML = `
        <div class="past-row-dot ${isEnrolled ? 'dot-enrolled' : ''}"></div>
        <div class="past-row-date">${formattedDate}</div>
        <div class="past-row-info">
          <span class="past-row-title">${evt.title}</span>
          <span class="past-row-meta">
            <span>📍 ${evt.venue}</span>
            ${evt.speaker ? `<span>🎤 ${evt.speaker}</span>` : ''}
            <span class="past-row-cat">${evt.category}</span>
            ${isEnrolled ? `<span class="past-attended-badge">✓ Attended</span>` : ''}
          </span>
        </div>
        <div class="past-row-actions">${actionHtml}</div>`;
      grid.appendChild(row);
    });
  });

  _attachGridListeners(grid);
}

let adminTicketsSubTab = 'all'; // Default to 'all' for admins

// ── 3. MY TICKETS: Boarding-pass style + Admin Global Tickets Roster ───────
function renderMyTickets() {
  const events = getFilteredEvents();
  const grid = document.getElementById('eventsGrid');
  const emptyState = document.getElementById('emptyState');
  const isAdmin = isCurrentUserAdmin();

  updateBadges();

  if (!currentSession) {
    grid.className = 'tickets-grid';
    grid.innerHTML = '';
    grid.classList.add('hidden');
    emptyState.classList.remove('hidden');
    document.getElementById('emptyTitle').textContent = 'Login Required';
    document.getElementById('emptyMessage').textContent = 'Please log in to see your enrolled events.';
    return;
  }

  emptyState.classList.add('hidden');
  grid.classList.remove('hidden');

  if (isAdmin) {
    grid.className = ''; // Allow custom layout container for admin view
    grid.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px; background:var(--card-bg, #ffffff); border:1px solid var(--border); padding:10px 14px; border-radius:14px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; gap:8px;">
          <button type="button" id="btnAdminAllStudentTickets" class="btn ${adminTicketsSubTab === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm">
            All Student Tickets & Rosters
          </button>
          <button type="button" id="btnAdminPersonalTickets" class="btn ${adminTicketsSubTab === 'personal' ? 'btn-primary' : 'btn-secondary'} btn-sm">
            🎟️ My Personal Tickets (${events.length})
          </button>
        </div>
      </div>
      <div id="adminTicketsViewContainer"></div>
    `;

    document.getElementById('btnAdminAllStudentTickets')?.addEventListener('click', () => {
      adminTicketsSubTab = 'all';
      renderMyTickets();
    });
    document.getElementById('btnAdminPersonalTickets')?.addEventListener('click', () => {
      adminTicketsSubTab = 'personal';
      renderMyTickets();
    });

    const container = document.getElementById('adminTicketsViewContainer');
    if (adminTicketsSubTab === 'all') {
      renderAdminAllTicketsView(container);
      return;
    }

    // Otherwise fall through to render personal tickets inside container
    renderPersonalTicketsGrid(container, events);
    return;
  }

  // Normal Student View
  grid.className = 'tickets-grid';
  renderPersonalTicketsGrid(grid, events);
}

function renderPersonalTicketsGrid(grid, events) {
  grid.innerHTML = '';
  if (events.length === 0) {
    grid.className = '';
    grid.innerHTML = `
      <div class="empty-tab-card empty-tickets-card">
        <div class="empty-tab-icon">🎟️</div>
        <h3>Ticket Wallet Empty</h3>
        <p>You haven't enrolled in any events yet. Explore upcoming campus events and enroll to generate your digital boarding pass pass with QR check-in!</p>
        <button class="btn btn-accent switch-to-upcoming-btn" style="margin-top:12px">📅 Browse Upcoming Events</button>
      </div>`;
    grid.querySelector('.switch-to-upcoming-btn')?.addEventListener('click', () => switchTab('upcoming'));
    return;
  }

  grid.className = 'tickets-grid';

  events.forEach((evt, i) => {
    const isPast = isEventPast(evt.date);
    const formattedDate = new Date(evt.date).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    const formattedTime = new Date(evt.date).toLocaleString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });

    const rollSuffix = (currentProfile?.roll || '0000').slice(-4);
    const ticketCode = `CX-${evt.id.slice(0, 6).toUpperCase()}-${rollSuffix}`;

    const categoryIcons = {
      'technical': '💻', 'cultural': '🎭', 'workshop': '🛠️',
      'seminar': '🎤', 'sports': '🏆', 'general': '🎓'
    };
    const catIcon = categoryIcons[(evt.category || '').toLowerCase()] || '🎓';

    const ticket = document.createElement('div');
    ticket.className = `ticket-card-modern${isPast ? ' ticket-past' : ''}`;
    ticket.style.animationDelay = `${i * 0.06}s`;
    ticket.innerHTML = `
      <div class="ticket-thumb">
        ${evt.banner
          ? `<img src="${evt.banner}" alt="${evt.title}" onerror="this.remove();" />`
          : `<span class="ticket-thumb-icon">${catIcon}</span>`
        }
      </div>
      <div class="ticket-main-content">
        <div class="ticket-header-line">
          <h3 class="ticket-card-title">${evt.title}</h3>
          <span class="ticket-cat-badge">${evt.category || 'General'}</span>
          <span class="ticket-status-pill ${isPast ? 'past' : 'upcoming'}">
            ${isPast ? '✓ Completed' : '● Upcoming'}
          </span>
        </div>
        <div class="ticket-meta-line">
          <div class="ticket-meta-item"><span>📅</span><span>${formattedDate}</span></div>
          <span>•</span>
          <div class="ticket-meta-item"><span>⏰</span><span>${formattedTime}</span></div>
          <span>•</span>
          <div class="ticket-meta-item"><span>📍</span><span>${evt.venue}</span></div>
        </div>
      </div>
      <div class="ticket-notch-divider"></div>
      <div class="ticket-stub-right">
        <div class="ticket-stub-code">${ticketCode}</div>
        <button class="btn btn-sm ${isPast ? 'btn-secondary' : 'btn-accent'} view-pass-btn" data-id="${evt.id}">
          🎟️ View Pass
        </button>
      </div>`;
    grid.appendChild(ticket);
  });

  grid.querySelectorAll('.view-pass-btn').forEach(btn =>
    btn.addEventListener('click', e => openTicketModal(e.currentTarget.dataset.id)));
}

async function renderAdminAllTicketsView(container) {
  container.innerHTML = `
    <div style="background:#ffffff; border:1px solid var(--border); border-radius:14px; padding:16px; margin-bottom:16px; box-shadow:var(--shadow-sm);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <div>
          <h3 style="font-family:var(--font-heading); font-size:1.05rem; font-weight:800; color:var(--text-primary); margin:0;">
            All Enrolled Student Tickets & Boarding Passes
          </h3>
          <p style="font-size:0.83rem; color:var(--text-muted); margin:3px 0 0 0;">
            Inspect all active student tickets across campus events. Click "View Pass" to display & print any student's QR check-in pass.
          </p>
        </div>
        <button id="refreshAdminTicketsBtn" class="btn btn-secondary btn-sm">🔄 Refresh Tickets</button>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <div class="search-box" style="flex:1; min-width:260px;">
          <span class="search-icon">🔍</span>
          <input type="text" id="adminTicketSearchInput" placeholder="Search by student name, roll, email, ticket code (CX-...), or event..." />
        </div>
      </div>
    </div>

    <div id="adminTicketsContent" style="display:flex; flex-direction:column; gap:12px;">
      <div style="text-align:center; padding:32px; color:var(--text-muted);">Loading student tickets roster...</div>
    </div>
  `;

  document.getElementById('refreshAdminTicketsBtn')?.addEventListener('click', () => renderAdminAllTicketsView(container));
  document.getElementById('adminTicketSearchInput')?.addEventListener('input', (e) => _applyAdminTicketSearch(e.target.value));

  try {
    const list = await store.getAllStudentEnrollments();
    window._cachedAllAdminTickets = list;
    _renderAdminTicketsTable(list);
  } catch (err) {
    document.getElementById('adminTicketsContent').innerHTML = `
      <div style="text-align:center; padding:32px; color:#ef4444;">Failed to load student tickets: ${err.message}</div>
    `;
  }
}

function _renderAdminTicketsTable(items) {
  const container = document.getElementById('adminTicketsContent');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="empty-tab-card" style="background:#ffffff; border:1px solid var(--border); border-radius:14px; padding:32px; text-align:center;">
        <div style="font-size:2rem; margin-bottom:8px;">🎟️</div>
        <h4 style="margin:0; font-weight:800;">No Enrolled Student Tickets Found</h4>
        <p style="color:var(--text-muted); font-size:0.85rem; margin:6px 0 0 0;">Student tickets will appear here as soon as students enroll in events.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="background:#ffffff; border:1px solid var(--border); border-radius:14px; overflow:hidden; box-shadow:var(--shadow-sm);">
      <div style="overflow-x:auto;">
        <table class="roster-table" style="margin:0; border-radius:0;">
          <thead>
            <tr>
              <th>Ticket Code</th>
              <th>Student Details</th>
              <th>Department / Roll</th>
              <th>Enrolled Event</th>
              <th>Enrolled Date</th>
              <th style="text-align:center;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
              const p = item.profile || {};
              const e = item.event || {};
              const dateStr = item.enrolled_at ? new Date(item.enrolled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
              const safeJson = escape(JSON.stringify(item));

              return `
                <tr>
                  <td>
                    <span class="badge" style="font-family:monospace; background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; font-weight:800; padding:4px 8px; border-radius:6px; font-size:0.8rem;">
                      ${item.ticket_code}
                    </span>
                  </td>
                  <td>
                    <div style="font-weight:700; color:var(--text-dark);">${p.name || p.email || 'Student'}</div>
                    <div style="font-size:0.78rem; color:var(--text-muted);">${p.email || '—'}</div>
                  </td>
                  <td>
                    <div style="font-weight:600;">${p.roll || '—'}</div>
                    <div style="font-size:0.78rem; color:var(--text-muted);">${p.dept || 'General'} ${p.year ? `(${p.year})` : ''}</div>
                  </td>
                  <td>
                    <div style="font-weight:700; color:var(--text-dark);">${e.title || 'Campus Event'}</div>
                    <div style="font-size:0.78rem; color:var(--orange); font-weight:600;">📍 ${e.venue || 'Campus Venue'}</div>
                  </td>
                  <td>
                    <div style="font-size:0.82rem; color:var(--text-muted);">${dateStr}</div>
                  </td>
                  <td style="text-align:center;">
                    <button class="btn btn-accent btn-sm admin-open-student-pass-btn" data-ticket="${safeJson}" style="padding:4px 10px; font-size:0.78rem;">
                      🎟️ View Pass
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('.admin-open-student-pass-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      try {
        const itemData = JSON.parse(unescape(e.currentTarget.dataset.ticket));
        openTicketModal(itemData.event_id, itemData.profile);
      } catch (err) {
        console.error('Failed to parse ticket data:', err);
      }
    });
  });
}

function _applyAdminTicketSearch(query) {
  const q = (query || '').toLowerCase().trim();
  const all = window._cachedAllAdminTickets || [];
  if (!q) {
    _renderAdminTicketsTable(all);
    return;
  }
  const filtered = all.filter(item => {
    const p = item.profile || {};
    const e = item.event || {};
    return (
      (item.ticket_code || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.roll || '').toLowerCase().includes(q) ||
      (e.title || '').toLowerCase().includes(q)
    );
  });
  _renderAdminTicketsTable(filtered);
}

// ── Shared listener attach helper ─────────────────────────────────────────
function _attachGridListeners(grid) {
  grid.querySelectorAll('.detail-btn').forEach(btn =>
    btn.addEventListener('click', e => openEventDetailModal(e.currentTarget.dataset.id)));
  grid.querySelectorAll('.enroll-btn').forEach(btn =>
    btn.addEventListener('click', e => handleEnroll(e.currentTarget.dataset.id)));
  grid.querySelectorAll('.view-pass-btn').forEach(btn =>
    btn.addEventListener('click', e => openTicketModal(e.currentTarget.dataset.id)));
  grid.querySelectorAll('.open-auth-btn').forEach(btn =>
    btn.addEventListener('click', () => openModal('authModal')));
  grid.querySelectorAll('.edit-evt-btn').forEach(btn =>
    btn.addEventListener('click', e => openAdminEventModal(e.currentTarget.dataset.id)));
  grid.querySelectorAll('.delete-evt-btn').forEach(btn =>
    btn.addEventListener('click', e => handleDeleteEvent(e.currentTarget.dataset.id)));
  grid.querySelectorAll('.view-roster-btn').forEach(btn =>
    btn.addEventListener('click', e => openRosterModal(e.currentTarget.dataset.id)));
}

// ─── Enrollment ────────────────────────────────────────────────────────────
async function handleEnroll(eventId) {
  if (!currentSession) {
    openModal('authModal');
    showToast('Please log in first to enroll.', 'info');
    return;
  }

  // Refresh profile details if needed
  if (!currentProfile || !currentProfile.name) {
    try {
      currentProfile = await store.getProfile(currentSession.user.id);
    } catch (_) {}
  }

  const p = currentProfile || {};
  const hasName = !!(p.name && p.name.trim());
  const hasRoll = !!(p.roll && p.roll.trim());
  const hasDept = !!(p.dept && p.dept.trim());
  const hasYear = !!(p.year && p.year.trim());
  const hasPhone = !!(p.phone && p.phone.trim());

  const isProfileComplete = hasName && hasRoll && hasDept && hasYear && hasPhone;

  if (!isProfileComplete) {
    const missing = [];
    if (!hasName) missing.push('Full Name');
    if (!hasRoll) missing.push('Roll No / Student ID');
    if (!hasDept) missing.push('Department');
    if (!hasYear) missing.push('Year of Study');
    if (!hasPhone) missing.push('Phone Number');

    showToast(`⚠️ Mandatory Profile Info Required: Please fill out your ${missing.join(', ')} before enrolling!`, 'warning');
    openProfileModal();
    return;
  }

  try {
    await store.enrollInEvent(eventId, currentSession.user.id);
    const normId = String(eventId || '').toLowerCase();
    myEnrollmentIds.add(normId);
    myEnrollmentIds.add(eventId);
    enrollmentCounts[eventId] = (enrollmentCounts[eventId] || 0) + 1;
    enrollmentCounts[normId] = (enrollmentCounts[normId] || 0) + 1;
    renderEvents();
    updateStats();
    showToast('Successfully enrolled! 🎉', 'success');
    openTicketModal(eventId);
  } catch (err) {
    showToast(err.message || 'Enrollment failed.', 'warning');
  }
}

// ─── Ticket Pass ───────────────────────────────────────────────────────────
function openTicketModal(eventId, customProfile = null) {
  if (!eventId) return;
  const evt = allEvents.find(e => e.id === eventId) || {
    id: eventId, title: 'Campus Event', category: 'General', date: new Date().toISOString(), venue: 'Main Auditorium'
  };

  const profile = customProfile || currentProfile || {};
  const formattedDate = evt.date ? new Date(evt.date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '—';

  const rollSuffix = (profile.roll || '0000').slice(-4);
  const ticketCodeStr = `CX-${(eventId || '000000').slice(0, 6).toUpperCase()}-${rollSuffix}`;

  const titleEl = document.getElementById('ticketEventTitle');
  const catEl = document.getElementById('ticketEventCategory');
  const nameEl = document.getElementById('ticketStudentName');
  const rollEl = document.getElementById('ticketStudentRoll');
  const dateEl = document.getElementById('ticketEventDate');
  const venueEl = document.getElementById('ticketEventVenue');
  const codeEl = document.getElementById('ticketCode');

  if (titleEl) titleEl.textContent = evt.title || 'Campus Event';
  if (catEl) catEl.textContent = evt.category || 'General';
  if (nameEl) nameEl.textContent = profile.name || profile.email || currentSession?.user?.email || '—';
  if (rollEl) rollEl.textContent = profile.roll || '—';
  if (dateEl) dateEl.textContent = formattedDate;
  if (venueEl) venueEl.textContent = evt.venue || 'Campus Venue';
  if (codeEl) codeEl.textContent = ticketCodeStr;

  renderQrMatrix(ticketCodeStr);
  openModal('ticketModal');
}

function renderQrMatrix(ticketCodeStr) {
  const qr = document.getElementById('qrMatrix');
  if (!qr) return;
  
  const code = ticketCodeStr || document.getElementById('ticketCode')?.textContent || 'CX-000000-0000';
  const verificationUrl = `${window.location.origin}${window.location.pathname}?verify_ticket=${encodeURIComponent(code)}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(verificationUrl)}`;

  qr.innerHTML = `
    <img src="${qrApiUrl}" alt="Scannable QR Code Ticket" style="width: 100%; height: 100%; object-fit: contain; display: block; border-radius: 4px;" />
  `;
}

// ─── Admin Event Modal ─────────────────────────────────────────────────────
function openAdminEventModal(eventId = null) {
  const form = document.getElementById('adminEventForm');
  form.reset();

  // Reset banner picker
  _setBannerPickerImage('');

  if (eventId) {
    const evt = allEvents.find(e => e.id === eventId);
    if (!evt) return;

    document.getElementById('adminEventModalTitle').textContent = '✏️ Edit Campus Event';
    document.getElementById('saveEventBtn').textContent = 'Update Event';
    document.getElementById('adminEventId').value = evt.id;
    document.getElementById('eventTitle').value = evt.title;
    if (document.getElementById('eventCategory')) {
      document.getElementById('eventCategory').value = evt.category || 'General';
    }
    // Populate separate date/time pickers
    if (evt.date) {
      const d = new Date(evt.date);
      document.getElementById('eventDatePart').value = d.toISOString().slice(0, 10);
      document.getElementById('eventTimePart').value = d.toTimeString().slice(0, 5);
    }
    document.getElementById('eventVenue').value       = evt.venue;
    document.getElementById('eventCapacity').value    = evt.capacity || '';
    document.getElementById('eventSpeaker').value     = evt.speaker || '';
    document.getElementById('eventBanner').value      = evt.banner  || '';
    document.getElementById('eventDescription').value = evt.description || '';

    // Show banner in picker if exists
    if (evt.banner) _setBannerPickerImage(evt.banner);

  } else {
    document.getElementById('adminEventModalTitle').textContent = '✨ Create Campus Event';
    document.getElementById('saveEventBtn').textContent = 'Publish Event';
    document.getElementById('adminEventId').value = '';
  }

  switchTab('create-event');

  // Live banner preview on URL input
  const bannerInput = document.getElementById('eventBanner');
  if (bannerInput && !bannerInput._previewBound) {
    bannerInput._previewBound = true;
    bannerInput.addEventListener('input', () => {
      _setBannerPickerImage(bannerInput.value.trim());
    });
  }

  // File upload handler
  const fileInput = document.getElementById('eventBannerFile');
  if (fileInput && !fileInput._uploadBound) {
    fileInput._uploadBound = true;
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const status = document.getElementById('bannerUploadStatus');
      const label  = document.getElementById('bannerUploadLabel');
      if (status) status.textContent = '⏳ Uploading...';
      if (label)  label.style.opacity = '0.6';
      try {
        const url = await store.uploadEventBannerImage(file);
        document.getElementById('eventBanner').value = url;
        _setBannerPickerImage(url);
        if (status) status.textContent = `✅ ${file.name}`;
        showToast('Image uploaded! 🖼️', 'success');
      } catch (err) {
        if (status) status.textContent = '❌ Upload failed';
        showToast(err.message || 'Image upload failed.', 'warning');
      } finally {
        if (label) label.style.opacity = '1';
        fileInput.value = '';
      }
    });
  }

  // Clear button
  const clearBtn = document.getElementById('clearBannerBtn');
  if (clearBtn && !clearBtn._clearBound) {
    clearBtn._clearBound = true;
    clearBtn.addEventListener('click', () => {
      document.getElementById('eventBanner').value = '';
      const status = document.getElementById('bannerUploadStatus');
      if (status) status.textContent = 'or paste URL below';
      _setBannerPickerImage('');
    });
  }
}

// Helper: update banner-picker preview state
function _setBannerPickerImage(url) {
  const img         = document.getElementById('eventBannerImg');
  const placeholder = document.getElementById('bannerPickerPlaceholder');
  const clearBtn    = document.getElementById('clearBannerBtn');

  if (!img) return;

  if (url) {
    img.style.display = 'block';
    img.src = url;
    img.onerror = () => _setBannerPickerImage('');
    if (placeholder) placeholder.style.display = 'none';
    if (clearBtn)    clearBtn.style.display = 'flex';
  } else {
    img.style.display = 'none';
    img.src = '';
    if (placeholder) placeholder.style.display = 'flex';
    if (clearBtn)    clearBtn.style.display = 'none';
  }
}

async function handleSaveEvent(e) {
  e.preventDefault();
  const btn = document.getElementById('saveEventBtn');
  setButtonLoading(btn, true);

  const id = document.getElementById('adminEventId').value;

  // Combine separate date + time pickers into ISO string
  const datePart = document.getElementById('eventDatePart').value;
  const timePart = document.getElementById('eventTimePart').value || '00:00';
  const combinedDate = datePart ? `${datePart}T${timePart}` : '';

  const bannerVal = document.getElementById('eventBanner').value.trim();
  const capacityVal = document.getElementById('eventCapacity').value;

  const catInput = document.getElementById('eventCategory');
  const payload = {
    title: document.getElementById('eventTitle').value.trim(),
    category: catInput ? catInput.value.trim() : 'General',
    date: combinedDate,
    venue: document.getElementById('eventVenue').value.trim(),
    capacity: capacityVal ? parseInt(capacityVal, 10) : null,
    speaker: document.getElementById('eventSpeaker').value.trim(),
    banner: bannerVal || null,
    description: document.getElementById('eventDescription').value.trim()
  };

  try {
    if (id) {
      await store.updateEvent(id, payload);
      showToast('Event updated successfully!', 'success');
    } else {
      await store.createEvent(payload);
      showToast('Event published successfully! 🚀', 'success');
    }
    switchTab('upcoming');
    await refreshEvents();
    renderEvents();
    updateStats();
  } catch (err) {
    showToast('Failed: ' + err.message, 'warning');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleDeleteEvent(id) {
  const evt = allEvents.find(e => e.id === id);
  if (!evt) return;
  if (!confirm(`Delete "${evt.title}"? This cannot be undone.`)) return;

  try {
    await store.deleteEvent(id);
    showToast('Event deleted.', 'info');
    await refreshEvents();
    renderEvents();
    updateStats();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'warning');
  }
}

// ─── Event Detail Modal ────────────────────────────────────────────────────
function openEventDetailModal(eventId) {
  const evt = allEvents.find(e => e.id === eventId);
  if (!evt) return;

  const isPast = isEventPast(evt.date);
  const isAdmin = currentProfile?.role === 'admin';
  const isEnrolled = myEnrollmentIds.has(evt.id);
  const count = enrollmentCounts[evt.id] || 0;
  const isFull = count >= evt.capacity;

  const formattedDate = new Date(evt.date).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  let detailAction = '';
  if (isAdmin) {
    detailAction = `
      <button class="btn btn-secondary" id="detailEditBtn">🖼️ Set / Edit Image</button>
      <button class="btn btn-accent" id="detailRosterBtn">👥 View Roster (${count})</button>`;
  } else if (isPast) {
    detailAction = `<button class="btn btn-secondary" disabled>Event Ended</button>`;
  } else if (isEnrolled) {
    detailAction = `<button class="btn btn-accent" id="detailPassBtn">🎟️ View My Ticket</button>`;
  } else if (!currentSession) {
    detailAction = `<button class="btn btn-primary" id="detailLoginBtn">Login to Enroll</button>`;
  } else if (isFull) {
    detailAction = `<button class="btn btn-secondary" disabled>Seats Full</button>`;
  } else {
    detailAction = `<button class="btn btn-primary" id="detailEnrollBtn">✨ Enroll Now</button>`;
  }

  const categoryColors = {
    'technical': 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    'cultural':  'linear-gradient(135deg, #6a0572 0%, #a4036f 100%)',
    'workshop':  'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
    'seminar':   'linear-gradient(135deg, #373b44 0%, #4286f4 100%)',
    'sports':    'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)',
  };
  const catKey = (evt.category || '').toLowerCase();
  const defaultBg = categoryColors[catKey] || 'linear-gradient(135deg, #3a3a3a 0%, #1a1a1a 100%)';

  document.getElementById('eventDetailContent').innerHTML = `
    <div class="event-detail-hero" style="background: ${defaultBg};">
      ${evt.banner
        ? `<img src="${evt.banner}" alt="${evt.title}" onerror="this.style.display='none'" />`
        : `<div class="card-banner-icon">${evt.category?.charAt(0) || '🎓'}</div>`
      }
      <div class="detail-badge-group">
        <span class="card-category-badge">${evt.category}</span>
        <span class="card-status-badge ${isPast ? 'past' : 'upcoming'}">${isPast ? 'Past Event' : 'Upcoming'}</span>
      </div>
    </div>
    <div class="event-detail-info">
      <h2 class="event-detail-title">${evt.title}</h2>
      <div class="detail-grid">
        <div class="detail-box">
          <span class="detail-box-label">Date &amp; Time</span>
          <span class="detail-box-val">${formattedDate}</span>
        </div>
        <div class="detail-box">
          <span class="detail-box-label">Venue</span>
          <span class="detail-box-val">${evt.venue}</span>
        </div>
        <div class="detail-box">
          <span class="detail-box-label">Host / Speaker</span>
          <span class="detail-box-val">${evt.speaker || 'Campus Admin'}</span>
        </div>
      </div>
      <div class="card-capacity-bar">
        <div class="capacity-info">
          <span>Registration Status</span>
          <span>${evt.capacity >= 99999 ? `${count} Registered (Unlimited)` : `${count} / ${evt.capacity} Seats Enrolled`}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${evt.capacity >= 99999 ? '100%' : `${Math.min((count / evt.capacity) * 100, 100)}%`}"></div>
        </div>
      </div>
      <div>
        <h4 style="margin-bottom:0.5rem;font-family:var(--font-heading);">About This Event</h4>
        <p class="event-description-text">${evt.description || ''}</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-close="eventDetailModal">Close</button>
        ${detailAction}
      </div>
    </div>`;

  // Re-attach [data-close] listener for newly rendered button
  document.querySelector('#eventDetailContent [data-close]')?.addEventListener('click', e =>
    closeModal(e.currentTarget.dataset.close));

  document.getElementById('detailEnrollBtn')?.addEventListener('click', async () => {
    closeModal('eventDetailModal');
    await handleEnroll(eventId);
  });
  document.getElementById('detailPassBtn')?.addEventListener('click', () => {
    closeModal('eventDetailModal');
    openTicketModal(eventId);
  });
  document.getElementById('detailLoginBtn')?.addEventListener('click', () => {
    closeModal('eventDetailModal');
    openModal('authModal');
  });
  document.getElementById('detailRosterBtn')?.addEventListener('click', () => {
    closeModal('eventDetailModal');
    openRosterModal(eventId);
  });
  document.getElementById('detailEditBtn')?.addEventListener('click', () => {
    closeModal('eventDetailModal');
    openAdminEventModal(eventId);
  });

  openModal('eventDetailModal');
}

// ─── Roster (Admin) — Inline Panel ────────────────────────────────────────
function _buildRosterRows(body, data) {
  body.innerHTML = '';
  if (!data.length) {
    body.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--text-muted)">No students found.</td></tr>`;
    return;
  }
  data.forEach((row, idx) => {
    const p = row.profiles || {};
    const enrolledAt = row.enrolled_at ? new Date(row.enrolled_at) : null;
    const enrollDate = enrolledAt ? enrolledAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
    const enrollTime = enrolledAt ? enrolledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : 'N/A';
    const uid = row.user_id || p.id || '';
    const evtPrefix = (activeRosterEventId || '').slice(0, 6).toUpperCase();
    const rollSuffix = (p.roll || '0000').slice(-4);
    const ticketCode = `CX-${evtPrefix}-${rollSuffix}`;
    const tr = document.createElement('tr');
    tr.dataset.userId = uid;
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><span class="badge" style="font-family:monospace; background:#e0f2fe; color:#0369a1; font-weight:700; padding:3px 8px; border-radius:6px; font-size:0.78rem;">${ticketCode}</span></td>
      <td class="roster-cell-roll">${p.roll || '—'}</td>
      <td class="roster-cell-name" style="font-weight:600;">${p.name || '—'}</td>
      <td class="roster-cell-dept">${p.dept || '—'}</td>
      <td class="roster-cell-year">${p.year || '—'}</td>
      <td style="color:var(--text-muted); font-size:0.82rem;">${p.email || '—'}</td>
      <td class="roster-cell-phone">${p.phone || '—'}</td>
      <td>${enrollDate}</td>
      <td style="color:var(--text-muted); font-size:0.82rem;">${enrollTime}</td>
      <td style="text-align:center; white-space:nowrap;">
        <button class="btn btn-secondary btn-sm roster-edit-btn" data-uid="${uid}" title="Edit student details"
          style="padding:4px 10px; font-size:0.75rem; margin-right:4px;">✏️ Edit</button>
        <button class="btn btn-sm roster-delete-btn" data-uid="${uid}" title="Remove from event"
          style="padding:4px 10px; font-size:0.75rem; background:#fee2e2; color:#dc2626; border:1px solid #fca5a5;">🗑️ Remove</button>
      </td>`;
    body.appendChild(tr);
  });

  // Wire delete
  body.querySelectorAll('.roster-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const row = activeRosterData.find(r => (r.user_id || r.profiles?.id) === uid);
      const name = row?.profiles?.name || uid;
      if (!confirm(`Remove "${name}" from this event? This cannot be undone.`)) return;
      try {
        await store.adminRemoveEnrollment(activeRosterEventId, uid);
        activeRosterData = activeRosterData.filter(r => (r.user_id || r.profiles?.id) !== uid);
        enrollmentCounts[activeRosterEventId] = Math.max(0, (enrollmentCounts[activeRosterEventId] || 1) - 1);
        _applyRosterSearch();
        document.getElementById('inlineRosterSub').textContent =
          `Total Enrolled: ${activeRosterData.length} students`;
        showToast(`${name} removed from event.`, 'info');
        renderEvents();
      } catch (err) {
        showToast(err.message || 'Could not remove enrollment.', 'warning');
      }
    });
  });

  // Wire edit
  body.querySelectorAll('.roster-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid;
      openRosterEditModal(uid);
    });
  });
}

function _applyRosterSearch() {
  const rawQ = (document.getElementById('rosterSearchInput')?.value || '').trim();
  const q = rawQ.toLowerCase().replace(/-+$/, ''); // Strip trailing dashes e.g. CX-F9FA7B-0000- -> cx-f9fa7b-0000
  const filtered = q
    ? activeRosterData.filter(row => {
        const p = row.profiles || {};
        const evtPrefix = (activeRosterEventId || '').slice(0, 6).toLowerCase();
        const rollSuffix = (p.roll || '0000').slice(-4).toLowerCase();
        const ticketCode = `cx-${evtPrefix}-${rollSuffix}`;
        return (p.name || '').toLowerCase().includes(q)
          || (p.roll || '').toLowerCase().includes(q)
          || (p.email || '').toLowerCase().includes(q)
          || (p.dept || '').toLowerCase().includes(q)
          || (p.phone || '').toLowerCase().includes(q)
          || ticketCode.includes(q)
          || q.includes(ticketCode);
      })
    : activeRosterData;
  const body = document.getElementById('inlineRosterBody');
  if (body) _buildRosterRows(body, filtered);
}

function openRosterEditModal(userId) {
  const row = activeRosterData.find(r => (r.user_id || r.profiles?.id) === userId);
  if (!row) return;
  const p = row.profiles || {};

  // Remove any existing edit modal
  document.getElementById('rosterEditModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'rosterEditModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
  modal.innerHTML = `
    <div style="background:var(--card-bg,#fff);border-radius:16px;padding:28px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1.1rem;font-weight:700;color:var(--text-dark);">✏️ Edit Student Profile</h3>
        <button id="rosterEditClose" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);">×</button>
      </div>
      <div style="display:grid;gap:12px;">
        <div>
          <label style="font-size:0.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Full Name</label>
          <input id="editField_name" value="${p.name || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:0.9rem;background:var(--input-bg,#f8fafc);color:var(--text-dark);box-sizing:border-box;"/>
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Roll Number</label>
          <input id="editField_roll" value="${p.roll || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:0.9rem;background:var(--input-bg,#f8fafc);color:var(--text-dark);box-sizing:border-box;"/>
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Department</label>
          <input id="editField_dept" value="${p.dept || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:0.9rem;background:var(--input-bg,#f8fafc);color:var(--text-dark);box-sizing:border-box;"/>
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Academic Year</label>
          <input id="editField_year" value="${p.year || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:0.9rem;background:var(--input-bg,#f8fafc);color:var(--text-dark);box-sizing:border-box;"/>
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Phone</label>
          <input id="editField_phone" value="${p.phone || ''}" style="width:100%;padding:8px 12px;border:1px solid var(--border,#e2e8f0);border-radius:8px;font-size:0.9rem;background:var(--input-bg,#f8fafc);color:var(--text-dark);box-sizing:border-box;"/>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
        <button id="rosterEditSave" class="btn btn-primary" style="min-width:100px;">💾 Save</button>
        <button id="rosterEditCancel" class="btn btn-secondary">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('rosterEditClose').addEventListener('click', close);
  document.getElementById('rosterEditCancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('rosterEditSave').addEventListener('click', async () => {
    const saveBtn = document.getElementById('rosterEditSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    const fields = {
      name:  document.getElementById('editField_name').value.trim(),
      roll:  document.getElementById('editField_roll').value.trim(),
      dept:  document.getElementById('editField_dept').value.trim(),
      year:  document.getElementById('editField_year').value.trim(),
      phone: document.getElementById('editField_phone').value.trim(),
    };
    try {
      await store.adminUpdateProfile(userId, fields);
      // Update local cache
      const cached = activeRosterData.find(r => (r.user_id || r.profiles?.id) === userId);
      if (cached) cached.profiles = { ...(cached.profiles || {}), ...fields };
      _applyRosterSearch();
      close();
      showToast('Profile updated successfully! ✅', 'success');
    } catch (err) {
      showToast(err.message || 'Could not save changes.', 'warning');
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Save';
    }
  });
}

async function openRosterModal(eventId) {
  activeRosterEventId = eventId;
  const evt = allEvents.find(e => e.id === eventId);
  if (!evt) return;

  const panel = document.getElementById('inlineRosterPanel');
  const body  = document.getElementById('inlineRosterBody');

  if (panel) {
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('inlineRosterTitle').textContent = `👥 Roster: ${evt.title}`;
  document.getElementById('inlineRosterSub').textContent = 'Loading...';
  if (body) body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-muted)">Loading...</td></tr>`;

  // Clear search
  const searchInput = document.getElementById('rosterSearchInput');
  if (searchInput) {
    searchInput.value = '';
    if (!searchInput._wired) {
      searchInput._wired = true;
      searchInput.addEventListener('input', _applyRosterSearch);
    }
  }

  // Wire close button
  const closeBtn = document.getElementById('inlineRosterClose');
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener('click', () => {
      panel?.classList.add('hidden');
      activeRosterEventId = null;
      activeRosterData = [];
      if (searchInput) searchInput.value = '';
    });
  }

  // Wire export button
  const exportBtn = document.getElementById('inlineExportCsvBtn');
  if (exportBtn && !exportBtn._wired) {
    exportBtn._wired = true;
    exportBtn.addEventListener('click', handleExportCsv);
  }

  try {
    activeRosterData = await store.getEventRosterWithEmails(eventId);
    const count = activeRosterData.length;
    document.getElementById('inlineRosterSub').textContent =
      `Total Enrolled: ${count} / ${evt.capacity || '∞'} students`;
    _buildRosterRows(body, activeRosterData);
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;color:#ef4444">Error: ${err.message}</td></tr>`;
  }
}

function handleExportCsv() {
  if (!activeRosterEventId || !activeRosterData.length) {
    showToast('No data to export.', 'warning');
    return;
  }
  const evt = allEvents.find(e => e.id === activeRosterEventId);

  const headers = [
    'Index', 'Roll Number', 'Student Name', 'Department', 'Academic Year',
    'Email', 'Phone', 'Enrollment Date', 'Enrollment Time', 'Enrolled At (ISO)'
  ];

  const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;

  let csv = headers.join(',') + '\n';
  activeRosterData.forEach((row, i) => {
    const p = row.profiles || {};
    const enrolledAt = row.enrolled_at ? new Date(row.enrolled_at) : null;
    const enrollDate = enrolledAt ? enrolledAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const enrollTime = enrolledAt ? enrolledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '';

    csv += [
      escape(i + 1),
      escape(p.roll),
      escape(p.name),
      escape(p.dept),
      escape(p.year),
      escape(p.email),
      escape(p.phone),
      escape(enrollDate),
      escape(enrollTime),
      escape(row.enrolled_at || '')
    ].join(',') + '\n';
  });

  const filename = `${(evt?.title || 'roster').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_enrolled_students.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exported ${activeRosterData.length} students to CSV! 📥`, 'success');
}

// ─── Stats & Badges ────────────────────────────────────────────────────────
function updateStats() {
  const total    = allEvents.length;
  const upcoming = allEvents.filter(e => !isEventPast(e.date)).length;
  const totalReg = Object.values(enrollmentCounts).reduce((s, c) => s + c, 0);
  const myCount  = myEnrollmentIds.size;

  const elTotal  = document.getElementById('statTotalEvents');
  const elUp     = document.getElementById('statUpcoming');
  const elReg    = document.getElementById('statTotalEnrollments');
  const elMy     = document.getElementById('statMyEnrollments');

  if (elTotal) elTotal.textContent = total;
  if (elUp)    elUp.textContent    = upcoming;
  if (elReg)   elReg.textContent   = totalReg;
  if (elMy)    elMy.textContent    = myCount;
}

function updateBadges() {
  const badgeUp = document.getElementById('badgeUpcoming');
  const badgePast = document.getElementById('badgePast');
  const badgeEnr = document.getElementById('badgeEnrolled');
  if (badgeUp) badgeUp.textContent = allEvents.filter(e => !isEventPast(e.date)).length;
  if (badgePast) badgePast.textContent = allEvents.filter(e => isEventPast(e.date)).length;
  if (badgeEnr) badgeEnr.textContent = myEnrollmentIds.size;
}

// ─── UI Helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function showLoading(show) {
  document.getElementById('loadingState').classList.toggle('hidden', !show);
  document.getElementById('eventsGrid').classList.toggle('hidden', show);
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
  btn.querySelector('.btn-spinner')?.classList.toggle('hidden', !loading);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Admin Control Panel Controllers ───────────────────────────────────────

async function openAdminPanel() {
  if (!isCurrentUserAdmin()) {
    showToast('Access denied: Admin privileges required.', 'warning');
    return;
  }
  switchTab('admin');
}

async function loadAdminUsers() {
  const tableBody = document.getElementById('adminUserTableBody');
  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">Loading users from database...</td></tr>';
  }
  try {
    allAdminUsers = await store.getAllUsers();
    renderAdminUsers();
  } catch (err) {
    console.error('Error loading users for admin panel:', err);
    showToast('Failed to load user list.', 'warning');
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #c62828; padding: 24px;">Failed to load users: ${err.message}</td></tr>`;
    }
  }
}

function renderAdminUsers() {
  const search = (document.getElementById('adminUserSearchInput')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('adminUserStatusFilter')?.value || 'ALL';
  const tbody = document.getElementById('adminUserTableBody');
  if (!tbody) return;

  // Filter users
  const filtered = allAdminUsers.filter(user => {
    const nameMatch = (user.name || '').toLowerCase().includes(search);
    const emailMatch = (user.email || '').toLowerCase().includes(search);
    const rollMatch = (user.roll || '').toLowerCase().includes(search);
    const matchesSearch = nameMatch || emailMatch || rollMatch;

    const userStatus = user.status || 'active';
    const matchesStatus = statusFilter === 'ALL' || userStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Update summary metrics
  const activeCount = allAdminUsers.filter(u => (u.status || 'active') === 'active').length;
  const bannedCount = allAdminUsers.filter(u => u.status === 'banned' || u.status === 'blocked').length;
  const totalRegs = Object.values(enrollmentCounts).reduce((s, c) => s + c, 0);

  document.getElementById('statAdminTotalUsers').textContent = allAdminUsers.length;
  document.getElementById('statAdminActiveUsers').textContent = activeCount;
  document.getElementById('statAdminBannedUsers').textContent = bannedCount;
  document.getElementById('statAdminTotalRegs').textContent = totalRegs;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No matching users found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(user => {
    const status = user.status || 'active';
    const statusClass = status === 'banned' ? 'banned' : status === 'blocked' ? 'blocked' : 'active';
    const isSelf = currentSession?.user?.id === user.id;
    const userEmailLower = (user.email || '').trim().toLowerCase();
    const isOriginalAdmin = userEmailLower === 'nikhildeosani@gmail.com';
    const isAdminRole = user.role === 'admin';
    const userNameEscaped = (user.name || user.email || '').replace(/'/g, "\\'");

    let roleBadgeHtml = '';
    if (isOriginalAdmin) {
      roleBadgeHtml = `
        <span style="font-weight: 800; font-size: 0.78rem; color: #f59e0b; background: rgba(245, 158, 11, 0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.3); display: inline-flex; align-items: center; gap: 4px;">
          ⭐ Primary Admin
        </span>`;
    } else if (isAdminRole) {
      roleBadgeHtml = `
        <span style="font-weight: 700; font-size: 0.78rem; color: var(--gold); background: rgba(212, 175, 55, 0.12); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(212, 175, 55, 0.25); display: inline-flex; align-items: center; gap: 4px;">
          👑 Admin
        </span>`;
    } else {
      roleBadgeHtml = `
        <span style="font-weight: 600; font-size: 0.8rem; color: var(--text-muted);">
          Student
        </span>`;
    }

    let actionsHtml = '';
    if (isOriginalAdmin) {
      // Primary admin row: protected from demotion, ban, or deletion
      actionsHtml = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; font-weight: 700; font-size: 0.75rem; padding: 5px 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">⭐ Primary Admin (Protected)</span>`;
    } else {
      actionsHtml = '<div class="user-action-group" style="display: inline-flex; gap: 6px; flex-wrap: nowrap; align-items: center; white-space: nowrap;">';

      // ── Admin Role Toggle (Make Admin / Remove Admin) ─────────────────────
      if (isAdminRole) {
        actionsHtml += `<button class="btn btn-xs" onclick="window.handleSetUserRole('${user.id}', 'student', '${userNameEscaped}')" style="background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.4); color: #ef4444; font-weight: 700; border-radius: 8px; padding: 5px 10px; cursor: pointer;" title="Revoke Admin Rights">🛡️ Remove Admin</button>`;
      } else {
        actionsHtml += `<button class="btn btn-xs" onclick="window.handleSetUserRole('${user.id}', 'admin', '${userNameEscaped}')" style="background: linear-gradient(135deg, #6366f1, #4f46e5); border: none; color: #ffffff; font-weight: 700; border-radius: 8px; padding: 5px 12px; box-shadow: 0 2px 10px rgba(99, 102, 241, 0.45); cursor: pointer;" title="Grant Admin Rights">👑 Make Admin</button>`;
      }

      // Appoint Mentor
      actionsHtml += `<button class="btn btn-xs btn-accent" onclick="window.openAppointMentorModal('${user.id}')" title="Appoint User as Mentor" style="cursor: pointer;">🎓 Mentor</button>`;

      // Ban or Activate & Delete (Block button REMOVED)
      if (!isSelf) {
        if (status === 'banned') {
          actionsHtml += `<button class="btn btn-xs btn-success" onclick="window.handleSetUserStatus('${user.id}', 'active')" title="Restore user to active status" style="cursor: pointer;">✅ Activate</button>`;
        } else {
          actionsHtml += `<button class="btn btn-xs btn-danger" onclick="window.handleSetUserStatus('${user.id}', 'banned')" title="Ban user from platform" style="cursor: pointer;">🚫 Ban</button>`;
        }
        actionsHtml += `<button class="btn btn-xs btn-secondary" onclick="window.handleDeleteUser('${user.id}', '${userNameEscaped}')" style="color: #c62828; cursor: pointer;" title="Delete user profile">🗑️ Delete</button>`;
      } else {
        actionsHtml += `<span style="font-size: 0.72rem; color: var(--text-muted); font-style: italic;">(You)</span>`;
      }
      actionsHtml += '</div>';
    }

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: var(--text-dark);">${user.name || 'Unnamed User'} ${isSelf ? '<span style="font-size:0.75rem; color:var(--gold); font-weight:600;">(You)</span>' : ''}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${user.email || user.id}</div>
        </td>
        <td>
          ${roleBadgeHtml}
        </td>
        <td>
          <div style="font-size: 0.85rem;">${user.roll || '—'}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${user.dept || 'General'} (${user.year || 'N/A'})</div>
        </td>
        <td>
          <span class="status-pill ${statusClass}">${status}</span>
        </td>
        <td>
          ${actionsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

// Global action handlers for user management table buttons
window.handleSetUserRole = async function (userId, newRole, userName) {
  if (!isCurrentUserAdmin()) {
    showToast('⛔ Admin privileges required to manage roles.', 'warning');
    return;
  }

  const isGranting = newRole === 'admin';
  const confirmMsg = isGranting
    ? `Are you sure you want to make "${userName}" an Admin?\n\nThey will gain full access to the Admin Panel, user management, event publishing, mentorship management, and system activity logs.`
    : `Are you sure you want to remove Admin privileges from "${userName}"?`;

  if (!confirm(confirmMsg)) return;

  try {
    showToast(isGranting ? `Granting Admin access to ${userName}...` : `Revoking Admin access from ${userName}...`, 'info');
    await store.setUserRole(userId, newRole);

    // If updating the currently logged-in user's own role, reflect it in local state
    if (currentSession?.user?.id === userId && currentProfile) {
      currentProfile.role = newRole;
      updateAuthUI();
    }

    showToast(isGranting ? `👑 ${userName} is now an Admin!` : `Removed Admin rights from ${userName}.`, 'success');
    await loadAdminUsers();
    await loadAdminLogs();
  } catch (err) {
    console.error('Failed to update user role:', err);
    showToast(err.message || 'Failed to update user role.', 'warning');
  }
};

// ── Appoint Admin Modal Handlers ──────────────────────────────────────────────
window.openAppointAdminModal = async function (preselectedUserId = null) {
  if (!isCurrentUserAdmin()) {
    showToast('Access denied: Admin privileges required.', 'warning');
    return;
  }

  const selectEl = document.getElementById('adminUserSelect');
  if (selectEl) {
    selectEl.innerHTML = '<option value="">Loading registered members...</option>';
  }

  openModal('appointAdminModal');

  try {
    const users = await store.getAllUsers();
    if (!users || users.length === 0) {
      if (selectEl) selectEl.innerHTML = '<option value="">No registered members found</option>';
      return;
    }

    window._allUsersForAdminAppoint = users;

    if (selectEl) {
      selectEl.innerHTML = '<option value="">-- Choose User to Manage Admin Rights --</option>' +
        users.map(u => {
          const roleBadge = u.role === 'admin' ? '👑 Admin' : 'Student';
          const isOriginal = (u.email || '').toLowerCase() === 'nikhildeosani@gmail.com' ? '⭐ Primary Admin' : roleBadge;
          const label = `${u.name || 'Unnamed'} (${u.email || u.roll || u.id}) — [Current: ${isOriginal}]`;
          const isSelected = preselectedUserId === u.id ? 'selected' : '';
          return `<option value="${u.id}" ${isSelected}>${label}</option>`;
        }).join('');
    }

    if (preselectedUserId) {
      if (selectEl) selectEl.value = preselectedUserId;
      handleAdminUserSelectChange();
    } else {
      const previewEl = document.getElementById('adminUserSelectedPreview');
      if (previewEl) previewEl.style.display = 'none';
    }

  } catch (err) {
    console.error('Failed to load users for appoint admin modal:', err);
    showToast('Failed to load user list.', 'warning');
  }
};

function handleAdminUserSelectChange() {
  const selectEl = document.getElementById('adminUserSelect');
  const previewEl = document.getElementById('adminUserSelectedPreview');
  if (!selectEl || !previewEl) return;

  const userId = selectEl.value;
  const users = window._allUsersForAdminAppoint || [];
  const user = users.find(u => u.id === userId);

  if (!user) {
    previewEl.style.display = 'none';
    return;
  }

  document.getElementById('previewUserName').textContent = user.name || 'Unnamed User';
  document.getElementById('previewUserEmail').textContent = user.email || user.id;
  document.getElementById('previewUserDept').textContent = `${user.dept || 'General'} (${user.roll || 'No Roll'})`;

  const isOriginal = (user.email || '').toLowerCase() === 'nikhildeosani@gmail.com';
  const roleEl = document.getElementById('previewUserRole');
  if (isOriginal) {
    roleEl.textContent = '⭐ Primary Admin (Protected)';
    roleEl.style.background = 'rgba(245, 158, 11, 0.2)';
    roleEl.style.color = '#f59e0b';
  } else if (user.role === 'admin') {
    roleEl.textContent = '👑 Admin';
    roleEl.style.background = 'rgba(212, 175, 55, 0.2)';
    roleEl.style.color = 'var(--gold)';
  } else {
    roleEl.textContent = 'Student';
    roleEl.style.background = 'rgba(255, 255, 255, 0.1)';
    roleEl.style.color = 'var(--text-muted)';
  }

  previewEl.style.display = 'block';

  // Auto-set choice based on current role
  const choiceEl = document.getElementById('adminRoleChoice');
  if (choiceEl) {
    choiceEl.value = user.role === 'admin' ? 'student' : 'admin';
  }
}

async function handleAppointAdminSubmit(e) {
  e.preventDefault();
  const selectEl = document.getElementById('adminUserSelect');
  const choiceEl = document.getElementById('adminRoleChoice');
  const submitBtn = document.getElementById('appointAdminSubmitBtn');
  if (!selectEl || !choiceEl) return;

  const userId = selectEl.value;
  const newRole = choiceEl.value;
  if (!userId) {
    showToast('Please select a registered member first.', 'warning');
    return;
  }

  const users = window._allUsersForAdminAppoint || [];
  const targetUser = users.find(u => u.id === userId);
  const userName = targetUser?.name || targetUser?.email || 'User';

  setButtonLoading(submitBtn, true);
  try {
    await store.setUserRole(userId, newRole);
    closeModal('appointAdminModal');

    const isGranting = newRole === 'admin';
    showToast(isGranting ? `👑 ${userName} is now an Admin!` : `Removed Admin rights from ${userName}.`, 'success');

    await loadAdminUsers();
    await loadAdminLogs();

    if (currentSession?.user?.id === userId && currentProfile) {
      currentProfile.role = newRole;
      updateAuthUI();
    }
  } catch (err) {
    console.error('Appoint admin submit error:', err);
    showToast(err.message || 'Failed to update user role.', 'warning');
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

window.handleSetUserStatus = async function (userId, newStatus) {
  try {
    showToast(`Updating user status to ${newStatus.toUpperCase()}...`, 'info');
    await store.setUserStatus(userId, newStatus);
    showToast(`User status updated to ${newStatus.toUpperCase()}!`, 'success');
    await loadAdminUsers();
    await loadAdminLogs();
  } catch (err) {
    console.error('Failed to update user status:', err);
    showToast(err.message || 'Failed to update user status.', 'warning');
  }
};

window.handleDeleteUser = async function (userId, userName) {
  if (!confirm(`Are you sure you want to permanently delete user "${userName}"? This cannot be undone.`)) {
    return;
  }
  try {
    showToast('Deleting user profile...', 'info');
    await store.deleteUserProfile(userId);
    showToast(`User ${userName} deleted successfully.`, 'success');
    await loadAdminUsers();
    await loadAdminLogs();
  } catch (err) {
    console.error('Failed to delete user:', err);
    showToast(err.message || 'Failed to delete user profile.', 'warning');
  }
};

async function loadAdminLogs() {
  const feed = document.getElementById('adminActivityLogFeed');
  if (feed) {
    feed.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 24px;">Loading real-time activity logs...</p>';
  }
  try {
    allAdminLogs = await store.getActivityLogs(100);
    renderAdminLogs();
  } catch (err) {
    console.error('Error loading activity logs:', err);
    if (feed) {
      feed.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 24px;">Activity logs not yet initialized. Run <code>admin_panel_setup.sql</code> in Supabase SQL Editor.</p>`;
    }
  }
}

function renderAdminLogs() {
  const filter = document.getElementById('adminActivityFilter')?.value || 'ALL';
  const feed = document.getElementById('adminActivityLogFeed');
  if (!feed) return;

  const filteredLogs = allAdminLogs.filter(log => {
    if (filter === 'ALL') return true;
    return (log.action_type || '').startsWith(filter);
  });

  if (filteredLogs.length === 0) {
    feed.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 24px;">No activity logs found for selected filter.</p>';
    return;
  }

  feed.innerHTML = filteredLogs.map(log => {
    const dateStr = log.created_at ? new Date(log.created_at).toLocaleString() : 'Just now';
    const action = log.action_type || 'SYSTEM';

    let badgeClass = 'EVENT';
    if (action.includes('SIGNUP')) badgeClass = 'SIGNUP';
    else if (action.includes('LOGIN')) badgeClass = 'LOGIN';
    else if (action.includes('BAN') || action.includes('BLOCKED')) badgeClass = 'BAN';
    else if (action.includes('DELETE')) badgeClass = 'DELETE';

    return `
      <div class="activity-item">
        <span class="activity-badge ${badgeClass}">${action}</span>
        <div class="activity-content">
          <div class="activity-details">${log.details || action}</div>
          <div class="activity-meta">User: ${log.user_email || log.user_id || 'System'} • ${dateStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Admin Analytics ────────────────────────────────────────────────────────
function renderAdminAnalytics() {
  const users = allAdminUsers;
  if (!users || users.length === 0) return;

  const totalUsers       = users.length;
  const totalEvents      = allEvents.length;
  const totalEnrollments = Object.values(enrollmentCounts).reduce((s, c) => s + c, 0);
  const avgEnrollments   = totalEvents > 0 ? (totalEnrollments / totalEvents).toFixed(1) : 0;
  const totalLogins      = users.reduce((s, u) => s + (u.login_count || 0), 0);

  // ── KPIs ──
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpiTotalUsers',       totalUsers);
  set('kpiTotalEvents',      totalEvents);
  set('kpiTotalEnrollments', totalEnrollments);
  set('kpiAvgEnrollments',   avgEnrollments);
  set('kpiTotalLogins',      totalLogins);

  // ── Department Bar Chart ──
  const deptCounts = {};
  users.forEach(u => {
    const dept = u.dept || 'Unknown';
    deptCounts[dept] = (deptCounts[dept] || 0) + 1;
  });
  const maxDept = Math.max(...Object.values(deptCounts), 1);
  const deptEl = document.getElementById('deptBarChart');
  if (deptEl) {
    deptEl.innerHTML = Object.entries(deptCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([dept, count]) => `
        <div class="bar-row">
          <div class="bar-label">${dept}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(count/maxDept*100).toFixed(1)}%; background: var(--orange);"></div>
          </div>
          <div class="bar-value">${count}</div>
        </div>`).join('');
  }

  // ── Top Events Bar Chart ──
  const topEvents = allEvents
    .map(e => ({ title: e.title, count: enrollmentCounts[e.id] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxEvt = Math.max(...topEvents.map(e => e.count), 1);
  const evtEl = document.getElementById('topEventsChart');
  if (evtEl) {
    evtEl.innerHTML = topEvents.length === 0
      ? '<p style="color:var(--text-muted);padding:12px;">No enrollments yet.</p>'
      : topEvents.map(e => `
        <div class="bar-row">
          <div class="bar-label" title="${e.title}">${e.title.length > 22 ? e.title.slice(0,22)+'…' : e.title}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(e.count/maxEvt*100).toFixed(1)}%; background: var(--accent);"></div>
          </div>
          <div class="bar-value">${e.count}</div>
        </div>`).join('');
  }

  // ── Role Donut ──
  const admins   = users.filter(u => u.role === 'admin').length;
  const students = totalUsers - admins;
  _renderDonut('roleDonutChart', [
    { label: 'Students', count: students, color: 'var(--orange)' },
    { label: 'Admins',   count: admins,   color: 'var(--gold)' },
  ]);

  // ── Status Donut ──
  const active  = users.filter(u => (u.status||'active') === 'active').length;
  const banned  = users.filter(u => u.status === 'banned').length;
  const blocked = users.filter(u => u.status === 'blocked').length;
  _renderDonut('statusDonutChart', [
    { label: 'Active',  count: active,  color: '#22c55e' },
    { label: 'Banned',  count: banned,  color: '#ef4444' },
    { label: 'Blocked', count: blocked, color: '#f59e0b' },
  ]);

  // ── Signup Sparkline (last 7 days) ──
  const days = Array.from({length: 7}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const signupsByDay = {};
  days.forEach(d => signupsByDay[d] = 0);
  users.forEach(u => {
    const day = (u.created_at || '').slice(0, 10);
    if (signupsByDay[day] !== undefined) signupsByDay[day]++;
  });
  const sparkMax = Math.max(...Object.values(signupsByDay), 1);
  const sparkEl = document.getElementById('signupSparkline');
  if (sparkEl) {
    sparkEl.innerHTML = `
      <div class="sparkline-bars">
        ${days.map(d => {
          const v = signupsByDay[d];
          const h = Math.max((v / sparkMax * 100), 4);
          return `<div class="spark-col">
            <div class="spark-bar" style="height:${h}%;" title="${d}: ${v} signups">
              ${v > 0 ? `<span class="spark-tip">${v}</span>` : ''}
            </div>
            <div class="spark-label">${d.slice(5)}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ── Most Active Users Table ──
  const tbody = document.getElementById('activeUsersTableBody');
  if (tbody) {
    const sorted = [...users]
      .sort((a, b) => (b.login_count || 0) - (a.login_count || 0))
      .slice(0, 8);
    tbody.innerHTML = sorted.map((u, i) => {
      const lastSeen = u.last_seen
        ? new Date(u.last_seen).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
      return `<tr>
        <td style="font-weight:700;color:var(--orange);">${i + 1}</td>
        <td style="font-weight:600;">${u.name || '—'}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${u.email || '—'}</td>
        <td>${u.dept || '—'}</td>
        <td><span style="font-weight:700;color:var(--orange);">${u.login_count || 0}</span></td>
        <td style="font-size:0.78rem;">${lastSeen}</td>
        <td style="text-align:center;">${enrollmentCounts[u.id] || '—'}</td>
      </tr>`;
    }).join('');
  }
}

function _renderDonut(containerId, segments) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const total = segments.reduce((s, seg) => s + seg.count, 0);
  if (total === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;">No data</p>'; return; }

  let angle = 0;
  const gradientParts = segments.map(seg => {
    const pct = (seg.count / total) * 100;
    const start = angle;
    angle += pct;
    return { ...seg, pct: pct.toFixed(1), start, end: angle };
  });
  const conicParts = gradientParts.map(p => `${p.color} ${p.start.toFixed(1)}% ${p.end.toFixed(1)}%`).join(', ');

  el.innerHTML = `
    <div class="donut-ring" style="background: conic-gradient(${conicParts});"></div>
    <div class="donut-legend">
      ${gradientParts.map(p => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${p.color};"></span>
          <span>${p.label}</span>
          <strong>${p.count}</strong>
          <span style="color:var(--text-muted);font-size:0.72rem;">${p.pct}%</span>
        </div>`).join('')}
    </div>`;
}

// ─── 3D Pie Chart Visualizer & Inspector ──────────────────────────────────
let current3DData = null;

function open3DPieInspector(chartType) {
  if (!allAdminUsers || allAdminUsers.length === 0) {
    allAdminUsers = store.getAllUsers ? [] : [];
  }

  let title = '';
  let subtitle = '';
  let segments = [];

  if (chartType === 'role') {
    title = '🎭 User Role Split 3D Inspector';
    subtitle = '3D isometric breakdown of Student vs Admin accounts on CampusEventX.';
    const students = (allAdminUsers || []).filter(u => (u.role || 'student').toLowerCase() === 'student');
    const admins = (allAdminUsers || []).filter(u => (u.role || '').toLowerCase() === 'admin');

    segments = [
      { id: 'students', label: 'Students', count: students.length, color: '#374151', users: students },
      { id: 'admins', label: 'Admins', count: admins.length, color: '#1d4aff', users: admins }
    ];
  } else if (chartType === 'status') {
    title = '🔒 Account Status Split 3D Inspector';
    subtitle = '3D isometric breakdown of Active, Banned, and Blocked account statuses.';
    const active = (allAdminUsers || []).filter(u => (u.status || 'active') === 'active');
    const banned = (allAdminUsers || []).filter(u => u.status === 'banned');
    const blocked = (allAdminUsers || []).filter(u => u.status === 'blocked');

    segments = [
      { id: 'active', label: 'Active Accounts', count: active.length, color: '#22c55e', users: active },
      { id: 'banned', label: 'Banned Users', count: banned.length, color: '#ef4444', users: banned },
      { id: 'blocked', label: 'Blocked Users', count: blocked.length, color: '#f59e0b', users: blocked }
    ];
  }

  current3DData = { chartType, title, subtitle, segments };

  document.getElementById('pie3DTitle').textContent = title;
  document.getElementById('pie3DSubtitle').textContent = subtitle;

  openModal('pie3DModal');
  select3DSlice(0);
}

function select3DSlice(index) {
  if (!current3DData || !current3DData.segments[index]) return;

  const segments = current3DData.segments;
  const total = segments.reduce((s, seg) => s + seg.count, 0);
  const activeSeg = segments[index];

  // Render 3D pie slices
  _render3DPieDisc(segments, index);

  // Render Callout Information Card
  const pct = total > 0 ? ((activeSeg.count / total) * 100).toFixed(1) : '0.0';
  document.getElementById('calloutBadge').textContent = `SEGMENT: ${activeSeg.label.toUpperCase()}`;
  document.getElementById('calloutBadge').style.background = `${activeSeg.color}20`;
  document.getElementById('calloutBadge').style.color = activeSeg.color;

  document.getElementById('calloutSegmentTitle').textContent = activeSeg.label;
  document.getElementById('calloutSegmentTitle').style.color = activeSeg.color;
  document.getElementById('calloutPctDisplay').textContent = `${pct}%`;
  document.getElementById('calloutPctDisplay').style.color = activeSeg.color;

  document.getElementById('calloutCount').textContent = activeSeg.count;
  document.getElementById('calloutShare').textContent = `${pct}% (${activeSeg.count}/${total})`;

  // Render matching user roster
  const memberListEl = document.getElementById('calloutMemberList');
  if (activeSeg.users.length === 0) {
    memberListEl.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); padding:8px 0;">No users in this category.</p>';
  } else {
    memberListEl.innerHTML = activeSeg.users.map(u => `
      <div style="display:flex; align-items:center; justify-content:space-between; background:#ffffff; border:1px solid var(--border-light); padding:8px 12px; border-radius:8px; font-size:0.8rem;">
        <div>
          <strong style="color:var(--text-primary);">${u.name || u.email}</strong>
          <div style="font-size:0.72rem; color:var(--text-muted);">${u.email || ''} ${u.roll ? '• Roll: ' + u.roll : ''}</div>
        </div>
        <span class="badge" style="background:${activeSeg.color}; color:#fff; font-size:0.68rem;">${(u.status || u.role || 'active').toUpperCase()}</span>
      </div>
    `).join('');
  }

  // Render Slice Pills selector
  const pillsEl = document.getElementById('pie3DSlicePills');
  pillsEl.innerHTML = segments.map((seg, i) => `
    <button type="button" class="btn btn-xs" onclick="window.select3DSlice(${i})" style="background:${i === index ? seg.color : '#ffffff'}; color:${i === index ? '#ffffff' : 'var(--text-primary)'}; border:1.5px solid ${seg.color}; font-weight:700; border-radius:99px; padding:4px 12px;">
      ${seg.label} (${seg.count})
    </button>
  `).join('');

  // Position 3D Arrow Path
  _drawPointerArrow(index, segments.length);
}

function _render3DPieDisc(segments, activeIndex) {
  const discEl = document.getElementById('pie3DStageDisc');
  if (!discEl) return;

  const total = segments.reduce((s, seg) => s + seg.count, 0);
  if (total === 0) {
    discEl.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;">No data</div>';
    return;
  }

  let angle = 0;
  const parts = segments.map((seg, idx) => {
    const pct = (seg.count / total) * 100;
    const start = angle;
    angle += pct;
    const midAngle = (start + angle) / 2;
    return { ...seg, pct, start, end: angle, midAngle, isActive: idx === activeIndex };
  });

  const conicParts = parts.map(p => `${p.color} ${p.start.toFixed(1)}% ${p.end.toFixed(1)}%`).join(', ');

  // Generate 3D layers (bottom shadow, extrusion depth layers, top face)
  let depthLayersHtml = '';
  for (let z = 0; z <= 24; z += 3) {
    const shadowOpacity = (1 - z / 24) * 0.4;
    depthLayersHtml += `
      <div style="position:absolute; inset:0; border-radius:50%; background: conic-gradient(${conicParts}); transform: translateZ(${z}px); filter: brightness(${0.65 + (z / 24) * 0.35}); opacity: ${z === 0 ? shadowOpacity : 1};"></div>
    `;
  }

  discEl.innerHTML = `
    ${depthLayersHtml}
    <!-- Top Interactive Surface -->
    <div style="position:absolute; inset:0; border-radius:50%; background: conic-gradient(${conicParts}); transform: translateZ(26px); box-shadow: inset 0 2px 8px rgba(255,255,255,0.6), 0 10px 24px rgba(0,0,0,0.25);">
      ${parts.map((p, idx) => {
        if (p.isActive) {
          const rad = (p.midAngle * 3.6 - 90) * (Math.PI / 180);
          const popX = Math.cos(rad) * 16;
          const popY = Math.sin(rad) * 16;
          return `
            <div onclick="window.select3DSlice(${idx})" style="position:absolute; inset:0; border-radius:50%; background: conic-gradient(${p.color} 0% 100%); transform: translate(${popX}px, ${popY}px) translateZ(18px) scale(1.05); opacity:0.22; cursor:pointer;" title="${p.label}"></div>
          `;
        }
        return '';
      }).join('')}
    </div>
  `;
}

function _drawPointerArrow(activeIndex, totalSegments) {
  const path = document.getElementById('pie3DArrowPath');
  if (!path) return;

  const startX = 220;
  const startY = 150 + (activeIndex * 24);
  const endX = 354;
  const endY = 96;

  const controlX = (startX + endX) / 2;
  const controlY = startY - 24;

  path.setAttribute('d', `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`);
}

window.open3DPieInspector = open3DPieInspector;
window.select3DSlice = select3DSlice;

// ─── Career & Mentorship Controllers ────────────────────────────────────────

let myMentorApplication = null;
let activeCareerSubTab = 'mentors';

function initCareerSubTabs() {
  document.querySelectorAll('.career-sub-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget.dataset.careerTab;
      switchCareerSubTab(target);
    });
  });
}

function switchCareerSubTab(tabName) {
  activeCareerSubTab = tabName;
  const mentorsView = document.getElementById('careerTabMentorsView');
  const appointmentsView = document.getElementById('careerTabAppointmentsView');
  const mentorsBtn = document.getElementById('careerSubTabMentors');
  const appointmentsBtn = document.getElementById('careerSubTabAppointments');

  if (tabName === 'appointments') {
    mentorsView?.classList.add('hidden');
    appointmentsView?.classList.remove('hidden');
    mentorsBtn?.classList.remove('btn-primary', 'active');
    mentorsBtn?.classList.add('btn-secondary');
    appointmentsBtn?.classList.remove('btn-secondary');
    appointmentsBtn?.classList.add('btn-primary', 'active');
    renderMyAppointments();
  } else {
    appointmentsView?.classList.add('hidden');
    mentorsView?.classList.remove('hidden');
    appointmentsBtn?.classList.remove('btn-primary', 'active');
    appointmentsBtn?.classList.add('btn-secondary');
    mentorsBtn?.classList.remove('btn-secondary');
    mentorsBtn?.classList.add('btn-primary', 'active');
    renderMentors();
  }
}

async function loadCareerData() {
  const mentorsGrid = document.getElementById('mentorsGrid');
  if (mentorsGrid) {
    mentorsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 16px;">Loading appointed mentors...</p>';
  }

  try {
    if (!currentSession) {
      currentSession = await store.getSession();
    }

    allMentors = await store.getMentors();
    renderMentors();

    if (currentSession?.user) {
      const freshAppts = await store.getMyAppointments(currentSession.user.id);
      // Merge fresh results with any already-shown appointments to prevent
      // RLS-blocked DB queries from wiping out locally-tracked bookings
      const seenIds = new Set(freshAppts.map(a => a.id));
      const preserved = myAppointments.filter(a => !seenIds.has(a.id));
      myAppointments = [...freshAppts, ...preserved];
      myMentorApplication = await store.getUserMentorApplication(currentSession.user.id);

      const incomingBookings = myAppointments.filter(a => a.is_mentor_booking);
      if (incomingBookings.length > 0) {
        const count = incomingBookings.length;
        const latest = incomingBookings[0];
        const studentName = latest.student_name || 'A student';
        showToast(`📬 Mentor Alert: ${count} student booking${count > 1 ? 's' : ''} received! Latest from ${studentName} (${latest.slot_time}). Check "My Sessions".`, 'info');
      }
    } else {
      myAppointments = [];
      myMentorApplication = null;
    }
    renderMyAppointments();
    updateApplyMentorButtonState();
  } catch (err) {
    console.error('Error loading career mentors:', err);
    renderMentors();
    renderMyAppointments();
  }
}

function updateApplyMentorButtonState() {
  const openBtn = document.getElementById('openApplyMentorBtn');
  if (!openBtn) return;

  if (myMentorApplication && myMentorApplication.status === 'pending') {
    openBtn.innerHTML = '⏳ Mentorship App Under Review (Click to View/Withdraw)';
    openBtn.className = 'btn btn-secondary';
    openBtn.style.borderColor = '#f59e0b';
    openBtn.style.color = '#b45309';
  } else if (myMentorApplication && myMentorApplication.status === 'approved') {
    openBtn.innerHTML = '✅ Appointed Campus Mentor';
    openBtn.className = 'btn btn-secondary';
    openBtn.style.borderColor = '#10b981';
    openBtn.style.color = '#047857';
  } else {
    openBtn.innerHTML = '✨ Apply as Mentor';
    openBtn.className = 'btn btn-primary';
    openBtn.style.borderColor = '';
    openBtn.style.color = '';
  }
}

function renderMentors() {
  const grid = document.getElementById('mentorsGrid');
  if (!grid) return;

  if (allMentors.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; width: 100%; max-width: 480px; margin: 32px auto;">
        <h3 style="font-size: 1.25rem; font-weight: 700; color: #0f172a; margin-bottom: 6px;">No Mentors Appointed Yet</h3>
        <p style="font-size: 0.88rem; color: #64748b; margin-bottom: 20px; line-height: 1.5;">Connect 1-on-1 with campus mentors and alumni for career advice, resume reviews, and prep.</p>
        <button class="btn-career-primary" onclick="window.openMentorApplicationModal()">
          Apply to Become a Mentor
        </button>
      </div>`;
    return;
  }

  const isAdmin = isCurrentUserAdmin();

  grid.innerHTML = allMentors.map(mentor => {
    const profile = mentor.profiles || {};
    const name = profile.name || profile.email || 'Registered Member';
    const initial = name.charAt(0).toUpperCase();

    const slots = Array.isArray(mentor.available_slots) ? mentor.available_slots : [];
    const expertiseList = (mentor.expertise || '').split(',').map(s => s.trim()).filter(Boolean);

    const slotBadgesHtml = slots.length > 0
      ? slots.map(slot => `<span class="slot-badge">${slot}</span>`).join('')
      : '<span style="font-size: 0.78rem; color: #94a3b8;">No open slots</span>';

    const tagsHtml = expertiseList.map(tag => `<span class="expertise-tag">${tag}</span>`).join('');

    let adminDeleteBtn = '';
    if (isAdmin) {
      adminDeleteBtn = `<button class="btn-mentor-delete" onclick="window.handleDeleteMentor('${mentor.id}', '${name.replace(/'/g, "\\'")}')">Remove</button>`;
    }

    return `
      <div class="mentor-card">
        <div class="mentor-header">
          <div class="mentor-avatar-circle">
            ${initial}
          </div>
          <div class="mentor-info">
            <div class="mentor-name">${name}</div>
            <div class="mentor-title">${mentor.title}</div>
            <div class="mentor-dept">${profile.dept ? profile.dept + ' Department' : profile.email || ''}</div>
          </div>
        </div>

        ${tagsHtml ? `<div class="mentor-expertise-tags">${tagsHtml}</div>` : ''}

        ${mentor.bio ? `<div class="mentor-bio-box">${mentor.bio}</div>` : ''}

        <div class="mentor-slots-section">
          <div class="mentor-slots-label">Available Slots</div>
          <div class="mentor-slots-list">${slotBadgesHtml}</div>
        </div>

        <div class="mentor-card-actions">
          <button class="btn-book-session" onclick="window.openBookAppointmentModal('${mentor.id}')">
            Book Guidance Session
          </button>
          ${adminDeleteBtn}
        </div>
      </div>
    `;
  }).join('');
}

function renderMyAppointments() {
  const feed = document.getElementById('myAppointmentsFeed');
  if (!feed) return;

  if (!currentSession?.user) {
    feed.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--text-muted);">
        Sign in to view your booked mentorship sessions.
      </div>`;
    return;
  }

  if (myAppointments.length === 0) {
    feed.innerHTML = `
      <div class="empty-state" style="width:100%;max-width:480px;margin:16px auto;">
        <h3 style="font-size:1.2rem;font-weight:700;color:#0f172a;margin-bottom:6px;">No Sessions Yet</h3>
        <p style="font-size:0.88rem;color:#64748b;margin-bottom:16px;line-height:1.5;">
          Go to <strong>Appointed Mentors</strong> tab and book a 1-on-1 guidance session.
        </p>
      </div>`;
    return;
  }

  feed.innerHTML = myAppointments.map(appt => {
    const isMentorBooking = appt.is_mentor_booking;
    const mentor = appt.mentors || {};
    const mentorProfile = mentor.profiles || {};
    const studentProfile = appt.student_profile || {};
    const bookedDate = appt.created_at
      ? new Date(appt.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '';

    if (isMentorBooking) {
      // ── Mentor view: incoming booking from a student ──
      const studentName = appt.student_name || studentProfile.name || appt.student_email || 'Student';
      const studentEmail = appt.student_email || studentProfile.email || '';
      const studentDept = studentProfile.dept ? `${studentProfile.dept}` : '';
      const initial = studentName.charAt(0).toUpperCase();
      const isCancelled = appt.status === 'cancelled';
      const isConfirmed = appt.status === 'confirmed';

      return `
        <div class="appointment-card" data-appt-id="${appt.id}" style="border-left:4px solid ${isCancelled ? '#ef4444' : isConfirmed ? '#10b981' : '#4f46e5'};">
          <div class="appointment-details">
            <div style="width:44px;height:44px;border-radius:50%;background:${isCancelled ? '#ef4444' : isConfirmed ? '#10b981' : '#4f46e5'};color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">${initial}</div>
            <div class="appointment-info" style="flex:1;">
              <div style="font-size:0.7rem;font-weight:700;color:${isCancelled ? '#ef4444' : isConfirmed ? '#10b981' : '#4f46e5'};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">
                Incoming Booking — ${isCancelled ? 'Withdrawn by Student' : 'You are the Mentor'}
              </div>
              <h4 style="font-size:0.98rem;font-weight:700;color:#0f172a;margin:0 0 4px;">
                ${studentName}${studentDept ? ` <span style="font-weight:400;font-size:0.8rem;color:#64748b;">(${studentDept})</span>` : ''}
              </h4>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:4px;">
                <span style="font-size:0.8rem;color:#334155;">⏰ <strong>${appt.slot_time}</strong></span>
                ${studentEmail ? `<span style="font-size:0.78rem;color:#64748b;">✉ ${studentEmail}</span>` : ''}
                ${bookedDate ? `<span style="font-size:0.72rem;color:#94a3b8;">Booked ${bookedDate}</span>` : ''}
              </div>
              <p style="font-size:0.78rem;color:#475569;margin:0;">Topic: <em>"${appt.guidance_topic || 'Career guidance'}"</em></p>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
            ${isConfirmed && appt.user_id ? `
            <button class="btn btn-xs" style="background:#0f172a;color:#ffffff;border:none;border-radius:6px;padding:5px 12px;font-size:0.75rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="window.openPeerChat('${appt.user_id}', '${studentName.replace(/'/g, "\\'")}', '${(studentProfile.username || 'student').replace(/'/g, "\\'")}')">💬 Chat with Student</button>
            ` : ''}
            ${studentEmail && !isCancelled ? `<a href="mailto:${studentEmail}?subject=Your Mentorship Session (${appt.slot_time})" class="btn btn-xs btn-secondary" style="text-decoration:none;">Contact Student</a>` : ''}
            ${!isCancelled && !isConfirmed ? `
            <button class="btn btn-xs" data-accept-btn style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:6px;padding:4px 12px;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;" onclick="window.handleAcceptAppointment('${appt.id}')">Accept</button>
            ` : isConfirmed ? `<span style="font-size:0.72rem;font-weight:700;color:#16a34a;background:#dcfce7;padding:3px 10px;border-radius:99px;border:1px solid #86efac;">Accepted</span>` : `<span style="font-size:0.72rem;font-weight:700;color:#dc2626;background:#fee2e2;padding:3px 10px;border-radius:99px;border:1px solid #fca5a5;">Cancelled</span>`}
            <button class="btn btn-xs" data-cancel-btn style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;padding:4px 10px;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;" onclick="window.handleCancelAppointment('${appt.id}')">${isCancelled ? 'Remove' : 'Cancel'}</button>
          </div>
        </div>
      `;
    } else {
      // ── Student view: session they booked ──
      const mentorName = mentor.name || mentorProfile.name || mentorProfile.email || 'Appointed Mentor';
      const mentorUserId = mentor.user_id || mentor.created_by;
      const initial = mentorName.charAt(0).toUpperCase();
      const isCancelled = appt.status === 'cancelled';
      const isPending = appt.status === 'pending';
      const isConfirmed = appt.status === 'confirmed';

      const statusColor = isConfirmed ? '#10b981' : isCancelled ? '#ef4444' : '#f59e0b';
      const statusBg = isConfirmed ? '#dcfce7' : isCancelled ? '#fee2e2' : '#fef3c7';
      const statusBorder = isConfirmed ? '#86efac' : isCancelled ? '#fca5a5' : '#fde68a';
      const statusLabel = isConfirmed ? 'Confirmed' : isCancelled ? 'Cancelled by Mentor' : 'Pending Mentor Approval';

      return `
        <div class="appointment-card" data-appt-id="${appt.id}" style="${isCancelled ? 'border-left: 4px solid #ef4444; opacity: 0.88;' : ''}">
          <div class="appointment-details">
            <div style="width:44px;height:44px;border-radius:50%;background:${isCancelled ? '#ef4444' : '#0f172a'};color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">${initial}</div>
            <div class="appointment-info" style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                <div style="font-size:0.7rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Your Booked Session</div>
                <span style="font-size:0.68rem;font-weight:700;color:${statusColor};background:${statusBg};padding:2px 8px;border-radius:99px;border:1px solid ${statusBorder};">${statusLabel}</span>
              </div>
              <h4 style="font-size:0.98rem;font-weight:700;color:#0f172a;margin:0 0 4px;">
                ${mentorName} <span style="font-weight:400;font-size:0.8rem;color:#64748b;">${mentor.title ? `— ${mentor.title}` : ''}</span>
              </h4>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:4px;">
                <span style="font-size:0.8rem;color:#334155;">⏰ <strong>${appt.slot_time}</strong></span>
                ${bookedDate ? `<span style="font-size:0.72rem;color:#94a3b8;">Booked ${bookedDate}</span>` : ''}
              </div>
              <p style="font-size:0.78rem;color:#475569;margin:0;">Topic: <em>"${appt.guidance_topic || 'Career guidance'}"</em></p>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
            ${isConfirmed && mentorUserId ? `
            <button class="btn btn-xs" style="background:#0f172a;color:#ffffff;border:none;border-radius:6px;padding:5px 12px;font-size:0.75rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="window.openPeerChat('${mentorUserId}', '${mentorName.replace(/'/g, "\\'")}', '${(mentorProfile.username || 'mentor').replace(/'/g, "\\'")}')">💬 Chat with Mentor</button>
            ` : ''}
            <button class="btn btn-xs" data-cancel-btn style="background:${isCancelled ? '#f1f5f9;color:#475569;border:1px solid #cbd5e1' : '#fee2e2;color:#991b1b;border:1px solid #fca5a5'};border-radius:6px;padding:4px 12px;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;" onclick="window.handleCancelAppointment('${appt.id}')">${isCancelled ? 'Dismiss' : 'Withdraw Session'}</button>
          </div>
        </div>
      `;
    }
  }).join('');
}

// Open Appoint Mentor Modal (Admin) — populates user select dropdown with registered platform users
window.openAppointMentorModal = async function (preselectedUserId = null) {
  if (!isCurrentUserAdmin()) {
    showToast('Access denied: Admin privileges required.', 'warning');
    return;
  }

  const selectEl = document.getElementById('mentorUserSelect');
  if (selectEl) {
    selectEl.innerHTML = '<option value="">Loading registered members...</option>';
  }

  openModal('appointMentorModal');

  try {
    const users = await store.getAllUsers();
    if (!users || users.length === 0) {
      if (selectEl) selectEl.innerHTML = '<option value="">No registered members found</option>';
      return;
    }

    if (selectEl) {
      selectEl.innerHTML = '<option value="">-- Choose User to Appoint as Mentor --</option>' +
        users.map(u => {
          const label = `${u.name || 'Unnamed'} (${u.email || u.roll || u.id}) - ${u.dept || 'Student'}`;
          const isSelected = preselectedUserId === u.id ? 'selected' : '';
          return `<option value="${u.id}" ${isSelected}>${label}</option>`;
        }).join('');
    }
  } catch (err) {
    console.error('Error loading users for mentor appointment:', err);
    showToast('Failed to load user list.', 'warning');
  }
};

// Appoint Mentor Form Handler (Admin)
async function handleAppointMentor(e) {
  e.preventDefault();
  const btn = document.getElementById('appointMentorSubmitBtn');
  setButtonLoading(btn, true);

  try {
    const userId = document.getElementById('mentorUserSelect').value;
    if (!userId) {
      throw new Error('Please select a registered platform member to appoint.');
    }

    await store.createMentor({
      userId,
      title: document.getElementById('mentorTitle').value.trim(),
      expertise: document.getElementById('mentorExpertise').value.trim(),
      bio: document.getElementById('mentorBio').value.trim(),
      available_slots: document.getElementById('mentorSlots').value.trim()
    });

    closeModal('appointMentorModal');
    document.getElementById('appointMentorForm').reset();
    showToast('Platform member appointed as Mentor successfully! 🎓', 'success');
    await loadCareerData();
  } catch (err) {
    console.error('Failed to appoint mentor:', err);
    showToast(err.message || 'Failed to appoint mentor.', 'warning');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ─── Student Apply for Mentorship Controllers ──────────────────────────────

async function openApplyMentorModal() {
  if (!currentSession) {
    openModal('authModal');
    showToast('Please log in to apply for mentorship.', 'info');
    return;
  }

  const withdrawBtn = document.getElementById('withdrawMentorAppBtn');
  const app = await store.getUserMentorApplication(currentSession.user.id);

  if (app && app.status === 'pending') {
    if (withdrawBtn) withdrawBtn.classList.remove('hidden');
    document.getElementById('applyMentorTitle').value = app.title || '';
    document.getElementById('applyMentorExpertise').value = app.expertise || '';
    document.getElementById('applyMentorBio').value = app.bio || '';
    document.getElementById('applyMentorSlots').value = Array.isArray(app.available_slots) ? app.available_slots.join(', ') : (app.available_slots || '');
  } else {
    if (withdrawBtn) withdrawBtn.classList.add('hidden');
  }

  openModal('applyMentorModal');
}

async function handleApplyMentor(e) {
  e.preventDefault();
  const btn = document.getElementById('applyMentorSubmitBtn');
  setButtonLoading(btn, true);

  try {
    await store.submitMentorApplication({
      title: document.getElementById('applyMentorTitle').value.trim(),
      expertise: document.getElementById('applyMentorExpertise').value.trim(),
      bio: document.getElementById('applyMentorBio').value.trim(),
      available_slots: document.getElementById('applyMentorSlots').value.trim()
    });

    closeModal('applyMentorModal');
    document.getElementById('applyMentorForm').reset();
    showToast('Application submitted! Admin will review your profile. 🎓', 'success');
    await Promise.all([loadCareerData(), loadAdminMentorApps()]);
  } catch (err) {
    console.error('Failed to submit mentor application:', err);
    showToast(err.message || 'Failed to submit application.', 'warning');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function handleWithdrawMentorApp() {
  if (!currentSession?.user?.id) return;
  if (!confirm('Are you sure you want to withdraw your mentorship application?')) return;

  const btn = document.getElementById('withdrawMentorAppBtn');
  if (btn) setButtonLoading(btn, true);

  try {
    await store.withdrawMentorApplication(currentSession.user.id);
    closeModal('applyMentorModal');
    document.getElementById('applyMentorForm').reset();
    showToast('Mentorship application withdrawn. 🚫', 'info');
    await Promise.all([loadCareerData(), loadAdminMentorApps()]);
  } catch (err) {
    console.error('Error withdrawing application:', err);
    showToast(err.message || 'Failed to withdraw application.', 'warning');
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

// ─── Admin Mentorship Applications Manager ──────────────────────────────────

async function loadAdminMentorApps() {
  const tbody = document.getElementById('adminAppsTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 24px;">Loading applications...</td></tr>';
  }
  try {
    allAdminMentorApps = await store.getMentorApplications();
    renderAdminMentorApps();
  } catch (err) {
    console.error('Error loading mentor applications:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 24px;">Applications table not initialized yet. Run <code>apply_mentor_setup.sql</code> in Supabase SQL Editor.</td></tr>`;
    }
  }
}

function renderAdminMentorApps() {
  const tbody = document.getElementById('adminAppsTableBody');
  const badge = document.getElementById('mentorAppsBadge');
  if (!tbody) return;

  // Update pending applications badge
  const pendingCount = (allAdminMentorApps || []).filter(a => a.status === 'pending').length;
  if (badge) {
    badge.textContent = pendingCount;
    badge.classList.toggle('hidden', pendingCount === 0);
  }

  const statusFilter = document.getElementById('mentorAppsStatusFilter')?.value || 'ALL';
  const filteredApps = (allAdminMentorApps || []).filter(app => {
    if (statusFilter === 'ALL') return true;
    return app.status === statusFilter;
  });

  if (filteredApps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 24px;">No ${statusFilter !== 'ALL' ? statusFilter : ''} mentorship applications found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredApps.map((app, idx) => {
    const p = app.profiles || {};
    const name = p.name || 'Unnamed Applicant';
    const email = p.email || 'No Email';
    const roll = p.roll || '—';
    const dept = p.dept || '—';
    const year = p.year || '—';
    const phone = p.phone || '—';
    const bio = app.bio || '—';
    const status = app.status || 'pending';
    const statusClass = status === 'approved' ? 'active' : status === 'rejected' ? 'banned' : 'blocked';
    const slots = Array.isArray(app.available_slots) ? app.available_slots.join(', ') : (app.available_slots || 'N/A');

    const createdDate = app.created_at ? new Date(app.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

    let actionsHtml = '';
    if (status === 'pending') {
      actionsHtml = `
        <div class="user-action-group" style="justify-content:center;">
          <button class="btn btn-xs btn-success" onclick="window.handleApproveMentorApp('${app.id}')" title="Approve & Appoint">✅ Approve</button>
          <button class="btn btn-xs btn-danger" onclick="window.handleRejectMentorApp('${app.id}')" title="Reject Application">❌ Decline</button>
        </div>`;
    } else {
      actionsHtml = `<span style="font-size:0.75rem;color:var(--text-muted);font-style:italic;">${status === 'approved' ? 'Approved' : 'Declined'}</span>`;
    }

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <div style="font-weight: 700; color: var(--text-dark);">${name}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${email}</div>
        </td>
        <td>
          <div style="font-weight: 600; font-size: 0.8rem;">${roll}</div>
          <div style="font-size: 0.73rem; color: var(--text-muted);">${dept} (${year})</div>
        </td>
        <td style="font-size: 0.8rem;">${phone}</td>
        <td>
          <div style="font-weight: 600; font-size: 0.85rem;">${app.title}</div>
        </td>
        <td>
          <span style="font-size: 0.78rem; font-weight: 600; color: var(--orange);">${app.expertise}</span>
        </td>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${slots}</td>
        <td style="font-size: 0.75rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${bio.replace(/"/g, '&quot;')}">${bio}</td>
        <td style="font-size: 0.78rem; color: var(--text-muted);">${createdDate}</td>
        <td>
          <span class="status-pill ${statusClass}">${status}</span>
        </td>
        <td style="text-align: center;">
          ${actionsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

window.handleApproveMentorApp = async function(appId) {
  try {
    showToast('Approving application & appointing mentor...', 'info');
    await store.approveMentorApplication(appId);
    showToast('Application approved! Member appointed as mentor 🎓', 'success');
    await Promise.all([loadAdminMentorApps(), loadCareerData()]);
  } catch (err) {
    console.error('Failed to approve mentor application:', err);
    showToast(err.message || 'Failed to approve application.', 'warning');
  }
};

window.handleRejectMentorApp = async function(appId) {
  try {
    showToast('Updating application...', 'info');
    await store.rejectMentorApplication(appId);
    showToast('Application rejected.', 'info');
    await loadAdminMentorApps();
  } catch (err) {
    console.error('Failed to reject mentor application:', err);
    showToast(err.message || 'Failed to reject application.', 'warning');
  }
};

// ─── Admin Ticket Pass Verification & Search ────────────────────────────────
async function handleVerifyTicketSearch(e) {
  if (e) e.preventDefault();
  const inputEl = document.getElementById('adminTicketInput');
  const resultEl = document.getElementById('ticketSearchResult');
  if (!inputEl || !resultEl) return;

  const rawInput = inputEl.value.trim();
  if (!rawInput) return;

  // Clean input e.g. CX-F9FA7B-0000- -> CX-F9FA7B-0000
  const ticketCode = rawInput.toUpperCase().replace(/-+$/, '');

  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <div style="padding:24px; text-align:center; color:var(--text-muted);">
      ⏳ Verifying ticket pass <strong>${ticketCode}</strong> across all campus events...
    </div>`;

  try {
    // Extract ticket components: CX-XXXXXX-YYYY
    const parts = ticketCode.split('-').filter(Boolean);
    let targetEvent = null;
    let rollQuery = '';

    if (parts.length >= 2 && parts[0] === 'CX') {
      const eventPrefix = parts[1].toLowerCase();
      rollQuery = parts[2] || '';
      targetEvent = allEvents.find(evt => evt.id.toLowerCase().startsWith(eventPrefix));
    } else {
      // Partial code match - search all events
      targetEvent = allEvents.find(evt => evt.id.toLowerCase().includes(ticketCode.toLowerCase()));
    }

    const candidateEvents = targetEvent ? [targetEvent] : allEvents;
    let foundMatch = null;

    for (const evt of candidateEvents) {
      const roster = await store.getEventRosterWithEmails(evt.id);
      for (const row of roster) {
        const p = row.profiles || {};
        const evtPrefix = evt.id.slice(0, 6).toUpperCase();
        const rollSuffix = (p.roll || '0000').slice(-4);
        const generatedCode = `CX-${evtPrefix}-${rollSuffix}`;

        const isExactMatch = generatedCode === ticketCode;
        const isRollMatch = rollQuery && (p.roll || '').toUpperCase().endsWith(rollQuery.toUpperCase());
        const isPartialMatch = generatedCode.toLowerCase().includes(rawInput.toLowerCase());

        if (isExactMatch || (isRollMatch && targetEvent) || isPartialMatch) {
          foundMatch = { evt, row, generatedCode };
          break;
        }
      }
      if (foundMatch) break;
    }

    if (!foundMatch) {
      resultEl.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fca5a5; border-radius:12px; padding:20px; text-align:center; color:#991b1b;">
          <div style="font-size:2rem; margin-bottom:8px;">❌</div>
          <h4 style="margin:0 0 4px; font-weight:800;">Ticket Pass Not Found</h4>
          <p style="margin:0; font-size:0.85rem; color:#b91c1c;">
            No enrolled student match found for ticket code <code>${rawInput}</code>. Please verify the ticket code and try again.
          </p>
        </div>`;
      return;
    }

    const { evt, row, generatedCode } = foundMatch;
    const p = row.profiles || {};
    const enrolledAt = row.enrolled_at ? new Date(row.enrolled_at) : null;
    const dateStr = enrolledAt ? enrolledAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
    const timeStr = enrolledAt ? enrolledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : 'N/A';
    const eventDateStr = evt.date ? new Date(evt.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';

    const checkInRecord = store.getTicketCheckInStatus(generatedCode);
    const isCheckedIn = !!checkInRecord;
    const checkInTimeStr = isCheckedIn ? new Date(checkInRecord.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

    resultEl.innerHTML = `
      <div style="background:#ffffff; border:1.5px solid ${isCheckedIn ? '#22c55e' : '#3b82f6'}; border-radius:16px; padding:24px; box-shadow:var(--shadow-md);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border); padding-bottom:16px; margin-bottom:16px;">
          <div>
            <span style="background:${isCheckedIn ? '#22c55e' : '#3b82f6'}; color:#fff; font-size:0.75rem; font-weight:800; padding:4px 12px; border-radius:99px; letter-spacing:0.5px; text-transform:uppercase;">
              ${isCheckedIn ? `✅ CHECKED-IN AT ${checkInTimeStr}` : '🎟️ VERIFIED TICKET PASS — READY FOR ENTRY'}
            </span>
            <h3 style="margin:8px 0 0; font-size:1.3rem; font-weight:900; color:var(--text-dark); font-family:monospace;">
              ${generatedCode}
            </h3>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button id="btnDoCheckInTicket" class="btn ${isCheckedIn ? 'btn-secondary' : 'btn-primary'}" style="${isCheckedIn ? '' : 'background:#22c55e; border-color:#16a34a; font-weight:800;'}">
              ${isCheckedIn ? '✅ Student Registered & Present' : '⚡ Register Check-in (Mark Present)'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="window.openRosterModal('${evt.id}')">👥 Event Roster</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:20px;">
          <!-- Student Information -->
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px;">
            <h4 style="margin:0 0 12px; font-size:0.85rem; font-weight:800; color:#15803d; text-transform:uppercase; letter-spacing:0.5px;">
              👤 Student Profile Details
            </h4>
            <div style="display:flex; flex-direction:column; gap:8px; font-size:0.88rem;">
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Full Name:</span> <strong style="color:var(--text-dark);">${p.name || '—'}</strong></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Roll / Student ID:</span> <strong>${p.roll || '—'}</strong></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Department / Year:</span> <span>${p.dept || 'General'} (${p.year || '1st Year'})</span></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Email Address:</span> <span>${p.email || '—'}</span></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Phone Number:</span> <span>${p.phone || '—'}</span></div>
            </div>
          </div>

          <!-- Event Information -->
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px;">
            <h4 style="margin:0 0 12px; font-size:0.85rem; font-weight:800; color:#15803d; text-transform:uppercase; letter-spacing:0.5px;">
              📅 Event Enrollment Information
            </h4>
            <div style="display:flex; flex-direction:column; gap:8px; font-size:0.88rem;">
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Event Title:</span> <strong style="color:var(--text-dark);">${evt.title}</strong></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Venue Location:</span> <span>📍 ${evt.venue}</span></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Event Schedule:</span> <span>${eventDateStr}</span></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Enrolled On:</span> <span style="color:#15803d; font-weight:600;">${dateStr} at ${timeStr}</span></div>
              <div><span style="color:var(--text-muted); font-size:0.78rem;">Check-in Status:</span> <strong style="color:${isCheckedIn ? '#16a34a' : '#d97706'};">${isCheckedIn ? `✅ Registered (${checkInTimeStr})` : '⏳ Pending Entry'}</strong></div>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('btnDoCheckInTicket')?.addEventListener('click', async () => {
      if (isCheckedIn) return;
      await store.registerTicketCheckIn(generatedCode, evt.id, p.id);
      showToast(`Student ${p.name || generatedCode} successfully registered & checked-in! 🎉`, 'success');
      handleVerifyTicketSearch();
    });
  } catch (err) {
    console.error('Ticket search error:', err);
    resultEl.innerHTML = `
      <div style="background:#fef2f2; border:1px solid #fca5a5; border-radius:12px; padding:16px; color:#991b1b;">
        Error verifying ticket: ${err.message}
      </div>`;
  }
}



// Open Booking Modal for Student
window.openBookAppointmentModal = function (mentorId) {
  if (!currentSession) {
    openModal('authModal');
    showToast('Please log in to book a mentorship appointment.', 'info');
    return;
  }

  const mentor = allMentors.find(m => m.id === mentorId);
  if (!mentor) return;

  const mentorProfile = mentor.profiles || {};
  const mentorName = mentorProfile.name || mentorProfile.email || 'Appointed Mentor';
  const initial = mentorName.charAt(0).toUpperCase();

  document.getElementById('bookMentorId').value = mentorId;
  const summaryEl = document.getElementById('bookMentorSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="avatar" style="width: 44px; height: 44px; font-size: 1rem;">${initial}</div>
      <div>
        <div style="font-weight: 800; font-family: var(--font-heading);">${mentorName}</div>
        <div style="font-size: 0.8rem; color: var(--gold);">${mentor.title}</div>
      </div>
    `;
  }

  const slotsSelect = document.getElementById('bookSlotSelect');
  const slots = Array.isArray(mentor.available_slots) ? mentor.available_slots : [];
  if (slotsSelect) {
    if (slots.length === 0) {
      slotsSelect.innerHTML = '<option value="">No open slots available for this mentor</option>';
    } else {
      slotsSelect.innerHTML = '<option value="">-- Select a Time Slot --</option>' +
        slots.map(s => `<option value="${s}">${s}</option>`).join('');
    }
  }

  openModal('bookAppointmentModal');
};

// Book Appointment Form Handler (Student)
async function handleBookAppointment(e) {
  e.preventDefault();
  const btn = document.getElementById('bookAppointmentSubmitBtn');
  setButtonLoading(btn, true);

  try {
    const mentorId = document.getElementById('bookMentorId').value;
    const slotTime = document.getElementById('bookSlotSelect').value;
    const topic = document.getElementById('bookTopic').value.trim();
    const studentName = currentProfile?.name || currentSession?.user?.email;

    if (!slotTime) {
      showToast('Please select a time slot.', 'warning');
      setButtonLoading(btn, false);
      return;
    }

    const booked = await store.bookAppointment({
      mentorId,
      slotTime,
      guidanceTopic: topic,
      studentName
    });

    closeModal('bookAppointmentModal');
    document.getElementById('bookAppointmentForm').reset();

    // ── Immediately add the booked appointment to the in-memory list
    //    so it renders without waiting for a DB round-trip (which RLS may block)
    const mentor = allMentors.find(m => m.id === mentorId) || {};
    const immediateAppt = {
      ...booked,
      mentor_id: mentorId,
      is_mentor_booking: false,
      mentors: {
        ...mentor,
        profiles: mentor.profiles || { name: mentor.name || 'Appointed Mentor', email: '' }
      },
      student_profile: {
        name: currentProfile?.name || '',
        email: currentSession?.user?.email || ''
      }
    };

    // Prepend to myAppointments (avoid duplicates)
    if (!myAppointments.some(a => a.id === immediateAppt.id)) {
      myAppointments = [immediateAppt, ...myAppointments];
    }

    // Switch to "My Sessions" tab so user sees the booking
    switchCareerSubTab('appointments');

    showToast('Session booked! View it in "My Sessions" tab below.', 'success');

    // Background reload to sync from DB
    loadCareerData().catch(() => {});
  } catch (err) {
    console.error('Failed to book appointment:', err);
    showToast(err.message || 'Failed to book appointment.', 'warning');
  } finally {
    setButtonLoading(btn, false);
  }
}

// Global Handler to Delete Mentor (Admin)
window.handleDeleteMentor = async function (mentorId, mentorName) {
  if (!confirm(`Are you sure you want to remove mentor "${mentorName}"?`)) return;
  try {
    showToast('Removing mentor...', 'info');
    await store.deleteMentor(mentorId);
    showToast(`Mentor ${mentorName} removed.`, 'success');
    await loadCareerData();
  } catch (err) {
    console.error('Failed to remove mentor:', err);
    showToast(err.message || 'Failed to remove mentor.', 'warning');
  }
};

// Global Handler to Accept a Booking (Mentor)
window.handleAcceptAppointment = async function (appointmentId) {
  try {
    // Immediately update status in memory so button switches to Accepted
    myAppointments = myAppointments.map(a =>
      a.id === appointmentId ? { ...a, status: 'confirmed' } : a
    );
    renderMyAppointments();

    await store.acceptAppointment(appointmentId);
    showToast('Session accepted! The student has been confirmed.', 'success');
  } catch (err) {
    console.error('Failed to accept appointment:', err);
    showToast(err.message || 'Failed to accept session.', 'warning');
    loadCareerData().catch(() => {});
  }
};

// Global Handler to Withdraw / Cancel / Dismiss a Booked Session
window.handleCancelAppointment = async function (appointmentId) {
  const appt = myAppointments.find(a => a.id === appointmentId);
  const isAlreadyCancelled = appt && appt.status === 'cancelled';

  // If already cancelled, dismiss/remove it immediately without two-tap delay
  if (isAlreadyCancelled) {
    myAppointments = myAppointments.filter(a => a.id !== appointmentId);
    renderMyAppointments();
    try {
      await store.deleteAppointment(appointmentId);
      showToast('Session record removed.', 'info');
    } catch (err) {
      console.warn('Error deleting appointment:', err);
    }
    return;
  }

  // Show a clean inline confirmation for active bookings
  const card = document.querySelector(`[data-appt-id="${appointmentId}"]`);
  if (card && !card.dataset.confirmPending) {
    card.dataset.confirmPending = 'true';
    const cancelBtn = card.querySelector('[data-cancel-btn]');
    if (cancelBtn) {
      const originalText = cancelBtn.textContent;
      cancelBtn.textContent = 'Tap again to confirm';
      cancelBtn.style.background = '#dc2626';
      cancelBtn.style.color = '#fff';
      setTimeout(() => {
        if (card.dataset.confirmPending) {
          delete card.dataset.confirmPending;
          if (cancelBtn) {
            cancelBtn.textContent = originalText;
            cancelBtn.style.background = '';
            cancelBtn.style.color = '';
          }
        }
      }, 3000);
    }
    return;
  }

  // Second tap — confirmed, proceed with cancellation / withdrawal
  if (card) delete card.dataset.confirmPending;

  try {
    // Immediately update status to 'cancelled' in memory so UI reflects withdrawal right away
    myAppointments = myAppointments.map(a =>
      a.id === appointmentId ? { ...a, status: 'cancelled' } : a
    );
    renderMyAppointments();

    await store.cancelAppointment(appointmentId);
    showToast('Session withdrawn / cancelled.', 'info');
  } catch (err) {
    console.error('Failed to cancel appointment:', err);
    showToast(err.message || 'Failed to cancel session.', 'warning');
    loadCareerData().catch(() => {});
  }
};

// ─── Social Hub & Friends Controllers ──────────────────────────────────────

async function openSocialModal() {
  const authorName = currentProfile?.name || currentSession?.user?.email || 'Guest Student';
  const authorNotice = document.getElementById('postAuthorName');
  if (authorNotice) authorNotice.textContent = authorName;

  switchTab('social');
}

async function loadSocialPosts() {
  const feed = document.getElementById('socialPostsFeed');
  if (!feed) return;

  try {
    const posts = await store.getSocialPosts();
    renderSocialPosts(posts);
  } catch (err) {
    console.error('Error loading social posts:', err);
    feed.innerHTML = `<div style="text-align:center;color:var(--red);padding:24px;">Failed to load campus feed.</div>`;
  }
}

let currentUploadedMediaData = '';  // public URL or base64 fallback
let currentUploadedFile = null;     // the actual File object

function clearUploadedMedia() {
  currentUploadedMediaData = '';
  currentUploadedFile = null;
  const fileInput = document.getElementById('postMediaFile');
  if (fileInput) fileInput.value = '';
  const previewContainer = document.getElementById('postMediaPreview');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    previewContainer.style.display = 'none';
  }
}

function renderPostMediaHtml(mediaUrl) {
  if (!mediaUrl) return '';
  const url = mediaUrl.trim();
  const clean = url.toLowerCase().split('?')[0];

  // Data URL or file video check (.mp4, .webm, .mov, .ogg or data:video/)
  const isVideo = url.startsWith('data:video/') || 
                  clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov') || clean.endsWith('.ogg') ||
                  url.includes('/post-media/') && (url.includes('.mp4') || url.includes('.webm') || url.includes('.mov') || url.includes('video'));

  if (isVideo) {
    return `
      <div style="width:100%;max-height:420px;border-radius:12px;overflow:hidden;background:#000;margin-top:8px;">
        <video controls preload="metadata" playsinline style="width:100%;max-height:420px;object-fit:contain;display:block;">
          <source src="${url}">
          Your browser does not support the video tag.
        </video>
      </div>`;
  }

  // YouTube Link check
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    let ytId = '';
    if (url.includes('youtu.be/')) {
      ytId = url.split('youtu.be/')[1]?.split('?')[0];
    } else if (url.includes('v=')) {
      ytId = url.split('v=')[1]?.split('&')[0];
    }
    if (ytId) {
      return `
        <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin-top:8px;background:#000;">
          <iframe src="https://www.youtube.com/embed/${ytId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe>
        </div>`;
    }
  }

  // Default Image Rendering
  return `
    <div style="width:100%;max-height:450px;border-radius:12px;overflow:hidden;background:#f0f0f0;margin-top:8px;">
      <img src="${url}" alt="Post media" style="width:100%;max-height:450px;object-fit:cover;display:block;" onerror="this.parentElement.style.display='none';" />
    </div>`;
}

function renderSocialPosts(posts) {
  const feed = document.getElementById('socialPostsFeed');
  if (!feed) return;

  if (!posts || posts.length === 0) {
    feed.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:32px;background:#fff;border-radius:12px;border:1px dashed var(--border);">No posts on the campus feed yet. Share photos, videos, or updates with your peers!</div>`;
    return;
  }

  const currentUserId = currentSession?.user?.id || 'guest';
  const isAdmin = isCurrentUserAdmin();

  feed.innerHTML = posts.map(post => {
    const isLiked = Array.isArray(post.liked_by) && post.liked_by.includes(currentUserId);
    const dateStr = post.created_at ? new Date(post.created_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Just now';

    const isMyPost = post.user_id && post.user_id === currentUserId;
    const canDelete = isMyPost || isAdmin;

    return `
      <div class="social-post-card" data-post-id="${post.id}">
        <div class="social-post-header" style="display:flex;align-items:center;justify-content:space-between;">
          <div class="social-post-author">
            <div class="avatar" style="width:36px;height:36px;font-size:0.85rem;">
              ${(post.author_name || 'S').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:800;font-family:var(--font-heading);font-size:0.92rem;color:var(--text-dark);">
                ${post.author_name || 'Campus Member'}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);">
                ${post.author_dept || 'Engineering'} • ${dateStr}
              </div>
            </div>
          </div>
          ${canDelete ? `
          <button class="btn btn-ghost btn-xs" data-delete-btn title="Delete Post" style="color:#ef4444;font-size:0.78rem;padding:4px 8px;border-radius:6px;transition:all 0.2s;" onclick="window.handleDeletePost('${post.id}')">🗑️ Delete</button>
          ` : ''}
        </div>

        ${post.content ? `
        <p style="font-size:0.9rem;color:var(--text-primary);line-height:1.5;margin:8px 0 4px;white-space:pre-line;">
          ${post.content}
        </p>
        ` : ''}

        ${renderPostMediaHtml(post.image)}

        <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border-light);padding-top:10px;margin-top:6px;">
          <button class="btn btn-ghost btn-sm" onclick="window.handleToggleLikePost('${post.id}')" style="font-size:0.82rem;gap:5px;">
            <span>${isLiked ? '❤️' : '🤍'}</span>
            <span>${post.likes_count || 0} Likes</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Global Handler to Delete a User's Post
window.handleDeletePost = async function (postId) {
  const card = document.querySelector(`[data-post-id="${postId}"]`);
  if (card && !card.dataset.confirmPending) {
    card.dataset.confirmPending = 'true';
    const delBtn = card.querySelector('[data-delete-btn]');
    if (delBtn) {
      const origText = delBtn.innerHTML;
      delBtn.innerHTML = 'Tap again to confirm delete';
      delBtn.style.color = '#dc2626';
      delBtn.style.fontWeight = '700';
      setTimeout(() => {
        if (card.dataset.confirmPending) {
          delete card.dataset.confirmPending;
          if (delBtn) {
            delBtn.innerHTML = origText;
            delBtn.style.color = '#ef4444';
            delBtn.style.fontWeight = 'normal';
          }
        }
      }, 3000);
    }
    return;
  }

  if (card) delete card.dataset.confirmPending;

  try {
    await store.deleteSocialPost(postId);
    showToast('Post deleted permanently.', 'info');
    await loadSocialPosts();
  } catch (err) {
    console.error('Failed to delete post:', err);
    showToast(err.message || 'Failed to delete post.', 'warning');
    await loadSocialPosts();
  }
};

async function handleCreatePost(e) {
  e.preventDefault();
  const btn = document.getElementById('submitPostBtn');
  setButtonLoading(btn, true);

  try {
    const content = document.getElementById('postContent').value.trim();

    if (!content && !currentUploadedFile) {
      showToast('Please attach a photo/video or write text to share a post.', 'warning');
      setButtonLoading(btn, false);
      return;
    }

    // Upload media to Supabase Storage if a file was selected
    let mediaUrl = '';
    if (currentUploadedFile) {
      showToast('Processing media...', 'info');
      try {
        const uploaded = await store.uploadPostMedia(currentUploadedFile);
        if (uploaded) {
          mediaUrl = uploaded;
        }
      } catch (err) {
        console.warn('Storage upload error, using Data URL fallback:', err);
      }

      // If Supabase Storage is not configured or fails, fallback to Data URL for instant rendering & playback
      if (!mediaUrl) {
        try {
          mediaUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = ev => resolve(ev.target.result);
            reader.onerror = err => reject(err);
            reader.readAsDataURL(currentUploadedFile);
          });
        } catch (readErr) {
          console.error('Failed to read file:', readErr);
          showToast('Failed to process video file.', 'warning');
          setButtonLoading(btn, false);
          return;
        }
      }
    }

    const authorName = currentProfile?.name || currentSession?.user?.email || 'Anonymous Student';
    const authorDept = currentProfile?.dept || 'Engineering';
    const authorYear = currentProfile?.year || 'Student';

    await store.createSocialPost({
      type: 'post',
      content: content || '',
      image: mediaUrl,
      authorName,
      authorDept,
      authorYear
    });

    document.getElementById('createPostForm').reset();
    clearUploadedMedia();
    closeModal('createPostModal');
    showToast('Post published to campus feed! ✨', 'success');
    await loadSocialPosts();
  } catch (err) {
    console.error('Failed to create post:', err);
    showToast(err.message || 'Failed to publish post.', 'warning');
  } finally {
    setButtonLoading(btn, false);
  }
}

window.handleToggleLikePost = async function(postId) {
  try {
    const currentUserId = currentSession?.user?.id || 'guest';
    await store.toggleLikePost(postId, currentUserId);
    await loadSocialPosts();
  } catch (err) {
    console.error('Like error:', err);
  }
};

async function handleSocialUserSearch() {
  const query = (document.getElementById('socialUserSearchInput')?.value || '').toLowerCase().trim();
  const resultsContainer = document.getElementById('socialSearchResults');
  const headerEl = document.getElementById('socialSearchHeader');
  if (!resultsContainer) return;

  if (headerEl) {
    headerEl.innerHTML = query 
      ? `<span>🔍 Search Results</span> <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">Matching Students</span>`
      : `<span>🤝 Suggested Peers &amp; Mutual Connections</span> <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">Campus Student Roster</span>`;
  }

  try {
    const allUsers = store.getAllUsers ? await store.getAllUsers() : [];
    const currentUserId = currentSession?.user?.id;
    const myDept = currentProfile?.dept || '';

    const filtered = allUsers.filter(u => {
      if (u.id === currentUserId) return false;
      if (!query) return true;
      const name = (u.name || '').toLowerCase();
      const username = (u.username || (u.email ? u.email.split('@')[0] : '')).toLowerCase();
      const email = (u.email || '').toLowerCase();
      const roll = (u.roll || '').toLowerCase();
      const dept = (u.dept || '').toLowerCase();
      const cleanQ = query.replace(/^@/, '');
      return username.includes(cleanQ) || name.includes(cleanQ) || email.includes(cleanQ) || roll.includes(cleanQ) || dept.includes(cleanQ);
    });

    if (!query && myDept) {
      filtered.sort((a, b) => (b.dept === myDept ? 1 : 0) - (a.dept === myDept ? 1 : 0));
    }

    renderSocialSearchResults(filtered);
  } catch (err) {
    console.error('User search error:', err);
  }
}

window.switchSocialTab = function(tabName) {
  document.querySelectorAll('.social-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.socialTab === tabName);
  });

  const feedTab = document.getElementById('socialFeedTab');
  const searchTab = document.getElementById('socialSearchTab');
  const friendsTab = document.getElementById('socialFriendsTab');

  if (feedTab) {
    feedTab.classList.toggle('active', tabName === 'feed');
    feedTab.style.setProperty('display', tabName === 'feed' ? 'flex' : 'none', 'important');
  }
  if (searchTab) {
    searchTab.classList.toggle('active', tabName === 'search');
    searchTab.style.setProperty('display', tabName === 'search' ? 'flex' : 'none', 'important');
  }
  if (friendsTab) {
    friendsTab.classList.toggle('active', tabName === 'friends');
    friendsTab.style.setProperty('display', tabName === 'friends' ? 'flex' : 'none', 'important');
  }

  if (tabName === 'feed') loadSocialPosts();
  if (tabName === 'search') handleSocialUserSearch();
  if (tabName === 'friends') loadFriendsAndRequests();
};

async function renderSocialSearchResults(users) {
  const container = document.getElementById('socialSearchResults');
  if (!container) return;

  if (users.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 24px;">No students found matching your search term.</p>`;
    return;
  }

  const friendRequests = await store.getFriendRequests();
  const currentUserId = String(currentSession?.user?.id || '').toLowerCase();
  const currentEmail = String(currentSession?.user?.email || '').toLowerCase();

  container.innerHTML = users.map(user => {
    const name = user.name || user.email || 'Campus Member';
    const initial = name.charAt(0).toUpperCase();
    const userId = String(user.id || '').toLowerCase();
    const userEmail = String(user.email || '').toLowerCase();

    const req = friendRequests.find(r => {
      const sId = String(r.sender_id || '').toLowerCase();
      const rId = String(r.receiver_id || '').toLowerCase();
      return (sId === currentUserId && (rId === userId || rId === userEmail)) ||
             (rId === currentUserId && (sId === userId || sId === userEmail)) ||
             (sId === currentEmail && (rId === userId || rId === userEmail)) ||
             (rId === currentEmail && (sId === userId || sId === userEmail));
    });

    const iSentThis = req && (
      String(req.sender_id || '').toLowerCase() === currentUserId ||
      String(req.sender_id || '').toLowerCase() === currentEmail
    );

    const isMutualDept = currentProfile?.dept && user.dept === currentProfile.dept;
    const badgeTag = isMutualDept ? `<span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-size:0.68rem; margin-left:6px;">✨ Same Dept</span>` : '';

    let btnHtml = '';
    if (req) {
      if (req.status === 'accepted') {
        btnHtml = `<button class="btn btn-secondary btn-sm" disabled style="color:var(--green);">✅ Friends</button>`;
      } else if (req.status === 'pending') {
        if (iSentThis) {
          btnHtml = `<button class="btn btn-secondary btn-sm" onclick="window.handleWithdrawFriendReq('${req.receiver_id || user.id}')" style="color:#d97706; border-color:#fde68a;">⏳ Pending (Withdraw)</button>`;
        } else {
          btnHtml = `<button class="btn btn-primary btn-sm" onclick="window.handleAcceptFriendReq('${req.id}')">Accept Request ✓</button>`;
        }
      }
    } else {
      btnHtml = `<button class="btn btn-primary btn-sm" onclick="window.handleSendFriendReq('${user.id}', '${name.replace(/'/g, "\\'")}', '${(user.email||'').replace(/'/g, "\\'")}', '${(user.username||'').replace(/'/g, "\\'")}')">➕ Add Friend</button>`;
    }

    return `
      <div class="social-user-card">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar" style="width:38px;height:38px;font-size:0.9rem;">${initial}</div>
          <div>
            <div style="font-weight:700;font-family:var(--font-heading);color:var(--text-dark);">
              ${name} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">@${user.username || (user.email ? user.email.split('@')[0] : 'user')}</span>
              ${badgeTag}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${user.dept || 'Department'} • ${user.year || 'Student'} ${user.roll ? `(${user.roll})` : ''}</div>
          </div>
        </div>
        <div>
          ${btnHtml}
        </div>
      </div>
    `;
  }).join('');
}

window.handleSendFriendReq = async function(targetUserId, targetUserName, targetUserEmail, targetUsername) {
  try {
    const senderProfile = currentProfile || { 
      id: currentSession?.user?.id || 'current-user', 
      name: currentSession?.user?.email,
      email: currentSession?.user?.email 
    };
    const receiverUserObj = {
      id: targetUserId,
      name: targetUserName,
      email: targetUserEmail,
      username: targetUsername
    };
    await store.sendFriendRequest(receiverUserObj, senderProfile);
    socialSyncChannel?.postMessage({ type: 'FRIEND_REQUEST_UPDATED' });
    showToast(`Friend request sent to ${targetUserName}! 👥`, 'success');
    await loadFriendsAndRequests();
    handleSocialUserSearch();
  } catch (err) {
    showToast(err.message || 'Could not send friend request.', 'warning');
  }
};

window.handleWithdrawFriendReq = async function(targetUserId) {
  try {
    await store.withdrawFriendRequest(targetUserId);
    socialSyncChannel?.postMessage({ type: 'FRIEND_REQUEST_UPDATED' });
    showToast('Friend request withdrawn.', 'info');
    await loadFriendsAndRequests();
    handleSocialUserSearch();
  } catch (err) {
    showToast(err.message || 'Could not withdraw friend request.', 'warning');
  }
};

// Broadcast Channel for Real-time Social Sync across tabs/windows
const socialSyncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cx_social_sync_v1') : null;
if (socialSyncChannel) {
  socialSyncChannel.onmessage = (event) => {
    if (event.data?.type === 'FRIEND_REQUEST_UPDATED') {
      loadFriendsAndRequests();
      handleSocialUserSearch();
    }
  };
}

// Auto-refresh friend requests every 4 seconds when user is on Social tab
setInterval(() => {
  if (typeof currentTab !== 'undefined' && currentTab === 'social') {
    loadFriendsAndRequests();
  }
}, 4000);

async function loadFriendsAndRequests() {
  if (currentSession?.user?.id && !currentProfile) {
    try {
      currentProfile = await store.getProfile(currentSession.user.id);
    } catch (_) {}
  }

  const requests = await store.getFriendRequests();
  const currentUserId = currentSession?.user?.id ? String(currentSession.user.id).trim().toLowerCase() : '';
  const currentEmail = currentSession?.user?.email ? String(currentSession.user.email).trim().toLowerCase() : '';
  const currentName = currentProfile?.name ? String(currentProfile.name).trim().toLowerCase() : '';
  const currentUsername = currentProfile?.username ? String(currentProfile.username).trim().toLowerCase() : (currentEmail ? currentEmail.split('@')[0] : '');

  const isForMe = (r) => {
    if (!r) return false;
    const recId = String(r.receiver_id || '').trim().toLowerCase();
    const recName = String(r.receiver_name || '').trim().toLowerCase();
    const recEmail = String(r.receiver_email || '').trim().toLowerCase();
    const recUsername = String(r.receiver_username || '').trim().toLowerCase();

    if (currentUserId && (recId === currentUserId || recId.includes(currentUserId))) return true;
    if (currentEmail && (recId === currentEmail || recEmail === currentEmail || recName === currentEmail || recName === currentEmail.split('@')[0] || (currentEmail.includes('@') && recUsername === currentEmail.split('@')[0]))) return true;
    if (currentName && (recName === currentName || recId === currentName)) return true;
    if (currentUsername && (recUsername === currentUsername || recId === currentUsername || recName === currentUsername)) return true;
    return false;
  };

  const isFromMe = (r) => {
    if (!r) return false;
    const sendId = String(r.sender_id || '').trim().toLowerCase();
    const sendName = String(r.sender_name || '').trim().toLowerCase();
    const sendEmail = String(r.sender_email || '').trim().toLowerCase();
    const sendUsername = String(r.sender_username || '').trim().toLowerCase();

    if (currentUserId && (sendId === currentUserId || sendId.includes(currentUserId))) return true;
    if (currentEmail && (sendId === currentEmail || sendEmail === currentEmail || sendName === currentEmail || (currentEmail.includes('@') && sendUsername === currentEmail.split('@')[0]))) return true;
    if (currentName && (sendName === currentName || sendId === currentName)) return true;
    if (currentUsername && (sendUsername === currentUsername || sendId === currentUsername || sendName === currentUsername)) return true;
    return false;
  };

  const pendingIncoming = requests.filter(r => isForMe(r) && r.status === 'pending');
  const pendingOutgoing = requests.filter(r => isFromMe(r) && r.status === 'pending');
  const acceptedFriends = requests.filter(r => (isForMe(r) || isFromMe(r)) && r.status === 'accepted');

  const totalPending = pendingIncoming.length + pendingOutgoing.length;
  const pendingCountEl = document.getElementById('pendingRequestsCount');
  const friendsCountEl = document.getElementById('myFriendsCount');
  const badgeEl = document.getElementById('socialBadgePending');

  if (pendingCountEl) pendingCountEl.textContent = totalPending;
  if (friendsCountEl) friendsCountEl.textContent = acceptedFriends.length;
  if (badgeEl) {
    badgeEl.textContent = pendingIncoming.length;
    badgeEl.style.display = pendingIncoming.length > 0 ? 'inline-flex' : 'none';
  }

  const pendingContainer = document.getElementById('pendingRequestsList');
  if (pendingContainer) {
    let html = '';
    if (pendingIncoming.length > 0) {
      html += pendingIncoming.map(r => `
        <div class="social-user-card" style="background:#fff8f3;border-color:#ffedd5;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar" style="width:36px;height:36px;">${(r.sender_name || 'S').charAt(0).toUpperCase()}</div>
            <div>
              <div style="font-weight:700;color:var(--text-dark);">${r.sender_name} <span style="font-size:0.75rem; color:var(--orange); font-weight:700;">(Received)</span></div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${r.sender_dept || ''} ${r.sender_year || ''}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary btn-sm" onclick="window.handleAcceptFriendReq('${r.id}')">Accept</button>
            <button class="btn btn-secondary btn-sm" onclick="window.handleRejectFriendReq('${r.id}')">Decline</button>
          </div>
        </div>
      `).join('');
    }

    if (pendingOutgoing.length > 0) {
      html += pendingOutgoing.map(r => `
        <div class="social-user-card" style="background:#f8fafc;border-color:#e2e8f0;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar" style="width:36px;height:36px;background:#e2e8f0;color:#475569;">${(r.receiver_name || 'R').charAt(0).toUpperCase()}</div>
            <div>
              <div style="font-weight:700;color:var(--text-dark);">${r.receiver_name} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">(Sent Request)</span></div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${r.receiver_dept || ''} ${r.receiver_year || ''}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="window.handleWithdrawFriendReq('${r.receiver_id || r.id}')" style="color:#d97706; border-color:#fde68a;">Withdraw Request</button>
          </div>
        </div>
      `).join('');
    }

    if (pendingIncoming.length === 0 && pendingOutgoing.length === 0) {
      pendingContainer.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);padding:8px 0;">No pending friend requests.</p>`;
    } else {
      pendingContainer.innerHTML = html;
    }
  }

  const friendsContainer = document.getElementById('myFriendsList');
  if (friendsContainer) {
    if (acceptedFriends.length === 0) {
      friendsContainer.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);padding:8px 0;grid-column:1/-1;">No friends added yet. Use the "Discover &amp; Find Peers" tab above to connect with fellow students!</p>`;
    } else {
      friendsContainer.innerHTML = acceptedFriends.map(r => {
        const isSender = r.sender_id === currentUserId;
        const friendId = isSender ? r.receiver_id : r.sender_id;
        const friendName = isSender ? r.receiver_name : r.sender_name;
        const friendUsername = (friendName || 'user').replace(/\s+/g, '_').toLowerCase();
        const initial = (friendName || 'F').charAt(0).toUpperCase();

        return `
          <div class="social-user-card" style="flex-direction:column; align-items:stretch; gap:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div class="avatar" style="width:36px;height:36px;font-size:0.85rem;">${initial}</div>
                <div>
                  <div style="font-weight:700;font-size:0.88rem;color:var(--text-dark);">${friendName}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);">@${friendUsername}</div>
                </div>
              </div>
              <span class="badge" style="background:#edfff2; color:var(--green); border:1px solid rgba(34,132,58,0.3); font-size:0.68rem;">● Connected</span>
            </div>
            <button class="btn btn-primary btn-sm btn-full" onclick="window.openPeerChat('${friendId}', '${friendName.replace(/'/g, "\\'")}', '${friendUsername}')">💬 Start Chat</button>
          </div>
        `;
      }).join('');
    }
  }
}

// ─── Direct 1-on-1 Chat Controller ─────────────────────────────────────────
let activeChatFriend = null;
let peerChatPollInterval = null;

window.openPeerChat = async function(friendId, friendName, friendUsername) {
  if (!friendId || friendId === 'undefined' || friendId === 'null') {
    showToast('User chat profile details unavailable.', 'warning');
    return;
  }
  activeChatFriend = { id: friendId, name: friendName, username: friendUsername };
  
  const avatarEl = document.getElementById('chatFriendAvatar');
  const nameEl = document.getElementById('chatFriendName');
  const handleEl = document.getElementById('chatFriendHandle');

  if (avatarEl) avatarEl.textContent = (friendName || 'U').charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = friendName || 'User';
  if (handleEl) handleEl.textContent = `@${friendUsername || 'user'} • 1-on-1 Mentorship Chat`;

  openModal('chatModal');
  await refreshPeerChatStream();

  if (peerChatPollInterval) clearInterval(peerChatPollInterval);
  peerChatPollInterval = setInterval(refreshPeerChatStream, 3000);
};

async function refreshPeerChatStream() {
  if (!activeChatFriend || !currentSession?.user) return;
  const currentUserId = currentSession.user.id;
  const streamEl = document.getElementById('chatMessagesStream');
  if (!streamEl) return;

  try {
    const msgs = await store.getChatMessages(currentUserId, activeChatFriend.id);
    if (msgs.length === 0) {
      streamEl.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-size:0.82rem; margin:auto;">No messages yet. Say hi to @${activeChatFriend.username || activeChatFriend.name}! 👋</p>`;
    } else {
      streamEl.innerHTML = msgs.map(m => {
        const isMe = m.sender_id === currentUserId;
        const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
          <div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}; margin:2px 0;">
            <div style="max-width:78%; padding:10px 14px; border-radius:14px; font-size:0.88rem; line-height:1.45; background:${isMe ? 'var(--orange)' : '#ffffff'}; color:${isMe ? '#ffffff' : 'var(--text-primary)'}; border:${isMe ? 'none' : '1px solid var(--border-light)'}; box-shadow:var(--shadow-sm);">
              ${m.message}
            </div>
            <span style="font-size:0.68rem; color:var(--text-muted); margin-top:2px; padding:0 4px;">${time}</span>
          </div>
        `;
      }).join('');
    }
    streamEl.scrollTop = streamEl.scrollHeight;
  } catch (err) {
    console.error('Failed to load chat messages:', err);
  }
}

async function handleSendChatMessage(e) {
  e.preventDefault();
  if (!activeChatFriend || !currentSession?.user) return;
  const inputEl = document.getElementById('chatMessageInput');
  const text = inputEl?.value.trim();
  if (!text) return;

  try {
    const senderName = currentProfile?.name || currentSession.user.email;
    await store.sendChatMessage({
      sender_id: currentSession.user.id,
      receiver_id: activeChatFriend.id,
      sender_name: senderName,
      receiver_name: activeChatFriend.name,
      message: text
    });
    inputEl.value = '';
    await refreshPeerChatStream();
  } catch (err) {
    showToast('Failed to send message: ' + err.message, 'warning');
  }
}

window.handleAcceptFriendReq = async function(requestId) {
  try {
    await store.acceptFriendRequest(requestId);
    showToast('Friend request accepted! 🎉', 'success');
    await loadFriendsAndRequests();
  } catch (err) {
    showToast(err.message || 'Action failed.', 'warning');
  }
};

window.handleRejectFriendReq = async function(requestId) {
  try {
    await store.rejectFriendRequest(requestId);
    showToast('Friend request declined.', 'info');
    await loadFriendsAndRequests();
  } catch (err) {
    showToast(err.message || 'Action failed.', 'warning');
  }
};

// ─── Notification Center Controller ────────────────────────────────────────
let userNotifications = [];

async function loadUserNotifications() {
  if (!currentSession?.user) return;
  const userId = currentSession.user.id;

  try {
    userNotifications = await store.getUserNotifications(userId);
    renderNotificationBadge();
  } catch (err) {
    console.warn('loadUserNotifications warning:', err);
  }
}

function renderNotificationBadge() {
  const badgeEl = document.getElementById('notifBadge');
  if (!badgeEl) return;

  const unreadCount = userNotifications.filter(n => !n.is_read).length;
  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount > 9 ? '9+' : unreadCount;
    badgeEl.style.display = 'inline-flex';
  } else {
    badgeEl.style.display = 'none';
  }
}

function renderNotificationStream() {
  const streamEl = document.getElementById('notifFeedStream');
  if (!streamEl) return;

  if (userNotifications.length === 0) {
    streamEl.innerHTML = `
      <div style="text-align:center; padding:32px; color:var(--text-muted);">
        <div style="font-size:2rem; margin-bottom:6px;">🔔</div>
        <div style="font-weight:700; color:var(--text-dark); margin-bottom:4px;">No Notifications Yet</div>
        <p style="font-size:0.82rem; margin:0;">You'll receive alerts here for new events, mentor announcements, messages, and updates.</p>
      </div>`;
    return;
  }

  streamEl.innerHTML = userNotifications.map(n => {
    const isUnread = !n.is_read;
    const timeStr = n.created_at ? new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    
    let icon = '🔔';
    if (n.type === 'event') icon = '📅';
    else if (n.type === 'mentor') icon = '💼';
    else if (n.type === 'chat') icon = '💬';
    else if (n.type === 'booking') icon = '🎟️';
    else if (n.type === 'friend') icon = '🤝';

    return `
      <div class="notif-card ${isUnread ? 'unread' : ''}" style="display:flex; gap:10px; padding:10px 12px; border-radius:10px; background:${isUnread ? '#f0f9ff' : '#f8fafc'}; border:1px solid ${isUnread ? '#bae6fd' : '#e2e8f0'}; cursor:pointer; transition:all 0.2s;" onclick="window.handleNotificationClick('${n.id}', '${n.link_tab || ''}', '${n.type || ''}', '${n.sender_id || ''}', '${(n.sender_name || '').replace(/'/g, "\\'")}')">
        <div style="width:36px; height:36px; border-radius:50%; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">${icon}</div>
        <div style="flex:1;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:2px;">
            <div style="font-size:0.85rem; font-weight:700; color:var(--text-dark);">${n.title}</div>
            <span style="font-size:0.7rem; color:var(--text-muted);">${timeStr}</span>
          </div>
          <div style="font-size:0.78rem; color:var(--text-primary); line-height:1.4;">${n.message}</div>
        </div>
      </div>
    `;
  }).join('');
}

window.handleNotificationClick = async function(notifId, linkTab, type, senderId, senderName) {
  closeModal('notifModal');

  // Mark notification as read
  const target = userNotifications.find(n => n.id === notifId);
  if (target) target.is_read = true;
  renderNotificationBadge();

  if (currentSession?.user) {
    store.markNotificationsAsRead(currentSession.user.id, [notifId]).catch(() => {});
  }

  if (type === 'chat' && senderId && senderId !== 'undefined') {
    const username = (senderName || 'user').replace(/\s+/g, '_').toLowerCase();
    window.openPeerChat(senderId, senderName || 'User', username);
  } else if (linkTab) {
    switchTab(linkTab);
  }
};

window.openNotificationModal = async function() {
  if (!currentSession?.user) {
    openModal('authModal');
    showToast('Please log in to view notifications.', 'info');
    return;
  }

  openModal('notifModal');
  await loadUserNotifications();

  // Mark all notifications as read upon opening the notification center
  const allIds = userNotifications.map(n => n.id);
  userNotifications = userNotifications.map(n => ({ ...n, is_read: true }));
  renderNotificationBadge();
  renderNotificationStream();

  if (currentSession?.user) {
    store.markNotificationsAsRead(currentSession.user.id, allIds).catch(() => {});
  }
};

window.markAllNotificationsRead = async function() {
  if (!currentSession?.user) return;
  const allIds = userNotifications.map(n => n.id);
  userNotifications = userNotifications.map(n => ({ ...n, is_read: true }));
  renderNotificationBadge();
  renderNotificationStream();
  await store.markNotificationsAsRead(currentSession.user.id, allIds);
  showToast('All notifications marked as read.', 'info');
};





