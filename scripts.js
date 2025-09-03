// Firebase Configuration and Initialization
const firebaseConfig = {
    apiKey: "AIzaSyCoMfEYbPgkzAdcDIlCFUTMo0RTK107ukE",
    authDomain: "philaopersonal.firebaseapp.com",
    projectId: "philaopersonal",
    storageBucket: "philaopersonal.firebasestorage.app",
    messagingSenderId: "966795699161",
    appId: "1:966795699161:web:8ca9d0dfaa2f9e7fe42fc8",
    measurementId: "G-Y36VQMM6G3"
};

// Initialize Firebase
let db, auth, isFirebaseAvailable = false;

function initializeFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.log('Firebase SDK not loaded - working in offline mode');
            return false;
        }
        
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        
        db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            if (err.code == 'failed-precondition') {
                console.log('Multiple tabs open, persistence can only be enabled in one tab at a time.');
            } else if (err.code == 'unimplemented') {
                console.log('The current browser does not support offline persistence');
            }
        });
        
        console.log('Firebase initialized successfully');
        return true;
    } catch (error) {
        console.log('Firebase initialization failed, working offline:', error.message);
        return false;
    }
}

isFirebaseAvailable = initializeFirebase();

// Global State Variables
let currentMainTab = 'dashboard';
let currentJobTab = null;
let currentView = 'grid';
let contextMenuTarget = null;
let deleteTarget = null;
let jobs = {};
let notes = {};
let currentDate = new Date();
let noteFiles = [];
let currentUser = null;
let isAuthMode = 'signin';
let syncStatus = 'offline';
let retryQueue = [];
let syncListeners = {};

console.log('🔥 Firebase configured and ready for cloud sync!');

// App Initialization
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    loadAllData();
    renderCalendar();
    setupConnectionMonitoring();
    setupKeyboardShortcuts();
});

function initializeApp() {
    console.log('Initializing TaskFlow Pro with auto-sync');
    currentUser = { uid: 'anonymous_user', email: 'auto-sync@taskflow.pro' };
    updateUserInterface();
    
    if (isFirebaseAvailable) {
        console.log('Firebase available - enabling cloud sync');
        syncDataFromFirestore();
    } else {
        console.log('Firebase not available - working in offline mode');
        loadLocalData();
    }
}

function updateUserInterface() {
    const syncBtn = document.getElementById('sync-btn');
    syncBtn.style.display = 'block';
    
    if (isFirebaseAvailable) {
        updateSyncStatus('synced');
    } else {
        updateSyncStatus('offline');
    }
}

// Connection Monitoring
function setupConnectionMonitoring() {
    window.addEventListener('online', () => {
        console.log('Connection restored');
        if (currentUser) {
            updateSyncStatus('syncing');
            processRetryQueue();
            syncDataFromFirestore();
        }
    });
    
    window.addEventListener('offline', () => {
        console.log('Connection lost');
        updateSyncStatus('offline');
    });
    
    setInterval(() => {
        if (navigator.onLine && currentUser && isFirebaseAvailable) {
            processRetryQueue();
        }
    }, 60000);
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });
}

function closeAllModals() {
    document.querySelectorAll('.task-detail-modal.active').forEach(modal => {
        modal.classList.remove('active');
    });
    hideContextMenu();
}

function updateSyncStatus(status) {
    syncStatus = status;
    const indicator = document.getElementById('sync-indicator');
    const text = document.getElementById('sync-text');
    
    indicator.className = 'sync-indicator';
    
    switch (status) {
        case 'synced':
            indicator.classList.add('synced');
            text.textContent = 'Synced';
            break;
        case 'syncing':
            indicator.classList.add('syncing');
            text.textContent = 'Syncing...';
            break;
        case 'offline':
            indicator.classList.add('offline');
            text.textContent = 'Offline';
            break;
    }
}

// Data Storage Functions
async function saveToStorage(key, data) {
    try {
        localStorage.setItem(`taskflow_${key}`, JSON.stringify(data));
        
        if (isFirebaseAvailable && currentUser) {
            await saveToFirestore(key, data);
        }
    } catch (error) {
        console.error('Error saving data:', error);
        console.log('Data saved locally, cloud sync unavailable');
    }
}

function loadFromStorage(key) {
    try {
        const data = localStorage.getItem(`taskflow_${key}`);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Error loading from localStorage:', error);
        return null;
    }
}

async function saveToFirestore(key, data) {
    if (!isFirebaseAvailable || !db || !currentUser) {
        console.log('Firebase not available or no user signed in, skipping Firestore save');
        return;
    }
    
    try {
        console.log(`Saving ${key} to Firestore for user:`, currentUser.uid);
        updateSyncStatus('syncing');
        
        await db.collection('users').doc(currentUser.uid).collection('data').doc(key).set({
            data: data,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            version: Date.now(),
            deviceId: getDeviceId()
        }, { merge: true });
        
        console.log(`Successfully saved ${key} to Firestore`);
        updateSyncStatus('synced');
        
        setupRealtimeSync(key);
        
    } catch (error) {
        console.error('Error saving to Firestore:', error);
        updateSyncStatus('offline');
        queueForRetry(key, data);
    }
}

function getDeviceId() {
    let deviceId = localStorage.getItem('taskflow_device_id');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('taskflow_device_id', deviceId);
    }
    return deviceId;
}

function queueForRetry(key, data) {
    retryQueue.push({ key, data, timestamp: Date.now() });
    setTimeout(processRetryQueue, 30000);
}

async function processRetryQueue() {
    if (!isFirebaseAvailable || !db || !currentUser || retryQueue.length === 0) {
        return;
    }
    
    console.log('Processing retry queue:', retryQueue.length, 'items');
    const itemsToRetry = [...retryQueue];
    retryQueue = [];
    
    for (const item of itemsToRetry) {
        try {
            await saveToFirestore(item.key, item.data);
        } catch (error) {
            retryQueue.push(item);
        }
    }
}

function setupRealtimeSync(key) {
    if (!isFirebaseAvailable || !db || !currentUser || syncListeners[key]) {
        return;
    }
    
    console.log(`Setting up real-time sync for ${key}`);
    
    syncListeners[key] = db.collection('users')
        .doc(currentUser.uid)
        .collection('data')
        .doc(key)
        .onSnapshot((doc) => {
            if (doc.exists) {
                const serverData = doc.data();
                const localVersion = getLocalVersion(key);
                
                if (serverData.version > localVersion) {
                    console.log(`Received newer ${key} data from server`);
                    updateLocalData(key, serverData.data, serverData.version);
                }
            }
        }, (error) => {
            console.error(`Real-time sync error for ${key}:`, error);
            updateSyncStatus('offline');
        });
}

function getLocalVersion(key) {
    const versionKey = `taskflow_${key}_version`;
    return parseInt(localStorage.getItem(versionKey) || '0');
}

function updateLocalData(key, data, version) {
    localStorage.setItem(`taskflow_${key}`, JSON.stringify(data));
    localStorage.setItem(`taskflow_${key}_version`, version.toString());
    
    if (key === 'jobs') {
        jobs = data;
        renderJobs();
        updateDashboard();
        renderCalendar();
    } else if (key === 'notes') {
        notes = data;
        renderNotes();
    }
    
    updateSyncStatus('synced');
}

