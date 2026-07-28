// =====================================================================
// ⚙️ CONFIG — بيانات الاتصال بـ Supabase
// =====================================================================
// حط هنا الـ Project URL والـ ANON / PUBLISHABLE KEY (تلقاهم في:
// Supabase Dashboard → Project Settings → API).
//
// ⚠️ هذا المفتاح (anon/publishable) هو المفتاح الوحيد المسموح وجوده هنا
// في كود يعمل بالمتصفح. لا تضع هنا مطلقاً الـ Service Role / Secret Key
// حتى لو المشروع شخصي — لأنه بمجرد نشر الصفحة (حتى محلياً وتشاركها مع
// أي شخص، أو رفعها لأي استضافة) يصبح أي زائر يملك تحكم كامل بقاعدة
// بياناتك (قراءة/تعديل/حذف بدون قيود). الحماية الصحيحة تكون عبر
// Row Level Security (RLS) في Supabase، وليس بإخفاء المفتاح.
//
// إذا احتجت لاحقاً عملية تتطلب صلاحيات أعلى (Service Role)، الحل هو
// Supabase Edge Function تُستدعى من هذا الملف، وليس وضع المفتاح مباشرة هنا.
const CONFIG = {
  SUPABASE_URL: "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE",       // مثال: https://xyzcompany.supabase.co
  SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_PUBLISHABLE_KEY_HERE"
};

// =====================================================================
// 📦 مخطط الجدول المطلوب في Supabase (نفّذه مرة واحدة من SQL Editor)
// =====================================================================
// create table game_saves (
//   player_id text primary key,
//   state jsonb not null,
//   updated_at timestamptz default now()
// );
//
// -- لأن هذا مشروع شخصي بدون نظام تسجيل دخول، الأبسط تفعيل RLS مع
// -- سياسة تسمح لأي حامل anon key بالقراءة/الكتابة على صفه فقط عبر
// -- معرف عشوائي مخزّن في المتصفح (player_id). إذا احتجت حماية أقوى
// -- لاحقاً، أضف Supabase Auth وقيّد السياسة بـ auth.uid().
// alter table game_saves enable row level security;
// create policy "allow anon all" on game_saves
//   for all using (true) with check (true);

// ==========================================
// 1. GAME STATE & DATA STORE
// ==========================================
let gameState = {
  user: {
    name: "CYBER_PLAYER",
    level: 14,
    xp: 3200,
    nextLevelXp: 4000,
    streak: 7
  },
  boss: {
    hp: 7500,
    maxHp: 10000
  },
  skills: [
    { id: 'Intelligence', name: "الذكاء (Intelligence)", level: 8, xp: 750, maxXp: 1000, icon: "fa-brain", color: "text-cyan-400", border: "border-cyan-400" },
    { id: 'Fitness', name: "اللياقة البدنية (Fitness)", level: 12, xp: 400, maxXp: 1000, icon: "fa-dumbbell", color: "text-green-400", border: "border-green-400" },
    { id: 'Wealth', name: "المال والأعمال (Wealth)", level: 5, xp: 900, maxXp: 1000, icon: "fa-wallet", color: "text-amber-400", border: "border-amber-400" },
    { id: 'Learning', name: "التعلم والتطوير (Learning)", level: 9, xp: 200, maxXp: 1000, icon: "fa-book-open", color: "text-purple-400", border: "border-purple-400" }
  ],
  quests: [
    { id: 1, title: "قراءة 30 دقيقة في كتاب تقني", xp: 250, skill: "Intelligence", type: "daily", completed: false },
    { id: 2, title: "التمرين الرياضي لمدة 45 دقيقة", xp: 300, skill: "Fitness", type: "daily", completed: false },
    { id: 3, title: "مراجعة المصاريف الأسبوعية والتخطيط", xp: 400, skill: "Wealth", type: "weekly", completed: false },
    { id: 4, title: "إكمال دورة معمارية البرمجيات", xp: 800, skill: "Learning", type: "main", completed: false }
  ]
};

let supabaseClient = null;
let saveDebounceTimer = null;

// معرف لاعب محلي بدون نظام تسجيل دخول — يُستخدم كمفتاح للصف في Supabase
function getPlayerId() {
  let id = localStorage.getItem('cyber_rpg_player_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'player-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    localStorage.setItem('cyber_rpg_player_id', id);
  }
  return id;
}

