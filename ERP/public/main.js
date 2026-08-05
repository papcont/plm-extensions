// API base URL
const API_BASE = '/api';

// DOM elements (will be initialized after DOM is loaded)
let itemIdInput;
let syncBtn;
let dryRunBtn;
let loadHistoryBtn;
let statusDiv;
let historyContainer;
let authStatusDiv;
let loginBtn;
let logoutBtn;
let progressContainer;
let progressBar;
let progressMessage;
let progressPercent;
let progressCurrent;
let progressTotal;
let viewBomBtn;

// Dolibarr base URL (will be loaded on page load)
let dolibarrBaseUrl = null;

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
    if (!statusDiv) {
        console.warn('statusDiv not found');
        return;
    }
    statusDiv.textContent = message;
    statusDiv.className = `status show ${type}`;
    statusDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Hide status message
 */
function hideStatus() {
    if (!statusDiv) {
        return;
    }
    statusDiv.className = 'status';
}

/**
 * Set loading state for buttons
 */
function setLoading(loading) {
    if (!syncBtn || !dryRunBtn || !loadHistoryBtn) {
        return;
    }
    syncBtn.disabled = loading;
    dryRunBtn.disabled = loading;
    loadHistoryBtn.disabled = loading;
    
    if (loading) {
        syncBtn.innerHTML = 'Synchronisiere... <span class="loading"></span>';
        dryRunBtn.innerHTML = 'Dry-Run läuft... <span class="loading"></span>';
        loadHistoryBtn.innerHTML = 'Lade... <span class="loading"></span>';
    } else {
        syncBtn.innerHTML = 'BOM jetzt synchronisieren';
        dryRunBtn.innerHTML = 'Dry-Run ausführen';
        loadHistoryBtn.innerHTML = 'Historie laden';
    }
}

/**
 * Show/hide progress bar
 */
function showProgress(show) {
    if (!progressContainer || !progressBar || !progressMessage || !progressPercent || !progressCurrent || !progressTotal) {
        return;
    }
    if (show) {
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressMessage.textContent = 'Initialisiere...';
        progressPercent.textContent = '0%';
        progressCurrent.textContent = '0';
        progressTotal.textContent = '0';
    } else {
        progressContainer.style.display = 'none';
    }
}

/**
 * Update progress UI based on progress event
 * Handles different steps: fetch_bom, ensure_products, create_bom_lines, etc.
 */
function updateProgressUI(progress) {
    if (!progress || !progress.step) {
        return;
    }
    
    const step = progress.step;
    const percent = progress.percent !== null && progress.percent !== undefined ? progress.percent : 0;
    const message = progress.message || 'Verarbeite...';
    const current = progress.current !== null && progress.current !== undefined ? progress.current : 0;
    const total = progress.total !== null && progress.total !== undefined ? progress.total : 0;
    
    // Update overall progress bar
    if (typeof percent === 'number') {
        progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        progressPercent.textContent = `${Math.round(percent)}%`;
    }
    
    // Update message and counts based on step
    switch (step) {
        case 'fetch_bom':
            progressMessage.textContent = message || 'BOM aus Fusion Manage laden...';
            break;
            
        case 'ensure_products':
            progressMessage.textContent = message || 'Produkte prüfen/erstellen...';
            if (total > 0 && progressCurrent && progressTotal) {
                progressCurrent.textContent = current;
                progressTotal.textContent = total;
                const progressDetails = document.getElementById('progressDetails');
                if (progressDetails) {
                    progressDetails.style.display = 'block';
                }
            }
            break;
            
        case 'create_bom_lines':
            progressMessage.textContent = message || 'BOM-Zeilen erstellen...';
            if (total > 0 && progressCurrent && progressTotal) {
                progressCurrent.textContent = current;
                progressTotal.textContent = total;
                const progressDetails = document.getElementById('progressDetails');
                if (progressDetails) {
                    progressDetails.style.display = 'block';
                }
            }
            break;
            
        case 'create_parent':
            progressMessage.textContent = message || 'Parent-Produkt erstellen...';
            break;
            
        case 'sync_bom_lines':
            progressMessage.textContent = message || 'BOM synchronisieren...';
            break;
            
        case 'log':
            progressMessage.textContent = message || 'Transfer protokollieren...';
            break;
            
        default:
            progressMessage.textContent = message;
            if (total > 0 && current > 0 && progressCurrent && progressTotal) {
                progressCurrent.textContent = current;
                progressTotal.textContent = total;
                const progressDetails = document.getElementById('progressDetails');
                if (progressDetails) {
                    progressDetails.style.display = 'block';
                }
            }
            break;
    }
}