async function syncDataFromFirestore() {
    if (!isFirebaseAvailable || !db || !currentUser) {
        console.log('Firebase not available or no user signed in, loading local data');
        loadLocalData();
        return;
    }
    
    try {
        updateSyncStatus('syncing');
        
        const firestoreJobsDoc = await db.collection('users').doc(currentUser.uid).collection('data').doc('jobs').get();
        if (firestoreJobsDoc.exists) {
            const serverData = firestoreJobsDoc.data();
            const localVersion = getLocalVersion('jobs');
            
            if (serverData.version > localVersion) {
                console.log('Updating jobs from server');
                jobs = serverData.data || {};
                localStorage.setItem('taskflow_jobs', JSON.stringify(jobs));
                localStorage.setItem('taskflow_jobs_version', serverData.version.toString());
            } else {
                console.log('Local jobs data is current');
                jobs = loadFromStorage('jobs') || {};
            }
        } else {
            jobs = loadFromStorage('jobs') || {};
        }
        
        const firestoreNotesDoc = await db.collection('users').doc(currentUser.uid).collection('data').doc('notes').get();
        if (firestoreNotesDoc.exists) {
            const serverData = firestoreNotesDoc.data();
            const localVersion = getLocalVersion('notes');
            
            if (serverData.version > localVersion) {
                console.log('Updating notes from server');
                notes = serverData.data || {};
                localStorage.setItem('taskflow_notes', JSON.stringify(notes));
                localStorage.setItem('taskflow_notes_version', serverData.version.toString());
            } else {
                console.log('Local notes data is current');
                notes = loadFromStorage('notes') || {};
            }
        } else {
            notes = loadFromStorage('notes') || {};
        }
        
        setupRealtimeSync('jobs');
        setupRealtimeSync('notes');
        
        renderJobs();
        renderNotes();
        updateDashboard();
        renderCalendar();
        
        updateSyncStatus('synced');
        
        if (!firestoreJobsDoc.exists && Object.keys(jobs).length > 0) {
            console.log('Pushing local jobs to server');
            await saveToFirestore('jobs', jobs);
        }
        
        if (!firestoreNotesDoc.exists && Object.keys(notes).length > 0) {
            console.log('Pushing local notes to server');
            await saveToFirestore('notes', notes);
        }
        
    } catch (error) {
        console.error('Error syncing from Firestore:', error);
        updateSyncStatus('offline');
        loadLocalData();
    }
}

function loadLocalData() {
    try {
        jobs = loadFromStorage('jobs') || {};
        notes = loadFromStorage('notes') || {};
        renderJobs();
        renderNotes();
        updateDashboard();
    } catch (error) {
        console.error('Error loading local data:', error);
        renderEmptyStates();
    }
}

async function testSync() {
    if (!isFirebaseAvailable || !db) {
        alert('❌ Cloud sync is not available. The app works fully offline!\n\nYour data is safely stored in your browser.');
        return;
    }
    
    try {
        updateSyncStatus('syncing');
        console.log('Testing sync for anonymous user:', currentUser.uid);
        
        const testData = {
            test: true,
            timestamp: new Date().toISOString(),
            message: 'Auto-sync test successful'
        };
        
        await db.collection('users').doc(currentUser.uid).collection('data').doc('test').set({
            data: testData,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('Test data saved to Firestore');
        
        const doc = await db.collection('users').doc(currentUser.uid).collection('data').doc('test').get();
        
        if (doc.exists) {
            console.log('Test data retrieved:', doc.data());
            updateSyncStatus('synced');
            alert('✅ Auto-sync test successful! Your data is syncing to the cloud automatically.');
            
            await db.collection('users').doc(currentUser.uid).collection('data').doc('test').delete();
        } else {
            throw new Error('Could not retrieve test data');
        }
        
    } catch (error) {
        console.error('Sync test failed:', error);
        updateSyncStatus('offline');
        
        let errorMessage = '❌ Auto-sync test failed. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Permission denied - the demo database may have restricted access.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Service temporarily unavailable. Please try again later.';
        } else {
            errorMessage += 'Please check your internet connection and try again.';
        }
        
        alert(errorMessage + '\n\nDon\'t worry - your data is safely stored locally and will auto-sync when the connection is restored.');
    }
}

// Utility Functions
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function generateReadableId(prefix, name) {
    const cleanName = name.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 20);
    const timestamp = Date.now().toString(36);
    return `${prefix}_${cleanName}_${timestamp}`;
}

function formatDate(date) {
    return date ? new Date(date).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    }) : 'No due date';
}

function loadAllData() {
    // Handled by auth state change listener
}

// Main Tab Switching
function switchMainTab(tab) {
    currentMainTab = tab;
    
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tab + '-tab').classList.add('active');
}

// Job Tab Switching
function switchJobTab(jobId) {
    currentJobTab = jobId;
    
    document.querySelectorAll('.job-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.job-content').forEach(c => c.classList.remove('active'));
    document.getElementById(jobId + '-job').classList.add('active');
}

// View Switching (Grid/Banner)
function switchView(view) {
    currentView = view;
    
    const activeJobContent = document.querySelector('.job-content.active');
    if (activeJobContent) {
        activeJobContent.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        
        const gridView = activeJobContent.querySelector('.projects-grid');
        const bannerView = activeJobContent.querySelector('.projects-banner');
        
        if (view === 'grid') {
            gridView.style.display = 'grid';
            bannerView.classList.remove('active');
        } else if (view === 'banner') {
            gridView.style.display = 'none';
            bannerView.classList.add('active');
        }
    }
}

// Dashboard Section Toggle
function toggleDashboardSection(header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.expand-icon');
    
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        icon.textContent = '▶';
    } else {
        content.classList.add('expanded');
        icon.textContent = '▼';
    }
}

// Toggle Tasks List
function toggleTasks(element) {
    const tasksList = element.querySelector('.tasks-list');
    const expandIcon = element.querySelector('.expand-icon');
    
    if (tasksList.classList.contains('expanded')) {
        tasksList.classList.remove('expanded');
        element.classList.remove('expanded');
    } else {
        tasksList.classList.add('expanded');
        element.classList.add('expanded');
    }
}

// Rendering Functions
function renderEmptyStates() {
    const jobTabsContainer = document.getElementById('job-tabs-container');
    jobTabsContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">💼</div>
            <div>No jobs yet. Click "Add Job" to get started!</div>
        </div>
    `;
    
    const notesContainer = document.getElementById('notes-container');
    notesContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <div>No notes yet. Click "Add Note" to start taking notes!</div>
        </div>
    `;
}