// ==========================================
// 2. LOAD STATE (Supabase أولاً، ثم localStorage كنسخة احتياطية)
// ==========================================
async function loadSavedState() {
  // اقرأ إعدادات الاتصال المخصصة من واجهة الإعدادات إن وُجدت، وإلا استخدم CONFIG
  const savedUrl = localStorage.getItem('supabase_url') || CONFIG.SUPABASE_URL;
  const savedKey = localStorage.getItem('supabase_key') || CONFIG.SUPABASE_ANON_KEY;

  if (savedUrl && savedKey && !savedUrl.includes('PASTE_YOUR')) {
    document.getElementById('supabase-url').value = savedUrl;
    document.getElementById('supabase-key').value = savedKey;
    initSupabase(savedUrl, savedKey);

    const remoteState = await fetchStateFromSupabase();
    if (remoteState) {
      gameState = remoteState;
      renderApp();
      return;
    }
  }

  // Fallback: تحميل محلي
  const localData = localStorage.getItem('cyber_rpg_state');
  if (localData) {
    try {
      gameState = JSON.parse(localData);
    } catch (e) {
      console.error("Error parsing local state", e);
    }
  }
}

function saveState() {
  localStorage.setItem('cyber_rpg_state', JSON.stringify(gameState));
  renderApp();

  // مزامنة مع Supabase مع تأخير بسيط (debounce) لتقليل عدد الطلبات
  if (supabaseClient) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      pushStateToSupabase();
    }, 600);
  }
}

// ==========================================
// 3. SUPABASE CONNECTION & SYNC
// ==========================================
function initSupabase(url, key) {
  try {
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(url, key);
      document.getElementById('supabase-status').innerText = "الحالة: متصل بنجاح 🟢";
      document.getElementById('supabase-status').className = "text-xs font-mono text-green-400";
    }
  } catch (err) {
    console.error(err);
    document.getElementById('supabase-status').innerText = "الحالة: فشل الاتصال 🔴";
    document.getElementById('supabase-status').className = "text-xs font-mono text-red-400";
  }
}

async function fetchStateFromSupabase() {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('game_saves')
      .select('state')
      .eq('player_id', getPlayerId())
      .maybeSingle();

    if (error) {
      console.error("Supabase fetch error:", error.message);
      return null;
    }
    return data ? data.state : null;
  } catch (err) {
    console.error("Supabase fetch exception:", err);
    return null;
  }
}

async function pushStateToSupabase() {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient
      .from('game_saves')
      .upsert({
        player_id: getPlayerId(),
        state: gameState,
        updated_at: new Date().toISOString()
      }, { onConflict: 'player_id' });

    if (error) {
      console.error("Supabase save error:", error.message);
      document.getElementById('supabase-status').innerText = "الحالة: خطأ أثناء الحفظ 🔴";
      document.getElementById('supabase-status').className = "text-xs font-mono text-red-400";
    } else {
      document.getElementById('supabase-status').innerText = "الحالة: تمت المزامنة ✅";
      document.getElementById('supabase-status').className = "text-xs font-mono text-green-400";
    }
  } catch (err) {
    console.error("Supabase save exception:", err);
  }
}

async function saveSupabaseConfig() {
  const url = document.getElementById('supabase-url').value.trim();
  const key = document.getElementById('supabase-key').value.trim();

  if (!url || !key) {
    alert("يرجى إدخال الرابط والمفتاح بشكل صحيح.");
    return;
  }

  localStorage.setItem('supabase_url', url);
  localStorage.setItem('supabase_key', key);
  initSupabase(url, key);

  // حاول تحميل أي حالة محفوظة سابقاً تحت هذا الاتصال، وإلا ادفع الحالة الحالية
  const remoteState = await fetchStateFromSupabase();
  if (remoteState) {
    gameState = remoteState;
  } else {
    await pushStateToSupabase();
  }
  renderApp();
  alert("تم حفظ بيانات Supabase ومحاولة الاتصال!");
}

