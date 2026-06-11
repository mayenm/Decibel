// ─── IndexedDB Storage ───────────────────────────────────────────
const DB_NAME = 'DecibelDB';
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('notes')) {
        database.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('audio')) {
        database.createObjectStore('audio', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function saveNoteToDB(note) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notes', 'audio'], 'readwrite');
    const noteStore = tx.objectStore('notes');
    const audioStore = tx.objectStore('audio');
    const noteToSave = {...note};
    delete noteToSave.audioBlob;
    delete noteToSave.audioFileURL;
    noteStore.put(noteToSave);
    if (note.audioBlob) {
      audioStore.put({ id: note.id, blob: note.audioBlob });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteNoteFromDB(id) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notes', 'audio'], 'readwrite');
    tx.objectStore('notes').delete(id);
    tx.objectStore('audio').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAllNotesFromDB() {
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notes', 'audio'], 'readonly');
    const noteStore = tx.objectStore('notes');
    const audioStore = tx.objectStore('audio');
    const notes = [];
    noteStore.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        notes.push(cursor.value);
        cursor.continue();
      }
    };
    tx.oncomplete = async () => {
      for (const note of notes) {
        if (!note.tags) note.tags = [];
        await new Promise((res) => {
          const req = audioStore.get(note.id);
          req.onsuccess = () => {
            if (req.result && req.result.blob) {
              note.audioBlob = req.result.blob;
              note.audioFileURL = URL.createObjectURL(note.audioBlob);
            }
            res();
          };
          req.onerror = () => res();
        });
      }
      notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(notes);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function saveSettingsToDB(settings) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    Object.entries(settings).forEach(([key, value]) => {
      store.put({ key, value });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadSettingsFromDB() {
  if (!db) return {};
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const settings = {};
    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        settings[cursor.value.key] = cursor.value.value;
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(settings);
    tx.onerror = () => reject(tx.error);
  });
}

const APP_VERSION = '1.0.0';
const STORAGE_KEY = 'voiceNoteApp_v3';
const HELP_URL = 'https://discord.gg/vhytdFAwe';
const PRIVACY_URL = 'https://example.com/privacy';
const TERMS_URL = 'https://example.com/terms';
const avatarColors = [
'#FF3B30', '#FF9500', '#FFCC00', '#34C759',
'#007AFF', '#5856D6', '#AF52DE', '#FF2D55'
];
const state = {
userName: 'there',
hasOnboarded: false,
isUserSignedIn: false,
userProfile: { firstName: '', lastName: '', email: '' },
notes: [],
currentNoteId: null,
currentFilter: 'voice',
activeTagFilter: null,
isRecording: false,
isPaused: false,
permissionsGranted: false,
mediaRecorder: null,
audioChunks: [],
audioContext: null,
analyser: null,
micStream: null,
recognition: null,
finalTranscript: '',
interimTranscript: '',
recordingStartTime: null,
timerInterval: null,
animationFrameId: null,
waveformData: [],
silenceTimer: null,
isSilent: true,
recordingWordTimings: [],
recordingWordCount: 0,
lastFinalTime: 0,
lastSentenceEnd: 0,
currentReviewAudioUrl: null,
currentReviewBlob: null,
currentReviewDuration: 0,
reviewPlaying: false,
isScrubbingReview: false,
scrubScaleReview: 1,
detailAudioPlaying: false,
currentWordIndex: -1,
wordTiming: [],
highlightRafId: null,
detailAudioBuffer: null,
isScrubbingDetail: false,
scrubScaleDetail: 1,
theme: 'light',
currentScreen: 'screen-onboarding',
navStack: [],
isProfileMenuOpen: false,
profileMenuHistoryPushed: false,
deleteModalHistoryPushed: false,
currentHomeAudio: null,
currentHomeAudioId: null,
currentHomeTile: null,
homeAudioInterval: null,
longPressTimer: null,
longPressTriggered: false,
pendingAction: null,
audioReactor: null,
totalPausedDuration: 0,
pausedAt: null,
currentPitch: 0,
lastSpeakerId: null,
speakerProfiles: [],
unpitchedDuration: 0,
musicDetected: false,
recentPitches: []
};
let pendingDeleteNoteId = null;
let isHandlingPopstate = false;
let currentModalAction = null;
let isMenuOpen = false;
let currentSelectionRange = null;
let detLongPressTimer = null;
let detIsLongPress = false;
let mediaHideTimer = null;
let editDebounce = null;
function getColorFromName(name) {
if (!name) return avatarColors[0];
let hash = 0;
for (let i = 0; i < name.length; i++) {
hash = name.charCodeAt(i) + ((hash << 5) - hash);
}
return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitials(first, last) {
const f = first ? first.charAt(0).toUpperCase() : '';
const l = last ? last.charAt(0).toUpperCase() : '';
return (f + l).trim() || '?';
}
function escapeHtml(t) {
const d = document.createElement('div');
d.textContent = t;
return d.innerHTML;
}
function haptic(pattern = 10) {
if (navigator.vibrate) {
navigator.vibrate(pattern);
}
}
function getStorageSize() {
let size = 0;
for (let key in localStorage) {
if (localStorage.hasOwnProperty(key)) {
size += localStorage[key].length + key.length;
}
}
return size;
}
function formatBytes(bytes) {
if (bytes === 0) return '0 Bytes';
const k = 1024;
const sizes = ['Bytes', 'KB', 'MB', 'GB'];
const i = Math.floor(Math.log(bytes) / Math.log(k));
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
async function saveState() {
  const settings = {
    userName: state.userName,
    hasOnboarded: state.hasOnboarded,
    theme: state.theme,
    currentFilter: state.currentFilter,
    isUserSignedIn: state.isUserSignedIn,
    userProfile: state.userProfile,
    backupEnabled: state.backupEnabled
  };
  await saveSettingsToDB(settings);
  for (const note of state.notes) {
    await saveNoteToDB(note);
  }
}

async function loadState() {
  try {
    await openDB();
    const settings = await loadSettingsFromDB();
    state.userName = settings.userName || 'there';
    state.hasOnboarded = settings.hasOnboarded || false;
    state.theme = settings.theme || 'light';
    state.currentFilter = settings.currentFilter || 'voice';
    state.isUserSignedIn = settings.isUserSignedIn || false;
    state.userProfile = settings.userProfile || { firstName: '', lastName: '', email: '' };
    state.backupEnabled = settings.backupEnabled !== undefined ? settings.backupEnabled : true;
    state.notes = await loadAllNotesFromDB();
  } catch(e) {
    console.error('Load error:', e);
  }
}
function triggerGoogleSignIn() {
  google.accounts.id.prompt();
}

function handleGoogleCredential(response) {
  const payload = JSON.parse(atob(response.credential.split('.')[1]));
  
  // Get name from Google account, fall back to email prefix if no name
  const fullName = payload.name || payload.email.split('@')[0];
  const nameParts = fullName.split(' ');
  
  // Capitalise first letter of email-derived name
  const firstName = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1);
  const lastName = nameParts.slice(1).join(' ') || '';

  state.isUserSignedIn = true;
  state.userProfile = {
    firstName: firstName,
    lastName: lastName,
    email: payload.email || ''
  };
  state.userName = firstName;
  state.hasOnboarded = true;
  saveState();
  renderProfileTrigger();
  showScreen('screen-home');
  showToast(`Welcome, ${firstName}!`);
  haptic([10, 50, 10]);
}
function applyTheme(theme, instant = false) {
document.documentElement.setAttribute('data-theme', theme);
setTimeout(() => {
if (document.getElementById('screen-detail').classList.contains('active')) {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note && note.type === 'voice') {
const audio = document.getElementById('detail-audio');
const dur = getDetailDuration(note);
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawDetailWaveform(progress, note.waveformData, state.detailAudioPlaying, state.scrubScaleDetail);
}
}
}, instant ? 0 : 100);
}
function toggleTheme() {
    // Trigger the smooth 400ms crossfade
    document.documentElement.classList.add('theme-transitioning');
    
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(state.theme, false);
    saveState();
    haptic(10);
    
    // Remove the class after the animation finishes
    setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
    }, 400);
}
function toggleThemeFromSettings(isDark) {
    // Trigger the smooth 400ms crossfade
    document.documentElement.classList.add('theme-transitioning');
    
    state.theme = isDark ? 'dark' : 'light';
    applyTheme(state.theme, false);
    saveState();
    haptic(10);
    
    const profileToggle = document.getElementById('profile-dark-toggle');
    if (profileToggle && profileToggle.checked !== isDark) {
        profileToggle.checked = isDark;
    }
    
    // Remove the class after the animation finishes
    setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning');
    }, 400);
}
function toggleBackup(enabled) {
  state.backupEnabled = enabled;
  saveState();
  if (enabled) {
    showToast('Auto-backup enabled');
    scheduleBackup();
  } else {
    showToast('Auto-backup disabled');
    if (state.backupInterval) {
      clearInterval(state.backupInterval);
      state.backupInterval = null;
    }
  }
  haptic(10);
}

function scheduleBackup() {
  if (state.backupInterval) clearInterval(state.backupInterval);
  // Auto backup every 10 minutes if enabled
  state.backupInterval = setInterval(() => {
    if (state.backupEnabled && state.notes.length > 0) {
      silentBackup();
    }
  }, 10 * 60 * 1000);
}