/**
 * Handle sync result (final event with syncResult)
 */
function handleSyncResult(syncResult, itemId) {
    if (!syncResult) {
        return;
    }
    
    // Build success message with detailed result
    let message = `✅ BOM erfolgreich synchronisiert!\n\n`;
    message += `Item ID: ${syncResult.fusionItemId || itemId}\n`;
    message += `Artikelnummer: ${syncResult.parentNumber || syncResult.parent?.fusionNumber || 'N/A'}\n`;
    message += `Dolibarr Produkt ID: ${syncResult.parentProductId || syncResult.parent?.dolibarrProductId || 'N/A'}\n`;
    message += `BOM Zeilen geplant: ${syncResult.bom?.linesPlanned || syncResult.bomLinesPlanned || 0}\n`;
    message += `BOM Zeilen geschrieben: ${syncResult.bom?.linesWritten || syncResult.bomLinesWritten || 0}\n`;
    
    if (syncResult.bom?.lines && syncResult.bom.lines.length > 0) {
        message += `\n--- BOM-Zeilen (${syncResult.bom.lines.length}) ---\n`;
        syncResult.bom.lines.slice(0, 10).forEach((line, idx) => {
            message += `  ${idx + 1}. ${line.childNumber || 'N/A'} (Menge: ${line.quantity || 1})\n`;
        });
        if (syncResult.bom.lines.length > 10) {
            message += `  ... und ${syncResult.bom.lines.length - 10} weitere Zeilen\n`;
        }
    }
    showStatus(message, 'success');
    
    // Show view BOM button if BOM ID is available
    const bomId = syncResult.bomId || syncResult.bom?.dolibarrBomId;
    if (bomId) {
        if (!dolibarrBaseUrl) {
            loadDolibarrBaseUrl().then(() => {
                if (dolibarrBaseUrl) {
                    showViewBomButton(bomId);
                }
            });
        } else {
            showViewBomButton(bomId);
        }
    }
    
    // Reload history to show updated entry
    setTimeout(() => loadHistory(), 1000);
}

/**
 * Update progress bar (legacy function, kept for backward compatibility)
 */
function updateProgress(progress) {
    updateProgressUI(progress);
}

/**
 * Format date for display
 */
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('de-DE');
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status, dryRun) {
    if (dryRun) {
        return '<span class="badge dry-run">DRY RUN</span>';
    }
    if (status === 'SUCCESS') {
        return '<span class="badge success">SUCCESS</span>';
    }
    if (status === 'ERROR') {
        return '<span class="badge error">ERROR</span>';
    }
    return `<span class="badge">${status}</span>`;
}

/**
 * Sync BOM with progress tracking via SSE
 */
