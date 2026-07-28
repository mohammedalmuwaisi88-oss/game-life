/* ============================================
   LifeRPG v2.0 - Core Engine with Supabase
   ============================================ */

class LifeRPG {
    constructor() {
        this.supabase = null;
        this.state = this.loadState();
        this.currentFilter = 'all';
        this.useCloud = false;
        this.init();
    }

    // ============================================
    // Default State
    // ============================================
    getDefaultState() {
        return {
            player: {
                name: 'CYBER_PLAYER',
                level: 1,
                xp: 0,
                xpToNext: 1000,
                streak: 0,
                stats: {
                    intelligence: 10,
                    fitness: 10,
                    wealth: 10,
                    learning: 10
                }
            },
            quests: [],
            skills: [
                { id: 1, name: 'البرمجة', icon: '💻', level: 1, xp: 0, maxXp: 1000 },
                { id: 2, name: 'التصميم', icon: '🎨', level: 1, xp: 0, maxXp: 1000 },
                { id: 3, name: 'اللغة الإنجليزية', icon: '🌍', level: 1, xp: 0, maxXp: 1000 }
            ],
            bosses: [],
            supabase: {
                url: '',
                key: '',
                connected: false
            }
        };
    }

    // ============================================
    // Initialize
    // ============================================
    async init() {
        this.createParticles();
        this.bindEvents();
        
        // محاولة الاتصال بـ Supabase إذا كانت البيانات محفوظة
        if (this.state.supabase.url && this.state.supabase.key) {
            await this.connectSupabase(this.state.supabase.url, this.state.supabase.key);
        }
        
        this.render();
        this.updateUI();
        console.log('%c⚡ LifeRPG v2.0 Initialized', 'color: #00f0ff; font-size: 16px; font-weight: bold;');
    }

    // ============================================
    // Supabase Connection
    // ============================================
    async connectSupabase(url, key) {
        try {
            // تحميل Supabase SDK ديناميكياً
            if (!window.supabase) {
                await this.loadSupabaseSDK();
            }
            
            this.supabase = window.supabase.createClient(url, key);
            
            // اختبار الاتصال
            const { data, error } = await this.supabase.auth.getSession();
            
            if (error && error.message !== 'Auth session missing!') {
                throw error;
            }
            
            this.useCloud = true;
            this.state.supabase = { url, key, connected: true };
            this.saveState();
            
            // تحميل البيانات من السحابة
            await this.loadFromCloud();
            
            this.updateConnectionStatus(true);
            this.showToast('✓ تم الاتصال بـ Supabase بنجاح', 'success');
            return true;
        } catch (err) {
            console.error('Supabase connection error:', err);
            this.showToast('✗ فشل الاتصال: ' + err.message, 'error');
            this.useCloud = false;
            this.updateConnectionStatus(false);
            return false;
        }
    }

    async loadSupabaseSDK() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    updateConnectionStatus(connected) {
        const indicator = document.querySelector('.status-indicator');
        const text = document.getElementById('connectionText');
        
        if (indicator && text) {
            indicator.className = `status-indicator ${connected ? 'online' : 'offline'}`;
            text.textContent = connected ? 'الحالة: متصل ✓ (سحابي)' : 'الحالة: غير متصل (محلي)';
        }
    }

    // ============================================
    // Cloud Sync
    // ============================================
    async loadFromCloud() {
        if (!this.supabase || !this.useCloud) return;

        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) {
                // تسجيل دخول كضيف مؤقت (Anonymous)
                await this.supabase.auth.signInAnonymously();
                const { data: { user: anonUser } } = await this.supabase.auth.getUser();
                if (anonUser) {
                    await this.createInitialData(anonUser.id);
                }
                return;
            }

            // تحميل البيانات
            const [playerRes, questsRes, skillsRes, bossesRes] = await Promise.all([
                this.supabase.from('players').select('*').eq('user_id', user.id).single(),
                this.supabase.from('quests').select('*').eq('user_id', user.id),
                this.supabase.from('skills').select('*').eq('user_id', user.id),
                this.supabase.from('bosses').select('*').eq('user_id', user.id)
            ]);