function silentBackup() {
  try {
    const data = JSON.stringify({
      notes: state.notes.map(n => {
        const c = {...n};
        delete c.audioFileURL;
        delete c.audioBlob;
        return c;
      }),
      exportedAt: new Date().toISOString(),
      version: APP_VERSION
    });
    localStorage.setItem('decibel_auto_backup', data);
    localStorage.setItem('decibel_backup_time', new Date().toISOString());
    console.log('Auto backup saved at', new Date().toLocaleTimeString());
  } catch(e) {
    console.warn('Auto backup failed:', e);
  }
}
function showScreen(id, direction = 'forward') {
if (state.currentScreen === id) return;
const cur = document.getElementById(state.currentScreen);
const nxt = document.getElementById(id);
if (direction === 'forward') {
if (cur) {
cur.classList.remove('active');
cur.classList.add('pushed-back');
}
nxt.classList.remove('pushed-back', 'popping-off');
nxt.classList.add('transitioning');
requestAnimationFrame(() => nxt.classList.add('active'));
setTimeout(() => nxt.classList.remove('transitioning'), 400);
state.navStack.push(id);
} else {
if (cur) {
cur.classList.remove('active');
cur.classList.add('popping-off');
setTimeout(() => cur.classList.remove('popping-off'), 500);
}
nxt.classList.remove('pushed-back');
requestAnimationFrame(() => nxt.classList.add('active'));
state.navStack.pop();
}
state.currentScreen = id;
if (id === 'screen-home') {
setTimeout(() => renderHome(), 50);
}
if (id === 'screen-settings') {
updateSettingsScreen();
}
}
function goBack() {
if (state.navStack.length <= 1) return;
showScreen(state.navStack[state.navStack.length - 2], 'back');
}
function navigateTo(screen) {
closeProfileMenu();
if (screen === 'settings') {
showScreen('screen-settings');
} else if (screen === 'profile') {
showToast('Profile screen coming soon');
} else if (screen === 'help') {
openHelp();
}
}
function handleAuth(provider) {
const btn = document.querySelector(`.auth-btn-${provider}`);
btn.classList.add('loading');
setTimeout(() => {
btn.classList.remove('loading');
state.isUserSignedIn = true;
state.userProfile = {
firstName: 'Alex',
lastName: 'Morgan',
email: provider === 'apple' ? 'alex@icloud.com' : 'alex@gmail.com'
};
state.userName = state.userProfile.firstName;
state.hasOnboarded = true;
saveState();
renderProfileTrigger();
showScreen('screen-home');
showToast(`Signed in with ${provider === 'apple' ? 'Apple' : 'Google'}`);
haptic([10, 50, 10]);
}, 1500);
}
function handleLogout() {
closeProfileMenu();
showModal(
"Are you sure you want to sign out?",
"Sign Out",
() => {
state.isUserSignedIn = false;
state.userProfile = { firstName: '', lastName: '', email: '' };
saveState();
renderProfileTrigger();
while (state.navStack.length > 1) state.navStack.pop();
showScreen('screen-onboarding');
showToast('Signed out successfully');
haptic([10, 50, 10]);
},
'#FF3B30'
);
}
function handleLogoutClick() {
handleLogout();
}
function renderProfileTrigger() {
const btn = document.getElementById('profile-trigger-btn');
if (!btn) return;
if (state.isUserSignedIn && state.userProfile.firstName) {
const initials = getInitials(state.userProfile.firstName, state.userProfile.lastName);
const color = getColorFromName((state.userProfile.firstName || '') + (state.userProfile.lastName || ''));
btn.innerHTML = `<div class="profile-avatar-wrapper"><div class="profile-avatar-initials" style="background-color: ${color};">${initials}</div></div>`;
} else {
btn.innerHTML = `<div class="profile-avatar-wrapper"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style="color: #888888;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>`;
}
}
function renderProfileHeader() {
const avatar = document.getElementById('profile-avatar');
const nameEl = document.getElementById('profile-name');
const emailEl = document.getElementById('profile-email');
if (state.isUserSignedIn && state.userProfile.firstName) {
const initials = getInitials(state.userProfile.firstName, state.userProfile.lastName);
const color = getColorFromName((state.userProfile.firstName || '') + (state.userProfile.lastName || ''));
avatar.innerHTML = `<div class="profile-avatar-initials" style="background-color: ${color}; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700;">${initials}</div>`;
nameEl.textContent = `${state.userProfile.firstName || ''} ${state.userProfile.lastName || ''}`.trim();
emailEl.textContent = state.userProfile.email || '';
emailEl.style.display = 'block';
} else {
avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" style="color: #888888;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
nameEl.textContent = 'Guest User';
emailEl.textContent = 'Sign in to sync';
emailEl.style.display = 'block';
}
}
function toggleProfileMenu(e) {
if (e) {
e.preventDefault();
e.stopPropagation();
}
if (state.isProfileMenuOpen) {
closeProfileMenu();
} else {
openProfileMenu();
}
haptic(10);
}
function openProfileMenu() {
const btn = document.getElementById('profile-trigger-btn');
const menu = document.getElementById('profile-menu-card');
const screen = document.querySelector('.phone-screen');
const btnRect = btn.getBoundingClientRect();
const screenRect = screen.getBoundingClientRect();
let top = btnRect.bottom - screenRect.top + 8;
let right = screenRect.right - btnRect.right;
if (screenRect.width - right - 256 < 16) {
right = screenRect.width - 256 - 16;
}
menu.style.top = top + 'px';
menu.style.right = right + 'px';
renderProfileHeader();
document.getElementById('app-version').textContent = `v.${APP_VERSION}`;
const profileDarkToggle = document.getElementById('profile-dark-toggle');
if (profileDarkToggle) {
profileDarkToggle.checked = (state.theme === 'dark');
}
state.isProfileMenuOpen = true;
menu.classList.remove('closing');
menu.classList.add('active');
btn.classList.add('active');
if (!isHandlingPopstate) {
try {
history.pushState({ menu: 'profile' }, '');
state.profileMenuHistoryPushed = true;
} catch(e) {}
}
setTimeout(() => {
document.addEventListener('click', handleOutsideClick);
}, 50);
}
function closeProfileMenu(fromPopstate = false) {
if (!state.isProfileMenuOpen) return;
state.isProfileMenuOpen = false;
const menu = document.getElementById('profile-menu-card');
menu.classList.add('closing');
menu.classList.remove('active');
document.getElementById('profile-trigger-btn').classList.remove('active');
setTimeout(() => {
menu.classList.remove('closing');
document.removeEventListener('click', handleOutsideClick);
}, 260);
if (!fromPopstate && !isHandlingPopstate && state.profileMenuHistoryPushed) {
try {
history.back();
} catch(e) {}
}
state.profileMenuHistoryPushed = false;
}
function handleOutsideClick(e) {
const menu = document.getElementById('profile-menu-card');
const trigger = document.getElementById('profile-trigger-btn');
if (!menu.contains(e.target) && !trigger.contains(e.target)) {
closeProfileMenu();
}
}
function handleProfileClick() {
if (state.isUserSignedIn) {
closeProfileMenu();
navigateTo('profile');
} else {
closeProfileMenu();
showScreen('screen-onboarding');
}
}
function updateSettingsScreen() {
const nameEl = document.getElementById('settings-profile-name');
const emailEl = document.getElementById('settings-profile-email');
if (state.isUserSignedIn && state.userProfile.firstName) {
nameEl.textContent = `${state.userProfile.firstName} ${state.userProfile.lastName}`.trim();
emailEl.textContent = state.userProfile.email || '';
} else {
nameEl.textContent = 'Guest User';
emailEl.textContent = 'Not signed in';
}
const storageSize = getStorageSize();
const storageText = document.getElementById('storage-text');
const storageBar = document.getElementById('storage-bar-fill');
if (storageText) {
storageText.textContent = `${formatBytes(storageSize)} of 5 GB used`;
}
if (storageBar) {
const percentage = Math.min((storageSize / (5 * 1024 * 1024 * 1024)) * 100, 100);
storageBar.style.width = `${Math.max(percentage, 1)}%`;
}
const versionEl = document.getElementById('settings-version');
if (versionEl) {
versionEl.textContent = APP_VERSION;
}
}
function openHelp() {
closeProfileMenu();
window.open(HELP_URL, '_blank');
haptic(10);
}
function openPrivacy() {
window.open(PRIVACY_URL, '_blank');
haptic(10);
}
function openTerms() {
window.open(TERMS_URL, '_blank');
haptic(10);
}
function openNameModal() {
document.getElementById('name-modal').classList.add('active');
const input = document.getElementById('name-input');
input.value = '';
setTimeout(() => input.focus(), 100);
}
function saveName() {
  const raw = document.getElementById('name-input').value.trim();
  // Capitalise first letter
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (name) {
    state.userName = name;
    state.userProfile.firstName = name;
    state.isUserSignedIn = true;
    state.userProfile.email = '';
  }
  state.hasOnboarded = true;
  saveState();
  document.getElementById('name-modal').classList.remove('active');
  renderProfileTrigger();
  showScreen('screen-home');
  haptic([10, 50, 10]);
}
const QUESTIONS = [
"What are you pondering?",
"What's on your mind?",
"Ready to capture a thought?",
"What's the big idea today?",
"What needs to be remembered?",
"What's worth noting?",
"What story do you have?",
"What just occurred to you?"
];
function renderHome() {
document.getElementById('home-username').textContent = state.userName;
document.getElementById('home-question').textContent = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
document.getElementById('pill-voice').classList.toggle('active', state.currentFilter === 'voice');
document.getElementById('pill-written').classList.toggle('active', state.currentFilter === 'written');
const wb = document.getElementById('written-btn');
if (state.currentFilter === 'written') {
wb.classList.remove('hidden');
} else {
wb.classList.add('hidden');
}
const search = (document.getElementById('home-search-input').value || '').toLowerCase();
const voiceNotesCount = state.notes.filter(n => n.type === 'voice').length;
const writtenNotesCount = state.notes.filter(n => n.type === 'written').length;
const filtered = state.notes.filter(n => {
const mt = state.currentFilter === 'all' || n.type === state.currentFilter;
const text = (n.title + ' ' + (n.editedBody || n.originalTranscription)).toLowerCase();
const tagsMatch = !state.activeTagFilter || (n.tags && n.tags.includes(state.activeTagFilter));
const searchMatch = !search || text.includes(search) || (n.tags && n.tags.some(t => ('#' + t).includes(search)));
return mt && tagsMatch && searchMatch;
});
const grid = document.getElementById('home-grid');
grid.innerHTML = '';
let renderedNoteCount = 0;
for (let i = 0; i < filtered.length; i += 2) {
const row = document.createElement('div');
row.className = 'home-grid-row';
row.appendChild(createTile(filtered[i], i * 0.05));
renderedNoteCount++;
if (filtered[i + 1]) {
row.appendChild(createTile(filtered[i + 1], (i + 1) * 0.05));
renderedNoteCount++;
} else {
const s = document.createElement('div');
s.style.width = '48%';
row.appendChild(s);
}
grid.appendChild(row);
}
if (renderedNoteCount === 0) {
if (state.currentFilter === 'voice' && voiceNotesCount === 0) {
const row = document.createElement('div');
row.className = 'home-grid-row';
const tile = document.createElement('div');
tile.className = 'home-tile empty empty-full';
tile.innerHTML = `
<div class="home-tile-icon">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
</div>
<div class="empty-text-wrap">
<div class="empty-title">Tap + to record</div>
<div class="empty-sub">Your first voice note</div>
</div>
`;
tile.onclick = () => handleAddTap();
row.appendChild(tile);
grid.appendChild(row);
} else if (state.currentFilter === 'written' && writtenNotesCount === 0) {
const row = document.createElement('div');
row.className = 'home-grid-row';
const tile = document.createElement('div');
tile.className = 'home-tile empty empty-full';
tile.innerHTML = `
<div class="home-tile-icon">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
</div>
<div class="empty-text-wrap">
<div class="empty-title">Your first note</div>
<div class="empty-sub">Tap to start writing</div>
</div>
`;
tile.onclick = () => openWrittenNote();
row.appendChild(tile);
grid.appendChild(row);
} else if (state.currentFilter === 'all' && state.notes.length === 0) {
const row = document.createElement('div');
row.className = 'home-grid-row';
const voiceTile = document.createElement('div');
voiceTile.className = 'home-tile empty';
voiceTile.innerHTML = `<div class="home-empty-text">Tap + to record</div>`;
voiceTile.onclick = () => handleAddTap();
const writtenTile = document.createElement('div');
writtenTile.className = 'home-tile empty';
writtenTile.innerHTML = `<div class="home-empty-text">Your first note</div>`;
writtenTile.onclick = () => openWrittenNote();
row.appendChild(voiceTile);
row.appendChild(writtenTile);
grid.appendChild(row);
} else if (state.notes.length > 0) {
const row = document.createElement('div');
row.className = 'home-grid-row';
row.innerHTML = `<div class="home-tile empty" style="width:100%"><div class="home-empty-text">No matching notes</div></div>`;
grid.appendChild(row);
}
}
updateSearchSuggestions();
}
function createTile(note, delay = 0) {
const tile = document.createElement('div');
tile.className = 'home-tile';
tile.style.animationDelay = delay + 's';
const body = note.editedBody || note.originalTranscription || '';
const cleanBody = body.replace(/\[MALE_\d+\]/g, '').replace(/\[FEMALE_\d+\]/g, '').replace(/\[MUSIC\]/g, '').trim();
const wordCount = cleanBody ? cleanBody.split(/\s+/).length : 0;
const date = new Date(note.createdAt);
const dd = String(date.getDate()).padStart(2, '0');
const mm = String(date.getMonth() + 1).padStart(2, '0');
const yyyy = date.getFullYear();
const dateStr = `${dd}.${mm}.${yyyy}`;
const cardClass = note.type === 'voice' ? 'voice-note-card' : 'written-note-card';
tile.classList.add(cardClass);
const dividerHTML = note.type === 'voice' ? `
<div class="note-dots-row">
${Array(32).fill(0).map(() => '<div class="progress-dot"></div>').join('')}
</div>
` : `<div class="note-divider-line"></div>`;
const playPauseBtnHTML = note.type === 'voice' ? `
<button class="note-play-pause-btn" onclick="event.stopPropagation(); toggleVoiceNoteAudio('${note.id}', this.closest('.home-tile'))">
<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
</button>
` : `<div class="note-word-count">${wordCount}</div>`;
let tagsHTML = '';
if (note.tags && note.tags.length > 0) {
tagsHTML = '<div style="margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + 
note.tags.slice(0, 3).map(t => `<span class="home-tag-pill">#${escapeHtml(t)}</span>`).join('') + 
'</div>';
}
tile.innerHTML = `
<div class="note-content-wrapper">
<div class="note-content">${escapeHtml(cleanBody)}</div>
</div>
${dividerHTML}
<div class="note-bottom">
<div class="note-title">${escapeHtml(note.title || 'Untitled')}</div>
<div class="note-meta-right">
${playPauseBtnHTML}
<div class="note-date">${dateStr}</div>
</div>
</div>
${tagsHTML}
`;
tile.onclick = () => openNoteDetail(note.id);
return tile;
}
function toggleFilter(t) {
state.currentFilter = state.currentFilter === t ? 'all' : t;
state.activeTagFilter = null;
renderHome();
saveState();
haptic(10);
}
function handleSearch() {
renderHome();
}
function updateSearchSuggestions() {
const search = (document.getElementById('home-search-input').value || '').toLowerCase();
const c = document.getElementById('home-suggestions');
c.innerHTML = '';
if (search.length < 2) return;
const words = new Set();
const tags = new Set();
state.notes.forEach(n => {
const text = (n.title + ' ' + (n.editedBody || n.originalTranscription)).toLowerCase();
text.split(/\s+/).forEach(w => {
if (w.startsWith(search) && w.length > search.length && w.length < 30) {
words.add(w);
}
});
if (n.tags) {
n.tags.forEach(t => {
if (('#' + t).startsWith(search)) tags.add(t);
});
}
});
Array.from(tags).slice(0, 3).forEach(t => {
const b = document.createElement('button');
b.className = 'home-suggestion';
b.textContent = '#' + t;
b.onclick = () => {
state.activeTagFilter = t;
document.getElementById('home-search-input').value = '';
renderHome();
};
c.appendChild(b);
});
Array.from(words).slice(0, 5).forEach(s => {
const b = document.createElement('button');
b.className = 'home-suggestion';
b.textContent = s;
b.onclick = () => {
document.getElementById('home-search-input').value = s;
state.activeTagFilter = null;
renderHome();
};
c.appendChild(b);
});
}
function toggleVoiceNoteAudio(noteId, tile) {
const note = state.notes.find(n => n.id === noteId);
if (!note || !note.audioFileURL) return;
const playBtn = tile.querySelector('.note-play-pause-btn');
const dots = tile.querySelectorAll('.progress-dot');
const totalDots = dots.length;
if (state.currentHomeAudioId === noteId && state.currentHomeAudio && !state.currentHomeAudio.paused) {
state.currentHomeAudio.pause();
playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
clearInterval(state.homeAudioInterval);
} else {
if (state.currentHomeAudio) {
state.currentHomeAudio.pause();
state.currentHomeAudio.currentTime = 0;
if (state.currentHomeTile) {
const prevPlayBtn = state.currentHomeTile.querySelector('.note-play-pause-btn');
if (prevPlayBtn) {
prevPlayBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
}
const prevDots = state.currentHomeTile.querySelectorAll('.progress-dot');
prevDots.forEach(dot => dot.classList.remove('active'));
}
clearInterval(state.homeAudioInterval);
}
if (!state.currentHomeAudio || state.currentHomeAudioId !== noteId) {
state.currentHomeAudio = new Audio(note.audioFileURL);
state.currentHomeAudioId = noteId;
} else if (state.currentHomeAudio.ended) {
state.currentHomeAudio.currentTime = 0;
}
state.currentHomeTile = tile;
playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8-14v14h4V5h-4z"/></svg>';
state.currentHomeAudio.play().catch(err => {
console.error('Audio play failed:', err);
playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
});
state.currentHomeAudio.onended = () => {
playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
dots.forEach(dot => dot.classList.remove('active'));
clearInterval(state.homeAudioInterval);
};
state.homeAudioInterval = setInterval(() => {
if (!state.currentHomeAudio || state.currentHomeAudio.paused || state.currentHomeAudio.ended) {
clearInterval(state.homeAudioInterval);
return;
}
const currentTime = state.currentHomeAudio.currentTime;
const duration = state.currentHomeAudio.duration || 1;
const activeDotsCount = Math.floor((currentTime / duration) * totalDots);
dots.forEach((dot, index) => {
if (index < activeDotsCount) {
dot.classList.add('active');
} else {
dot.classList.remove('active');
}
});
}, 50);
}
haptic(10);
}
function setupAddButton() {
const btn = document.getElementById('add-btn');
btn.addEventListener('pointerdown', (e) => {
state.longPressTriggered = false;
state.longPressTimer = setTimeout(() => {
state.longPressTriggered = true;
showContextMenu(e);
}, 500);
});
btn.addEventListener('pointerup', () => {
clearTimeout(state.longPressTimer);
if (!state.longPressTriggered) handleAddTap();
});
btn.addEventListener('pointerleave', () => clearTimeout(state.longPressTimer));
btn.addEventListener('pointercancel', () => clearTimeout(state.longPressTimer));
btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
function handleAddTap() {
if (!state.permissionsGranted) {
state.pendingAction = 'record';
document.getElementById('permission-overlay').classList.add('active');
} else {
startRecording();
}
haptic(10);
}
function showContextMenu(e) {
const menu = document.getElementById('context-menu');
const btn = document.getElementById('add-btn');
const rect = btn.getBoundingClientRect();
const pr = btn.closest('.phone-screen').getBoundingClientRect();
menu.style.right = (pr.right - rect.right) + 'px';
menu.style.bottom = (pr.bottom - rect.top + 10) + 'px';
menu.style.left = 'auto';
menu.classList.add('active');
const closeHandler = (ev) => {
if (!menu.contains(ev.target) && ev.target !== btn) {
menu.classList.remove('active');
document.removeEventListener('pointerdown', closeHandler);
}
};
setTimeout(() => document.addEventListener('pointerdown', closeHandler), 10);
haptic(10);
}
function openWrittenNote() {
document.getElementById('context-menu').classList.remove('active');
document.getElementById('wri-title-input').value = '';
document.getElementById('wri-body-input').value = '';
showScreen('screen-written');
setTimeout(() => document.getElementById('wri-title-input').focus(), 400);
}
function startRecordingFromMenu() {
document.getElementById('context-menu').classList.remove('active');
if (!state.permissionsGranted) {
state.pendingAction = 'record';
document.getElementById('permission-overlay').classList.add('active');
} else {
startRecording();
}
}
function saveWrittenNote() {
const title = document.getElementById('wri-title-input').value.trim();
const body = document.getElementById('wri-body-input').value.trim();
if (!title) {
showToast('Please enter a title');
return;
}
state.notes.unshift({
id: 'note_' + Date.now(),
title,
originalTranscription: body,
editedBody: body,
audioFileURL: null,
audioBlob: null,
waveformData: [],
type: 'written',
media: [],
tags: [],
createdAt: new Date().toISOString(),
duration: null
});
saveState();
showToast('Note saved');
haptic([10, 50, 10]);
goBack();
}
async function requestPermissions() {
try {
const stream = await navigator.mediaDevices.getUserMedia({audio: true});
stream.getTracks().forEach(t => t.stop());
state.permissionsGranted = true;
document.getElementById('permission-overlay').classList.remove('active');
if (state.pendingAction === 'record') {
state.pendingAction = null;
startRecording();
}
haptic([10, 50, 10]);
} catch(e) {
showToast('Permission denied');
document.getElementById('permission-overlay').classList.remove('active');
state.pendingAction = null;
}
}
function denyPermissions() {
document.getElementById('permission-overlay').classList.remove('active');
showToast('Permissions required for recording');
state.pendingAction = null;
}
class AudioReactor {
constructor(canvas, audioContext, sourceNode) {
this.canvas = canvas;
this.ctx = canvas.getContext('2d');
this.audioCtx = audioContext;
this.analyser = this.audioCtx.createAnalyser();
this.analyser.fftSize = 1024;
this.analyser.smoothingTimeConstant = 0.8;
this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
this.sourceNode = sourceNode;
this.sourceNode.connect(this.analyser);
this.NUM_CAPSULES = 4;
this.springs = Array(this.NUM_CAPSULES).fill(0).map(() => ({
value: 1,
velocity: 0,
target: 1
}));
this.W = 0;
this.H = 0;
this.handleResize = this.resize.bind(this);
this.animate = this.animate.bind(this);
window.addEventListener('resize', this.handleResize);
this.resize();
this.isRunning = true;
requestAnimationFrame(this.animate);
}
resize() {
const dpr = window.devicePixelRatio || 1;
const parent = this.canvas.parentElement;
const w = parent ? parent.offsetWidth : window.innerWidth;
const h = parent ? parent.offsetHeight : window.innerHeight;
this.W = this.canvas.width = w * dpr;
this.H = this.canvas.height = h * dpr;
this.canvas.style.width = w + 'px';
this.canvas.style.height = h + 'px';
}
getFrequencyData() {
this.analyser.getByteFrequencyData(this.freqData);
this.analyser.getByteTimeDomainData(this.dataArray);
return { freq: this.freqData, time: this.dataArray };
}
getBandValues(freq) {
if (!freq) return [0, 0, 0, 0];
const len = freq.length;
const bands = [
{ start: 0, end: Math.floor(len * 0.06) },
{ start: Math.floor(len * 0.40), end: Math.floor(len * 0.75) },
{ start: Math.floor(len * 0.06), end: Math.floor(len * 0.25) },
{ start: Math.floor(len * 0.25), end: Math.floor(len * 0.40) }
];
const gains = [1.0, 1.6, 1.1, 1.0];
return bands.map((b, index) => {
let sum = 0;
const count = b.end - b.start || 1;
for (let i = b.start; i < b.end; i++) sum += freq[i];
const avg = sum / (count * 255);
return Math.pow(avg, 1.3) * gains[index];
});
}
drawVerticalCapsule(cx, cy, width, height) {
const r = width / 2;
const halfH = height / 2;
const isDark = state.theme === 'dark';
const grad = this.ctx.createLinearGradient(cx - r, cy, cx + r, cy);
if (isDark) {
grad.addColorStop(0.00, '#b0b0b0');
grad.addColorStop(0.08, '#d4d4d4');
grad.addColorStop(0.15, '#ffffff');
grad.addColorStop(0.22, '#e8e8e8');
grad.addColorStop(0.40, '#e0e0e0');
grad.addColorStop(0.65, '#b8b8b8');
grad.addColorStop(0.88, '#c8c8c8');
grad.addColorStop(1.00, '#a8a8a8');
} else {
grad.addColorStop(0.00, '#111111');
grad.addColorStop(0.08, '#222222');
grad.addColorStop(0.15, '#444444');
grad.addColorStop(0.22, '#2a2a2a');
grad.addColorStop(0.40, '#1a1a1a');
grad.addColorStop(0.65, '#0a0a0a');
grad.addColorStop(0.88, '#151515');
grad.addColorStop(1.00, '#000000');
}
this.ctx.beginPath();
this.ctx.arc(cx, cy - halfH + r, r, Math.PI, 0, false);
this.ctx.lineTo(cx + r, cy + halfH - r);
this.ctx.arc(cx, cy + halfH - r, r, 0, Math.PI, false);
this.ctx.lineTo(cx - r, cy - halfH + r);
this.ctx.closePath();
const dpr = window.devicePixelRatio || 1;
this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
this.ctx.shadowBlur = 25 * dpr;
this.ctx.shadowOffsetY = 15 * dpr;
this.ctx.fillStyle = grad;
this.ctx.fill();
this.ctx.shadowColor = 'transparent';
this.ctx.shadowBlur = 0;
this.ctx.shadowOffsetY = 0;
}
animate() {
if (!this.isRunning) return;
this.ctx.clearRect(0, 0, this.W, this.H);
const audioData = this.getFrequencyData();
const bandValues = this.getBandValues(audioData.freq);
const maxStretch = 2.8;
const stiffness = 0.12;
const damping = 0.68;
for (let i = 0; i < this.NUM_CAPSULES; i++) {
const spring = this.springs[i];
spring.target = 1 + bandValues[i] * maxStretch;
const force = (spring.target - spring.value) * stiffness;
spring.velocity += force;
spring.velocity *= damping;
spring.value += spring.velocity;
}
const dpr = window.devicePixelRatio || 1;
const baseCapsuleWidth = Math.min(this.W * 0.10, 70 * dpr);
const gap = baseCapsuleWidth * 0.25;
const totalWidth = this.NUM_CAPSULES * baseCapsuleWidth + (this.NUM_CAPSULES - 1) * gap;
const startX = (this.W - totalWidth) / 2 + baseCapsuleWidth / 2;
const centerY = this.H / 2;
for (let i = 0; i < this.NUM_CAPSULES; i++) {
const x = startX + i * (baseCapsuleWidth + gap);
const spring = this.springs[i];
const squashFactor = 1 / Math.pow(spring.value, 0.3);
const currentW = baseCapsuleWidth * squashFactor;
const currentH = baseCapsuleWidth * spring.value;
this.drawVerticalCapsule(x, centerY, currentW, currentH);
}
requestAnimationFrame(this.animate);
}
destroy() {
this.isRunning = false;
window.removeEventListener('resize', this.handleResize);
try {
this.sourceNode.disconnect(this.analyser);
} catch (e) {}
}
}
function detectSilenceLoop() {
if (!state.isRecording) return;
if (state.isPaused) {
state.animationFrameId = requestAnimationFrame(detectSilenceLoop);
return;
}
const bufferLength = state.analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);
state.analyser.getByteFrequencyData(dataArray);
const timeArray = new Uint8Array(state.analyser.fftSize);
state.analyser.getByteTimeDomainData(timeArray);
const pitch = autoCorrelate(timeArray, state.audioContext.sampleRate);
let maxVal = 0;
for (let i = 0; i < bufferLength; i++) if (dataArray[i] > maxVal) maxVal = dataArray[i];
const isSilent = maxVal < 15;
if (isSilent) {
if (!state.silenceTimer) {
state.silenceTimer = setTimeout(() => {
state.isSilent = true;
document.getElementById('rec-silence').classList.add('active');
document.getElementById('recording-canvas').style.display = 'none';
}, 800);
}
state.unpitchedDuration = 0;
} else {
if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
if (state.isSilent) {
state.isSilent = false;
document.getElementById('rec-silence').classList.remove('active');
document.getElementById('recording-canvas').style.display = 'block';
}
if (pitch > 50 && pitch < 500) {
    state.currentPitch = pitch;
    state.recentPitches.push(pitch);
    if (state.recentPitches.length > 60) state.recentPitches.shift();
}

// Music detection using spectral spread.
// Music has energy distributed across many frequency bins at once.
// Speech concentrates energy in a narrow band.
// Count how many bins are meaningfully active (above a noise floor).
let activeBins = 0;
for (let i = 0; i < bufferLength; i++) { if (dataArray[i] > 30) activeBins++; }
const spectralSpread = activeBins / bufferLength;

// Also measure spectral flatness — music tends to have energy
// spread more evenly than a voice, which spikes in narrow bands.
let sumLog = 0, sumLinear = 0;
let validBins = 0;
for (let i = 1; i < bufferLength; i++) {
    if (dataArray[i] > 0) {
        sumLog += Math.log(dataArray[i]);
        sumLinear += dataArray[i];
        validBins++;
    }
}
const geometricMean = validBins > 0 ? Math.exp(sumLog / validBins) : 0;
const arithmeticMean = validBins > 0 ? sumLinear / validBins : 1;
const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

// Music signature: wide spectral spread + moderate flatness + not silent
const looksLikeMusic = spectralSpread > 0.25 && spectralFlatness > 0.08 && maxVal > 40;

if (looksLikeMusic) {
    state.unpitchedDuration += 1/60;
    if (state.unpitchedDuration > 1.2 && !state.musicDetected) {
        state.musicDetected = true;
        if (state.recognition) {
    try { state.recognition.stop(); } catch(e) {}
}
        state.finalTranscript += '\n[MUSIC]\n';
        updateLiveTranscript();
    }
} else {
    state.unpitchedDuration = Math.max(0, state.unpitchedDuration - 1/30);
    if (state.unpitchedDuration < 0.3 && state.musicDetected) {
        state.musicDetected = false;
        state.recentPitches = [];
        if (state.isRecording && !state.isPaused && state.recognition) {
            try { state.recognition.start(); } catch(e) {}
        }
    }
}
}
state.waveformData.push(maxVal / 255);
if (state.waveformData.length > 500) state.waveformData.shift();
state.animationFrameId = requestAnimationFrame(detectSilenceLoop);
}
function autoCorrelate(buf, sampleRate) {
let SIZE = buf.length;
let rms = 0;
for (let i = 0; i < SIZE; i++) {
let val = (buf[i] - 128) / 128;
rms += val * val;
}
rms = Math.sqrt(rms / SIZE);
if (rms < 0.01) return -1;
let r1 = 0, r2 = SIZE - 1, thres = 0.2;
for (let i = 0; i < SIZE / 2; i++) if (Math.abs((buf[i] - 128) / 128) < thres) { r1 = i; break; }
for (let i = 1; i < SIZE / 2; i++) if (Math.abs((buf[SIZE - i] - 128) / 128) < thres) { r2 = SIZE - i; break; }
let newBuf = [];
for (let i = r1; i <= r2; i++) newBuf.push(buf[i]);
buf = newBuf;
SIZE = buf.length;
if (SIZE < 2) return -1;
let c = new Array(SIZE).fill(0);
for (let i = 0; i < SIZE; i++)
for (let j = 0; j < SIZE - i; j++)
c[i] = c[i] + (buf[j] - 128) * (buf[j + i] - 128);
let d = 0;
while (d < SIZE - 1 && c[d] > c[d + 1]) d++;
let maxval = -1, maxpos = -1;
for (let i = d; i < SIZE; i++) {
if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
}
let T0 = maxpos;
if (T0 <= 0 || T0 >= SIZE - 1) return -1;
let T0_corrected = T0;
if (T0 * 2 < SIZE) {
if (c[T0 * 2] > 0.8 * maxval) {
T0_corrected = T0 * 2;
}
}
let x1 = (T0_corrected - 1 >= 0) ? c[T0_corrected - 1] : 0;
let x2 = c[T0_corrected];
let x3 = (T0_corrected + 1 < SIZE) ? c[T0_corrected + 1] : 0;
let a = (x1 + x3 - 2 * x2) / 2;
let b = (x3 - x1) / 2;
if (a) T0_corrected = T0_corrected - b / (2 * a);
return sampleRate / T0_corrected;
}
async function startRecording() {
if (!state.permissionsGranted) {
state.pendingAction = 'record';
document.getElementById('permission-overlay').classList.add('active');
return;
}
state.finalTranscript = '';
state.interimTranscript = '';
state.waveformData = [];
state.recordingWordTimings = [];
state.recordingWordCount = 0;
state.lastFinalTime = 0;
state.isSilent = true;
state.lastSentenceEnd = 0;
state.totalPausedDuration = 0;
state.pausedAt = null;
state.currentPitch = 0;
state.lastSpeakerId = null;
state.speakerProfiles = [];
state.unpitchedDuration = 0;
state.musicDetected = false;
state.recentPitches = [];
document.getElementById('rec-timer').textContent = '00:00';
document.getElementById('rec-silence').classList.remove('active');
document.getElementById('rec-live-text').innerHTML = '<span class="rec-listening">Listening...</span>';
const recCanvas = document.getElementById('recording-canvas');
if (recCanvas) {
const ctx = recCanvas.getContext('2d');
ctx.clearRect(0, 0, recCanvas.width, recCanvas.height);
recCanvas.style.display = 'block';
}
document.getElementById('rec-pause-btn').textContent = 'Pause';
try {
const stream = await navigator.mediaDevices.getUserMedia({audio: true});
state.micStream = stream;
state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
state.analyser = state.audioContext.createAnalyser();
state.analyser.fftSize = 2048;
const source = state.audioContext.createMediaStreamSource(stream);
source.connect(state.analyser);
const mimeType = MediaRecorder.isTypeSupported('audio/mp4') 
  ? 'audio/mp4'
  : MediaRecorder.isTypeSupported('audio/webm') 
  ? 'audio/webm' 
  : '';

state.mediaRecorder = mimeType 
  ? new MediaRecorder(stream, { mimeType }) 
  : new MediaRecorder(stream);

state.currentMimeType = mimeType || 'audio/webm';
state.audioChunks = [];
state.mediaRecorder.ondataavailable = (e) => {
if (e.data.size > 0) state.audioChunks.push(e.data);
};
state.mediaRecorder.start(100);
showScreen('screen-recording');
if (state.recognition) {
updateLiveTranscript();
try {
state.recognition.start();
} catch(e) {}
}
state.isRecording = true;
state.isPaused = false;
state.recordingStartTime = Date.now();
state.timerInterval = setInterval(updateTimer, 1000);
state.audioReactor = new AudioReactor(recCanvas, state.audioContext, source);
detectSilenceLoop();
haptic([10, 50, 10]);
} catch(e) {
console.error('Recording error:', e);
showToast('Could not start recording');
}
}
function updateTimer() {
if (!state.recordingStartTime) return;
const elapsed = Math.floor(getRecordingElapsedTime());
const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
const s = (elapsed % 60).toString().padStart(2, '0');
document.getElementById('rec-timer').textContent = `${m}:${s}`;
}
function updateLiveTranscript() {
const el = document.getElementById('rec-live-text');
if (!state.finalTranscript && !state.interimTranscript) {
el.innerHTML = '<span class="rec-listening">Listening...</span>';
return;
}
let safeFinal = escapeHtml(state.finalTranscript);
safeFinal = safeFinal.replace(/\[MUSIC\]/g, '<span class="transcript-pill music-pill">Music playing</span>');
safeFinal = safeFinal.replace(/\[MALE_(\d+)\]/g, '<span class="transcript-pill male-pill">MALE $1</span>');
safeFinal = safeFinal.replace(/\[FEMALE_(\d+)\]/g, '<span class="transcript-pill female-pill">FEMALE $1</span>');
safeFinal = safeFinal.replace(/\n/g, '<br>');
const safeInterim = escapeHtml(state.interimTranscript);
el.innerHTML = `<span class="rec-final">${safeFinal}</span> <span class="rec-interim">${safeInterim}</span>`;
const preview = document.querySelector('.rec-transcript-preview');
if (preview) preview.scrollTop = preview.scrollHeight;
}
function togglePause() {
if (!state.isRecording) return;
if (state.isPaused) {
state.mediaRecorder.resume();
if (state.recognition) {
try { state.recognition.start(); } catch(e) {}
}
state.isPaused = false;
state.totalPausedDuration += (Date.now() - state.pausedAt);
state.pausedAt = null;
document.getElementById('rec-pause-btn').textContent = 'Pause';
state.timerInterval = setInterval(updateTimer, 1000);
} else {
state.mediaRecorder.pause();
if (state.recognition) {
try { state.recognition.stop(); } catch(e) {}
}
state.isPaused = true;
state.pausedAt = Date.now();
document.getElementById('rec-pause-btn').textContent = 'Resume';
clearInterval(state.timerInterval);
}
haptic(10);
}
function finishRecording() {
if (!state.isRecording) return;
state.isRecording = false;
clearInterval(state.timerInterval);
if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
if (state.audioReactor) {
state.audioReactor.destroy();
state.audioReactor = null;
}
if (state.silenceTimer) clearTimeout(state.silenceTimer);
if (state.recognition) {
try { state.recognition.stop(); } catch(e) {}
}
state.mediaRecorder.onstop = () => {
const audioBlob = new Blob(state.audioChunks, {type: state.currentMimeType || 'audio/webm'});
const audioUrl = URL.createObjectURL(audioBlob);
if (state.micStream) state.micStream.getTracks().forEach(t => t.stop());
if (state.audioContext) state.audioContext.close();
const elapsed = Math.floor(getRecordingElapsedTime());
const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
const s = (elapsed % 60).toString().padStart(2, '0');
const duration = m * 60 + s;
state.currentReviewAudioUrl = audioUrl;
state.currentReviewBlob = audioBlob;
state.currentReviewDuration = duration;
state.currentReviewWordTimings = [...state.recordingWordTimings];
setupReviewScreen();
};
state.mediaRecorder.stop();
haptic([10, 50, 10]);
}
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || 
             window.webkitSpeechRecognition || 
             window.mozSpeechRecognition ||
             window.msSpeechRecognition;

  if (!SR) {
    console.warn('Speech recognition not supported on this browser');
    state.speechSupported = false;
    return;
  }

  state.speechSupported = true;
  state.recognition = new SR();
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';
  state.recognition.maxAlternatives = 3;