async function syncBOM() {
    const itemId = itemIdInput.value.trim();
    
    if (!itemId) {
        showStatus('Bitte geben Sie eine Item ID ein', 'error');
        return;
    }

    setLoading(true);
    hideStatus();
    showProgress(true);
    showViewBomButton(null); // Hide button at start

    let eventSource = null;
    let syncResult = null;

    try {
        const url = `/api/sync/bom/${encodeURIComponent(itemId)}/progress?dryRun=false`;
        eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
            try {
                const progress = JSON.parse(event.data);
                
                // 1. Handle errors first
                if (progress.step === 'error' || progress.error) {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    const errorMsg = progress.message || (progress.error && (progress.error.message || String(progress.error))) || 'Unbekannter Fehler';
                    showStatus(`❌ Fehler: ${errorMsg}`, 'error');
                    
                    // Check if it's an authentication error
                    if (progress.error && (progress.error.status === 401 || errorMsg.includes('authenticated') || errorMsg.includes('Token'))) {
                        checkAuthStatus();
                    }
                    
                    if (progress.error) {
                        console.error('Sync error:', progress.error);
                    }
                    return;
                }
                
                // 2. Handle authentication errors (old format)
                if (progress.status === 'error' && progress.error) {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    if (progress.error.includes('authenticated') || progress.error.includes('Token')) {
                        showStatus(`❌ ${progress.error}. Bitte melden Sie sich zuerst bei Autodesk an.`, 'error');
                        checkAuthStatus();
                    } else {
                        showStatus(`❌ Fehler: ${progress.error}`, 'error');
                    }
                    return;
                }
                
                // 3. Always update progress UI if step is present
                if (progress.step) {
                    updateProgressUI(progress);
                }
                
                // 4. Handle final completion event
                if (progress.step === 'complete') {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    
                    // syncResult is optional - only present in final event
                    syncResult = progress.syncResult || progress.result; // Support both for backward compatibility
                    
                    if (syncResult) {
                        handleSyncResult(syncResult, itemId);
                    } else {
                        // No syncResult - show generic success message
                        showStatus(progress.message || '✅ Synchronisierung abgeschlossen', 'success');
                        setTimeout(() => loadHistory(), 1000);
                    }
                    return;
                }
                
                // 5. Normal progress events (without syncResult) are handled by updateProgressUI above
                // No error logging needed - these are expected
                
            } catch (e) {
                console.error('Error parsing progress event:', e, event.data);
            }
        };

        eventSource.onerror = (error) => {
            console.error('EventSource error:', error);
            eventSource.close();
            showProgress(false);
            setLoading(false);
            showStatus('❌ Fehler: Verbindung zum Server verloren', 'error');
        };

    } catch (error) {
        if (eventSource) {
            eventSource.close();
        }
        showProgress(false);
        setLoading(false);
        showStatus(`❌ Fehler: ${error.message}`, 'error');
        console.error('Sync error:', error);
    }
}

/**
 * Dry run with progress tracking via SSE
 */
