// --- Supabase Config ---
const SUPABASE_URL = "https://raklpfmsglgytqvvrxft.supabase.co";
const SUPABASE_KEY = "sb_publishable_YGZLapsWUvCsgNSJkuV8iA_tMMVK_r5";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- State Variables ---
let currentUser = null;
let profileData = { level: 1, current_xp: 0, next_level_xp: 1000, username: '' };
let statsData = { intelligence: 10, strength: 10, discipline: 10, knowledge: 10 };
let authMode = 'login'; // 'login' or 'signup'

// --- DOM Elements ---
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const userStatusNav = document.getElementById('user-status');
const authForm = document.getElementById('auth-form');
const groupUsername = document.getElementById('group-username');
const toggleAuthBtn = document.getElementById('toggle-auth-mode');

// --- Initialize App ---
window.addEventListener('DOMContentLoaded', async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    await loadDashboard();
  } else {
    showAuth();
  }
});

// --- Auth Handling ---
toggleAuthBtn.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  groupUsername.classList.toggle('hidden', authMode === 'login');
  document.getElementById('btn-auth-submit').textContent = authMode === 'login' ? 'دخول اللعبة' : 'إنشاء حساب جديد';
  toggleAuthBtn.textContent = authMode === 'login' ? 'ليس لديك حساب؟ سجل الآن' : 'لديك حساب بالفعل؟ سجل الدخول';
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const username = document.getElementById('auth-username').value;

  if (authMode === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);
    
    if (data.user) {
      await supabase.from('profiles').insert({ id: data.user.id, username: username || 'محارب' });
      await supabase.from('player_stats').insert({ user_id: data.user.id });
      alert('تم إنشاء الحساب بنجاح! يمكنك الآن تسجيل الدخول.');
    }
  } else {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    currentUser = data.user;
    await loadDashboard();
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// --- Load Dashboard Data ---
async function loadDashboard() {
  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  userStatusNav.classList.remove('hidden');

  // 1. Load Profile
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  if (profile) {
    profileData = profile;
    document.getElementById('nav-username').textContent = profile.username;
    document.getElementById('player-name').textContent = profile.username;
    document.getElementById('player-level').textContent = `LVL ${profile.level}`;
    
    // Update XP Bar
    const xpPct = Math.min(100, Math.round((profile.current_xp / profile.next_level_xp) * 100));
    document.getElementById('xp-bar-fill').style.width = `${xpPct}%`;
    document.getElementById('xp-text').textContent = `${profile.current_xp} / ${profile.next_level_xp} XP`;
  }

  // 2. Load Stats
  const { data: stats } = await supabase.from('player_stats').select('*').eq('user_id', currentUser.id).single();
  if (stats) {
    statsData = stats;
    document.getElementById('stat-int').textContent = stats.intelligence;
    document.getElementById('stat-str').textContent = stats.strength;
    document.getElementById('stat-des').textContent = stats.discipline;
    document.getElementById('stat-knw').textContent = stats.knowledge;
  }

  // 3. Load Quests & Leaderboard
  await renderQuests();
  await renderLeaderboard();
}

// --- Quests System ---
document.getElementById('btn-add-quest').addEventListener('click', async () => {
  const title = document.getElementById('quest-input').value;
  const category = document.getElementById('quest-category').value;
  if (!title) return;

  const { data, error } = await supabase.from('quests').insert([{
    user_id: currentUser.id,
    title: title,
    stat_category: category,
    xp_reward: 150
  }]).select();

  if (!error) {
    document.getElementById('quest-input').value = '';
    await renderQuests();
  }
});

async function renderQuests() {
  const { data: quests } = await supabase.from('quests').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  const listContainer = document.getElementById('quests-list');
  listContainer.innerHTML = '';

  (quests || []).forEach(q => {
    const item = document.createElement('div');
    item.className = `quest-item ${q.is_completed ? 'completed' : ''}`;
    item.innerHTML = `
      <div>
        <strong>${q.title}</strong>
        <span style="display:block; font-size:10px; color:var(--cyan-neon);">${q.stat_category.toUpperCase()}</span>
      </div>
      <div>
        <span style="color:var(--pink-neon); font-weight:bold; margin-left:10px;">+${q.xp_reward} XP</span>
        ${!q.is_completed ? `<button onclick="completeQuest('${q.id}', '${q.stat_category}', ${q.xp_reward})" class="btn-primary" style="padding: 2px 10px; font-size:12px;">تم</button>` : '✔️'}
      </div>
    `;
    listContainer.appendChild(item);
  });
}

async function completeQuest(questId, category, xp) {
  // Update quest status
  await supabase.from('quests').update({ is_completed: true }).eq('id', questId);

  // Update XP and Level
  profileData.current_xp += xp;
  if (profileData.current_xp >= profileData.next_level_xp) {
    profileData.level += 1;
    profileData.current_xp -= profileData.next_level_xp;
    profileData.next_level_xp = Math.round(profileData.next_level_xp * 1.5);
    alert(`🎉 LEVEL UP! أصبحت في المستوى ${profileData.level}`);
  }

  await supabase.from('profiles').update({
    level: profileData.level,
    current_xp: profileData.current_xp,
    next_level_xp: profileData.next_level_xp
  }).eq('id', currentUser.id);

  // Update Stats
  if (statsData[category] !== undefined) {
    statsData[category] += 2;
    await supabase.from('player_stats').update({ [category]: statsData[category] }).eq('user_id', currentUser.id);
  }

  await loadDashboard();
}

// --- Leaderboard ---
async function renderLeaderboard() {
  const { data: board } = await supabase.from('profiles').select('username, level, current_xp').order('level', { ascending: false }).limit(5);
  const container = document.getElementById('leaderboard-list');
  container.innerHTML = '';

  (board || []).forEach((user, index) => {
    const row = document.createElement('div');
    row.style.cssText = "display:flex; justify-between:space-between; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.9rem;";
    row.innerHTML = `
      <span>#${index + 1} ${user.username}</span>
      <span style="color:var(--cyan-neon);">LVL ${user.level} (${user.current_xp} XP)</span>
    `;
    container.appendChild(row);
  });
}

function showAuth() {
  authSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
  userStatusNav.classList.add('hidden');
}