function renderJobs() {
    const jobTabsContainer = document.getElementById('job-tabs-container');
    const jobContentContainer = document.getElementById('job-content-container');
    
    if (Object.keys(jobs).length === 0) {
        jobTabsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💼</div>
                <div>No jobs yet. Click "Add Job" to get started!</div>
            </div>
        `;
        jobContentContainer.innerHTML = '';
        return;
    }
    
    let tabsHTML = '';
    let firstJobId = null;
    
    Object.values(jobs).forEach((job, index) => {
        if (index === 0) firstJobId = job.id;
        const isActive = currentJobTab === job.id || (!currentJobTab && index === 0);
        tabsHTML += `
            <button class="job-tab ${isActive ? 'active' : ''}" onclick="switchJobTab('${job.id}')">
                ${job.name}
            </button>
        `;
    });
    
    jobTabsContainer.innerHTML = tabsHTML;
    
    if (!currentJobTab && firstJobId) {
        currentJobTab = firstJobId;
    }
    
    let contentHTML = '';
    Object.values(jobs).forEach(job => {
        const isActive = job.id === currentJobTab;
        contentHTML += renderJobContent(job, isActive);
    });
    
    jobContentContainer.innerHTML = contentHTML;
    initializeEventListeners();
}

function renderJobContent(job, isActive) {
    const projects = Object.values(job.projects || {});
    
    let projectsGridHTML = '';
    let projectsBannerHTML = '';
    
    if (projects.length === 0) {
        const emptyState = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div>No projects yet. Click "Add Project" to get started!</div>
            </div>
        `;
        projectsGridHTML = emptyState;
        projectsBannerHTML = emptyState;
    } else {
        projects.forEach(project => {
            projectsGridHTML += renderProjectCard(project, job.id);
            projectsBannerHTML += renderProjectBanner(project, job.id);
        });
    }
    
    return `
        <div id="${job.id}-job" class="job-content ${isActive ? 'active' : ''}">
            <div class="job-info" data-job-id="${job.id}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div class="job-name" style="margin-bottom: 0;">${job.name}</div>
                    <button class="menu-btn" onclick="showContextMenu(event, this.closest('.job-info'), 'job')">⋮</button>
                </div>
                <div class="job-description">${job.description || ''}</div>
                <div class="job-notes">
                    <div class="job-notes-title">📝 Job Notes</div>
                    <div>${job.notes || 'No notes added yet.'}</div>
                </div>
            </div>
            
            <div class="progress-header">
                <div class="view-toggle">
                    <button class="view-btn ${currentView === 'grid' ? 'active' : ''}" onclick="switchView('grid')">Grid</button>
                    <button class="view-btn ${currentView === 'banner' ? 'active' : ''}" onclick="switchView('banner')">Banner</button>
                </div>
                <button class="add-btn" onclick="addProject()">+ Add Project</button>
            </div>
            
            <div class="projects-grid" style="display: ${currentView === 'grid' ? 'grid' : 'none'}">
                ${projectsGridHTML}
            </div>
            
            <div class="projects-banner ${currentView === 'banner' ? 'active' : ''}">
                ${projectsBannerHTML}
            </div>
        </div>
    `;
}

function renderProjectCard(project, jobId) {
    const tasks = Object.values(project.tasks || {});
    const completedTasks = tasks.filter(task => task.status === 'completed').length;
    const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
    
    let tasksHTML = '';
    if (tasks.length === 0) {
        tasksHTML = `
            <div class="empty-state" style="padding: 20px; text-align: center; color: #6b7280;">
                <div>No tasks yet. Click "Add Task" to get started!</div>
                <button class="add-subtask-btn" onclick="event.stopPropagation(); addTask();" style="margin-top: 12px;">+ Add Task</button>
            </div>
        `;
    } else {
        tasks.forEach(task => {
            tasksHTML += renderTaskCard(task, jobId, project.id);
        });
    }
    
    return `
        <div class="project-card priority-${project.priority || 'medium'}" data-project-id="${project.id}" data-job-id="${jobId}">
            <div class="project-header">
                <div class="project-title inline-editable" onclick="makeInlineEditable(this, 'project', 'title')">${project.title}</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="project-status status-${project.status || 'active'} inline-editable" onclick="makeInlineDropdown(this, 'project', 'status')">${(project.status || 'active').charAt(0).toUpperCase() + (project.status || 'active').slice(1).replace('-', ' ')}</span>
                    <button class="menu-btn" onclick="showContextMenu(event, this.closest('.project-card'), 'project')">⋮</button>
                </div>
            </div>
            <div class="project-meta">
                <div class="project-meta-item">
                    <span>📅 Due: ${formatDate(project.dueDate)}</span>
                </div>
                <div class="project-meta-item">
                    <span class="priority-badge priority-${project.priority || 'medium'}">${(project.priority || 'medium').charAt(0).toUpperCase() + (project.priority || 'medium').slice(1)}</span>
                </div>
            </div>
            <div class="project-description">${project.description || ''}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-text">${progress}% Complete</div>
            <div class="tasks-banner" onclick="toggleTasks(this)">
                <div class="tasks-banner-content">
                    <div class="tasks-info">
                        <span class="tasks-count">📋 ${tasks.length} Task${tasks.length !== 1 ? 's' : ''}</span>
                        <span class="tasks-progress">(${completedTasks} completed)</span>
                    </div>
                    <div class="tasks-controls">
                        <button class="add-subtask-btn" onclick="event.stopPropagation(); addTask();" style="padding: 4px 8px; font-size: 11px;">+ Add Task</button>
                        <span class="expand-icon">▼</span>
                    </div>
                </div>
                <div class="tasks-list">
                    ${tasksHTML}
                </div>
            </div>
        </div>
    `;
}

function renderProjectBanner(project, jobId) {
    const tasks = Object.values(project.tasks || {});
    const completedTasks = tasks.filter(task => task.status === 'completed').length;
    const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
    
    let tasksHTML = '';
    if (tasks.length === 0) {
        tasksHTML = `
            <div class="empty-state" style="padding: 20px; text-align: center; color: #6b7280;">
                <div>No tasks yet. Click "Add Task" to get started!</div>
                <button class="add-subtask-btn" onclick="event.stopPropagation(); addTask();" style="margin-top: 12px;">+ Add Task</button>
            </div>
        `;
    } else {
        tasks.forEach(task => {
            tasksHTML += renderTaskCard(task, jobId, project.id);
        });
    }
    
    return `
        <div class="banner-card priority-${project.priority || 'medium'}" data-project-id="${project.id}" data-job-id="${jobId}">
            <div class="banner-main">
                <div class="banner-left">
                    <div class="project-header">
                        <div class="project-title">${project.title}</div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="project-status status-${project.status || 'active'}">${(project.status || 'active').charAt(0).toUpperCase() + (project.status || 'active').slice(1).replace('-', ' ')}</span>
                            <button class="menu-btn" onclick="showContextMenu(event, this.closest('.banner-card'), 'project')">⋮</button>
                        </div>
                    </div>
                    <div class="project-meta">
                        <div class="project-meta-item">
                            <span>📅 Due: ${formatDate(project.dueDate)}</span>
                        </div>
                        <div class="project-meta-item">
                            <span class="priority-badge priority-${project.priority || 'medium'}">${(project.priority || 'medium').charAt(0).toUpperCase() + (project.priority || 'medium').slice(1)}</span>
                        </div>
                    </div>
                    <div class="project-description">${project.description || ''}</div>
                </div>
                <div class="banner-right">
                    <div class="progress-text">${progress}% Complete</div>
                    <div class="progress-bar" style="width: 120px;">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
            </div>
            ${project.notes ? `<div class="project-notes">
                <div class="project-notes-title">📝 Project Notes</div>
                <div class="project-notes-content">${project.notes}</div>
            </div>` : ''}
            <div class="tasks-banner" onclick="toggleTasks(this)">
                <div class="tasks-banner-content">
                    <div class="tasks-info">
                        <span class="tasks-count">📋 ${tasks.length} Task${tasks.length !== 1 ? 's' : ''}</span>
                        <span class="tasks-progress">(${completedTasks} completed)</span>
                    </div>
                    <div class="tasks-controls">
                        <button class="add-subtask-btn" onclick="event.stopPropagation(); addTask();" style="padding: 4px 8px; font-size: 11px;">+ Add Task</button>
                        <span class="expand-icon">▼</span>
                    </div>
                </div>
                <div class="tasks-list">
                    ${tasksHTML}
                </div>
            </div>
        </div>
    `;
}