// ==========================================
// 4. UI RENDER ENGINE
// ==========================================
function renderApp() {
  document.getElementById('hero-username').innerText = gameState.user.name;
  document.getElementById('sidebar-username').innerText = gameState.user.name;
  document.getElementById('hero-lvl-badge').innerText = `LVL ${gameState.user.level}`;
  document.getElementById('sidebar-level-text').innerText = `LVL ${gameState.user.level} AGENT`;
  document.getElementById('hero-streak').innerText = `${gameState.user.streak} DAYS`;
  document.getElementById('mobile-streak-count').innerText = `${gameState.user.streak} أيام`;

  const xpPct = Math.min(100, Math.floor((gameState.user.xp / gameState.user.nextLevelXp) * 100));
  document.getElementById('xp-bar-fill').style.width = `${xpPct}%`;
  document.getElementById('xp-text-counter').innerText = `${gameState.user.xp.toLocaleString()} / ${gameState.user.nextLevelXp.toLocaleString()} XP`;

  renderSkills();
  renderQuests();
  renderBoss();
}

function renderSkills() {
  const dashGrid = document.getElementById('dashboard-skills-grid');
  const fullGrid = document.getElementById('skills-full-grid');

  dashGrid.innerHTML = '';
  fullGrid.innerHTML = '';

  gameState.skills.forEach(skill => {
    const pct = Math.floor((skill.xp / skill.maxXp) * 100);

    dashGrid.innerHTML += `
      <div class="glass-card p-4 rounded-xl flex items-center space-x-3 space-x-reverse border-cyber-border">
        <div class="w-10 h-10 rounded-lg bg-slate-900 border ${skill.border} flex items-center justify-center ${skill.color}">
          <i class="fa-solid ${skill.icon}"></i>
        </div>
        <div class="flex-1 overflow-hidden">
          <div class="flex justify-between text-xs font-bold mb-1">
            <span class="truncate">${skill.name}</span>
            <span class="text-slate-400 font-mono">Lvl ${skill.level}</span>
          </div>
          <div class="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
            <div class="bg-white h-full" style="width: ${pct}%;"></div>
          </div>
        </div>
      </div>
    `;

    fullGrid.innerHTML += `
      <div class="glass-card p-5 rounded-2xl border-cyber-border space-y-3">
        <div class="flex justify-between items-center">
          <div class="flex items-center space-x-3 space-x-reverse">
            <div class="w-12 h-12 rounded-xl bg-slate-900 border ${skill.border} flex items-center justify-center ${skill.color} text-xl">
              <i class="fa-solid ${skill.icon}"></i>
            </div>
            <div>
              <h4 class="font-bold text-base text-white">${skill.name}</h4>
              <span class="text-xs text-slate-400">المستوى الحالي: ${skill.level}</span>
            </div>
          </div>
          <span class="text-xs font-mono px-2 py-1 bg-slate-800 rounded text-cyber-cyan">${pct}%</span>
        </div>
        <div class="space-y-1">
          <div class="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
            <div class="bg-gradient-to-r from-cyber-cyan to-cyber-magenta h-full" style="width: ${pct}%;"></div>
          </div>
          <div class="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>${skill.xp} XP</span>
            <span>${skill.maxXp} XP للترقية</span>
          </div>
        </div>
      </div>
    `;
  });
}

function renderQuests() {
  const dashList = document.getElementById('dashboard-quests-list');
  const allContainer = document.getElementById('all-quests-container');

  dashList.innerHTML = '';
  allContainer.innerHTML = '';

  gameState.quests.forEach(quest => {
    const questHtml = `
      <div class="glass-card p-4 rounded-xl border-cyber-border flex items-center justify-between transition hover:border-slate-700">
        <div class="flex items-center space-x-3 space-x-reverse">
          <div class="w-8 h-8 rounded-lg ${quest.completed ? 'bg-slate-800 text-slate-600' : 'bg-cyber-yellow/10 text-cyber-yellow'} flex items-center justify-center">
            <i class="fa-solid ${quest.completed ? 'fa-check' : 'fa-bolt'}"></i>
          </div>
          <div>
            <h4 class="font-bold text-sm ${quest.completed ? 'line-through text-slate-500' : 'text-white'}">${quest.title}</h4>
            <div class="flex items-center space-x-2 space-x-reverse text-[10px] text-slate-400 mt-0.5">
              <span class="text-cyber-cyan font-mono">+${quest.xp} XP</span>
              <span>•</span>
              <span>المهارة: ${quest.skill}</span>
            </div>
          </div>
        </div>

        <button onclick="completeQuest(${quest.id})" ${quest.completed ? 'disabled' : ''}
          class="px-4 py-2 rounded-xl text-xs font-bold font-orbitron transition ${quest.completed ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-cyber-cyan/10 border border-cyber-cyan text-cyber-cyan hover:bg-cyber-cyan hover:text-black shadow-neon-cyan'}">
          ${quest.completed ? 'مكتملة' : 'إنجاز المهمة'}
        </button>
      </div>
    `;

    if (!quest.completed) {
      dashList.innerHTML += questHtml;
    }
    allContainer.innerHTML += questHtml;
  });

  if (dashList.innerHTML === '') {
    dashList.innerHTML = `<div class="text-xs text-slate-500 text-center py-4">تم إنجاز جميع مهام اليوم! 🔥</div>`;
  }
}

