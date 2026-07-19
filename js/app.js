        
        // Loaded configurations references
        let CONFIG = {
            app: {},
            routine: [],
            whiteboardTopics: [],
            revisionTopics: {},
            studyPlan: {}
        };

        // Configuration loader — fetches decoupled JSON files from /json
        const loader = {
            async loadAll() {
                try {
                    const [app, routine, whiteboardTopics, revisionTopics, studyPlan] = await Promise.all([
                        fetch('json/app.json').then(r => r.json()),
                        fetch('json/routine.json').then(r => r.json()),
                        fetch('json/whiteboard.json').then(r => r.json()),
                        fetch('json/revision.json').then(r => r.json()),
                        fetch('json/study-plan.json').then(r => r.json())
                    ]);
                    CONFIG.app = app;
                    CONFIG.routine = routine;
                    CONFIG.whiteboardTopics = whiteboardTopics;
                    CONFIG.revisionTopics = revisionTopics;
                    CONFIG.studyPlan = studyPlan;
                    console.log("Configuration JSON files fetched and parsed successfully.");
                } catch (e) {
                    console.error("Configuration decoding error: ", e);
                    showToast("Failed loading configuration JSON files", "warning");
                }
            }
        };

        // Writeable local state storage engine. Keeps configurations and progress flags detached.
        const storage = {
            PREFIX: 'prepflow_v2_',
            
            get(key) {
                try {
                    const data = localStorage.getItem(this.PREFIX + key);
                    return data ? JSON.parse(data) : null;
                } catch (e) {
                    return null;
                }
            },
            
            set(key, value) {
                try {
                    localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
                } catch (e) {
                    console.error("Local storage error: ", e);
                }
            },

            // Active flags retrieval for specific dates and activities
            getTaskStatus(dateStr, taskId) {
                const logs = this.get('logs') || {};
                if (!logs[dateStr]) return null;
                return logs[dateStr][taskId] || null;
            },

            setTaskStatus(dateStr, taskId, status) {
                const logs = this.get('logs') || {};
                if (!logs[dateStr]) logs[dateStr] = {};
                
                logs[dateStr][taskId] = status;
                this.set('logs', logs);
                
                // Keep progress statistics accurate
                this.recalculateTotalStats();
                app.updateDashboard();
            },

            // Mastery trackers for Whiteboard and Revision topics
            getMasteredWhiteboard() {
                return this.get('mastered_whiteboard') || [];
            },

            flagWhiteboardMastered(topic) {
                const mastered = this.getMasteredWhiteboard();
                if (!mastered.includes(topic)) {
                    mastered.push(topic);
                    this.set('mastered_whiteboard', mastered);
                    this.recalculateTotalStats();
                    return true;
                }
                return false;
            },

            getMasteredRevisions() {
                return this.get('mastered_revisions') || [];
            },

            flagRevisionMastered(topic) {
                const mastered = this.getMasteredRevisions();
                if (!mastered.includes(topic)) {
                    mastered.push(topic);
                    this.set('mastered_revisions', mastered);
                    this.recalculateTotalStats();
                    return true;
                }
                return false;
            },

            unflagRevisionMastered(topic) {
                const mastered = this.getMasteredRevisions();
                const index = mastered.indexOf(topic);
                if (index > -1) {
                    mastered.splice(index, 1);
                    this.set('mastered_revisions', mastered);
                    this.recalculateTotalStats();
                    return true;
                }
                return false;
            },

            recalculateTotalStats() {
                const logs = this.get('logs') || {};
                let completedCount = 0;
                let skippedCount = 0;

                Object.values(logs).forEach(dayLog => {
                    Object.values(dayLog).forEach(status => {
                        if (status === 'completed') completedCount++;
                        if (status === 'skipped') skippedCount++;
                    });
                });

                // Include overall whiteboard and revision items in completed stats
                const masteredWCount = this.getMasteredWhiteboard().length;
                const masteredRCount = this.getMasteredRevisions().length;
                const totalMastery = completedCount + masteredWCount + masteredRCount;

                this.set('overall_stats', {
                    completedTasks: totalMastery,
                    skippedTasks: skippedCount,
                    whiteboardCompleted: masteredWCount,
                    revisionCompleted: masteredRCount
                });
            },

            clearAllSafe() {
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(this.PREFIX)) {
                        localStorage.removeItem(key);
                    }
                });
                showToast("System memory wiped. Reloading setup...", "warning");
                setTimeout(() => location.reload(), 1200);
            }
        };

        // Scheduling and temporal calculations engine
        const scheduler = {
            simulatedDateOffset: 0, // Time simulation tracking in milliseconds

            getNow() {
                // Return real date plus any user simulation offset
                return new Date(Date.now() + this.simulatedDateOffset);
            },
            
            getDateString() {
                const now = this.getNow();
                // Ensure date displays based on native local timezone splits
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            },

            // Safe range boundary validator
            getDayNumber() {
                if (!CONFIG.app.startDate) return 1;
                const start = new Date(CONFIG.app.startDate);
                start.setHours(0,0,0,0);
                
                const current = this.getNow();
                current.setHours(0,0,0,0);
                
                const diffTime = current.getTime() - start.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
                
                if (diffDays < 1) return 1; // Prior to start date
                if (diffDays > CONFIG.app.totalDays) return CONFIG.app.totalDays; // After end date
                return diffDays;
            },
            
            timeToMinutes(timeStr) {
                const [h, m] = timeStr.split(':').map(Number);
                return h * 60 + m;
            },
            
            getCurrentTimeMinutes() {
                const now = this.getNow();
                return now.getHours() * 60 + now.getMinutes();
            },
            
            // Dynamic evaluation of timeline item states for a chosen date
            getTimelineStateForDate(dateStr) {
                const logs = storage.get('logs') || {};
                const dayLogs = logs[dateStr] || {};
                const currentMins = this.getCurrentTimeMinutes();
                const activeTodayStr = this.getDateString();
                
                return CONFIG.routine.map(task => {
                    const startMins = this.timeToMinutes(task.start);
                    const endMins = this.timeToMinutes(task.end);
                    
                    const savedStatus = dayLogs[task.id];
                    let computedStatus = 'upcoming';
                    
                    if (savedStatus) {
                        computedStatus = savedStatus;
                    } else if (dateStr < activeTodayStr) {
                        computedStatus = 'overdue'; // Past days default to overdue if not checked
                    } else if (dateStr === activeTodayStr) {
                        if (currentMins >= startMins && currentMins < endMins) {
                            computedStatus = 'in_progress';
                        } else if (currentMins >= endMins) {
                            computedStatus = 'overdue';
                        } else {
                            computedStatus = 'upcoming';
                        }
                    } else {
                        computedStatus = 'upcoming';
                    }
                    
                    return {
                        ...task,
                        status: computedStatus,
                        isCurrent: (dateStr === activeTodayStr && currentMins >= startMins && currentMins < endMins)
                    };
                });
            },
            
            getStudyPlanForDay(dayNum) {
                return CONFIG.studyPlan[dayNum] || null;
            },

            // Active consecutive streak computation using real historical entries
            getStreak() {
                const logs = storage.get('logs') || {};
                let streak = 0;
                let checkDate = new Date(this.getNow());
                
                while (true) {
                    const dateStr = checkDate.toISOString().split('T')[0];
                    const dayLogs = logs[dateStr] || {};
                    const hasCompleted = Object.values(dayLogs).includes('completed');
                    
                    if (hasCompleted) {
                        streak++;
                        checkDate.setDate(checkDate.getDate() - 1);
                    } else {
                        const todayStr = this.getNow().toISOString().split('T')[0];
                        if (dateStr === todayStr) {
                            checkDate.setDate(checkDate.getDate() - 1);
                            continue;
                        }
                        break;
                    }
                }
                return streak;
            }
        };

        // Helper function to dynamically render complex types from the study plan safely
        function renderContentValue(content) {
            if (content === null || content === undefined || (Array.isArray(content) && content.length === 0)) {
                return `<span class="text-xs text-textSecondary italic">None scheduled</span>`;
            }
            if (Array.isArray(content)) {
                return `<ul class="list-disc pl-4 space-y-1 mt-1 text-xs">` + 
                       content.map(item => `<li class="text-textPrimary">${item}</li>`).join('') + 
                       `</ul>`;
            }
            if (typeof content === 'object') {
                let html = '';
                if (content.topic) {
                    html += `<strong class="text-textPrimary text-sm block">${content.topic}</strong>`;
                }
                if (content.questions && Array.isArray(content.questions) && content.questions.length > 0) {
                    html += `<ul class="list-decimal pl-4 space-y-0.5 mt-1 text-xs">` + 
                            content.questions.map(q => `<li class="text-textSecondary">${q}</li>`).join('') + 
                            `</ul>`;
                }
                return html || `<span class="text-xs text-textSecondary italic">None scheduled</span>`;
            }
            return `<span class="text-textPrimary">${content}</span>`;
        }

        // UI rendering and interactions controller
        const dashboard = {
            
            renderTimeline() {
                const timelineEl = document.getElementById('timeline');
                const dateStr = scheduler.getDateString();
                const tasks = scheduler.getTimelineStateForDate(dateStr);
                
                timelineEl.innerHTML = '';
                
                let completedCount = 0;
                let totalCount = tasks.length;
                
                tasks.forEach(task => {
                    if (task.status === 'completed' || task.status === 'skipped') completedCount++;
                    
                    const el = document.createElement('div');
                    let timelineModifier = 'timeline-item--upcoming';
                    let actionHtml = '';
                    
                    if (task.status === 'completed') {
                        timelineModifier = 'timeline-item--completed';
                        actionHtml = `<span class="badge badge--success">Mastered</span>`;
                    } else if (task.status === 'skipped') {
                        timelineModifier = 'timeline-item--skipped';
                        actionHtml = `<span class="badge badge--danger">Skipped</span>`;
                    } else if (task.status === 'in_progress') {
                        timelineModifier = 'timeline-item--in-progress';
                        actionHtml = `
                            <div class="flex gap-2">
                                <button onclick="app.handleTaskAction('${task.id}', 'completed')" class="button button--success button--small">Mark Done</button>
                                <button onclick="app.handleTaskAction('${task.id}', 'skipped')" class="button button--secondary button--small">Skip</button>
                            </div>
                        `;
                    } else if (task.status === 'overdue') {
                        timelineModifier = 'timeline-item--overdue';
                        actionHtml = `
                            <button onclick="app.handleTaskAction('${task.id}', 'completed')" class="button button--outline-warning button--small">Complete Late</button>
                        `;
                    } else {
                        actionHtml = `<span class="text-xs text-textSecondary opacity-60 block w-16 text-right">Scheduled</span>`;
                    }

                    el.className = `timeline-item ${timelineModifier}`;
                    el.innerHTML = `
                        <div class="flex flex-col items-center mt-1">
                            <div class="timeline-item__dot"></div>
                            <div class="w-px h-full bg-appBorder mt-2"></div>
                        </div>
                        <div class="flex-1 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                            <div>
                                <h3 class="text-sm font-semibold ${task.isCurrent ? 'text-textPrimary font-bold' : 'text-textPrimary'}">${task.name}</h3>
                                <p class="text-xs text-textSecondary mt-0.5">${task.start} - ${task.end} &bull; ${task.desc}</p>
                            </div>
                            <div class="mt-2 sm:mt-0 flex shrink-0">
                                ${actionHtml}
                            </div>
                        </div>
                    `;
                    timelineEl.appendChild(el);
                });
                
                this.updateProgress(completedCount, totalCount);
                this.renderCurrentTask(tasks);
            },
            
            renderCurrentTask(tasks) {
                const cardEl = document.getElementById('current-focus');
                const container = cardEl.querySelector('.focus-content');
                
                const currentTask = tasks.find(t => t.status === 'in_progress');
                const overdueTasks = tasks.filter(t => t.status === 'overdue');
                
                if (currentTask) {
                    cardEl.className = 'card card--highlight';
                    container.innerHTML = `
                        <h3 class="text-2xl font-bold text-textPrimary">${currentTask.name}</h3>
                        <p class="text-textSecondary text-sm">${currentTask.desc}</p>
                        <div class="mt-4 flex gap-3">
                            <button onclick="app.handleTaskAction('${currentTask.id}', 'completed')" class="button button--primary button--large flex-1">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                Done!
                            </button>
                            <button onclick="app.handleTaskAction('${currentTask.id}', 'skipped')" class="button button--secondary button--large">
                                Skip Block
                            </button>
                        </div>
                    `;
                } else if (overdueTasks.length > 0) {
                    const latestOverdue = overdueTasks[overdueTasks.length - 1];
                    cardEl.className = 'card card--highlight-overdue';
                    container.innerHTML = `
                        <h3 class="text-2xl font-bold text-textPrimary opacity-60">Catch Up Period</h3>
                        <p class="text-statusOverdue text-sm font-semibold mt-2">Current outstanding: ${latestOverdue.name}</p>
                        <div class="mt-4">
                            <button onclick="app.handleTaskAction('${latestOverdue.id}', 'completed')" class="button button--outline-warning button--large w-full sm:w-auto">
                                Mark As Done Now
                            </button>
                        </div>
                    `;
                } else {
                    cardEl.className = 'card';
                    const allDone = tasks.every(t => t.status === 'completed' || t.status === 'skipped');
                    
                    if (allDone) {
                        container.innerHTML = `
                            <h3 class="text-xl font-bold text-statusCompleted flex items-center gap-2">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                Daily Syllabus Completed!
                            </h3>
                            <p class="text-textSecondary mt-1">Excellent pacing. Enjoy your rest period!</p>
                        `;
                    } else {
                        const nextTask = tasks.find(t => t.status === 'upcoming');
                        if (nextTask) {
                            container.innerHTML = `
                                <h3 class="text-xl font-bold text-textPrimary opacity-70">Study Interval / Rest</h3>
                                <p class="text-textSecondary mt-1">Next focused module is: <span class="text-textPrimary font-semibold">${nextTask.name}</span> beginning at ${nextTask.start}</p>
                            `;
                        }
                    }
                }
            },
            
            updateProgress(completed, total) {
                const progressCard = document.getElementById('daily-progress');
                if (progressCard) {
                    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                    progressCard.querySelector('.progress-percentage').innerText = `${percent}%`;
                    progressCard.querySelector('.progress-fill').style.width = `${percent}%`;
                    progressCard.querySelector('.progress-stats').innerText = `${completed}/${total} Activities Mastered`;
                }
            },
            
            renderGenerators() {
                const dateStr = scheduler.getDateString();
                const masteredW = storage.getMasteredWhiteboard();
                const masteredR = storage.getMasteredRevisions();

                // 1. Decoupled Whiteboard Generator
                let currentWTopic = storage.get('current_whiteboard_topic_' + dateStr);
                
                // If current selection is empty or already mastered, draw a fresh one
                if (!currentWTopic || masteredW.includes(currentWTopic)) {
                    // Filter available topics that are not yet mastered
                    const availableTopics = CONFIG.whiteboardTopics.filter(t => !masteredW.includes(t));
                    
                    if (availableTopics.length > 0) {
                        currentWTopic = availableTopics[Math.floor(Math.random() * availableTopics.length)];
                        storage.set('current_whiteboard_topic_' + dateStr, currentWTopic);
                    } else {
                        currentWTopic = "All Whiteboard Topics Mastered! Congratulations! 🎉";
                        storage.set('current_whiteboard_topic_' + dateStr, currentWTopic);
                    }
                }

                const wTextEl = document.getElementById('whiteboard-text');
                const wMasterBtn = document.getElementById('whiteboard-master-btn');
                if (wTextEl) {
                    wTextEl.innerText = currentWTopic;
                    
                    // Disable mastered trigger if already finished
                    if (masteredW.includes(currentWTopic) || CONFIG.whiteboardTopics.filter(t => !masteredW.includes(t)).length === 0) {
                        wMasterBtn.disabled = true;
                        wMasterBtn.classList.add('is-disabled');
                        wMasterBtn.innerText = "Mastery Achieved!";
                    } else {
                        wMasterBtn.disabled = false;
                        wMasterBtn.classList.remove('is-disabled');
                        wMasterBtn.innerText = "Mark Topic as Mastered";
                    }
                }

                // 2. Decoupled Revision Generator
                let revisionSet = storage.get('current_revision_set_' + dateStr);
                if (!revisionSet && CONFIG.revisionTopics.ml) {
                    // Pull from non-completed pools
                    const getUncompleted = (category, pool) => {
                        const filtered = pool.filter(t => !masteredR.includes(t));
                        if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
                        return pool[Math.floor(Math.random() * pool.length)]; // Reset fallback
                    };

                    revisionSet = {
                        ml: getUncompleted('ml', CONFIG.revisionTopics.ml),
                        dl: getUncompleted('dl', CONFIG.revisionTopics.dl),
                        llm: getUncompleted('llm', CONFIG.revisionTopics.llm)
                    };
                    storage.set('current_revision_set_' + dateStr, revisionSet);
                }

                const revisionListEl = document.getElementById('revision-list');
                if (revisionListEl && revisionSet) {
                    revisionListEl.innerHTML = '';
                    
                    const categories = [
                        { key: 'ml', label: 'ML', topic: revisionSet.ml },
                        { key: 'dl', label: 'DL', topic: revisionSet.dl },
                        { key: 'llm', label: 'LLM', topic: revisionSet.llm }
                    ];

                    categories.forEach(cat => {
                        const isChecked = masteredR.includes(cat.topic);
                        const li = document.createElement('li');
                        li.className = "flex items-center justify-between p-2 bg-appBg/50 border border-appBorder/50 rounded-lg";
                        li.innerHTML = `
                            <div class="flex items-center gap-2">
                                <span class="badge badge--neutral text-[9px] uppercase tracking-wider px-1.5">${cat.label}</span>
                                <span class="text-xs ${isChecked ? 'line-through text-textSecondary opacity-60' : 'text-textPrimary'}">${cat.topic}</span>
                            </div>
                            <input type="checkbox" class="w-4 h-4 text-statusCompleted rounded border-appBorder focus:ring-statusCompleted cursor-pointer" 
                                ${isChecked ? 'checked' : ''} 
                                onchange="app.handleRevisionCheck('${cat.topic}', this.checked)">
                        `;
                        revisionListEl.appendChild(li);
                    });
                }
            },

            refreshWhiteboard() {
                const dateStr = scheduler.getDateString();
                const masteredW = storage.getMasteredWhiteboard();
                const availableTopics = CONFIG.whiteboardTopics.filter(t => !masteredW.includes(t));
                
                if (availableTopics.length === 0) {
                    showToast("All available whiteboard concepts have been mastered!", "warning");
                    return;
                }
                
                const newTopic = availableTopics[Math.floor(Math.random() * availableTopics.length)];
                storage.set('current_whiteboard_topic_' + dateStr, newTopic);
                this.renderGenerators();
                showToast("Whiteboard presentation target updated!");
            },
            
            refreshRevision() {
                const dateStr = scheduler.getDateString();
                const masteredR = storage.getMasteredRevisions();
                
                const getUncompleted = (pool) => {
                    const filtered = pool.filter(t => !masteredR.includes(t));
                    if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
                    return pool[Math.floor(Math.random() * pool.length)];
                };

                const newSet = {
                    ml: getUncompleted(CONFIG.revisionTopics.ml),
                    dl: getUncompleted(CONFIG.revisionTopics.dl),
                    llm: getUncompleted(CONFIG.revisionTopics.llm)
                };
                
                storage.set('current_revision_set_' + dateStr, newSet);
                this.renderGenerators();
                showToast("Nightly revision subjects updated!");
            },
            
            renderStudyPlan() {
                const dayNum = scheduler.getDayNumber();
                const plan = scheduler.getStudyPlanForDay(dayNum);
                const container = document.getElementById('study-plan');
                
                if (!plan) {
                    container.innerHTML = '<p class="italic text-center py-4">No academic roadmap entries found for today.</p>';
                    return;
                }
                
                let html = '';
                for (const [subject, content] of Object.entries(plan)) {
                    // Skip empty arrays/content to prevent cluttering the syllabus details
                    if (Array.isArray(content) && content.length === 0) continue;
                    
                    let label = subject.toUpperCase();
                    let valueHtml = renderContentValue(content);
                    
                    html += `
                        <div class="border-b border-appBorder last:border-0 pb-2 mb-2">
                            <span class="text-xs font-bold text-statusInProgress tracking-wider uppercase">${label}</span>
                            <div class="mt-1 leading-tight text-sm">${valueHtml}</div>
                        </div>
                    `;
                }
                container.innerHTML = html;
            },
            
            renderStats() {
                const statsCard = document.getElementById('quick-stats');
                if (statsCard) {
                    const stats = storage.get('overall_stats') || { completedTasks: 0, skippedTasks: 0, whiteboardCompleted: 0, revisionCompleted: 0 };
                    
                    const tasksDoneEl = statsCard.querySelector('.stats-completed');
                    if (tasksDoneEl) tasksDoneEl.innerText = stats.completedTasks;
                    
                    const rateEl = statsCard.querySelector('.stats-rate');
                    if (rateEl) {
                        const totalW = CONFIG.whiteboardTopics.length;
                        const percent = totalW > 0 ? Math.round((stats.whiteboardCompleted / totalW) * 100) : 0;
                        rateEl.innerText = `${percent}% mastered`;
                    }
                    
                    const streakEl = statsCard.querySelector('.stats-streak');
                    if (streakEl) {
                        const streak = scheduler.getStreak();
                        streakEl.innerHTML = `${streak} <span class="text-xs font-normal font-sans">days</span>`;
                    }
                }
            },

            renderCalendarView() {
                const gridEl = document.getElementById('calendar-grid');
                if (!gridEl) return;
                gridEl.innerHTML = '';

                const activeDateString = scheduler.getDateString();

                // Grid structures representing July 2026
                const julyWeekdayOffset = 3; // July 1st is a Wednesday
                const daysInJuly = 31;

                // Week offset renderers
                for (let i = 0; i < julyWeekdayOffset; i++) {
                    const cell = document.createElement('div');
                    cell.className = 'calendar-cell calendar-cell--inactive bg-transparent border-0';
                    gridEl.appendChild(cell);
                }

                let totalPrepCompleted = 0;
                let perfectDaysCount = 0;
                let activeDaysLoggedCount = 0;
                let totalPercentageSum = 0;
                const dailyRates = [];

                // Calendar cell populator
                for (let day = 1; day <= daysInJuly; day++) {
                    const cell = document.createElement('div');
                    const dateStr = `2026-07-${day < 10 ? '0' + day : day}`;
                    const isPrepDay = (day >= 19 && day <= 31);
                    
                    if (!isPrepDay) {
                        cell.className = 'calendar-cell calendar-cell--inactive bg-appBg border border-appBorder/10 opacity-30 select-none';
                        cell.innerHTML = `<span>${day}</span>`;
                    } else {
                        const dayTasks = scheduler.getTimelineStateForDate(dateStr);
                        const completed = dayTasks.filter(t => t.status === 'completed' || t.status === 'skipped').length;
                        const total = dayTasks.length;
                        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                        
                        totalPrepCompleted += dayTasks.filter(t => t.status === 'completed').length;
                        if (percent === 100) perfectDaysCount++;
                        if (completed > 0) activeDaysLoggedCount++;
                        totalPercentageSum += percent;

                        dailyRates.push({ day, percent });

                        let bgClass = 'bg-appBg';
                        let borderClass = 'border-appBorder';
                        let textClass = 'text-textPrimary';

                        // Graded styling depending on completion rates
                        if (percent === 100) {
                            bgClass = 'bg-statusCompleted text-white font-bold';
                        } else if (percent >= 75) {
                            bgClass = 'bg-emerald-600/60';
                        } else if (percent >= 50) {
                            bgClass = 'bg-emerald-700/40';
                        } else if (percent >= 25) {
                            bgClass = 'bg-emerald-800/20';
                        } else if (percent > 0) {
                            bgClass = 'bg-emerald-900/10';
                        }

                        const isCurrentDay = (dateStr === activeDateString);
                        const currentDayHighlight = isCurrentDay ? 'calendar-cell--current' : '';

                        cell.className = `calendar-cell calendar-cell--active ${bgClass} ${borderClass} ${textClass} ${currentDayHighlight} shadow-sm`;
                        cell.innerHTML = `
                            <span class="text-xs absolute top-1 left-1.5 opacity-60">${day}</span>
                            <span class="text-xs font-bold mt-3">${percent}%</span>
                            <div class="calendar-tooltip font-medium text-xs">
                                Day ${day - 18} &bull; ${percent}% logged (${completed}/${total} tasks)
                            </div>
                        `;

                        cell.addEventListener('click', () => {
                            app.travelToDate(dateStr);
                        });
                    }

                    gridEl.appendChild(cell);
                }

                // Update analytical totals
                document.getElementById('stats-perfect-days').innerText = perfectDaysCount;
                const avgProgress = dailyRates.length > 0 ? Math.round(totalPercentageSum / dailyRates.length) : 0;
                document.getElementById('stats-avg-progress').innerText = `${avgProgress}%`;
                document.getElementById('stats-days-logged').innerText = activeDaysLoggedCount;

                this.renderSparklineChart(dailyRates);
                this.renderSelectedSyllabus();
            },

            renderSparklineChart(dailyRates) {
                const container = document.getElementById('stats-sparkline-bars');
                if (!container) return;
                container.innerHTML = '';

                dailyRates.forEach(item => {
                    const bar = document.createElement('div');
                    bar.className = 'flex-1 group relative flex flex-col justify-end h-full cursor-pointer';
                    const heightPercent = Math.max(item.percent, 6);
                    
                    let colorClass = 'bg-appBorder';
                    if (item.percent === 100) colorClass = 'bg-statusCompleted';
                    else if (item.percent > 50) colorClass = 'bg-statusInProgress';
                    else if (item.percent > 0) colorClass = 'bg-statusOverdue';

                    bar.innerHTML = `
                        <div class="w-full ${colorClass} rounded-t" style="height: ${heightPercent}%"></div>
                        <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 bg-black/90 text-white text-[10px] py-1 px-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 whitespace-nowrap mb-1">
                            Jul ${item.day}: ${item.percent}%
                        </div>
                    `;
                    bar.addEventListener('click', () => {
                        app.travelToDate(`2026-07-${item.day < 10 ? '0' + item.day : item.day}`);
                    });
                    container.appendChild(bar);
                });
            },

            renderSelectedSyllabus() {
                const dayNum = scheduler.getDayNumber();
                const plan = scheduler.getStudyPlanForDay(dayNum);
                const container = document.getElementById('selected-day-syllabus');
                if (!container) return;

                if (!plan) {
                    container.innerHTML = `
                        <div class="text-center py-4">
                            <p class="text-textSecondary text-sm italic">Day ${dayNum} covers mock evaluation systems & final rehearsals!</p>
                        </div>
                    `;
                    return;
                }

                let html = `
                    <div class="flex justify-between items-center border-b border-appBorder pb-2 mb-2">
                        <span class="text-xs font-bold text-statusCompleted uppercase tracking-wider">Plan Day ${dayNum} Target Blueprint</span>
                        <span class="text-xs text-textSecondary">Target Date: 2026-07-${18 + dayNum}</span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                `;

                for (const [subject, content] of Object.entries(plan)) {
                    // Skip empty values to look exceptionally clean
                    if (Array.isArray(content) && content.length === 0) continue;
                    
                    let valueHtml = renderContentValue(content);

                    html += `
                        <div class="bg-appCard border border-appBorder/60 p-3 rounded-lg text-xs leading-relaxed">
                            <span class="font-bold text-statusInProgress uppercase block mb-1">${subject}</span>
                            ${valueHtml}
                        </div>
                    `;
                }

                html += `</div>`;
                container.innerHTML = html;
            },
            
            updateHeader() {
                const now = scheduler.getNow();
                const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                
                const headerDateEl = document.getElementById('header-date');
                if (headerDateEl) {
                    const relativeText = scheduler.simulatedDateOffset !== 0 ? ' (Simulated)' : '';
                    headerDateEl.innerText = now.toLocaleDateString('en-US', options) + relativeText;
                }
                
                const dayBadge = document.getElementById('day-counter');
                if (dayBadge) {
                    const todayNum = scheduler.getDayNumber();
                    const realToday = new Date();
                    const prepStartDate = new Date("2026-07-19T00:00:00");
                    
                    if (realToday < prepStartDate && scheduler.simulatedDateOffset === 0) {
                        dayBadge.innerText = `Starts Tomorrow!`;
                        dayBadge.className = "badge badge--warning px-4 py-1.5 text-sm font-semibold";
                    } else {
                        dayBadge.innerText = `Day ${todayNum}`;
                        dayBadge.className = "badge badge--info px-4 py-1.5 text-sm font-semibold";
                    }
                }
                
                const timeDisplay = document.querySelector('#current-focus .focus-time');
                if (timeDisplay) {
                    timeDisplay.innerText = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                }
            }
        };

        // Theme management API
        const theme = {
            init() {
                const savedTheme = storage.get('theme') || 'dark';
                this.setTheme(savedTheme);
                
                document.getElementById('theme-toggle-btn').addEventListener('click', () => {
                    const currentTheme = document.documentElement.classList.contains('light-mode') ? 'light' : 'dark';
                    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                    this.setTheme(newTheme);
                });
            },
            setTheme(mode) {
                const sunIcon = document.getElementById('sun-icon');
                const moonIcon = document.getElementById('moon-icon');
                
                if (mode === 'light') {
                    document.documentElement.classList.add('light-mode');
                    document.body.classList.add('light-mode');
                    sunIcon.classList.add('hidden');
                    moonIcon.classList.remove('hidden');
                } else {
                    document.documentElement.classList.remove('light-mode');
                    document.body.classList.remove('light-mode');
                    sunIcon.classList.remove('hidden');
                    moonIcon.classList.add('hidden');
                }
                storage.set('theme', mode);
            }
        };

        // Application workflow controller
        const app = {
            timer: null,
            
            async init() {
                await loader.loadAll();
                await this.loadProgressSnapshot();
                theme.init();
                this.detectCurrentDate();
                this.bindEvents();
                this.updateDashboard();
                this.startTimer();
                console.log("PrepFlow state architecture loaded.");
            },

            // Auto-load a saved progress snapshot from progress/progress.json, if present.
            // Silently does nothing if the folder/file is missing, empty, or invalid —
            // the app just falls back to whatever is already in localStorage.
            async loadProgressSnapshot() {
                try {
                    const res = await fetch('progress/progress.json', { cache: 'no-store' });
                    if (!res.ok) return; // 404 or similar — no snapshot present, skip silently

                    const text = await res.text();
                    if (!text || !text.trim()) return; // empty file — skip silently

                    const parsed = JSON.parse(text);
                    if (parsed.logs && Array.isArray(parsed.mastered_whiteboard)) {
                        storage.set('logs', parsed.logs);
                        storage.set('mastered_whiteboard', parsed.mastered_whiteboard);
                        storage.set('mastered_revisions', parsed.mastered_revisions || []);
                        storage.recalculateTotalStats();
                        console.log("Progress snapshot auto-loaded from progress/progress.json.");
                        showToast("Progress auto-loaded from saved snapshot.", "info");
                    }
                } catch (e) {
                    // Missing folder, network hiccup, or invalid JSON — treat the same as "no file present"
                    console.log("No valid progress snapshot found at progress/progress.json — starting from local storage.");
                }
            },
            
            detectCurrentDate() {
                const now = new Date();
                const startDate = new Date("2026-07-19T00:00:00");
                const endDate = new Date("2026-07-31T23:59:59");
                
                // If loaded today (before the 19th), shift simulation so you start in preview on Day 1
                if (now < startDate) {
                    console.log("Date is prior to Day 1. Enabling simulated preview range starting July 19th.");
                    const diffTime = startDate.getTime() - now.getTime();
                    // Set simulation offset to align exactly with July 19th at 10:00 AM
                    const targetPreset = new Date("2026-07-19T10:00:00");
                    scheduler.simulatedDateOffset = targetPreset.getTime() - Date.now();
                } else if (now > endDate) {
                    // Lock simulated time to the final prep day to keep the archive inspectable
                    const endPreset = new Date("2026-07-31T12:00:00");
                    scheduler.simulatedDateOffset = endPreset.getTime() - Date.now();
                }
            },
            
            bindEvents() {
                document.getElementById('refresh-whiteboard').addEventListener('click', () => dashboard.refreshWhiteboard());
                document.getElementById('refresh-revision').addEventListener('click', () => dashboard.refreshRevision());
                
                document.getElementById('whiteboard-master-btn').addEventListener('click', () => {
                    const topic = document.getElementById('whiteboard-text').innerText;
                    if (storage.flagWhiteboardMastered(topic)) {
                        showToast(`"${topic}" successfully marked as Mastered!`, 'success');
                        this.updateDashboard();
                    }
                });

                document.getElementById('reset-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    if (confirm("Are you sure you want to delete all completion records, mastery histories, and backup indices? This operation is permanent.")) {
                        storage.clearAllSafe();
                    }
                });
                
                // Fast forward to the next task block dynamically
                document.getElementById('dev-mode-btn').addEventListener('click', () => {
                    const now = scheduler.getNow();
                    const currentMinutes = now.getHours() * 60 + now.getMinutes();
                    let nextTask = null;
                    let foundToday = false;

                    // Sort routine by chronological start time
                    const sortedRoutine = [...CONFIG.routine].sort((a, b) => {
                        return scheduler.timeToMinutes(a.start) - scheduler.timeToMinutes(b.start);
                    });

                    // Search for the immediate next scheduled task block today
                    for (const task of sortedRoutine) {
                        const startMins = scheduler.timeToMinutes(task.start);
                        if (startMins > currentMinutes) {
                            nextTask = task;
                            foundToday = true;
                            break;
                        }
                    }

                    if (foundToday && nextTask) {
                        // Align the simulation clock with today's next task start time
                        const [h, m] = nextTask.start.split(':').map(Number);
                        const targetDate = new Date(now);
                        targetDate.setHours(h, m, 0, 0);
                        
                        scheduler.simulatedDateOffset = targetDate.getTime() - Date.now();
                        showToast(`Fast forwarded to next task: ${nextTask.name}!`, "info");
                    } else {
                        // No tasks remaining today. Jump to tomorrow's very first task block
                        const firstTask = sortedRoutine[0];
                        const [h, m] = firstTask.start.split(':').map(Number);
                        const targetDate = new Date(now);
                        targetDate.setDate(targetDate.getDate() + 1);
                        targetDate.setHours(h, m, 0, 0);

                        scheduler.simulatedDateOffset = targetDate.getTime() - Date.now();
                        showToast(`Fast forwarded to tomorrow's start: ${firstTask.name}!`, "info");
                    }

                    this.updateDashboard();
                    document.getElementById('calendar-alert-dot').classList.remove('hidden');
                });

                // Tab workflows
                const tabDashboardBtn = document.getElementById('tab-dashboard');
                const tabCalendarBtn = document.getElementById('tab-calendar');
                const viewDashboard = document.getElementById('view-dashboard');
                const viewCalendar = document.getElementById('view-calendar');

                tabDashboardBtn.addEventListener('click', () => {
                    tabDashboardBtn.classList.add('is-active');
                    tabCalendarBtn.classList.remove('is-active');
                    viewDashboard.classList.remove('hidden');
                    viewDashboard.classList.add('block');
                    viewCalendar.classList.add('hidden');
                });

                tabCalendarBtn.addEventListener('click', () => {
                    tabCalendarBtn.classList.add('is-active');
                    tabDashboardBtn.classList.remove('is-active');
                    viewCalendar.classList.remove('hidden');
                    viewCalendar.classList.add('block');
                    viewDashboard.classList.add('hidden');
                    
                    document.getElementById('calendar-alert-dot').classList.add('hidden');
                    dashboard.renderCalendarView();
                });

                // State Backup Utilities
                document.getElementById('btn-export-db').addEventListener('click', () => {
                    this.exportDatabase();
                });

                document.getElementById('file-import-db').addEventListener('change', (e) => {
                    this.importDatabase(e);
                });

                // Sandbox controllers
                document.getElementById('sandbox-seed-btn').addEventListener('click', () => {
                    this.seedRandomProgress();
                });
                document.getElementById('sandbox-clear-btn').addEventListener('click', () => {
                    this.clearSeededProgress();
                });
            },
            
            updateDashboard() {
                dashboard.updateHeader();
                dashboard.renderTimeline();
                dashboard.renderGenerators();
                dashboard.renderStudyPlan();
                dashboard.renderStats();
                dashboard.renderCalendarView();
            },
            
            handleTaskAction(taskId, action) {
                const dateStr = scheduler.getDateString();
                storage.setTaskStatus(dateStr, taskId, action);
                showToast(`Timetable task marked as ${action}!`);
            },

            handleRevisionCheck(topic, isChecked) {
                if (isChecked) {
                    storage.flagRevisionMastered(topic);
                    showToast(`Concept "${topic}" marked as revised!`, 'success');
                } else {
                    storage.unflagRevisionMastered(topic);
                    showToast(`Revision mastery cleared for "${topic}".`, 'info');
                }
                this.updateDashboard();
            },

            travelToDate(dateStr) {
                // Relocate simulator timestamp to 10:00 AM of target travel date
                const targetPreset = new Date(`${dateStr}T10:00:00`);
                scheduler.simulatedDateOffset = targetPreset.getTime() - Date.now();
                
                this.updateDashboard();
                showToast(`Time-traveled to ${dateStr}!`);
                
                // Return user to core layout panel
                document.getElementById('tab-dashboard').click();
            },

            exportDatabase() {
                const data = {
                    logs: storage.get('logs') || {},
                    mastered_whiteboard: storage.get('mastered_whiteboard') || [],
                    mastered_revisions: storage.get('mastered_revisions') || [],
                    overall_stats: storage.get('overall_stats') || {},
                    exportedAt: new Date().toISOString()
                };

                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                downloadAnchor.setAttribute("download", `prepflow_backup_${scheduler.getDateString()}.json`);
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
                showToast("User logs exported successfully!");
            },

            importDatabase(event) {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const parsed = JSON.parse(e.target.result);
                        if (parsed.logs && Array.isArray(parsed.mastered_whiteboard)) {
                            storage.set('logs', parsed.logs);
                            storage.set('mastered_whiteboard', parsed.mastered_whiteboard);
                            storage.set('mastered_revisions', parsed.mastered_revisions || []);
                            storage.recalculateTotalStats();
                            
                            this.updateDashboard();
                            showToast("Backup logs successfully restored!", "success");
                        } else {
                            showToast("Invalid backup file layout structure.", "warning");
                        }
                    } catch (err) {
                        showToast("Failed loading database file.", "warning");
                    }
                };
                reader.readAsText(file);
            },

            seedRandomProgress() {
                const logs = {};
                let completedAcc = 0;
                let skippedAcc = 0;

                // Loop through active study window (July 19 to 31)
                for (let day = 19; day <= 31; day++) {
                    const dateStr = `2026-07-${day < 10 ? '0' + day : day}`;
                    logs[dateStr] = {};
                    
                    CONFIG.routine.forEach(task => {
                        const roll = Math.random();
                        if (roll > 0.45) {
                            logs[dateStr][task.id] = 'completed';
                            completedAcc++;
                        } else if (roll > 0.3) {
                            logs[dateStr][task.id] = 'skipped';
                            skippedAcc++;
                        }
                    });
                }

                // Populate randomized mastery metrics
                const randomWhiteboard = CONFIG.whiteboardTopics.slice(0, Math.floor(Math.random() * 8) + 3);
                const randomRevision = [
                    ...CONFIG.revisionTopics.ml.slice(0, 3),
                    ...CONFIG.revisionTopics.dl.slice(0, 3),
                    ...CONFIG.revisionTopics.llm.slice(0, 3)
                ];

                storage.set('logs', logs);
                storage.set('mastered_whiteboard', randomWhiteboard);
                storage.set('mastered_revisions', randomRevision);
                storage.recalculateTotalStats();
                
                this.updateDashboard();
                showToast("Sandbox dataset loaded with mock logs!", "success");
            },

            clearSeededProgress() {
                storage.set('logs', {});
                storage.set('mastered_whiteboard', []);
                storage.set('mastered_revisions', []);
                storage.recalculateTotalStats();
                
                this.updateDashboard();
                showToast("Sandbox logs successfully cleared!", "warning");
            },
            
            startTimer() {
                this.timer = setInterval(() => {
                    dashboard.updateHeader();
                    dashboard.renderTimeline();
                }, 60000);
            }
        };

        // Standardized alert toast messaging
        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            
            let color = 'var(--status-completed)';
            if (type === 'warning') color = 'var(--status-skipped)';
            if (type === 'info') color = 'var(--status-in-progress)';
            
            toast.className = `toast px-4 py-3 rounded-lg shadow-xl text-textPrimary text-sm font-medium transform transition-all duration-300 translate-y-10 opacity-0 flex items-center gap-3`;
            toast.innerHTML = `
                <div class="w-2.5 h-2.5 rounded-full" style="background-color: ${color}"></div>
                <span>${message}</span>
            `;
            
            container.appendChild(toast);
            requestAnimationFrame(() => {
                toast.classList.remove('translate-y-10', 'opacity-0');
            });
            
            setTimeout(() => {
                toast.classList.add('translate-y-10', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        window.addEventListener('DOMContentLoaded', () => app.init());