function renderTaskCard(task, jobId, projectId) {
    return `
        <div class="task-card priority-${task.priority || 'medium'}" data-task-id="${task.id}" data-project-id="${projectId}" data-job-id="${jobId}">
            <div class="task-header">
                <div class="task-name-main">${task.name}</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="task-status-mini task-${task.status ? task.status.replace(' ', '-') : 'not-started'}">${task.status ? task.status.charAt(0).toUpperCase() + task.status.slice(1).replace('-', ' ') : 'Not Started'}</span>
                    <button class="menu-btn" onclick="showContextMenu(event, this.closest('.task-card'), 'task')">⋮</button>
                </div>
            </div>
            <div class="task-meta-info">
                <span>📅 Due: ${formatDate(task.dueDate)}</span>
                <span class="priority-badge priority-${task.priority || 'medium'}">${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}</span>
            </div>
            ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
            <div class="task-actions">
                <button class="details-btn" onclick="openTaskDetails('${task.id}', '${projectId}', '${jobId}')">View Details</button>
            </div>
        </div>
    `;
}

function renderNotes() {
    const notesContainer = document.getElementById('notes-container');
    
    if (Object.keys(notes).length === 0) {
        notesContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div>No notes yet. Click "Add Note" to start taking notes!</div>
            </div>
        `;
        return;
    }
    
    let notesHTML = '';
    Object.values(notes)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .forEach(note => {
            let filesHTML = '';
            if (note.files && note.files.length > 0) {
                filesHTML = `
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                        <div style="font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 8px;">
                            📎 ${note.files.length} attachment${note.files.length !== 1 ? 's' : ''}
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                `;
                
                note.files.forEach((file, index) => {
                    const fileIcon = getFileIcon(file.type);
                    const fileTypeClass = getFileTypeClass(file.type);
                    const canView = canViewFile(file.type);
                    const actionText = canView ? 'View' : 'Download';
                    const actionIcon = canView ? '👁️' : '⬇️';
                    
                    filesHTML += `
                        <div class="file-item" style="margin-bottom: 4px; padding: 8px; background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;">
                            <div class="file-info">
                                <span class="file-icon ${fileTypeClass}">${fileIcon}</span>
                                <div class="file-details">
                                    <div class="file-name" onclick="handleFileAction('${note.id}', ${index})">${file.name}</div>
                                    <div class="file-size">${formatFileSize(file.size)}</div>
                                </div>
                            </div>
                            <div class="file-actions">
                                <button class="file-action-btn ${canView ? 'view' : 'download'}" onclick="handleFileAction('${note.id}', ${index})" title="${actionText} file">
                                    ${actionIcon}
                                </button>
                            </div>
                        </div>
                    `;
                });
                
                filesHTML += `
                        </div>
                    </div>
                `;
            }
            
            notesHTML += `
                <div class="note-card" data-note-id="${note.id}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <div class="note-title" style="margin-bottom: 0;">${note.title}</div>
                        <button class="menu-btn" onclick="showContextMenu(event, this.closest('.note-card'), 'note')">⋮</button>
                    </div>
                    <div class="note-meta">${formatDate(note.createdAt)} • General</div>
                    <div class="note-content">${note.content}</div>
                    ${filesHTML}
                </div>
            `;
        });
    
    notesContainer.innerHTML = notesHTML;
    initializeEventListeners();
}

function updateDashboard() {
    const dueTodayContent = document.getElementById('due-today-content');
    const thisWeekContent = document.getElementById('this-week-content');
    
    const today = new Date();
    const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    let dueTodayTasks = [];
    let thisWeekTasks = [];
    
    Object.values(jobs).forEach(job => {
        Object.values(job.projects || {}).forEach(project => {
            Object.values(project.tasks || {}).forEach(task => {
                if (task.dueDate) {
                    const dueDate = new Date(task.dueDate);
                    if (dueDate.toDateString() === today.toDateString()) {
                        dueTodayTasks.push({ ...task, jobName: job.name, projectTitle: project.title });
                    } else if (dueDate <= weekFromNow && dueDate > today) {
                        thisWeekTasks.push({ ...task, jobName: job.name, projectTitle: project.title });
                    }
                }
            });
        });
    });
    
    if (dueTodayTasks.length === 0) {
        dueTodayContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📅</div>
                <div>No tasks due today. Great job staying on top of things!</div>
            </div>
        `;
    } else {
        let dueTodayHTML = '';
        dueTodayTasks.forEach(task => {
            const urgencyClass = task.priority === 'high' ? 'urgent' : task.priority === 'medium' ? 'medium' : '';
            dueTodayHTML += `
                <div class="task-item ${urgencyClass}">
                    <div class="task-title">${task.name}</div>
                    <div class="task-meta">${task.jobName} • ${task.projectTitle} • ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} Priority</div>
                </div>
            `;
        });
        dueTodayContent.innerHTML = dueTodayHTML;
    }
    
    if (thisWeekTasks.length === 0) {
        thisWeekContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div>No tasks due this week. Time to plan ahead!</div>
            </div>
        `;
    } else {
        let thisWeekHTML = '';
        thisWeekTasks.forEach(task => {
            const urgencyClass = task.priority === 'high' ? 'urgent' : task.priority === 'medium' ? 'medium' : '';
            thisWeekHTML += `
                <div class="task-item ${urgencyClass}">
                    <div class="task-title">${task.name}</div>
                    <div class="task-meta">${task.jobName} • ${task.projectTitle} • Due ${formatDate(task.dueDate)}</div>
                </div>
            `;
        });
        thisWeekContent.innerHTML = thisWeekHTML;
    }
}

// Event Listener Initialization
function initializeEventListeners() {
    document.querySelectorAll('.job-info').forEach(element => {
        addDoubleClickListener(element, 'job');
    });
    
    document.querySelectorAll('.project-card, .banner-card').forEach(element => {
        addDoubleClickListener(element, 'project');
    });
    
    document.querySelectorAll('.task-card').forEach(element => {
        addDoubleClickListener(element, 'task');
    });
    
    document.querySelectorAll('.note-card').forEach(element => {
        addDoubleClickListener(element, 'note');
    });
}

function addDoubleClickListener(element, type) {
    element.addEventListener('dblclick', function(e) {
        if (e.target.classList.contains('menu-btn') || e.target.closest('.menu-btn')) {
            return;
        }
        openEditModal(element, type);
    });
}

// Calendar Functions
function renderCalendar() {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    const monthDisplay = document.getElementById('calendar-month-display');
    const calendarGrid = document.getElementById('calendar-grid');
    
    monthDisplay.textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const dayOfWeek = firstDay.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const startDate = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() - mondayOffset);
    
    let calendarHTML = '';
    
    dayNames.forEach(day => {
        calendarHTML += `<div class="calendar-day header">${day}</div>`;
    });
    
    const today = new Date();
    for (let i = 0; i < 42; i++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
        
        const isToday = date.toDateString() === today.toDateString();
        const isCurrentMonth = date.getMonth() === currentDate.getMonth();
        const tasksOnDate = getTasksOnDate(date);
        const hasTask = tasksOnDate.length > 0;
        
        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (hasTask) classes += ' has-task';
        if (!isCurrentMonth) classes += ' other-month';
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;
        
        const onMouseEnter = hasTask ? `onmouseenter="showCalendarTooltip(event, '${dateString}')"` : '';
        const onMouseLeave = hasTask ? `onmouseleave="hideCalendarTooltip()"` : '';
        const onClick = `onclick="showDateTasks('${dateString}')"`;
        
        calendarHTML += `<div class="${classes}" ${onMouseEnter} ${onMouseLeave} ${onClick}>${date.getDate()}</div>`;
    }
    
    calendarGrid.innerHTML = calendarHTML;
}

function getTasksOnDate(date) {
    const dateString = date.toISOString().split('T')[0];
    const tasksOnDate = [];
    
    for (const job of Object.values(jobs)) {
        for (const project of Object.values(job.projects || {})) {
            for (const task of Object.values(project.tasks || {})) {
                if (task.dueDate === dateString) {
                    tasksOnDate.push({
                        ...task,
                        jobName: job.name,
                        projectTitle: project.title
                    });
                }
            }
        }
    }
    return tasksOnDate;
}

function changeMonth(direction) {
    currentDate.setMonth(currentDate.getMonth() + direction);
    renderCalendar();
}

function showCalendarTooltip(event, dateString) {
    const tooltip = document.getElementById('calendar-tooltip');
    const date = new Date(dateString + 'T00:00:00');
    const tasksOnDate = getTasksOnDate(date);
    
    if (tasksOnDate.length === 0) return;
    
    let tooltipContent = `<strong>${formatDate(dateString)}</strong><br>`;
    tasksOnDate.forEach(task => {
        const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
        const statusIcon = task.status === 'completed' ? '✅' : task.status === 'in-progress' ? '🔄' : '⏳';
        tooltipContent += `${priorityIcon} ${statusIcon} ${task.name}<br><small>${task.jobName} • ${task.projectTitle}</small><br>`;
    });
    
    tooltip.innerHTML = tooltipContent;
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY - 10) + 'px';
    tooltip.classList.add('show');
}

function hideCalendarTooltip() {
    const tooltip = document.getElementById('calendar-tooltip');
    tooltip.classList.remove('show');
}

function showDateTasks(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const tasksOnDate = getTasksOnDate(date);
    
    document.getElementById('date-tasks-title').textContent = `Tasks for ${formatDate(dateString)}`;
    
    let tasksHTML = '';
    
    if (tasksOnDate.length === 0) {
        tasksHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <div class="empty-state-icon">📅</div>
                <div>No tasks scheduled for this date</div>
                <div style="font-size: 14px; color: #6b7280; margin-top: 8px;">Click "Add Task" in any project to schedule work for this day</div>
            </div>
        `;
    } else {
        tasksOnDate.forEach(task => {
            const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
            const statusIcon = task.status === 'completed' ? '✅' : task.status === 'in-progress' ? '🔄' : '⏳';
            const statusClass = task.status ? task.status.replace(' ', '-') : 'not-started';
            
            tasksHTML += `
                <div class="task-card priority-${task.priority || 'medium'}" style="margin-bottom: 16px;">
                    <div class="task-header">
                        <div class="task-name-main">${priorityIcon} ${task.name}</div>
                        <span class="task-status-mini task-${statusClass}">${statusIcon} ${task.status ? task.status.charAt(0).toUpperCase() + task.status.slice(1).replace('-', ' ') : 'Not Started'}</span>
                    </div>
                    <div class="task-meta-info">
                        <span>💼 ${task.jobName}</span>
                        <span>📋 ${task.projectTitle}</span>
                    </div>
                    ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
                </div>
            `;
        });
    }
    
    document.getElementById('date-tasks-list').innerHTML = tasksHTML;
    document.getElementById('date-tasks-modal').classList.add('active');
}