state.recognition.onresult = (event) => {
let interim = '';
let finalAdd = '';
for (let i = event.resultIndex; i < event.results.length; i++) {
const result = event.results[i];
const transcript = result[0].transcript;
if (result.isFinal) {
const elapsed = getRecordingElapsedTime();
const { formatted, sentenceEnded } = formatTranscriptChunk(transcript, elapsed);
let medianPitch = 0;
if (state.recentPitches && state.recentPitches.length > 5 && !state.musicDetected) {
const sorted = [...state.recentPitches].sort((a, b) => a - b);
medianPitch = sorted[Math.floor(sorted.length / 2)];
}
if (medianPitch >= 60 && medianPitch <= 400) {
if (!state.speakerProfiles) state.speakerProfiles = [];
let matchedSpeaker = null;
let minDiff = Infinity;
for (let sp of state.speakerProfiles) {
const diff = Math.abs(sp.avgPitch - medianPitch);
if (diff < minDiff && diff < 60) {
minDiff = diff;
matchedSpeaker = sp;
}
}
if (!matchedSpeaker) {
let gender = medianPitch < 170 ? 'Male' : 'Female';
matchedSpeaker = {
gender: gender,
avgPitch: medianPitch,
id: state.speakerProfiles.filter(s => s.gender === gender).length + 1
};
state.speakerProfiles.push(matchedSpeaker);
} else {
matchedSpeaker.avgPitch = (matchedSpeaker.avgPitch * 0.8) + (medianPitch * 0.2);
}
if (state.lastSpeakerId !== matchedSpeaker.id) {
const token = `[${matchedSpeaker.gender.toUpperCase()}_${matchedSpeaker.id}]`;
finalAdd += '\n' + token + '\n';
state.lastSpeakerId = matchedSpeaker.id;
}
}
if (formatted) {
const needsSpace = state.finalTranscript.length > 0 &&
!state.finalTranscript.endsWith(' ') &&
!state.finalTranscript.endsWith('\n') &&
!/[.!?]$/.test(state.finalTranscript) &&
!finalAdd.endsWith('\n');
if (needsSpace && !finalAdd.endsWith('\n')) {
finalAdd += ' ';
}
finalAdd += formatted;
if (sentenceEnded) {
finalAdd += ' ';
}
}
const words = transcript.trim().split(/\s+/).filter(w => w);
if (words.length > 0) {
const chunkEndTime = elapsed;
const chunkStartTime = Math.max(0, state.lastFinalTime);
const chunkDuration = chunkEndTime - chunkStartTime;
const timePerWord = words.length > 0 ? chunkDuration / words.length : 0;
words.forEach((word, idx) => {
const wordStart = chunkStartTime + (idx * timePerWord);
const wordEnd = chunkStartTime + ((idx + 1) * timePerWord);
state.recordingWordTimings.push({
wordIndex: state.recordingWordCount++,
word: word,
start: wordStart,
end: wordEnd
});
});
state.lastFinalTime = chunkEndTime;
}
} else {
interim += transcript;
}
}
if (finalAdd) {
state.finalTranscript += finalAdd;
}
state.interimTranscript = interim;
updateLiveTranscript();
};
state.recognition.onerror = (e) => {
    console.log('Speech error:', e.error);
    if (e.error === 'no-speech' || e.error === 'audio-capture') {
        // Flush any interim text to final before stopping so nothing is lost
        if (state.interimTranscript && state.interimTranscript.trim()) {
            const elapsed = getRecordingElapsedTime();
            const { formatted } = formatTranscriptChunk(state.interimTranscript, elapsed);
            if (formatted) {
                const needsSpace = state.finalTranscript.length > 0 &&
                    !state.finalTranscript.endsWith(' ') &&
                    !state.finalTranscript.endsWith('\n');
                state.finalTranscript += (needsSpace ? ' ' : '') + formatted;
            }
            state.interimTranscript = '';
            updateLiveTranscript();
        }
        if (state.isRecording && !state.isPaused) {
            try { state.recognition.stop(); } catch(err) {}
        }
    }
};
state.recognition.onend = () => {
    // Flush any buffered interim to final before restarting.
    // The gap between stop and start drops interim results permanently.
    if (state.interimTranscript && state.interimTranscript.trim()) {
        const elapsed = getRecordingElapsedTime();
        const { formatted } = formatTranscriptChunk(state.interimTranscript, elapsed);
        if (formatted) {
            const needsSpace = state.finalTranscript.length > 0 &&
                !state.finalTranscript.endsWith(' ') &&
                !state.finalTranscript.endsWith('\n');
            state.finalTranscript += (needsSpace ? ' ' : '') + formatted;
        }
        state.interimTranscript = '';
        updateLiveTranscript();
    }
    if (state.isRecording && !state.isPaused) {
        try {
            setTimeout(() => {
                if (state.isRecording && !state.isPaused) {
                    state.recognition.start();
                }
            }, 50);
        } catch(e) {
            console.log('Restart error:', e);
        }
    }
};
state.recognition.onspeechstart = () => {};
state.recognition.onspeechend = () => {
const elapsed = getRecordingElapsedTime();
if (elapsed - state.lastSentenceEnd > 1.5) {
state.lastSentenceEnd = elapsed;
}
};
}
}
function formatTranscriptChunk(rawText, elapsedTime) {
if (!rawText || !rawText.trim()) return { formatted: '', sentenceEnded: false };
let text = rawText.trim();
text = text.replace(/\s+/g, ' ');
if (text.length > 0) {
text = text.charAt(0).toUpperCase() + text.slice(1);
}
// Don't guess punctuation from keywords — the engine's own confidence
// about sentence boundaries is more accurate than word-list heuristics,
// and false positives here corrupt the chunk joining logic.
if (text.length > 30) {
text = text.replace(/\s+(and|but|or|so|yet|however|therefore|meanwhile|although|because|since)\s+/gi, (match, conj) => {
return `, ${conj.toLowerCase()} `;
});
}
const introPhrases = /^(however|therefore|meanwhile|furthermore|moreover|additionally|consequently|nevertheless|specifically|for example|for instance|in addition|on the other hand|as a result|in conclusion|to summarize|first|second|third|finally|lastly|next|then|after that|before that)\b/i;
if (introPhrases.test(text)) {
text = text.replace(/^([a-z\s]+)\s+/i, (match) => {
const firstComma = match.indexOf(',');
if (firstComma === -1 && match.trim().split(' ').length <= 4) {
return match.trim() + ', ';
}
return match;
});
}
const timeSinceLastSentence = elapsedTime - state.lastSentenceEnd;
const isLongPause = timeSinceLastSentence > 2.5;
let sentenceEnded = false;
if (isLongPause && text.length > 5 && !/[.!?]$/.test(text)) {
text += '.';
sentenceEnded = true;
state.lastSentenceEnd = elapsedTime;
}
text = text.replace(/\bi\b/g, 'I');
text = text.replace(/\bi('m|'ll|'ve|'d)\b/gi, 'I$1');
const contractions = {
'dont': "don't", 'cant': "can't", 'wont': "won't",
'shouldnt': "shouldn't", 'wouldnt': "wouldn't", 'couldnt': "couldn't",
'isnt': "isn't", 'arent': "aren't", 'wasnt': "wasn't", 'werent': "weren't",
'hasnt': "hasn't", 'havent': "haven't", 'hadnt': "hadn't",
'doesnt': "doesn't", 'didnt': "didn't", 'im': "I'm", 'ive': "I've", 'ill': "I'll", 'id': "I'd"
};
text = text.replace(/\b(dont|cant|wont|shouldnt|wouldnt|couldnt|isnt|arent|wasnt|werent|hasnt|havent|hadnt|doesnt|didnt|im|ive|ill|id)\b/gi,
match => contractions[match.toLowerCase()] || match);
const commonNames = /\b(john|jane|mike|sarah|david|emma|james|mary|robert|linda|william|elizabeth|richard|jennifer|charles|susan|joseph|margaret|thomas|dorothy|alex|chris|jessica|dan|sam|tom|anna|maria|jose|luis|carlos|juan|wei|yuki|hiroshi|fatima|ahmed|omar|ali|zainab|ishaan|priya|arjun|aisha|kwame|nia|malik|jamal|latoya|deandre|siobhan|liam|noah|olivia|ava|sophia|mason|isabella|lucas|mia|ethan|amelia|logan|harper|aiden|evelyn|elijah|abigail|jackson|emily|sebastian|ella)\b/gi;
text = text.replace(commonNames, match => match.charAt(0).toUpperCase() + match.slice(1).toLowerCase());
return { formatted: text, sentenceEnded };
}
function getRecordingElapsedTime() {
if (!state.recordingStartTime) return 0;
let paused = state.totalPausedDuration || 0;
if (state.pausedAt) paused += (Date.now() - state.pausedAt);
return (Date.now() - state.recordingStartTime - paused) / 1000;
}
async function setupReviewScreen() {
const now = new Date();
const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
document.getElementById('rev-date').textContent = dateStr;
const combinedTranscript = (state.finalTranscript + ' ' + state.interimTranscript).trim();
const cleanTranscript = combinedTranscript.replace(/\[MALE_\d+\]/g, '').replace(/\[FEMALE_\d+\]/g, '').replace(/\[MUSIC\]/g, '').replace(/\n/g, ' ').trim();
const words = cleanTranscript.split(/\s+/).slice(0, 5).join(' ');
document.getElementById('rev-title-input').value = words || 'New Voice Note';
document.getElementById('rev-textarea').value = combinedTranscript;
const audio = document.getElementById('review-audio');
audio.src = state.currentReviewAudioUrl;
state.reviewPlaying = false;
document.getElementById('rev-play-btn').textContent = 'Play';
document.getElementById('rev-time-label').textContent = '';
await new Promise((resolve) => {
audio.onloadedmetadata = () => {
updateReviewTimeLabel(audio);
resolve();
};
audio.onerror = () => resolve();
});
showScreen('screen-review');
audio.ontimeupdate = () => {
if (state.isScrubbingReview) return;
updateReviewTimeLabel(audio);
const dur = getReviewDuration();
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawReviewWaveform(progress, state.scrubScaleReview);
};
audio.onended = () => {
state.reviewPlaying = false;
document.getElementById('rev-play-btn').textContent = 'Play';
drawReviewWaveform(1, 1);
};
audio.onpause = () => {
state.reviewPlaying = false;
document.getElementById('rev-play-btn').textContent = 'Play';
};
audio.onplay = () => {
state.reviewPlaying = true;
document.getElementById('rev-play-btn').textContent = 'Pause';
};
setTimeout(() => drawReviewWaveform(0, 1), 100);
}
function getReviewDuration() {
const audio = document.getElementById('review-audio');
if (audio.duration && isFinite(audio.duration)) return audio.duration;
return state.currentReviewDuration || 1;
}
function updateReviewTimeLabel(audio) {
const dur = getReviewDuration();
const cur = Math.floor(audio.currentTime || 0);
const total = Math.floor(dur);
const cm = Math.floor(cur / 60).toString().padStart(2, '0');
const cs = (cur % 60).toString().padStart(2, '0');
const tm = Math.floor(total / 60).toString().padStart(2, '0');
const ts = (total % 60).toString().padStart(2, '0');
document.getElementById('rev-time-label').textContent = `${cm}:${cs} / ${tm}:${ts}`;
}
function drawReviewWaveform(progress = 0, playheadScale = 1) {
const canvas = document.getElementById('review-canvas');
const ctx = canvas.getContext('2d');
const container = canvas.parentElement;
const dpr = window.devicePixelRatio || 1;
const dw = container.offsetWidth, dh = container.offsetHeight;
canvas.width = dw * dpr;
canvas.height = dh * dpr;
canvas.style.width = dw + 'px';
canvas.style.height = dh + 'px';
ctx.scale(dpr, dpr);
ctx.clearRect(0, 0, dw, dh);
const data = state.waveformData;
if (data.length === 0) return;
const barCount = Math.min(60, data.length);
const barWidth = 2;
const gap = (dw - barCount * barWidth) / (barCount - 1);
const cy = dh / 2;
const playheadX = Math.min(Math.max(progress, 0), 1) * dw;
const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
for (let i = 0; i < barCount; i++) {
const di = Math.floor(i * data.length / barCount);
const value = data[di] || 0;
const bh = Math.max(3, value * dh * 0.7);
const x = i * (barWidth + gap), y = cy - bh / 2;
ctx.fillStyle = x < playheadX ? (isDark ? '#FFFFFF' : '#000000') : (isDark ? '#444444' : '#D0D0D0');
ctx.beginPath();
if (ctx.roundRect) {
ctx.roundRect(x, y, barWidth, bh, 1);
} else {
ctx.rect(x, y, barWidth, bh);
}
ctx.fill();
}
if (progress >= 0 && progress <= 1) {
const baseRadius = 5;
const radius = baseRadius * playheadScale;
ctx.fillStyle = '#E8342A';
ctx.beginPath();
ctx.arc(playheadX, cy, radius, 0, Math.PI * 2);
ctx.fill();
if (playheadScale > 1) {
ctx.fillStyle = '#FFFFFF';
ctx.beginPath();
ctx.arc(playheadX, cy, radius * 0.4, 0, Math.PI * 2);
ctx.fill();
}
}
}
function playReviewAudio() {
const audio = document.getElementById('review-audio');
if (audio.paused) {
audio.play();
haptic(10);
} else {
audio.pause();
haptic(10);
}
}
function rewindReviewAudio() {
const audio = document.getElementById('review-audio');
audio.currentTime = 0;
audio.pause();
state.reviewPlaying = false;
document.getElementById('rev-play-btn').textContent = 'Play';
drawReviewWaveform(0, 1);
haptic(10);
}
function stopReviewAudio() {
const audio = document.getElementById('review-audio');
if (audio && !audio.paused) audio.pause();
state.reviewPlaying = false;
const btn = document.getElementById('rev-play-btn');
if (btn) btn.textContent = 'Play';
state.isScrubbingReview = false;
state.scrubScaleReview = 1;
}
function discardRecording() {
showModal(
"Are you sure you want to discard this recording?",
"Discard",
() => {
exitRecording();
haptic([10, 50, 10]);
},
'#FF3B30'
);
}
function discardReview() {
showModal(
"Are you sure you want to discard this recording?",
"Discard",
() => {
stopReviewAudio();
if (state.currentReviewAudioUrl) URL.revokeObjectURL(state.currentReviewAudioUrl);
goBackFromReview();
haptic([10, 50, 10]);
},
'#FF3B30'
);
}
function goBackFromReview() {
stopReviewAudio();
state.isRecording = false;
state.isPaused = false;
clearInterval(state.timerInterval);
if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
if (state.audioReactor) {
state.audioReactor.destroy();
state.audioReactor = null;
}
if (state.silenceTimer) clearTimeout(state.silenceTimer);
if (state.recognition) {
  try { state.recognition.stop(); } catch(e) {}
}
if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
if (state.micStream) state.micStream.getTracks().forEach(t => t.stop());
if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close();
document.getElementById('rec-silence').classList.remove('active');
document.getElementById('rec-timer').textContent = '00:00';
document.getElementById('rec-pause-btn').textContent = 'Pause';
document.getElementById('rec-live-text').innerHTML = '<span class="rec-listening">Listening...</span>';
state.totalPausedDuration = 0;
state.pausedAt = null;
goBack();
}
function exitRecording() {
if (state.isRecording) {
showModal(
"Are you sure you want to discard this recording?",
"Discard",
() => {
goBackFromReview();
haptic([10, 50, 10]);
},
'#FF3B30'
);
} else {
goBackFromReview();
}
}
function saveNote() {
const title = document.getElementById('rev-title-input').value.trim();
const body = document.getElementById('rev-textarea').value;
if (!title) {
showToast('Please enter a title');
return;
}
stopReviewAudio();
const combinedTranscript = (state.finalTranscript + ' ' + state.interimTranscript).trim();
state.notes.unshift({
  id: 'note_' + Date.now(),
  title,
  originalTranscription: combinedTranscript,
  editedBody: body,
  audioFileURL: state.currentReviewAudioUrl,
  audioBlob: state.currentReviewBlob,
  mimeType: state.currentMimeType || 'audio/webm',  // ADD THIS LINE
  waveformData: [...state.waveformData],
  type: 'voice',
media: [],
tags: [],
createdAt: new Date().toISOString(),
duration: state.currentReviewDuration,
wordTimings: state.currentReviewWordTimings || []
});
saveState();
showToast('Note saved');
haptic([10, 50, 10]);
while (state.navStack.length > 1) state.navStack.pop();
showScreen('screen-home');
}
function getDetailDuration(note) {
if (state.detailAudioBuffer && state.detailAudioBuffer.duration > 0) {
return state.detailAudioBuffer.duration;
}
const audio = document.getElementById('detail-audio');
if (audio && audio.duration && isFinite(audio.duration) && audio.duration > 0) {
return audio.duration;
}
if (note.duration && note.duration > 0) return note.duration;
return 1;
}
async function openNoteDetail(id) {
const note = state.notes.find(n => n.id === id);
if (!note) return;
state.currentNoteId = id;
state.detailAudioPlaying = false;
state.currentWordIndex = -1;
state.wordTiming = [];
state.detailAudioBuffer = null;
state.scrubScaleDetail = 1;
if (state.highlightRafId) cancelAnimationFrame(state.highlightRafId);
document.getElementById('det-title-input').value = note.title;
const date = new Date(note.createdAt);
const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).replace(',', '');
document.getElementById('det-date').textContent = dateStr;
const text = note.editedBody || note.originalTranscription || '';
const cleanText = text.replace(/\[MALE_\d+\]/g, '').replace(/\[FEMALE_\d+\]/g, '').replace(/\[MUSIC\]/g, '').trim();
const words = cleanText ? cleanText.split(/\s+/).length : 0;
document.getElementById('det-word-count').textContent = `${words} Words`;
const dur = note.duration || 0;
const dm = Math.floor(dur / 60).toString().padStart(2, '0');
const ds = Math.floor(dur % 60).toString().padStart(2, '0');
document.getElementById('det-audio-length').textContent = note.type === 'voice' ? `${dm}:${ds}` : '--:--';
const mediaContainer = document.getElementById('det-media-container');
mediaContainer.innerHTML = '';
if (note.media && note.media.length > 0) {
note.media.forEach(m => createMediaElement(m, mediaContainer));
}
const audioContainer = document.getElementById('det-audio-container');
if (note.type === 'voice' && note.audioFileURL) {
audioContainer.style.display = 'flex';
const audio = document.getElementById('detail-audio');
audio.src = note.audioFileURL;
const playIcon = document.querySelector('.det-play-icon');
const pauseIcon = document.querySelector('.det-pause-icon');
if (playIcon) playIcon.style.display = 'block';
if (pauseIcon) pauseIcon.style.display = 'none';
decodeAudioDuration(note.audioFileURL, note.duration || 1).then(decodedDuration => {
note.decodedDuration = decodedDuration;
state.detailAudioBuffer = { duration: decodedDuration };
if (note.wordTimings && note.wordTimings.length > 0) {
state.wordTiming = note.wordTimings.map(t => ({...t}));
} else {
buildWordTiming(note);
}
drawDetailWaveform(0, note.waveformData, false, 1);
});
audio.ontimeupdate = () => {
if (state.isScrubbingDetail) return;
const dur = getDetailDuration(note);
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawDetailWaveform(Math.min(progress, 1), note.waveformData, state.detailAudioPlaying, state.scrubScaleDetail);
};
audio.onended = () => {
stopDetailHighlight();
drawDetailWaveform(1, note.waveformData, false, 1);
};
audio.onpause = () => {
stopDetailHighlight();
const playIcon = document.querySelector('.det-play-icon');
const pauseIcon = document.querySelector('.det-pause-icon');
if (playIcon) playIcon.style.display = 'block';
if (pauseIcon) pauseIcon.style.display = 'none';
};
audio.onplay = () => {
state.detailAudioPlaying = true;
document.getElementById('det-editable-text').classList.add('playing');
const playIcon = document.querySelector('.det-play-icon');
const pauseIcon = document.querySelector('.det-pause-icon');
if (playIcon) playIcon.style.display = 'none';
if (pauseIcon) pauseIcon.style.display = 'block';
if (!state.wordTiming || state.wordTiming.length === 0) {
if (note.wordTimings && note.wordTimings.length > 0) {
state.wordTiming = note.wordTimings.map(t => ({...t}));
} else {
buildWordTiming(note);
}
}
startDetailHighlightLoop();
};
} else {
audioContainer.style.display = 'none';
}
const container = document.getElementById('det-editable-text');
renderDetailText();
renderDetailTags();
showScreen('screen-detail');
}
function buildWordTiming(note) {
const duration = getDetailDuration(note);
if (!duration || duration <= 0) return;
const text = note.originalTranscription || '';
const cleanText = text.replace(/\[MALE_\d+\]/g, '').replace(/\[FEMALE_\d+\]/g, '').replace(/\[MUSIC\]/g, '');
const tokens = cleanText.split(/(\s+)/);
const words = tokens.filter(t => /\S/.test(t));
if (words.length === 0) {
state.wordTiming = [];
return;
}
const timePerWord = duration / words.length;
state.wordTiming = [];
let currentWordIdx = 0;
tokens.forEach((token) => {
if (/\S/.test(token)) {
const startTime = currentWordIdx * timePerWord;
const endTime = (currentWordIdx + 1) * timePerWord;
state.wordTiming.push({
wordIndex: currentWordIdx,
word: token,
start: startTime,
end: endTime
});
currentWordIdx++;
}
});
}
function startDetailHighlightLoop() {
if (state.highlightRafId) cancelAnimationFrame(state.highlightRafId);
function tick() {
if (!state.detailAudioPlaying) return;
const audio = document.getElementById('detail-audio');
if (audio.ended) {
stopDetailHighlight();
return;
}
updateWordHighlight();
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note && !state.isScrubbingDetail) {
const dur = getDetailDuration(note);
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawDetailWaveform(Math.min(progress, 1), note.waveformData, true, state.scrubScaleDetail);
}
state.highlightRafId = requestAnimationFrame(tick);
}
state.highlightRafId = requestAnimationFrame(tick);
}
function stopDetailHighlight() {
state.detailAudioPlaying = false;
if (state.highlightRafId) {
cancelAnimationFrame(state.highlightRafId);
state.highlightRafId = null;
}
const editable = document.getElementById('det-editable-text');
if (editable) editable.classList.remove('playing');
const playIcon = document.querySelector('.det-play-icon');
const pauseIcon = document.querySelector('.det-pause-icon');
if (playIcon) playIcon.style.display = 'block';
if (pauseIcon) pauseIcon.style.display = 'none';
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note) {
renderDetailText();
const audio = document.getElementById('detail-audio');
const dur = getDetailDuration(note);
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawDetailWaveform(Math.min(progress, 1), note.waveformData, false, state.scrubScaleDetail);
}
}
function updateWordHighlight() {
const audio = document.getElementById('detail-audio');
const container = document.getElementById('det-editable-text');
if (!container) return;
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note) return;
const currentTime = audio.currentTime;
if (!state.wordTiming || state.wordTiming.length === 0) {
if (note.wordTimings && note.wordTimings.length > 0) {
state.wordTiming = note.wordTimings.map(t => ({...t}));
} else {
buildWordTiming(note);
}
if (!state.wordTiming || state.wordTiming.length === 0) return;
}
let activeWordIndex = -1;
for (let i = 0; i < state.wordTiming.length; i++) {
const w = state.wordTiming[i];
if (currentTime >= w.start && currentTime < w.end) {
activeWordIndex = w.wordIndex;
break;
}
}
if (activeWordIndex === -1 && state.wordTiming.length > 0) {
const lastTiming = state.wordTiming[state.wordTiming.length - 1];
if (currentTime >= lastTiming.end) {
activeWordIndex = lastTiming.wordIndex;
} else if (currentTime < state.wordTiming[0].start) {
activeWordIndex = 0;
}
}
if (activeWordIndex !== state.currentWordIndex) {
state.currentWordIndex = activeWordIndex;
const targetSpan = container.querySelector(`.det-word.det-original[data-word-index="${activeWordIndex}"]`);
container.querySelectorAll('.det-word.det-current-word').forEach(span => {
span.classList.remove('det-current-word');
});
if (targetSpan) {
targetSpan.classList.add('det-current-word');
}
}
if (activeWordIndex >= 0) {
const currentSpan = container.querySelector(`.det-word.det-original[data-word-index="${activeWordIndex}"]`);
if (currentSpan) {
const rect = currentSpan.getBoundingClientRect();
const containerRect = container.getBoundingClientRect();
if (rect.top < containerRect.top + 80 || rect.bottom > containerRect.bottom - 80) {
currentSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
}
}
}
function renderDetailText() {
    const note = state.notes.find(n => n.id === state.currentNoteId);
    if (!note) return;
    const container = document.getElementById('det-editable-text');
    const originalText = note.originalTranscription || '';
    const editedText = note.editedBody || originalText; // Reverted to normal
    container.innerHTML = '';

// Skip diffing for written notes as they have no original audio transcript
if (note.type === 'written') {
    container.textContent = editedText;
    return;
}

let originalWordIdx = 0;
// Use your existing diffWords function to compare original vs edited
const diffResult = diffWords(originalText, editedText);

diffResult.forEach(part => {
    if (part.removed) return; // Skip words that were in the audio but deleted by the user

    // Split by whitespace to process words and spaces individually
    const tokens = part.value.split(/(\s+)/);
    
    tokens.forEach(token => {
        if (!token) return;
        
        // Handle whitespace and newlines
        if (/\s+/.test(token)) {
            if (token.includes('\n')) {
                const lines = token.split('\n');
                lines.forEach((line, i) => {
                    if (line) container.appendChild(document.createTextNode(line));
                    if (i < lines.length - 1) container.appendChild(document.createElement('br'));
                });
            } else {
                container.appendChild(document.createTextNode(token));
            }
            return;
        }

        // Check for special transcript pills
        const musicMatch = token.match(/^\[MUSIC\]$/);
        const maleMatch = token.match(/^\[MALE_(\d+)\]$/);
        const femaleMatch = token.match(/^\[FEMALE_(\d+)\]$/);

        if (musicMatch) {
            const pill = document.createElement('span');
            pill.className = 'transcript-pill music-pill';
            pill.contentEditable = 'false';
            pill.textContent = 'Music playing';
            container.appendChild(pill);
        } else if (maleMatch) {
            const pill = document.createElement('span');
            pill.className = 'transcript-pill male-pill';
            pill.contentEditable = 'false';
            pill.textContent = `MALE ${maleMatch[1]}`;
            container.appendChild(pill);
        } else if (femaleMatch) {
            const pill = document.createElement('span');
            pill.className = 'transcript-pill female-pill';
            pill.contentEditable = 'false';
            pill.textContent = `FEMALE ${femaleMatch[1]}`;
            container.appendChild(pill);
        } else {
            // Regular word rendering
            if (part.added) {
                // FIX: Inject added words as PLAIN TEXT NODES.
                // Because the parent container is gray/italic by default (via CSS), 
                // this text will appear gray. More importantly, because it is NOT 
                // inside a <span>, the mobile keyboard won't lose its anchor and 
                // won't trigger phantom line breaks!
                container.appendChild(document.createTextNode(token));
            } else {
                const span = document.createElement('span');
                span.className = 'det-word det-original';
                span.setAttribute('data-word-index', originalWordIdx++);
                span.textContent = token;
                container.appendChild(span);
                // Append a zero-width text node after each original span.
                // This gives the browser a neutral text node to extend into when
                // the user types adjacent to a span, preventing the span's black
                // color from being inherited by newly typed (added) characters.
                container.appendChild(document.createTextNode('\u200B'));
            }
        }
    });
});
}
function getRawTextFromDOM(el) {
    let raw = '';
    el.childNodes.forEach((node, index) => {
        if (node.nodeType === Node.TEXT_NODE) {
            raw += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList.contains('male-pill')) {
                const match = node.textContent.match(/MALE\s*(\d+)/i);
                raw += `[MALE_${match ? match[1] : '1'}]`;
            } else if (node.classList.contains('female-pill')) {
                const match = node.textContent.match(/FEMALE\s*(\d+)/i);
                raw += `[FEMALE_${match ? match[1] : '1'}]`;
            } else if (node.classList.contains('music-pill')) {
                raw += `[MUSIC]`;
            } else if (node.tagName === 'BR') {
                raw += '\n';
            } else if (node.tagName === 'DIV' || node.tagName === 'P') {
                // FIX: Only add a newline if it's NOT the very first element
                if (index > 0 || raw.length > 0) {
                    raw += '\n';
                }
                raw += getRawTextFromDOM(node);
            } else {
                raw += getRawTextFromDOM(node);
            }
        }
    });
    return raw.replace(/\u200B/g, '');
}