function renderBoss() {
  document.getElementById('boss-hp-text').innerText = `${gameState.boss.hp.toLocaleString()} / ${gameState.boss.maxHp.toLocaleString()} HP`;
  const pct = Math.floor((gameState.boss.hp / gameState.boss.maxHp) * 100);
  document.getElementById('boss-hp-bar').style.width = `${pct}%`;
}

// ==========================================
// 5. GAME ACTIONS & LOGIC
// ==========================================
function completeQuest(id) {
  const quest = gameState.quests.find(q => q.id === id);
  if (!quest || quest.completed) return;

  quest.completed = true;
  addXp(quest.xp);

  const skill = gameState.skills.find(s => s.id === quest.skill || s.name.includes(quest.skill));
  if (skill) {
    skill.xp += Math.floor(quest.xp / 2);
    if (skill.xp >= skill.maxXp) {
      skill.level += 1;
      skill.xp -= skill.maxXp;
    }
  }

  triggerParticles();
  saveState();
}

function addXp(amount) {
  gameState.user.xp += amount;
  if (gameState.user.xp >= gameState.user.nextLevelXp) {
    gameState.user.level += 1;
    gameState.user.xp -= gameState.user.nextLevelXp;
    gameState.user.nextLevelXp += 1000;
    showLevelUpModal(gameState.user.level);
  }
}

function attackBoss(damage) {
  if (gameState.boss.hp <= 0) return;
  gameState.boss.hp = Math.max(0, gameState.boss.hp - damage);
  addXp(300);
  triggerParticles();
  saveState();
}

function toggleNewQuestForm() {
  const form = document.getElementById('new-quest-form');
  form.classList.toggle('hidden');
}

function createNewQuest() {
  const title = document.getElementById('quest-input-title').value.trim();
  const xp = parseInt(document.getElementById('quest-input-xp').value) || 100;
  const skill = document.getElementById('quest-input-skill').value;
  const type = document.getElementById('quest-input-type').value;

  if (!title) return alert("يرجى إدخال عنوان المهمة");

  const newQuest = {
    id: Date.now(),
    title,
    xp,
    skill,
    type,
    completed: false
  };

  gameState.quests.push(newQuest);
  toggleNewQuestForm();
  saveState();
}

function showLevelUpModal(level) {
  document.getElementById('modal-new-level').innerText = level;
  document.getElementById('level-up-modal').classList.remove('hidden');
  triggerParticles();
}

function closeLevelUpModal() {
  document.getElementById('level-up-modal').classList.add('hidden');
}

// ==========================================
// 6. NAVIGATION & TABS
// ==========================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.className = "nav-btn w-full flex items-center space-x-3 space-x-reverse px-4 py-3 rounded-xl font-bold text-sm text-slate-400 hover:text-white hover:bg-slate-800/50 transition";
  });
  const activeNav = document.getElementById(`nav-${tabId}`);
  if (activeNav) {
    activeNav.className = "nav-btn w-full flex items-center space-x-3 space-x-reverse px-4 py-3 rounded-xl font-bold text-sm text-cyber-cyan bg-cyber-cyan/10 border border-cyber-cyan/30 transition";
  }
}

// ==========================================
// 7. PARTICLE ANIMATION ENGINE
// ==========================================
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function triggerParticles() {
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      color: Math.random() > 0.5 ? '#00f0ff' : '#ff007f',
      size: Math.random() * 4 + 2,
      alpha: 1
    });
  }
}

function updateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach((p, index) => {
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= 0.02;

    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();

    if (p.alpha <= 0) particles.splice(index, 1);
  });
  requestAnimationFrame(updateParticles);
}
updateParticles();

// ==========================================
// 8. INIT APPLICATION
// ==========================================
(async function init() {
  await loadSavedState();
  renderApp();
})();