async function dryRun() {
    const itemId = itemIdInput.value.trim();
    
    if (!itemId) {
        showStatus('Bitte geben Sie eine Item ID ein', 'error');
        return;
    }

    setLoading(true);
    hideStatus();
    showProgress(true);
    showViewBomButton(null); // Disable button at start

    let eventSource = null;
    let syncResult = null;

    try {
        const url = `/api/sync/bom/${encodeURIComponent(itemId)}/progress?dryRun=true`;
        eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
            try {
                const progress = JSON.parse(event.data);
                
                // Handle authentication errors
                if (progress.status === 'error' && progress.error) {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    if (progress.error.includes('authenticated') || progress.error.includes('Token')) {
                        showStatus(`❌ ${progress.error}. Bitte melden Sie sich zuerst bei Autodesk an.`, 'error');
                        checkAuthStatus();
                    } else {
                        showStatus(`❌ Fehler: ${progress.error}`, 'error');
                    }
                    return;
                }
                
                if (progress.step === 'error') {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    const errorMsg = progress.message || (progress.error && progress.error.message) || 'Unbekannter Fehler';
                    showStatus(`❌ Fehler: ${errorMsg}`, 'error');
                    
                    // Check if it's an authentication error
                    if (progress.error && (progress.error.status === 401 || errorMsg.includes('authenticated') || errorMsg.includes('Token'))) {
                        checkAuthStatus();
                    }
                    
                    if (progress.error) {
                        console.error('Dry-run error:', progress.error);
                    }
                    return;
                }
                
                // Fehlerfall vom Server
                if (progress.error) {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    const errorMsg = progress.error.message || String(progress.error);
                    showStatus(`❌ Fehler: ${errorMsg}`, 'error');
                    return;
                }
                
                // Erfolgreicher Abschluss
                if (progress.step === 'complete') {
                    eventSource.close();
                    showProgress(false);
                    setLoading(false);
                    syncResult = progress.result;
                    
                    if (syncResult) {
                        // Build dry-run message with detailed result
                        let message = `🔍 Dry-Run abgeschlossen!\n\n`;
                        message += `Item ID: ${syncResult.fusionItemId || itemId}\n`;
                        message += `Artikelnummer: ${syncResult.parentNumber || syncResult.parent?.fusionNumber || 'N/A'}\n`;
                        message += `Geplante BOM Zeilen: ${syncResult.bom?.linesPlanned || syncResult.bomLinesPlanned || 0}\n`;
                        message += `Geschriebene BOM Zeilen: ${syncResult.bom?.linesWritten || syncResult.bomLinesWritten || 0} (Dry-Run: 0)\n`;
                        
                        if (syncResult.bom?.lines && syncResult.bom.lines.length > 0) {
                            message += `\n--- Preview (erste 10 Zeilen) ---\n`;
                            syncResult.bom.lines.slice(0, 10).forEach((line, idx) => {
                                message += `  ${idx + 1}. ${line.childNumber || 'N/A'} (Menge: ${line.quantity || 1})`;
                                if (line.dolibarrProductId) {
                                    message += ` → Dolibarr ID: ${line.dolibarrProductId}`;
                                }
                                message += `\n`;
                            });
                            if (syncResult.bom.lines.length > 10) {
                                message += `  ... und ${syncResult.bom.lines.length - 10} weitere Zeilen\n`;
                            }
                        } else {
                            message += `\nKeine BOM-Zeilen gefunden.\n`;
                        }
                        showStatus(message, 'info');
                    } else {
                        // Generischer Erfolg, wenn kein detailliertes Ergebnis vorhanden
                        showStatus(progress.message || '🔍 Dry-Run abgeschlossen', 'info');
                    }
                    return;
                }
                
                // Normale Zwischenstände
                if (!progress.result) {
                    console.warn('Sync event without syncResult', progress);
                    // Kein Fehler, nur Warnung loggen
                }
                
                // Update progress bar
                updateProgress(progress);
                
            } catch (e) {
                console.error('Error parsing progress event:', e);
            }
        };

        eventSource.onerror = (error) => {
            console.error('EventSource error:', error);
            eventSource.close();
            showProgress(false);
            setLoading(false);
            showStatus('❌ Fehler: Verbindung zum Server verloren', 'error');
        };

    } catch (error) {
        if (eventSource) {
            eventSource.close();
        }
        showProgress(false);
        setLoading(false);
        showStatus(`❌ Fehler: ${error.message}`, 'error');
        console.error('Dry-run error:', error);
    }
}

/**
 * Load history
 */