function handleEditInput() {
    const container = document.getElementById('det-editable-text');
    
    // Update word count immediately
    const rawText = getRawTextFromDOM(container);
    const cleanText = rawText.replace(/\[MALE_\d+\]/g, '').replace(/\[FEMALE_\d+\]/g, '').replace(/\[MUSIC\]/g, '').replace(/\n/g, ' ');
    const words = cleanText.trim() ? cleanText.trim().split(/\s+/).length : 0;
    document.getElementById('det-word-count').textContent = `${words} Words`;

    clearTimeout(editDebounce);
    editDebounce = setTimeout(() => {
        const note = state.notes.find(n => n.id === state.currentNoteId);
        if (!note) return;

        const latestRawText = getRawTextFromDOM(container);
        note.editedBody = latestRawText;

        if (state.detailAudioPlaying) {
            document.getElementById('detail-audio').pause();
        }

        // Do NOT call renderDetailText() here during typing.
        // That rebuilds the entire DOM and destroys the cursor position.
        // The visual diff (gray added words vs black original words) will
        // refresh the next time the note is opened or audio starts playing.
    }, 300);
}
function getCaretCharacterOffsetWithin(element) {
    let caretOffset = 0;
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        
        // Clone the DOM up to the cursor into a temporary, invisible div
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(preCaretRange.cloneContents());
        
        // Use your exact same parsing logic to count the characters perfectly!
        caretOffset = getRawTextFromDOM(tempDiv).length;
    }
    return caretOffset;
}
function setCaretPosition(el, offset) {
    const range = document.createRange();
    const sel = window.getSelection();
    let charCount = 0;
    let found = false;

    function traverse(node) {
        if (found) return;

        if (node.nodeType === Node.TEXT_NODE) {
            if (charCount + node.textContent.length >= offset) {
                range.setStart(node, offset - charCount);
                range.collapse(true);
                found = true;
                return;
            }
            charCount += node.textContent.length;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'BR') {
                if (charCount === offset) {
                    range.setStartAfter(node);
                    range.collapse(true);
                    found = true;
                    return;
                }
                charCount += 1; // Matches the \n in getRawTextFromDOM
            } else if (node.tagName === 'DIV' || node.tagName === 'P') {
                // Match the exact newline logic from getRawTextFromDOM
                let isBlockNewline = false;
                if (node.previousSibling || charCount > 0) {
                    isBlockNewline = true;
                }
                
                if (isBlockNewline) {
                    if (charCount === offset) {
                        range.setStartBefore(node);
                        range.collapse(true);
                        found = true;
                        return;
                    }
                    charCount += 1;
                }
            }
            
            for (let i = 0; i < node.childNodes.length; i++) {
                traverse(node.childNodes[i]);
                if (found) return;
            }
        }
    }

    traverse(el);

    if (found) {
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        // Fallback: if math slightly misaligns due to browser quirks, put cursor at the end
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
}
function diffWords(original, edited) {
    const orig = original.split(/(\s+)/);
    const edit = edited.split(/(\s+)/);
    
    // FIX: Reverse the arrays so the matching algorithm anchors to the BEGINNING 
    // of the text. This prevents duplicated sentences from turning the original text gray.
    const origRev = [...orig].reverse();
    const editRev = [...edit].reverse();
    
    const m = origRev.length, n = editRev.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = origRev[i-1] === editRev[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
        }
    }
    
    const resultRev = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && origRev[i-1] === editRev[j-1]) {
            resultRev.unshift({value: origRev[i-1], added: false, removed: false});
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
            resultRev.unshift({value: editRev[j-1], added: true, removed: false});
            j--;
        } else if (i > 0) {
            resultRev.unshift({value: origRev[i-1], added: false, removed: true});
            i--;
        }
    }
    
    // FIX: Reverse the result back to normal chronological order
    const result = resultRev.reverse();
    
    const merged = [];
    result.forEach(part => {
        const last = merged[merged.length - 1];
        if (last && last.added === part.added && last.removed === part.removed) {
            last.value += part.value;
        } else {
            merged.push({...part});
        }
    });
    return merged;
}
function drawDetailWaveform(progress, waveformData, isPlaying, playheadScale = 1) {
const canvas = document.getElementById('detail-canvas');
if (!canvas) return;
const ctx = canvas.getContext('2d');
const container = canvas.parentElement;
if (!container) return;
const dpr = window.devicePixelRatio || 1;
const dw = container.offsetWidth, dh = container.offsetHeight;
if (dw === 0 || dh === 0) return;
canvas.width = dw * dpr;
canvas.height = dh * dpr;
canvas.style.width = dw + 'px';
canvas.style.height = dh + 'px';
ctx.scale(dpr, dpr);
ctx.clearRect(0, 0, dw, dh);
const safeProgress = isNaN(progress) ? 0 : Math.min(Math.max(progress, 0), 1);
const cy = dh / 2;
const baseRadius = 7;
const lineThickness = 4;
const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
const lineStartX = baseRadius;
const lineEndX = dw - baseRadius;
const lineWidth = lineEndX - lineStartX;
const playheadX = lineStartX + (safeProgress * lineWidth);
ctx.fillStyle = isDark ? '#48484A' : '#D1D1D6';
ctx.beginPath();
if (ctx.roundRect) {
ctx.roundRect(lineStartX, cy - lineThickness / 2, lineWidth, lineThickness, lineThickness / 2);
} else {
ctx.rect(lineStartX, cy - lineThickness / 2, lineWidth, lineThickness);
}
ctx.fill();
if (safeProgress > 0) {
ctx.fillStyle = isDark ? '#FFFFFF' : '#000000';
ctx.beginPath();
const progressWidth = playheadX - lineStartX;
if (ctx.roundRect) {
ctx.roundRect(lineStartX, cy - lineThickness / 2, progressWidth, lineThickness, lineThickness / 2);
} else {
ctx.rect(lineStartX, cy - lineThickness / 2, progressWidth, lineThickness);
}
ctx.fill();
}
const radius = baseRadius * playheadScale;
ctx.shadowColor = 'rgba(0,0,0,0.25)';
ctx.shadowBlur = 8;
ctx.shadowOffsetY = 3;
ctx.fillStyle = isDark ? '#FFFFFF' : '#000000';
ctx.beginPath();
ctx.arc(playheadX, cy, radius, 0, Math.PI * 2);
ctx.fill();
ctx.shadowColor = 'transparent';
ctx.shadowBlur = 0;
ctx.shadowOffsetY = 0;
}
function toggleDetailAudio(event) {
if (event && event.target.tagName === 'CANVAS') return;
if (event && event.target.closest('.det-waveform-container')) return;
const audio = document.getElementById('detail-audio');
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note) return;
if (audio.paused) {
audio.play().catch(e => console.error('Play failed:', e));
state.detailAudioPlaying = true;
document.getElementById('det-editable-text').classList.add('playing');
if (!state.wordTiming || state.wordTiming.length === 0) {
if (note.wordTimings && note.wordTimings.length > 0) {
state.wordTiming = note.wordTimings.map(t => ({...t}));
} else {
buildWordTiming(note);
}
}
startDetailHighlightLoop();
const dur = getDetailDuration(note);
drawDetailWaveform(0, note.waveformData, true, 1);
haptic(10);
} else {
audio.pause();
stopDetailHighlight();
haptic(10);
}
}
function stopDetailAudio() {
const audio = document.getElementById('detail-audio');
if (audio && !audio.paused) audio.pause();
state.detailAudioPlaying = false;
state.isScrubbingDetail = false;
state.scrubScaleDetail = 1;
if (state.highlightRafId) {
cancelAnimationFrame(state.highlightRafId);
state.highlightRafId = null;
}
const editable = document.getElementById('det-editable-text');
if (editable) editable.classList.remove('playing');
}
function saveAndGoHome() {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note) {
note.title = document.getElementById('det-title-input').value.trim() || note.title;
note.editedBody = getRawTextFromDOM(document.getElementById('det-editable-text'));
stopDetailAudio();
saveState();
} else {
stopDetailAudio();
}
goBack();
}
function deleteCurrentNote() {
pendingDeleteNoteId = state.currentNoteId;
showModal(
"Are you sure you want to delete this note?",
"Delete",
() => {
if (!pendingDeleteNoteId) return;
const note = state.notes.find(n => n.id === pendingDeleteNoteId);
stopDetailAudio();
if (note && note.audioFileURL) URL.revokeObjectURL(note.audioFileURL);
state.notes = state.notes.filter(n => n.id !== pendingDeleteNoteId);
deleteNoteFromDB(pendingDeleteNoteId);
saveState();
showToast('Note deleted');
haptic([10, 50, 10]);
goBack();
},
'#FF3B30'
);
}
function shareCurrentNote() {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note && navigator.share) {
navigator.share({
title: note.title,
text: note.editedBody || note.originalTranscription
}).catch(() => showToast('Share sheet opened'));
} else {
showToast('Share sheet opened');
}
haptic(10);
}
function exportNoteAsMarkdown() {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note) return;
const date = new Date(note.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const title = note.title || 'Untitled Note';
let body = getRawTextFromDOM(document.getElementById('det-editable-text'));
body = body.replace(/\[MUSIC\]/g, '*[Music Playing]*')
.replace(/\[MALE_(\d+)\]/g, '*[Male Speaker $1]*')
.replace(/\[FEMALE_(\d+)\]/g, '*[Female Speaker $1]*')
.replace(/\n/g, '\n\n');
const tags = (note.tags || []).map(t => `#${t}`).join(' ');
const mdContent = `# ${title}\n\n*${date}*\n${tags ? '\n' + tags + '\n' : ''}\n---\n\n${body}`;
const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
showToast('Exported as Markdown');
haptic(10);
}
function renderDetailTags() {
const note = state.notes.find(n => n.id === state.currentNoteId);
const container = document.getElementById('det-tags-container');
if (!container || !note) return;
container.innerHTML = '';
if (!note.tags) note.tags = [];
note.tags.forEach(tag => {
const pill = document.createElement('span');
pill.className = 'tag-pill';
pill.innerHTML = `#${escapeHtml(tag)} <span class="tag-remove" onclick="removeTag('${escapeHtml(tag)}')">&times;</span>`;
container.appendChild(pill);
});
const input = document.createElement('input');
input.type = 'text';
input.className = 'tag-input';
input.placeholder = '+ Add tag';
input.onkeydown = (e) => {
if (e.key === 'Enter' && input.value.trim()) {
e.preventDefault();
addTag(input.value.trim().replace(/^#/, ''));
input.value = '';
}
};
container.appendChild(input);
}
function addTag(tag) {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note) return;
if (!note.tags) note.tags = [];
if (!note.tags.includes(tag)) {
note.tags.push(tag);
saveState();
renderDetailTags();
}
}
function removeTag(tag) {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note || !note.tags) return;
note.tags = note.tags.filter(t => t !== tag);
saveState();
renderDetailTags();
}
function exportDatabase() {
const data = JSON.stringify(state.notes, null, 2);
const blob = new Blob([data], {type: 'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `voice_notes_backup_${new Date().toISOString().slice(0,10)}.json`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
showToast('Backup exported');
haptic(10);
}
function importDatabase(event) {
const file = event.target.files[0];
if (!file) return;
const reader = new FileReader();
reader.onload = (e) => {
try {
const imported = JSON.parse(e.target.result);
if (Array.isArray(imported)) {
imported.forEach(n => {
if (n.audioData) {
try {
const byteChars = atob(n.audioData);
const byteArray = new Uint8Array(byteChars.length);
for (let i = 0; i < byteChars.length; i++) {
byteArray[i] = byteChars.charCodeAt(i);
}
n.audioBlob = new Blob([byteArray], {type: n.mimeType || 'audio/webm'});
n.audioFileURL = URL.createObjectURL(n.audioBlob);
} catch(err) {}
}
if (!n.tags) n.tags = [];
});
state.notes = [...imported, ...state.notes];
saveState();
renderHome();
showToast('Backup imported successfully');
haptic([10, 50, 10]);
} else {
showToast('Invalid backup format');
}
} catch(err) {
showToast('Failed to parse backup');
}
};
reader.readAsText(file);
event.target.value = '';
}
function ensureSelection() {
const sel = window.getSelection();
if ((!sel.rangeCount || sel.isCollapsed) && currentSelectionRange) {
sel.removeAllRanges();
sel.addRange(currentSelectionRange);
}
}
window.ctxNote = function() {
ensureSelection();
hideDetContextMenu();
showToast('Note created');
haptic(10);
};
window.ctxHighlight = function() {
ensureSelection();
document.querySelector('.ctx-main-menu').style.display = 'none';
document.getElementById('ctx-highlight-submenu').classList.add('active');
haptic(10);
};
window.ctxCopy = function() {
ensureSelection();
const sel = window.getSelection().toString();
if (sel) {
navigator.clipboard.writeText(sel).then(() => showToast('Copied')).catch(() => showToast('Copied'));
} else {
showToast('Copied');
}
hideDetContextMenu();
haptic(10);
};
window.ctxExport = function() {
hideDetContextMenu();
exportNoteAsMarkdown();
};
window.ctxTranslate = function() {
ensureSelection();
hideDetContextMenu();
showToast('Translate invoked');
haptic(10);
};
window.ctxDictionary = function() {
ensureSelection();
hideDetContextMenu();
showToast('Dictionary opened');
haptic(10);
};
window.ctxShare = function() {
ensureSelection();
hideDetContextMenu();
showToast('Share sheet opened');
haptic(10);
};
window.ctxBackToMain = function() {
document.getElementById('ctx-highlight-submenu').classList.remove('active');
document.querySelector('.ctx-main-menu').style.display = 'block';
haptic(10);
};
window.applyHighlight = function(color) {
ensureSelection();
const sel = window.getSelection();
if (sel.rangeCount > 0) {
const range = sel.getRangeAt(0);
const span = document.createElement('span');
span.style.backgroundColor = color;
span.style.borderRadius = '3px';
span.style.padding = '0 2px';
try {
range.surroundContents(span);
} catch(e) {}
}
hideDetContextMenu();
showToast('Highlighted');
haptic(10);
};
function measureAndPositionMenu() {
const menu = document.getElementById('det-context-menu');
const screen = document.getElementById('screen-detail');
const screenRect = screen.getBoundingClientRect();
const sel = window.getSelection();
if (!sel.rangeCount) return;
const range = sel.getRangeAt(0);
const selRect = range.getBoundingClientRect();
if (selRect.width === 0 && selRect.height === 0) return;
const wasActive = menu.classList.contains('active');
menu.style.display = 'block';
menu.style.visibility = 'hidden';
menu.style.left = '0px';
menu.style.top = '0px';
const menuHeight = menu.offsetHeight;
const selCenterX = selRect.left + selRect.width / 2;
const menuWidth = 220;
let left = selCenterX - screenRect.left - (menuWidth / 2);
if (left < 10) left = 10;
if (left + menuWidth > screenRect.width - 10) left = screenRect.width - menuWidth - 10;
let top = selRect.top - screenRect.top - menuHeight - 12;
let origin = 'center bottom';
if (top < 10) {
top = selRect.bottom - screenRect.top + 12;
origin = 'center top';
}
menu.style.left = left + 'px';
menu.style.top = top + 'px';
menu.style.transformOrigin = origin;
menu.style.visibility = 'visible';
if (!wasActive) {
void menu.offsetWidth;
menu.classList.add('active');
menu.classList.remove('closing');
}
}
function showDetContextMenu(e) {
const menu = document.getElementById('det-context-menu');
let sel = window.getSelection();
if (!sel.rangeCount || sel.isCollapsed) {
let range = null;
const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
if (document.caretRangeFromPoint) {
range = document.caretRangeFromPoint(clientX, clientY);
} else if (document.caretPositionFromPoint) {
let pos = document.caretPositionFromPoint(clientX, clientY);
if (pos) {
range = document.createRange();
range.setStart(pos.offsetNode, pos.offset);
range.collapse(true);
}
}
if (range) {
const textNode = range.startContainer;
if (textNode.nodeType === Node.TEXT_NODE) {
const text = textNode.textContent;
let start = range.startOffset;
let end = range.startOffset;
while (start > 0 && /\w/.test(text[start - 1])) start--;
while (end < text.length && /\w/.test(text[end])) end++;
if (start !== end) {
range.setStart(textNode, start);
range.setEnd(textNode, end);
sel.removeAllRanges();
sel.addRange(range);
}
}
}
}
if (!sel.rangeCount || sel.isCollapsed) return;
currentSelectionRange = sel.getRangeAt(0).cloneRange();
isMenuOpen = true;
document.querySelector('.ctx-main-menu').style.display = 'block';
document.getElementById('ctx-highlight-submenu').classList.remove('active');
measureAndPositionMenu();
document.addEventListener('selectionchange', handleSelectionChange);
document.addEventListener('pointerdown', handleGlobalPointerDown, { passive: false });
document.addEventListener('mousedown', handleGlobalMouseDown, { passive: false });
}
function hideDetContextMenu(e) {
const menu = document.getElementById('det-context-menu');
if (e && menu.contains(e.target)) return;
if (!isMenuOpen) return;
isMenuOpen = false;
document.removeEventListener('selectionchange', handleSelectionChange);
document.removeEventListener('pointerdown', handleGlobalPointerDown);
document.removeEventListener('mousedown', handleGlobalMouseDown);
menu.classList.add('closing');
setTimeout(() => {
menu.classList.remove('active', 'closing');
document.querySelector('.ctx-main-menu').style.display = 'block';
document.getElementById('ctx-highlight-submenu').classList.remove('active');
}, 140);
}
function handleGlobalMouseDown(e) {
const menu = document.getElementById('det-context-menu');
if (menu.contains(e.target)) {
e.preventDefault();
}
}
function handleGlobalPointerDown(e) {
if (!isMenuOpen) return;
const menu = document.getElementById('det-context-menu');
if (menu.contains(e.target)) return;
const editableText = document.getElementById('det-editable-text');
if (editableText.contains(e.target)) {
setTimeout(() => {
if (!isMenuOpen) return;
const sel = window.getSelection();
if (!sel.rangeCount || sel.isCollapsed) {
hideDetContextMenu();
} else {
const range = sel.getRangeAt(0);
if (!editableText.contains(range.commonAncestorContainer)) {
hideDetContextMenu();
} else {
measureAndPositionMenu();
}
}
}, 10);
} else {
hideDetContextMenu();
window.getSelection().removeAllRanges();
}
}
function handleSelectionChange() {
if (!isMenuOpen) return;
const sel = window.getSelection();
const editableText = document.getElementById('det-editable-text');
if (!sel.rangeCount || sel.isCollapsed) {
hideDetContextMenu();
return;
}
const range = sel.getRangeAt(0);
if (!editableText.contains(range.commonAncestorContainer)) {
hideDetContextMenu();
return;
}
currentSelectionRange = range.cloneRange();
measureAndPositionMenu();
}
function triggerMediaImport() {
document.getElementById('media-import-input').click();
}
function handleMediaImport(event) {
const files = event.target.files;
if (!files.length) return;
const container = document.getElementById('det-media-container');
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note) return;
if (!note.media) note.media = [];
const textArea = document.getElementById('det-editable-text');
const scrollContent = document.querySelector('.det-scroll-content');
const textRect = textArea.getBoundingClientRect();
const scrollRect = scrollContent.getBoundingClientRect();
const baseY = textRect.bottom - scrollRect.top + scrollContent.scrollTop + 20;
const existingCount = note.media.length;
Array.from(files).forEach((file, index) => {
const id = 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
const offsetX = 20 + (existingCount + index) * 20;
const offsetY = baseY + (existingCount + index) * 20;
if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
const textReader = new FileReader();
textReader.onload = (te) => {
const textContent = te.target.result;
const m = {
id,
type: file.type || 'text/plain',
url: '',
name: file.name,
textContent,
width: 250,
height: 150,
rotation: 0,
x: offsetX,
y: offsetY
};
note.media.push(m);
saveState();
createMediaElement(m, container);
};
textReader.readAsText(file);
} else {
const reader = new FileReader();
reader.onload = (e) => {
const url = e.target.result;
const m = {
id,
type: file.type,
url,
name: file.name,
width: 200,
height: 150,
rotation: 0,
x: offsetX,
y: offsetY
};
if (file.type.startsWith('audio/')) m.height = 60;
note.media.push(m);
saveState();
createMediaElement(m, container);
};
reader.readAsDataURL(file);
}
});
event.target.value = '';
}
function createMediaElement(m, container) {
const item = document.createElement('div');
item.className = 'media-item';
item.dataset.id = m.id;
item.dataset.rotation = m.rotation || 0;
item.style.width = (m.width || 200) + 'px';
item.style.height = (m.height || 150) + 'px';
item.style.transform = `rotate(${m.rotation || 0}deg)`;
item.style.left = (m.x || 0) + 'px';
item.style.top = (m.y || 0) + 'px';
let contentHTML = '';
if (m.type.startsWith('image/')) {
contentHTML = `<img src="${m.url}" alt="imported image">`;
} else if (m.type.startsWith('video/')) {
contentHTML = `<video src="${m.url}" controls></video>`;
} else if (m.type.startsWith('audio/')) {
contentHTML = `<audio src="${m.url}" controls style="width:100%;"></audio>`;
} else if (m.type.startsWith('text/') || m.name.endsWith('.txt') || m.name.endsWith('.md')) {
contentHTML = `<div style="padding:10px; overflow:auto; width:100%; height:100%; font-size:14px; color:#333; background:rgba(255,255,255,0.95); border: 1px solid #eee;">${escapeHtml(m.textContent || m.name)}</div>`;
} else {
contentHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; padding:10px; text-align:center; background:rgba(255,255,255,0.95); border: 1px solid #eee;">
<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#888" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
<div style="margin-top:8px; font-size:12px; color:#666; word-break:break-all;">${escapeHtml(m.name)}</div>
</div>`;
}
item.innerHTML = `
<div class="media-content">${contentHTML}</div>
<div class="media-handle media-rotate-handle">
<svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
</div>
<div class="media-handle media-resize-handle">
<svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/></svg>
</div>
<div class="media-handle media-delete-handle">
<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
</div>
`;
container.appendChild(item);
initResize(item, item.querySelector('.media-resize-handle'));
initRotate(item, item.querySelector('.media-rotate-handle'));
initDelete(item, item.querySelector('.media-delete-handle'));
initDrag(item);
}
function showMediaHandles(item) {
document.querySelectorAll('.media-item.show-handles').forEach(el => {
if (el !== item) el.classList.remove('show-handles');
});
item.classList.add('show-handles');
resetMediaHideTimer();
}
function resetMediaHideTimer() {
clearTimeout(mediaHideTimer);
mediaHideTimer = setTimeout(() => {
document.querySelectorAll('.media-item.show-handles').forEach(el => {
el.classList.remove('show-handles');
});
}, 2000);
}
function hideAllMediaHandles() {
clearTimeout(mediaHideTimer);
document.querySelectorAll('.media-item.show-handles').forEach(el => {
el.classList.remove('show-handles');
});
}
function initDrag(item) {
let longPressTimer = null;
let isLongPress = false;
let isDragging = false;
let startX, startY, startLeft, startTop;
item.addEventListener('pointerdown', (e) => {
if (e.target.closest('.media-handle')) {
resetMediaHideTimer();
return;
}
isLongPress = false;
longPressTimer = setTimeout(() => {
isLongPress = true;
showMediaHandles(item);
}, 500);
const onMove = (ev) => {
if (!isLongPress) {
clearTimeout(longPressTimer);
return;
}
if (!isDragging) {
isDragging = true;
item.style.transition = 'none';
startX = ev.clientX;
startY = ev.clientY;
startLeft = item.offsetLeft;
startTop = item.offsetTop;
item.style.zIndex = 100;
}
const dx = ev.clientX - startX;
const dy = ev.clientY - startY;
let newTop = startTop + dy;
let newLeft = startLeft + dx;
const scrollContent = document.querySelector('.det-scroll-content');
const scrollRect = scrollContent.getBoundingClientRect();
const metaRow = document.querySelector('.det-metadata-row');
const metaRect = metaRow.getBoundingClientRect();
const minY = metaRect.bottom - scrollRect.top + scrollContent.scrollTop;
if (newTop < minY) newTop = minY;
const minX = 10;
const maxX = scrollRect.width - item.offsetWidth - 10;
if (newLeft < minX) newLeft = minX;
if (newLeft > maxX) newLeft = maxX;
item.style.left = newLeft + 'px';
item.style.top = newTop + 'px';
resetMediaHideTimer();
};
const onUp = () => {
clearTimeout(longPressTimer);
window.removeEventListener('pointermove', onMove);
window.removeEventListener('pointerup', onUp);
window.removeEventListener('pointercancel', onUp);
if (isDragging) {
isDragging = false;
item.style.transition = '';
item.style.zIndex = '';
updateMediaState(item);
}
};
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
});
}
function initResize(item, handle) {
handle.addEventListener('pointerdown', (e) => {
e.preventDefault();
e.stopPropagation();
resetMediaHideTimer();
const startX = e.clientX;
const startY = e.clientY;
const startW = item.offsetWidth;
const startH = item.offsetHeight;
const move = (ev) => {
const dx = ev.clientX - startX;
const dy = ev.clientY - startY;
item.style.width = Math.max(80, startW + dx) + 'px';
item.style.height = Math.max(80, startH + dy) + 'px';
};
const up = () => {
window.removeEventListener('pointermove', move);
window.removeEventListener('pointerup', up);
window.removeEventListener('pointercancel', up);
updateMediaState(item);
};
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);
});
}
function initRotate(item, handle) {
handle.addEventListener('pointerdown', (e) => {
e.preventDefault();
e.stopPropagation();
resetMediaHideTimer();
const rect = item.getBoundingClientRect();
const centerX = rect.left + rect.width / 2;
const centerY = rect.top + rect.height / 2;
let startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
let currentRotation = parseFloat(item.dataset.rotation || 0);
const move = (ev) => {
const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
const delta = angle - startAngle;
const newRot = currentRotation + (delta * 180 / Math.PI);
item.style.transform = `rotate(${newRot}deg)`;
item.dataset.rotation = newRot;
};
const up = () => {
window.removeEventListener('pointermove', move);
window.removeEventListener('pointerup', up);
window.removeEventListener('pointercancel', up);
updateMediaState(item);
};
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);
});
}
function initDelete(item, handle) {
handle.addEventListener('pointerdown', (e) => {
e.preventDefault();
e.stopPropagation();
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note && note.media) {
note.media = note.media.filter(m => m.id !== item.dataset.id);
saveState();
}
item.remove();
haptic(10);
});
}
function updateMediaState(item) {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!note || !note.media) return;
const id = item.dataset.id;
const mediaObj = note.media.find(m => m.id === id);
if (mediaObj) {
mediaObj.width = item.offsetWidth;
mediaObj.height = item.offsetHeight;
mediaObj.rotation = parseFloat(item.dataset.rotation || 0);
mediaObj.x = item.offsetLeft;
mediaObj.y = item.offsetTop;
saveState();
}
}
function showModal(message, confirmText, confirmCallback, confirmColor = '') {
document.querySelector('.delete-modal-text').textContent = message;
const confirmBtn = document.getElementById('delete-modal-confirm');
confirmBtn.textContent = confirmText;
confirmBtn.style.color = confirmColor;
currentModalAction = confirmCallback;
showDeleteModal();
}
function showDeleteModal() {
const overlay = document.getElementById('delete-modal-overlay');
overlay.classList.remove('closing');
overlay.classList.add('active');
try {
if (!state.deleteModalHistoryPushed) {
history.pushState({ modal: 'delete' }, '');
state.deleteModalHistoryPushed = true;
}
} catch(e) {}
}
function hideDeleteModal() {
const overlay = document.getElementById('delete-modal-overlay');
if (!overlay.classList.contains('active')) return;
overlay.classList.add('closing');
setTimeout(() => {
overlay.classList.remove('active', 'closing');
pendingDeleteNoteId = null;
currentModalAction = null;
try {
if (state.deleteModalHistoryPushed && !isHandlingPopstate) {
history.back();
}
} catch(e) {}
state.deleteModalHistoryPushed = false;
}, 150);
}
function confirmDeleteNote() {
if (currentModalAction) {
currentModalAction();
}
hideDeleteModal();
}
function showToast(msg) {
const toast = document.getElementById('toast');
toast.textContent = msg;
toast.classList.add('show');
setTimeout(() => toast.classList.remove('show'), 2200);
}
function initScrubbing() {
const detContainer = document.getElementById('det-waveform-container');
const detCanvas = document.getElementById('detail-canvas');
let detWasPlaying = false;
let detStartY = 0;
function getProgressFromEvent(e, canvas) {
const rect = canvas.getBoundingClientRect();
const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
const x = clientX - rect.left;
return Math.min(Math.max(x / rect.width, 0), 1);
}
function getYDistance(e, canvas) {
const rect = canvas.getBoundingClientRect();
const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : rect.top + rect.height / 2);
const centerY = rect.top + rect.height / 2;
return Math.abs(clientY - centerY);
}
function computeAppleScale(yDist) {
const maxDist = 200;
const minScale = 0.5;
const maxScale = 1.8;
const ratio = Math.min(yDist / maxDist, 1);
return maxScale - (ratio * (maxScale - minScale));
}
function onDetPointerDown(e) {
e.preventDefault();
e.stopPropagation();
const audio = document.getElementById('detail-audio');
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!audio || !note || !note.audioFileURL) return;
state.isScrubbingDetail = true;
detWasPlaying = !audio.paused;
audio.pause();
detStartY = e.clientY !== undefined ? e.clientY : (e.touches ? e.touches[0].clientY : 0);
detContainer.classList.add('scrubbing');
updateDetScrub(e);
}
function updateDetScrub(e) {
if (!state.isScrubbingDetail) return;
const audio = document.getElementById('detail-audio');
const note = state.notes.find(n => n.id === state.currentNoteId);
if (!audio || !note) return;
const progress = getProgressFromEvent(e, detCanvas);
const yDist = getYDistance(e, detCanvas);
const scale = computeAppleScale(yDist);
state.scrubScaleDetail = scale;
const dur = getDetailDuration(note);
audio.currentTime = progress * dur;
drawDetailWaveform(progress, note.waveformData, false, scale);
}
function onDetPointerUp(e) {
if (!state.isScrubbingDetail) return;
state.isScrubbingDetail = false;
detContainer.classList.remove('scrubbing');
const audio = document.getElementById('detail-audio');
const note = state.notes.find(n => n.id === state.currentNoteId);
animateScale('detail', () => {
if (note) {
const progress = audio.currentTime / getDetailDuration(note);
drawDetailWaveform(progress, note.waveformData, detWasPlaying, 1);
}
});
if (detWasPlaying && audio) {
audio.play().catch(() => {});
}
}
detContainer.addEventListener('pointerdown', onDetPointerDown, { passive: false });
detContainer.addEventListener('touchstart', (e) => {
e.preventDefault();
onDetPointerDown(e.touches[0]);
}, { passive: false });
window.addEventListener('pointermove', (e) => {
if (state.isScrubbingDetail) updateDetScrub(e);
});
window.addEventListener('pointerup', onDetPointerUp);
window.addEventListener('pointercancel', onDetPointerUp);
window.addEventListener('touchmove', (e) => {
if (state.isScrubbingDetail && e.touches[0]) {
e.preventDefault();
updateDetScrub(e.touches[0]);
}
}, { passive: false });
window.addEventListener('touchend', onDetPointerUp);
window.addEventListener('touchcancel', onDetPointerUp);
const revContainer = document.getElementById('rev-waveform-container');
const revCanvas = document.getElementById('review-canvas');
let revWasPlaying = false;
function onRevPointerDown(e) {
e.preventDefault();
e.stopPropagation();
const audio = document.getElementById('review-audio');
if (!audio || !audio.src) return;
state.isScrubbingReview = true;
revWasPlaying = !audio.paused;
audio.pause();
revContainer.classList.add('scrubbing');
updateRevScrub(e);
}
function updateRevScrub(e) {
if (!state.isScrubbingReview) return;
const audio = document.getElementById('review-audio');
if (!audio) return;
const progress = getProgressFromEvent(e, revCanvas);
const yDist = getYDistance(e, revCanvas);
const scale = computeAppleScale(yDist);
state.scrubScaleReview = scale;
const dur = getReviewDuration();
audio.currentTime = progress * dur;
updateReviewTimeLabel(audio);
drawReviewWaveform(progress, scale);
}
function onRevPointerUp(e) {
if (!state.isScrubbingReview) return;
state.isScrubbingReview = false;
revContainer.classList.remove('scrubbing');
const audio = document.getElementById('review-audio');
animateScale('review', () => {
const progress = audio.currentTime / getReviewDuration();
drawReviewWaveform(progress, 1);
});
if (revWasPlaying && audio) {
audio.play().catch(() => {});
}
}
revContainer.addEventListener('pointerdown', onRevPointerDown, { passive: false });
revContainer.addEventListener('touchstart', (e) => {
e.preventDefault();
onRevPointerDown(e.touches[0]);
}, { passive: false });
window.addEventListener('pointermove', (e) => {
if (state.isScrubbingReview) updateRevScrub(e);
});
window.addEventListener('pointerup', onRevPointerUp);
window.addEventListener('pointercancel', onRevPointerUp);
window.addEventListener('touchmove', (e) => {
if (state.isScrubbingReview && e.touches[0]) {
e.preventDefault();
updateRevScrub(e.touches[0]);
}
}, { passive: false });
window.addEventListener('touchend', onRevPointerUp);
window.addEventListener('touchcancel', onRevPointerUp);
}
function animateScale(which, onComplete) {
const key = which === 'detail' ? 'scrubScaleDetail' : 'scrubScaleReview';
const startScale = state[key];
const endScale = 1;
const duration = 250;
const startTime = performance.now();
function frame(now) {
const elapsed = now - startTime;
const t = Math.min(elapsed / duration, 1);
const eased = 1 - Math.pow(1 - t, 3);
const currentScale = startScale + (endScale - startScale) * eased;
state[key] = currentScale;
if (which === 'detail') {
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note) {
const audio = document.getElementById('detail-audio');
const dur = getDetailDuration(note);
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawDetailWaveform(progress, note.waveformData, state.detailAudioPlaying, currentScale);
}
} else {
const audio = document.getElementById('review-audio');
const dur = getReviewDuration();
const progress = dur > 0 ? audio.currentTime / dur : 0;
drawReviewWaveform(progress, currentScale);
}
if (t < 1) {
requestAnimationFrame(frame);
} else {
state[key] = 1;
if (onComplete) onComplete();
}
}
requestAnimationFrame(frame);
}
async function decodeAudioDuration(blobUrl, fallbackDuration) {
try {
const response = await fetch(blobUrl);
const arrayBuffer = await response.arrayBuffer();
const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
return audioBuffer.duration;
} catch (e) {
console.warn('Audio decode failed, using fallback duration:', e);
return fallbackDuration;
}
}
if (!CanvasRenderingContext2D.prototype.roundRect) {
CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
if (w < 2 * r) r = w / 2;
if (h < 2 * r) r = h / 2;
this.moveTo(x + r, y);
this.arcTo(x + w, y, x + w, y + h, r);
this.arcTo(x + w, y + h, x, y + h, r);
this.arcTo(x, y + h, x, y, r);
this.arcTo(x, y, x + w, y, r);
this.closePath();
return this;
};
}
function updateStatusBarTime() {
const now = new Date();
let h = now.getHours();
const m = now.getMinutes();
h = h % 12 || 12;
document.getElementById('status-time').textContent = `${h}:${m.toString().padStart(2, '0')}`;
}
async function init() {
  updateStatusBarTime();
  setInterval(updateStatusBarTime, 60000);
  await loadState();
  applyTheme(state.theme, true);
const onbWave = document.getElementById('onb-waveform');
for (let i = 0; i < 50; i++) {
const bar = document.createElement('div');
bar.className = 'bar';
bar.style.height = (Math.random() * 60 + 10) + 'px';
bar.style.animationDelay = (Math.random() * 2) + 's';
onbWave.appendChild(bar);
}
initSpeechRecognition();
setupAddButton();
initScrubbing();
document.addEventListener('pointerdown', (e) => {
if (!e.target.closest('.media-item')) {
hideAllMediaHandles();
}
});
const detEditText = document.getElementById('det-editable-text');
detEditText.addEventListener('click', function(e) {
const wordSpan = e.target.closest('.det-word');
if (wordSpan && wordSpan.hasAttribute('data-word-index')) {
const idx = parseInt(wordSpan.getAttribute('data-word-index'), 10);
if (state.wordTiming && state.wordTiming[idx]) {
const startTime = state.wordTiming[idx].start;
const audio = document.getElementById('detail-audio');
if (audio) {
audio.currentTime = startTime;
const note = state.notes.find(n => n.id === state.currentNoteId);
if (note) {
const dur = getDetailDuration(note);
const progress = dur > 0 ? startTime / dur : 0;
drawDetailWaveform(progress, note.waveformData, state.detailAudioPlaying, state.scrubScaleDetail);
}
}
}
}
});
detEditText.addEventListener('touchend', function(e) {
setTimeout(() => {
const sel = window.getSelection();
if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
const range = sel.getRangeAt(0);
if (detEditText.contains(range.commonAncestorContainer)) {
if (!isMenuOpen) {
showDetContextMenu(e);
} else {
measureAndPositionMenu();
}
}
}
}, 50);
});
detEditText.addEventListener('mouseup', function(e) {
setTimeout(() => {
const sel = window.getSelection();
if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
const range = sel.getRangeAt(0);
if (detEditText.contains(range.commonAncestorContainer)) {
if (!isMenuOpen) {
showDetContextMenu(e);
} else {
measureAndPositionMenu();
}
}
}
}, 10);
});
const ctxMenu = document.getElementById('det-context-menu');
ctxMenu.addEventListener('touchstart', (e) => {
const editableText = document.getElementById('det-editable-text');
if (document.activeElement !== editableText) {
editableText.focus();
}
ensureSelection();
}, { passive: true });
document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
if (state.hasOnboarded) {
const hs = document.getElementById('screen-home');
hs.classList.add('active');
state.currentScreen = 'screen-home';
state.navStack = ['screen-home'];
renderHome();
} else {
const os = document.getElementById('screen-onboarding');
os.classList.add('active');
state.currentScreen = 'screen-onboarding';
state.navStack = ['screen-onboarding'];
}
renderProfileTrigger();
document.getElementById('delete-modal-overlay').addEventListener('click', (e) => {
if (e.target.id === 'delete-modal-overlay') {
hideDeleteModal();
}
});
document.getElementById('delete-modal-confirm').addEventListener('click', confirmDeleteNote);
document.getElementById('delete-modal-cancel').addEventListener('click', hideDeleteModal);
window.addEventListener('popstate', (e) => {
const overlay = document.getElementById('delete-modal-overlay');
if (overlay && overlay.classList.contains('active')) {
isHandlingPopstate = true;
hideDeleteModal();
isHandlingPopstate = false;
return;
}
if (state.isProfileMenuOpen) {
isHandlingPopstate = true;
closeProfileMenu(true);
isHandlingPopstate = false;
}
});
  // Re-enable transitions AFTER the initial screen is instantly painted
  requestAnimationFrame(() => {
    document.querySelector('.phone-screen').classList.remove('no-transitions');
  });

  // Hide splash screen
  const splash = document.getElementById('splash-screen');
  if (splash) {
    setTimeout(() => {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 600);
    }, 1200);
  }
}
if (state.backupEnabled) scheduleBackup();
init();