function closeDateTasks() {
    document.getElementById('date-tasks-modal').classList.remove('active');
}

// Task Detail Functions
function openTaskDetails(taskId, projectId, jobId) {
    const task = jobs[jobId]?.projects[projectId]?.tasks[taskId];
    if (!task) return;
    
    document.getElementById('modal-task-title').textContent = task.name;
    document.getElementById('modal-task-description').textContent = task.description || 'No description provided.';
    document.getElementById('modal-task-notes').textContent = task.notes || 'No notes added yet.';
    document.getElementById('modal-task-due').textContent = `📅 Due: ${formatDate(task.dueDate)}`;
    
    const statusBadge = document.getElementById('modal-task-status-badge');
    const statusText = task.status ? task.status.charAt(0).toUpperCase() + task.status.slice(1).replace('-', ' ') : 'Not Started';
    statusBadge.textContent = statusText;
    statusBadge.className = `task-status-mini task-${task.status ? task.status.replace(' ', '-') : 'not-started'}`;
    
    const priorityBadge = document.getElementById('modal-task-priority-badge');
    const priorityText = (task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1);
    priorityBadge.textContent = priorityText;
    priorityBadge.className = `priority-badge priority-${task.priority || 'medium'}`;
    
    document.getElementById('subtasks-container').innerHTML = '<div style="color: #6b7280; font-style: italic;">No sub-tasks yet.</div>';
    
    document.getElementById('task-detail-modal').classList.add('active');
}

function closeTaskDetails() {
    document.getElementById('task-detail-modal').classList.remove('active');
}

function attachFile() {
    alert('File attachment functionality - would open file picker to attach documents, images, or other files to this task');
}

function addSubtask() {
    document.querySelector('#add-task-modal .modal-title').textContent = 'Add New Sub-task';
    addTask();
}

// Add Task Modal Functions
function addTask() {
    document.getElementById('task-modal-title').textContent = 'Add New Task';
    document.getElementById('task-save-btn').textContent = 'Create Task';
    document.getElementById('task-save-btn').onclick = saveNewTask;
    document.getElementById('add-task-modal').classList.add('active');
}

function closeAddTask() {
    document.getElementById('add-task-modal').classList.remove('active');
    document.getElementById('new-task-name').value = '';
    document.getElementById('new-task-description').value = '';
    document.getElementById('new-task-status').value = 'not-started';
    document.getElementById('new-task-priority').value = 'medium';
    document.getElementById('new-task-due').value = '';
    document.getElementById('new-task-notes').value = '';
}