async function loadHistory() {
    const itemId = itemIdInput.value.trim();
    
    if (!itemId) {
        showStatus('Bitte geben Sie eine Item ID ein', 'error');
        return;
    }

    setLoading(true);
    historyContainer.innerHTML = '<p>Lade Historie...</p>';

    try {
        const response = await fetch(`${API_BASE}/sync/history/${encodeURIComponent(itemId)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || data.message || 'Historie konnte nicht geladen werden');
        }

        if (data.count === 0) {
            historyContainer.innerHTML = '<p style="color: #999;">Keine Historie für diese Item ID gefunden.</p>';
            return;
        }

        let html = `
            <p style="margin-bottom: 10px;"><strong>${data.count} Einträge gefunden</strong></p>
            <table class="history-table">
                <thead>
                    <tr>
                        <th>Datum</th>
                        <th>Status</th>
                        <th>Dolibarr Produkt</th>
                        <th>BOM ID</th>
                        <th>Nachricht</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Find the most recent successful sync with BOM ID
        let latestBomId = null;
        data.history.forEach(entry => {
            const dryRun = entry.dry_run === 1;
            // Track latest successful BOM ID (not dry-run)
            if (!dryRun && entry.status === 'SUCCESS' && entry.dolibarr_bom_id && !latestBomId) {
                latestBomId = entry.dolibarr_bom_id;
            }
        });

        data.history.forEach(entry => {
            const dryRun = entry.dry_run === 1;
            html += `
                <tr>
                    <td>${formatDate(entry.created_at)}</td>
                    <td>${getStatusBadge(entry.status, dryRun)}</td>
                    <td>${entry.dolibarr_product_ref || '-'}</td>
                    <td>${entry.dolibarr_bom_id || '-'}</td>
                    <td>
                        ${entry.message || '-'}
                        ${entry.diff_summary ? `<br><small style="color: #666;">${entry.diff_summary}</small>` : ''}
                    </td>
                </tr>
            `;
        });
        
        // Show view BOM button if we found a successful BOM ID in history
        if (latestBomId) {
            console.log('Found BOM ID in history:', latestBomId);
            if (!dolibarrBaseUrl) {
                loadDolibarrBaseUrl().then(() => {
                    if (dolibarrBaseUrl) {
                        showViewBomButton(latestBomId);
                    } else {
                        showViewBomButton(null); // Disable if URL not available
                    }
                });
            } else {
                showViewBomButton(latestBomId);
            }
        } else {
            // No BOM ID found in history, disable button
            showViewBomButton(null);
        }

        html += `
                </tbody>
            </table>
        `;

        historyContainer.innerHTML = html;
        showStatus(`✅ Historie geladen: ${data.count} Einträge`, 'success');
    } catch (error) {
        historyContainer.innerHTML = `<p style="color: #dc3545;">Fehler beim Laden der Historie: ${error.message}</p>`;
        showStatus(`❌ Fehler: ${error.message}`, 'error');
        console.error('History error:', error);
    } finally {
        setLoading(false);
    }
}

/**
 * Set auth UI to checking state
 */
function setAuthCheckingUI() {
    if (!authStatusDiv) {
        console.warn('authStatusDiv not found');
        return;
    }
    authStatusDiv.innerHTML = '<p style="color: #999;">Prüfe Authentifizierungsstatus...</p>';
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
}

/**
 * Update auth UI based on status
 */
function updateAuthUI(status) {
    if (!authStatusDiv) {
        console.warn('authStatusDiv not found');
        return;
    }
    
    if (status.authenticated) {
        authStatusDiv.innerHTML = `
            <div class="auth-status authenticated">
                ✅ <strong>Angemeldet</strong><br>
                <small>Token läuft ab: ${status.expiresAt ? new Date(status.expiresAt).toLocaleString('de-DE') : 'Unbekannt'}</small>
            </div>
        `;
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        
        // Enable BOM buttons
        if (syncBtn) syncBtn.disabled = false;
        if (dryRunBtn) dryRunBtn.disabled = false;
    } else {
        authStatusDiv.innerHTML = `
            <div class="auth-status not-authenticated">
                ⚠️ <strong>Nicht angemeldet</strong><br>
                <small>Bitte melden Sie sich bei Autodesk an, um BOMs zu synchronisieren.</small>
            </div>
        `;
        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'none';
        
        // Disable BOM buttons
        if (syncBtn) syncBtn.disabled = true;
        if (dryRunBtn) dryRunBtn.disabled = true;
    }
}

/**
 * Show auth error
 */
function showAuthError(message) {
    if (!authStatusDiv) {
        console.warn('authStatusDiv not found');
        return;
    }
    authStatusDiv.innerHTML = `
        <div class="auth-status not-authenticated">
            ❌ <strong>Fehler</strong><br>
            <small>${message}</small>
        </div>
    `;
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';
}

/**
 * Check authentication status
 */
async function checkAuthStatus() {
    // Check if DOM elements exist
    if (!authStatusDiv) {
        console.error('authStatusDiv element not found');
        return;
    }
    
    setAuthCheckingUI();
    
    try {
        const response = await fetch('/auth/status');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        updateAuthUI(data);
    } catch (error) {
        console.error('Auth status check error:', error);
        showAuthError('Fehler beim Prüfen des Anmeldestatus');
    }
}

/**
 * Login to Autodesk
 */
function loginToAutodesk() {
    window.location.href = '/auth/login';
}

/**
 * Logout
 */
async function logout() {
    try {
        const response = await fetch('/auth/logout');
        const data = await response.json();
        
        if (response.ok) {
            showStatus('✅ Erfolgreich abgemeldet', 'success');
            // Update auth UI after logout
            setTimeout(() => {
                checkAuthStatus().catch(err => {
                    console.error('Error checking auth status after logout:', err);
                });
            }, 500);
        } else {
            throw new Error(data.message || 'Logout fehlgeschlagen');
        }
    } catch (error) {
        showStatus(`❌ Fehler beim Abmelden: ${error.message}`, 'error');
        console.error('Logout error:', error);
        // Still try to update auth UI
        checkAuthStatus().catch(err => {
            console.error('Error checking auth status after logout error:', err);
        });
    }
}

/**
 * Load Dolibarr base URL from server
 */
async function loadDolibarrBaseUrl() {
    try {
        const response = await fetch(`${API_BASE}/sync/config/dolibarr-url`);
        const data = await response.json();
        if (data.status === 'ok' && data.baseUrl) {
            dolibarrBaseUrl = data.baseUrl;
            console.log('Dolibarr base URL loaded:', dolibarrBaseUrl);
        } else {
            console.warn('Failed to load Dolibarr base URL, using default');
            dolibarrBaseUrl = 'http://localhost:3030/dolibarr';
        }
    } catch (error) {
        console.error('Error loading Dolibarr base URL:', error);
        dolibarrBaseUrl = 'http://localhost:3030/dolibarr';
    }
    return dolibarrBaseUrl;
}

/**
 * Show/hide view BOM button
 */
function showViewBomButton(bomId) {
    if (bomId && dolibarrBaseUrl) {
        viewBomBtn.disabled = false;
        viewBomBtn.dataset.bomId = bomId;
        viewBomBtn.style.opacity = '1';
        viewBomBtn.style.cursor = 'pointer';
    } else {
        viewBomBtn.disabled = true;
        delete viewBomBtn.dataset.bomId;
        viewBomBtn.style.opacity = '0.5';
        viewBomBtn.style.cursor = 'not-allowed';
    }
}

/**
 * Open BOM in Dolibarr
 */
function viewBomInDolibarr() {
    const bomId = viewBomBtn.dataset.bomId;
    if (!bomId) {
        showStatus('Keine BOM-ID verfügbar', 'error');
        return;
    }
    
    if (!dolibarrBaseUrl) {
        showStatus('Dolibarr-URL nicht konfiguriert', 'error');
        return;
    }
    
    const url = `${dolibarrBaseUrl}/bom/bom_card.php?id=${bomId}&save_lastsearch_values=1`;
    window.open(url, '_blank');
}

/**
 * Initialize authentication UI
 */
function initAuth() {
    setAuthCheckingUI();
    checkAuthStatus()
        .catch(err => {
            console.error('Auth initialization failed', err);
            showAuthError('Fehler beim Prüfen des Anmeldestatus');
        });
}

/**
 * Initialize application on page load
 */
function init() {
    // Get DOM elements
    itemIdInput = document.getElementById('itemId');
    syncBtn = document.getElementById('syncBtn');
    dryRunBtn = document.getElementById('dryRunBtn');
    loadHistoryBtn = document.getElementById('loadHistoryBtn');
    statusDiv = document.getElementById('status');
    historyContainer = document.getElementById('historyContainer');
    authStatusDiv = document.getElementById('authStatus');
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    progressContainer = document.getElementById('progressContainer');
    progressBar = document.getElementById('progressBar');
    progressMessage = document.getElementById('progressMessage');
    progressPercent = document.getElementById('progressPercent');
    progressCurrent = document.getElementById('progressCurrent');
    progressTotal = document.getElementById('progressTotal');
    viewBomBtn = document.getElementById('viewBomBtn');
    
    // Check if all required DOM elements exist
    if (!authStatusDiv) {
        console.error('authStatusDiv element not found');
        return;
    }
    if (!itemIdInput) {
        console.error('itemIdInput element not found');
        return;
    }
    if (!syncBtn) {
        console.error('syncBtn element not found');
        return;
    }
    if (!dryRunBtn) {
        console.error('dryRunBtn element not found');
        return;
    }
    
    // Initialize auth
    initAuth();
    
    // Load Dolibarr base URL
    (async () => {
        try {
            await loadDolibarrBaseUrl();
            console.log('Initial Dolibarr base URL:', dolibarrBaseUrl);
            // Initially disable button (will be enabled if BOM ID found in history)
            showViewBomButton(null);
        } catch (error) {
            console.error('Error initializing Dolibarr URL:', error);
        }
    })();
    
    // Allow Enter key to trigger sync
    itemIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            syncBOM();
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM already loaded
    init();
}