            if (playerRes.data) {
                this.state.player = {
                    name: playerRes.data.name,
                    level: playerRes.data.level,
                    xp: playerRes.data.xp,
                    xpToNext: playerRes.data.xp_to_next,
                    streak: playerRes.data.streak,
                    stats: playerRes.data.stats
                };
            }

            if (questsRes.data) this.state.quests = questsRes.data;
            if (skillsRes.data && skillsRes.data.length > 0) this.state.skills = skillsRes.data;
            if (bossesRes.data) this.state.bosses = bossesRes.data;

            this.saveState();
            this.render();
        } catch (err) {
            console.error('Load from cloud error:', err);
        }
    }

    async createInitialData(userId) {
        if (!this.supabase) return;

        try {
            // إنشاء لاعب
            await this.supabase.from('players').insert({
                user_id: userId,
                name: this.state.player.name,
                level: this.state.player.level,
                xp: this.state.player.xp,
                xp_to_next: this.state.player.xpToNext,
                streak: this.state.player.streak,
                stats: this.state.player.stats
            });

            // إنشاء المهارات الافتراضية
            for (const skill of this.state.skills) {
                await this.supabase.from('skills').insert({
                    user_id: userId,
                    name: skill.name,
                    icon: skill.icon,
                    level: skill.level,
                    xp: skill.xp,
                    max_xp: skill.maxXp
                });
            }
        } catch (err) {
            console.error('Create initial data error:', err);
        }
    }

    async syncToCloud(table, data, operation = 'upsert') {
        if (!this.supabase || !this.useCloud) return;

        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) return;

            const record = { ...data, user_id: user.id };

            if (operation === 'upsert') {
                await this.supabase.from(table).upsert(record);
            } else if (operation === 'insert') {
                await this.supabase.from(table).insert(record);
            } else if (operation === 'update') {
                await this.supabase.from(table).update(record).eq('id', data.id);
            } else if (operation === 'delete') {
                await this.supabase.from(table).delete().eq('id', data.id);
            }
        } catch (err) {
            console.error(`Sync to ${table} error:`, err);
        }
    }

    // ============================================
    // State Management (Local)
    // ============================================
    loadState() {
        const saved = localStorage.getItem('liferpg_state');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                return this.getDefaultState();
            }
        }
        return this.getDefaultState();
    }

    saveState() {
        localStorage.setItem('liferpg_state', JSON.stringify(this.state));
    }

    // ============================================
    // Particles Background
    // ============================================
    createParticles() {
        const container = document.getElementById('particles');
        if (!container) return;
        
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 15 + 's';
            particle.style.animationDuration = (10 + Math.random() * 10) + 's';
            container.appendChild(particle);
        }
    }

    // ============================================
    // Event Bindings
    // ============================================
    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab));
        });

        // Quests
        document.getElementById('addQuestBtn')?.addEventListener('click', () => this.openModal());
        document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('cancelQuestBtn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('questForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addQuest();
        });

        // Filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.currentFilter = e.currentTarget.dataset.filter;
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.renderQuests();
            });
        });

        // Settings
        document.getElementById('saveSupabaseBtn')?.addEventListener('click', () => this.saveSupabase());
        document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
        document.getElementById('importDataBtn')?.addEventListener('click', () => this.importData());
        document.getElementById('resetDataBtn')?.addEventListener('click', () => this.resetData());

        // Level Up
        document.getElementById('claimRewardsBtn')?.addEventListener('click', () => {
            document.getElementById('levelUpOverlay').classList.remove('active');
        });

        // Boss
        document.getElementById('enterBattleBtn')?.addEventListener('click', () => {
            this.switchTab('boss');
        });
    }

    // ============================================
    // Tab Navigation
    // ============================================
    switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        
        document.getElementById(tabId)?.classList.add('active');
        document.querySelector(`.nav-btn[data-tab="${tabId}"]`)?.classList.add('active');
    }

    // ============================================
    // Render Functions
    // ============================================
    render() {
        this.renderQuests();
        this.renderSkills();
        this.renderBosses();
        this.updateUI();
    }

    updateUI() {
        const { player } = this.state;
        
        document.getElementById('playerLevel').textContent = player.level;
        document.getElementById('xpText').textContent = 
            `${player.xp.toLocaleString()} / ${player.xpToNext.toLocaleString()} XP`;
        document.getElementById('xpFill').style.width = 
            `${(player.xp / player.xpToNext) * 100}%`;
        document.getElementById('streakCount').textContent = player.streak;

        const statNames = {
            intelligence: 'Intelligence',
            fitness: 'Fitness',
            wealth: 'Wealth',
            learning: 'Learning'
        };

        Object.keys(player.stats).forEach(stat => {
            const value = player.stats[stat];
            const el = document.getElementById(`stat${statNames[stat]}`);
            if (el) {
                el.textContent = value;
                const card = el.closest('.stat-card');
                if (card) {
                    const fill = card.querySelector('.stat-fill');
                    if (fill) fill.style.width = value + '%';
                }
            }
        });
    }

    renderQuests() {
        const list = document.getElementById('questsList');
        if (!list) return;

        let quests = this.state.quests;
        if (this.currentFilter !== 'all') {
            quests = quests.filter(q => q.type === this.currentFilter);
        }

        if (quests.length === 0) {
            list.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                    <p>لا توجد مهام في هذه الفئة</p>
                </div>
            `;
            return;
        }

        list.innerHTML = quests.map(quest => `
            <div class="quest-item ${quest.completed ? 'completed' : ''}" data-id="${quest.id}">
                <div class="quest-checkbox ${quest.completed ? 'checked' : ''}" 
                     onclick="app.toggleQuest('${quest.id}')">
                    ${quest.completed ? '✓' : ''}
                </div>
                <div class="quest-content">
                    <div class="quest-title">${quest.title}</div>
                    <div class="quest-meta">
                        <span class="quest-badge ${quest.type}">${this.getTypeLabel(quest.type)}</span>
                        <span>${this.getCategoryIcon(quest.category)} ${this.getCategoryLabel(quest.category)}</span>
                    </div>
                </div>
                <div class="quest-xp">+${quest.xp} XP</div>
                <button class="quest-delete" onclick="app.deleteQuest('${quest.id}')">×</button>
            </div>
        `).join('');
    }

    renderSkills() {
        const matrix = document.getElementById('skillsMatrix');
        if (!matrix) return;

        matrix.innerHTML = this.state.skills.map(skill => {
            const progress = (skill.xp / skill.maxXp) * 100;
            return `
                <div class="skill-card">
                    <div class="skill-header">
                        <div class="skill-name">${skill.icon} ${skill.name}</div>
                        <div class="skill-level">LVL ${skill.level}</div>
                    </div>
                    <div class="skill-progress">
                        <div class="skill-progress-label">
                            <span>التقدم</span>
                            <span>${skill.xp} / ${skill.maxXp} XP</span>
                        </div>
                        <div class="skill-bar">
                            <div class="skill-bar-fill" style="width: ${progress}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderBosses() {
        const arena = document.getElementById('bossArena');
        if (!arena) return;

        if (this.state.bosses.length === 0) {
            arena.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">👹</div>
                    <p>لا توجد زعماء حالياً. أضف أهدافك الكبيرة!</p>
                </div>
            `;
            return;
        }

        arena.innerHTML = this.state.bosses.map(boss => {
            const hpPercent = (boss.hp / boss.maxHp) * 100;
            return `
                <div class="boss-card">
                    <div class="boss-header">
                        <div>
                            <span class="boss-tag">STAGE BOSS LVL ${boss.level}</span>
                            <h3 class="boss-name">${boss.name}</h3>
                        </div>
                    </div>
                    <p class="boss-desc">${boss.description}</p>
                    <div class="boss-hp-bar">
                        <div class="hp-label">
                            <span>BOSS HEALTH</span>
                            <span>${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()} HP</span>
                        </div>
                        <div class="hp-bar">
                            <div class="hp-fill" style="width: ${hpPercent}%"></div>
                        </div>
                    </div>
                    <div class="boss-actions">
                        <button class="btn-primary" onclick="app.attackBoss('${boss.id}')">
                            <span>⚔</span> توجيه ضربة
                        </button>
                        <button class="btn-danger" onclick="app.deleteBoss('${boss.id}')">
                            <span>🗑</span> حذف
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // Quest Actions
    // ============================================
    async addQuest() {
        const title = document.getElementById('questTitle').value.trim();
        const category = document.getElementById('questCategory').value;
        const type = document.getElementById('questType').value;
        const xp = parseInt(document.getElementById('questXP').value);

        if (!title) return;

        const newQuest = {
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
            title,
            category,
            type,
            xp,
            completed: false,
            created_at: new Date().toISOString()
        };

        this.state.quests.unshift(newQuest);
        this.saveState();
        
        // مزامنة مع السحابة
        if (this.useCloud) {
            await this.syncToCloud('quests', newQuest, 'insert');
        }
        
        this.renderQuests();
        this.closeModal();
        this.showToast('✓ تمت إضافة المهمة بنجاح', 'success');
        
        document.getElementById('questForm').reset();
    }

    async toggleQuest(id) {
        const quest = this.state.quests.find(q => q.id === id);
        if (!quest) return;

        if (!quest.completed) {
            quest.completed = true;
            quest.completed_at = new Date().toISOString();
            this.addXP(quest.xp);
            this.increaseStat(quest.category, Math.floor(quest.xp / 10));
            this.showToast(`+${quest.xp} XP! أحسنت`, 'success');
        } else {
            quest.completed = false;
            quest.completed_at = null;
            this.removeXP(quest.xp);
        }

        this.saveState();
        
        if (this.useCloud) {
            await this.syncToCloud('quests', quest, 'update');
            await this.syncToCloud('players', {
                id: this.state.player.id,
                ...this.state.player,
                xp_to_next: this.state.player.xpToNext
            }, 'update');
        }
        
        this.renderQuests();
        this.updateUI();
    }

    async deleteQuest(id) {
        if (!confirm('هل تريد حذف هذه المهمة؟')) return;
        
        this.state.quests = this.state.quests.filter(q => q.id !== id);
        this.saveState();
        
        if (this.useCloud) {
            await this.syncToCloud('quests', { id }, 'delete');
        }
        
        this.renderQuests();
        this.showToast('تم حذف المهمة', 'warning');
    }

    // ============================================
    // XP & Level System
    // ============================================
    addXP(amount) {
        this.state.player.xp += amount;
        
        while (this.state.player.xp >= this.state.player.xpToNext) {
            this.levelUp();
        }
    }

    removeXP(amount) {
        this.state.player.xp = Math.max(0, this.state.player.xp - amount);
    }

    levelUp() {
        this.state.player.xp -= this.state.player.xpToNext;
        this.state.player.level++;
        this.state.player.xpToNext = Math.floor(this.state.player.xpToNext * 1.2);
        
        Object.keys(this.state.player.stats).forEach(stat => {
            this.state.player.stats[stat] = Math.min(100, this.state.player.stats[stat] + 5);
        });

        this.showLevelUp();
    }

    showLevelUp() {
        document.getElementById('newLevel').textContent = this.state.player.level;
        document.getElementById('levelUpOverlay').classList.add('active');
    }

    increaseStat(category, amount) {
        if (this.state.player.stats[category] !== undefined) {
            this.state.player.stats[category] = Math.min(100, 
                this.state.player.stats[category] + amount);
        }
    }

    // ============================================
    // Boss System
    // ============================================
    async attackBoss(id) {
        const boss = this.state.bosses.find(b => b.id === id);
        if (!boss) return;

        const damage = Math.floor(Math.random() * 500) + 200;
        boss.hp = Math.max(0, boss.hp - damage);
        
        this.addXP(100);
        this.showToast(`⚔ ضربة قوية! -${damage} HP`, 'success');

        if (boss.hp === 0) {
            boss.defeated = true;
            this.addXP(1000);
            this.showToast(`🏆 تم هزيمة الزعيم! +1000 XP`, 'success');
        }

        this.saveState();
        
        if (this.useCloud) {
            await this.syncToCloud('bosses', boss, 'update');
        }
        
        this.renderBosses();
        this.updateUI();
    }

    async deleteBoss(id) {
        if (!confirm('هل تريد حذف هذا الزعيم؟')) return;
        
        this.state.bosses = this.state.bosses.filter(b => b.id !== id);
        this.saveState();
        
        if (this.useCloud) {
            await this.syncToCloud('bosses', { id }, 'delete');
        }
        
        this.renderBosses();
        this.showToast('تم حذف الزعيم', 'warning');
    }

    // ============================================
    // Modal
    // ============================================
    openModal() {
        document.getElementById('questModal').classList.add('active');
    }

    closeModal() {
        document.getElementById('questModal').classList.remove('active');
    }

    // ============================================
    // Settings
    // ============================================
    async saveSupabase() {
        const url = document.getElementById('supabaseUrl').value.trim();
        const key = document.getElementById('supabaseKey').value.trim();

        if (!url || !key) {
            this.showToast('الرجاء إدخال جميع البيانات', 'error');
            return;
        }

        // التحقق من صحة الصيغة
        if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
            this.showToast('⚠ صيغة URL غير صحيحة. يجب أن تكون مثل: https://xxx.supabase.co', 'warning');
            return;
        }

        this.showToast('جاري الاتصال...', 'info');
        const success = await this.connectSupabase(url, key);
        
        if (success) {
            this.showToast('✓ تم حفظ البيانات وربطها بنجاح', 'success');
        }
    }

    exportData() {
        const data = JSON.stringify(this.state, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `liferpg-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('✓ تم تصدير البيانات', 'success');
    }

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    this.state = data;
                    this.saveState();
                    this.render();
                    this.showToast('✓ تم استيراد البيانات بنجاح', 'success');
                } catch (err) {
                    this.showToast('خطأ في ملف البيانات', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    async resetData() {
        if (!confirm('⚠ هل أنت متأكد؟ سيتم حذف جميع البيانات!')) return;
        if (!confirm('تأكيد نهائي: سيتم إعادة تعيين كل شيء!')) return;
        
        this.state = this.getDefaultState();
        this.saveState();
        
        if (this.useCloud) {
            // حذف البيانات من السحابة أيضاً
            try {
                const { data: { user } } = await this.supabase.auth.getUser();
                if (user) {
                    await Promise.all([
                        this.supabase.from('quests').delete().eq('user_id', user.id),
                        this.supabase.from('skills').delete().eq('user_id', user.id),
                        this.supabase.from('bosses').delete().eq('user_id', user.id),
                        this.supabase.from('players').delete().eq('user_id', user.id)
                    ]);
                }
            } catch (err) {
                console.error('Reset cloud error:', err);
            }
        }
        
        this.render();
        this.showToast('تم إعادة تعيين البيانات', 'warning');
    }

    // ============================================
    // Toast Notifications
    // ============================================
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ============================================
    // Helpers
    // ============================================
    getTypeLabel(type) {
        const labels = { daily: 'يومية', weekly: 'أسبوعية', main: 'رئيسية' };
        return labels[type] || type;
    }

    getCategoryLabel(cat) {
        const labels = { 
            intelligence: 'الذكاء', 
            fitness: 'اللياقة', 
            wealth: 'المال', 
            learning: 'التعلم' 
        };
        return labels[cat] || cat;
    }

    getCategoryIcon(cat) {
        const icons = { 
            intelligence: '🧠', 
            fitness: '💪', 
            wealth: '💰', 
            learning: '📚' 
        };
        return icons[cat] || '⚡';
    }
}

// ============================================
// Initialize App
// ============================================
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new LifeRPG();
});