function saveNewTask() {
    const name = document.getElementById('new-task-name').value;
    const description = document.getElementById('new-task-description').value;
    const status = document.getElementById('new-task-status').value;
    const priority = document.getElementById('new-task-priority').value;
    const due = document.getElementById('new-task-due').value;
    const notes = document.getElementById('new-task-notes').value;
    
    if (!name.trim()) {
        alert('Please enter a task name');
        return;
    }
    
    if (!currentJobTab) {
        alert('Please select a job first');
        return;
    }
    
    const currentJob = jobs[currentJobTab];
    const projectIds = Object.keys(currentJob.projects || {});
    
    if (projectIds.length === 0) {
        alert('Please create a project first');
        return;
    }
    
    const projectId = projectIds[0];
    const taskId = generateReadableId('task', name);
    const taskData = {
        id: taskId,
        name,
        description,
        status,
        priority,
        dueDate: due || null,
        notes,
        createdAt: new Date().toISOString()
    };
    
    if (!jobs[currentJobTab].projects[projectId].tasks) {
        jobs[currentJobTab].projects[projectId].tasks = {};
    }
    jobs[currentJobTab].projects[projectId].tasks[taskId] = taskData;
    
    saveToStorage('jobs', jobs);
    renderJobs();
    updateDashboard();
    renderCalendar();
    
    alert(`Task "${name}" created successfully!`);
    closeAddTask();
}

// Context Menu Functions
function showContextMenu(event, target, type) {
    event.preventDefault();
    event.stopPropagation();
    
    contextMenuTarget = { element: target, type: type };
    const contextMenu = document.getElementById('context-menu');
    
    contextMenu.style.display = 'block';
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
    
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu);
    }, 0);
}

function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
    document.removeEventListener('click', hideContextMenu);
    contextMenuTarget = null;
}

function editItem() {
    if (!contextMenuTarget) return;
    
    const element = contextMenuTarget.element;
    const type = contextMenuTarget.type;
    
    openEditModal(element, type);
    hideContextMenu();
}

function deleteItem() {
    if (!contextMenuTarget) return;
    
    const type = contextMenuTarget.type;
    let itemName = '';
    
    if (type === 'job') {
        itemName = contextMenuTarget.element.querySelector('.job-name').textContent;
    } else if (type === 'project') {
        itemName = contextMenuTarget.element.querySelector('.project-title').textContent;
    } else if (type === 'task') {
        itemName = contextMenuTarget.element.querySelector('.task-name-main').textContent;
    } else if (type === 'note') {
        itemName = contextMenuTarget.element.querySelector('.note-title').textContent;
    }
    
    deleteTarget = contextMenuTarget;
    document.getElementById('delete-message').textContent = `Are you sure you want to delete "${itemName}"?`;
    document.getElementById('delete-modal').classList.add('active');
    hideContextMenu();
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('active');
    deleteTarget = null;
}

function confirmDelete() {
    if (!deleteTarget) return;
    
    const element = deleteTarget.element;
    const type = deleteTarget.type;
    
    if (type === 'job') {
        const jobId = element.dataset.jobId;
        delete jobs[jobId];
        
        const jobTab = document.querySelector(`[onclick="switchJobTab('${jobId}')"]`);
        const jobContent = document.getElementById(`${jobId}-job`);
        
        if (jobTab) jobTab.remove();
        if (jobContent) jobContent.remove();
        
        const remainingJobIds = Object.keys(jobs);
        if (remainingJobIds.length > 0) {
            currentJobTab = remainingJobIds[0];
            renderJobs();
        } else {
            currentJobTab = null;
            renderEmptyStates();
        }
        
    } else if (type === 'project') {
        const jobId = element.dataset.jobId;
        const projectId = element.dataset.projectId;
        delete jobs[jobId].projects[projectId];
        renderJobs();
        
    } else if (type === 'task') {
        const jobId = element.dataset.jobId;
        const projectId = element.dataset.projectId;
        const taskId = element.dataset.taskId;
        delete jobs[jobId].projects[projectId].tasks[taskId];
        renderJobs();
        
    } else if (type === 'note') {
        const noteId = element.dataset.noteId;
        delete notes[noteId];
        renderNotes();
    }
    
    saveToStorage('jobs', jobs);
    saveToStorage('notes', notes);
    updateDashboard();
    renderCalendar();
    
    alert(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully!`);
    closeDeleteModal();
}

// Open Edit Modal Functions
function openEditModal(element, type) {
    if (type === 'job') {
        const jobId = element.dataset.jobId;
        const job = jobs[jobId];
        
        document.getElementById('job-modal-title').textContent = 'Edit Job';
        document.getElementById('new-job-name').value = job.name || '';
        document.getElementById('new-job-description').value = job.description || '';
        document.getElementById('new-job-notes').value = job.notes || '';
        document.getElementById('job-save-btn').textContent = 'Save Changes';
        document.getElementById('job-save-btn').onclick = () => saveEditedJob(jobId);
        document.getElementById('add-job-modal').classList.add('active');
        
    } else if (type === 'project') {
        const jobId = element.dataset.jobId;
        const projectId = element.dataset.projectId;
        const project = jobs[jobId].projects[projectId];
        
        document.getElementById('project-modal-title').textContent = 'Edit Project';
        document.getElementById('new-project-title').value = project.title || '';
        document.getElementById('new-project-description').value = project.description || '';
        document.getElementById('new-project-status').value = project.status || 'active';
        document.getElementById('new-project-priority').value = project.priority || 'medium';
        document.getElementById('new-project-due').value = project.dueDate || '';
        document.getElementById('new-project-notes').value = project.notes || '';
        document.getElementById('project-save-btn').textContent = 'Save Changes';
        document.getElementById('project-save-btn').onclick = () => saveEditedProject(jobId, projectId);
        document.getElementById('add-project-modal').classList.add('active');
        
    } else if (type === 'task') {
        const jobId = element.dataset.jobId;
        const projectId = element.dataset.projectId;
        const taskId = element.dataset.taskId;
        const task = jobs[jobId].projects[projectId].tasks[taskId];
        
        document.getElementById('task-modal-title').textContent = 'Edit Task';
        document.getElementById('new-task-name').value = task.name || '';
        document.getElementById('new-task-description').value = task.description || '';
        document.getElementById('new-task-status').value = task.status || 'not-started';
        document.getElementById('new-task-priority').value = task.priority || 'medium';
        document.getElementById('new-task-due').value = task.dueDate || '';
        document.getElementById('new-task-notes').value = task.notes || '';
        document.getElementById('task-save-btn').textContent = 'Save Changes';
        document.getElementById('task-save-btn').onclick = () => saveEditedTask(jobId, projectId, taskId);
        document.getElementById('add-task-modal').classList.add('active');
        
    } else if (type === 'note') {
        const noteId = element.dataset.noteId;
        const note = notes[noteId];
        
        document.getElementById('note-modal-title').textContent = 'Edit Note';
        document.getElementById('new-note-title').value = note.title || '';
        document.getElementById('new-note-content').value = note.content || '';
        document.getElementById('note-save-btn').textContent = 'Save Changes';
        document.getElementById('note-save-btn').onclick = () => saveEditedNote(noteId);
        noteFiles = note.files || [];
        renderNoteFiles();
        document.getElementById('add-note-modal').classList.add('active');
    }
}

// Save Edited Items Functions
function saveEditedJob(jobId) {
    const name = document.getElementById('new-job-name').value;
    const description = document.getElementById('new-job-description').value;
    const notes = document.getElementById('new-job-notes').value;
    
    if (!name.trim()) {
        alert('Please enter a job name');
        return;
    }
    
    jobs[jobId].name = name;
    jobs[jobId].description = description;
    jobs[jobId].notes = notes;
    jobs[jobId].updatedAt = new Date().toISOString();
    
    saveToStorage('jobs', jobs);
    renderJobs();
    updateDashboard();
    
    alert(`Job "${name}" updated successfully!`);
    closeAddJob();
}

function saveEditedProject(jobId, projectId) {
    const title = document.getElementById('new-project-title').value;
    const description = document.getElementById('new-project-description').value;
    const status = document.getElementById('new-project-status').value;
    const priority = document.getElementById('new-project-priority').value;
    const due = document.getElementById('new-project-due').value;
    const notes = document.getElementById('new-project-notes').value;
    
    if (!title.trim()) {
        alert('Please enter a project title');
        return;
    }
    
    const project = jobs[jobId].projects[projectId];
    project.title = title;
    project.description = description;
    project.status = status;
    project.priority = priority;
    project.dueDate = due || null;
    project.notes = notes;
    project.updatedAt = new Date().toISOString();
    
    saveToStorage('jobs', jobs);
    renderJobs();
    updateDashboard();
    renderCalendar();
    
    alert(`Project "${title}" updated successfully!`);
    closeAddProject();
}

function saveEditedTask(jobId, projectId, taskId) {
    const name = document.getElementById('new-task-name').value;
    const description = document.getElementById('new-task-description').value;
    const status = document.getElementById('new-task-status').value;
    const priority = document.getElementById('new-task-priority').value;
    const due = document.getElementById('new-task-due').value;
    const notes = document.getElementById('new-task-notes').value;
    
    if (!name.trim()) {
        alert('Please enter a task name');
        return;
    }
    
    const task = jobs[jobId].projects[projectId].tasks[taskId];
    task.name = name;
    task.description = description;
    task.status = status;
    task.priority = priority;
    task.dueDate = due || null;
    task.notes = notes;
    task.updatedAt = new Date().toISOString();
    
    saveToStorage('jobs', jobs);
    renderJobs();
    updateDashboard();
    renderCalendar();
    
    alert(`Task "${name}" updated successfully!`);
    closeAddTask();
}

function saveEditedNote(noteId) {
    const title = document.getElementById('new-note-title').value;
    const content = document.getElementById('new-note-content').value;
    
    if (!title.trim()) {
        alert('Please enter a note title');
        return;
    }
    
    notes[noteId].title = title;
    notes[noteId].content = content;
    notes[noteId].files = noteFiles;
    notes[noteId].updatedAt = new Date().toISOString();
    
    saveToStorage('notes', notes);
    renderNotes();
    
    alert(`Note "${title}" updated successfully!`);
    closeAddNote();
}

// Add Job Modal Functions
function addJob() {
    document.getElementById('job-modal-title').textContent = 'Add New Job';
    document.getElementById('new-job-name').value = '';
    document.getElementById('new-job-description').value = '';
    document.getElementById('new-job-notes').value = '';
    document.getElementById('job-save-btn').textContent = 'Create Job';
    document.getElementById('job-save-btn').onclick = saveNewJob;
    document.getElementById('add-job-modal').classList.add('active');
}

function closeAddJob() {
    document.getElementById('add-job-modal').classList.remove('active');
}

function saveNewJob() {
    const name = document.getElementById('new-job-name').value;
    const description = document.getElementById('new-job-description').value;
    const notes = document.getElementById('new-job-notes').value;
    
    if (!name.trim()) {
        alert('Please enter a job name');
        return;
    }
    
    const jobId = generateReadableId('job', name);
    const jobData = {
        id: jobId,
        name,
        description,
        notes,
        projects: {},
        createdAt: new Date().toISOString()
    };
    
    jobs[jobId] = jobData;
    currentJobTab = jobId;
    
    saveToStorage('jobs', jobs);
    renderJobs();
    updateDashboard();
    
    alert(`Job "${name}" created successfully!`);
    closeAddJob();
}

// Add Project Modal Functions
function addProject() {
    if (!currentJobTab) {
        alert('Please select a job first');
        return;
    }
    
    document.getElementById('project-modal-title').textContent = 'Add New Project';
    document.getElementById('new-project-title').value = '';
    document.getElementById('new-project-description').value = '';
    document.getElementById('new-project-status').value = 'active';
    document.getElementById('new-project-priority').value = 'medium';
    document.getElementById('new-project-due').value = '';
    document.getElementById('new-project-notes').value = '';
    document.getElementById('project-save-btn').textContent = 'Create Project';
    document.getElementById('project-save-btn').onclick = saveNewProject;
    document.getElementById('add-project-modal').classList.add('active');
}

function closeAddProject() {
    document.getElementById('add-project-modal').classList.remove('active');
}

function saveNewProject() {
    const title = document.getElementById('new-project-title').value;
    const description = document.getElementById('new-project-description').value;
    const status = document.getElementById('new-project-status').value;
    const priority = document.getElementById('new-project-priority').value;
    const due = document.getElementById('new-project-due').value;
    const notes = document.getElementById('new-project-notes').value;
    
    if (!title.trim()) {
        alert('Please enter a project title');
        return;
    }
    
    if (!currentJobTab) {
        alert('Please select a job first');
        return;
    }
    
    const projectId = generateReadableId('project', title);
    const projectData = {
        id: projectId,
        title,
        description,
        status,
        priority,
        dueDate: due || null,
        notes,
        tasks: {},
        createdAt: new Date().toISOString()
    };
    
    if (!jobs[currentJobTab].projects) {
        jobs[currentJobTab].projects = {};
    }
    jobs[currentJobTab].projects[projectId] = projectData;
    
    saveToStorage('jobs', jobs);
    renderJobs();
    updateDashboard();
    renderCalendar();
    
    alert(`Project "${title}" created successfully!`);
    closeAddProject();
}

// Add Note Modal Functions
function addNote() {
    document.getElementById('note-modal-title').textContent = 'Add New Note';
    document.getElementById('new-note-title').value = '';
    document.getElementById('new-note-content').value = '';
    document.getElementById('note-save-btn').textContent = 'Create Note';
    document.getElementById('note-save-btn').onclick = saveNewNote;
    noteFiles = [];
    renderNoteFiles();
    document.getElementById('add-note-modal').classList.add('active');
}

function closeAddNote() {
    document.getElementById('add-note-modal').classList.remove('active');
    noteFiles = [];
}

function saveNewNote() {
    const title = document.getElementById('new-note-title').value;
    const content = document.getElementById('new-note-content').value;
    
    if (!title.trim()) {
        alert('Please enter a note title');
        return;
    }
    
    const noteId = generateReadableId('note', title);
    const noteData = {
        id: noteId,
        title,
        content,
        files: noteFiles,
        createdAt: new Date().toISOString()
    };
    
    notes[noteId] = noteData;
    
    saveToStorage('notes', notes);
    renderNotes();
    
    alert(`Note "${title}" created successfully!`);
    closeAddNote();
}

// File Handling Functions
function triggerFileUpload() {
    document.getElementById('note-file-input').click();
}

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const fileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                data: e.target.result,
                uploadedAt: new Date().toISOString()
            };
            noteFiles.push(fileData);
            renderNoteFiles();
        };
        reader.readAsDataURL(file);
    });
}

function handleFileDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const uploadArea = event.currentTarget;
    uploadArea.classList.remove('dragover');
    
    const files = Array.from(event.dataTransfer.files);
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const fileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                data: e.target.result,
                uploadedAt: new Date().toISOString()
            };
            noteFiles.push(fileData);
            renderNoteFiles();
        };
        reader.readAsDataURL(file);
    });
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');
}

function renderNoteFiles() {
    const container = document.getElementById('note-uploaded-files');
    
    if (noteFiles.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    let filesHTML = '';
    noteFiles.forEach((file, index) => {
        const fileIcon = getFileIcon(file.type);
        const fileTypeClass = getFileTypeClass(file.type);
        const canView = canViewFile(file.type);
        
        filesHTML += `
            <div class="file-item">
                <div class="file-info">
                    <span class="file-icon ${fileTypeClass}">${fileIcon}</span>
                    <div class="file-details">
                        <div class="file-name">${file.name}</div>
                        <div class="file-size">${formatFileSize(file.size)}</div>
                    </div>
                </div>
                <div class="file-actions">
                    ${canView ? `<button class="file-action-btn view" onclick="previewFile(${index})" title="Preview file">👁️</button>` : ''}
                    <button class="file-action-btn download" onclick="downloadFile(${index})" title="Download file">⬇️</button>
                    <button class="file-action-btn delete" onclick="removeFile(${index})" title="Remove file">🗑️</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = filesHTML;
}

function getFileIcon(type) {
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('excel') || type.includes('spreadsheet')) return '📊';
    if (type.includes('powerpoint') || type.includes('presentation')) return '📽️';
    if (type.includes('zip') || type.includes('rar')) return '📦';
    return '📁';
}

function getFileTypeClass(type) {
    if (type.startsWith('image/')) return 'file-type-image';
    if (type.startsWith('video/')) return 'file-type-video';
    if (type.startsWith('audio/')) return 'file-type-audio';
    if (type.includes('pdf') || type.includes('document') || type.includes('text')) return 'file-type-document';
    return 'file-type-other';
}

function canViewFile(type) {
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/') || type.includes('pdf');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function previewFile(index) {
    const file = noteFiles[index];
    if (!canViewFile(file.type)) return;
    
    document.getElementById('file-viewer-title').textContent = file.name;
    const mediaContainer = document.getElementById('file-viewer-media');
    
    if (file.type.startsWith('image/')) {
        mediaContainer.innerHTML = `<img src="${file.data}" alt="${file.name}">`;
    } else if (file.type.startsWith('video/')) {
        mediaContainer.innerHTML = `<video controls src="${file.data}"></video>`;
    } else if (file.type.startsWith('audio/')) {
        mediaContainer.innerHTML = `<audio controls src="${file.data}"></audio>`;
    } else if (file.type.includes('pdf')) {
        mediaContainer.innerHTML = `<iframe src="${file.data}" style="width: 100%; height: 70vh; border: none;"></iframe>`;
    }
    
    document.getElementById('file-viewer-modal').classList.add('active');
}

function downloadFile(index) {
    const file = noteFiles[index];
    const link = document.createElement('a');
    link.href = file.data;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function removeFile(index) {
    noteFiles.splice(index, 1);
    renderNoteFiles();
}

function closeFileViewer() {
    document.getElementById('file-viewer-modal').classList.remove('active');
}

function handleFileAction(noteId, fileIndex) {
    const note = notes[noteId];
    if (!note || !note.files || !note.files[fileIndex]) return;
    
    const file = note.files[fileIndex];
    
    if (canViewFile(file.type)) {
        document.getElementById('file-viewer-title').textContent = file.name;
        const mediaContainer = document.getElementById('file-viewer-media');
        
        if (file.type.startsWith('image/')) {
            mediaContainer.innerHTML = `<img src="${file.data}" alt="${file.name}">`;
        } else if (file.type.startsWith('video/')) {
            mediaContainer.innerHTML = `<video controls src="${file.data}"></video>`;
        } else if (file.type.startsWith('audio/')) {
            mediaContainer.innerHTML = `<audio controls src="${file.data}"></audio>`;
        } else if (file.type.includes('pdf')) {
            mediaContainer.innerHTML = `<iframe src="${file.data}" style="width: 100%; height: 70vh; border: none;"></iframe>`;
        }
        
        document.getElementById('file-viewer-modal').classList.add('active');
    } else {
        const link = document.createElement('a');
        link.href = file.data;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Inline Editing Functions
function makeInlineEditable(element, type, field) {
    if (element.classList.contains('editing')) return;
    
    const originalText = element.textContent;
    element.classList.add('editing');
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalText;
    input.className = 'inline-input';
    
    element.innerHTML = '';
    element.appendChild(input);
    input.focus();
    input.select();
    
    function saveEdit() {
        const newValue = input.value.trim();
        if (newValue && newValue !== originalText) {
            updateInlineField(element, type, field, newValue);
        }
        element.textContent = newValue || originalText;
        element.classList.remove('editing');
    }
    
    function cancelEdit() {
        element.textContent = originalText;
        element.classList.remove('editing');
    }
    
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });
}

function makeInlineDropdown(element, type, field) {
    if (element.classList.contains('editing')) return;
    
    const originalText = element.textContent;
    element.classList.add('editing');
    
    const select = document.createElement('select');
    select.className = 'inline-select';
    
    if (field === 'status') {
        const options = [
            { value: 'active', text: 'Active' },
            { value: 'pending', text: 'Pending' },
            { value: 'completed', text: 'Completed' },
            { value: 'on-hold', text: 'On Hold' }
        ];
        
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.text;
            if (option.text === originalText) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        });
    }
    
    element.innerHTML = '';
    element.appendChild(select);
    select.focus();
    
    function saveEdit() {
        const newValue = select.value;
        const newText = select.options[select.selectedIndex].text;
        
        if (newValue !== originalText.toLowerCase().replace(' ', '-')) {
            updateInlineField(element, type, field, newValue);
        }
        
        element.textContent = newText;
        element.className = element.className.replace(/status-\w+/, `status-${newValue}`);
        element.classList.remove('editing');
    }
    
    function cancelEdit() {
        element.textContent = originalText;
        element.classList.remove('editing');
    }
    
    select.addEventListener('blur', saveEdit);
    select.addEventListener('change', saveEdit);
    select.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });
}

function updateInlineField(element, type, field, newValue) {
    if (type === 'project') {
        const projectCard = element.closest('.project-card, .banner-card');
        const jobId = projectCard.dataset.jobId;
        const projectId = projectCard.dataset.projectId;
        
        if (jobs[jobId] && jobs[jobId].projects[projectId]) {
            jobs[jobId].projects[projectId][field] = newValue;
            jobs[jobId].projects[projectId].updatedAt = new Date().toISOString();
            
            saveToStorage('jobs', jobs);
            
            if (field === 'title') {
                renderJobs();
            }
        }
    }
}