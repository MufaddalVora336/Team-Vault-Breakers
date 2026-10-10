/**
 * QueueLess — Center Administration Logic
 * Staff Approvals, Multi-Counter Rostering, Office & Service Management,
 * Filterable Queue Monitor, and Audit Activity Feed.
 */

let monitorPollTimer = null;
let currentOffices = [];
let currentStaff = [];

document.addEventListener('DOMContentLoaded', async () => {
  await verifyAdminSession();
  await refreshAdminData();
  startAdminPolling();
});

function showAlert(msg, type = 'danger') {
  const alertBox = document.getElementById('adminAlert');
  if (!alertBox) return;
  alertBox.className = `alert-box alert-${type}`;
  alertBox.innerHTML = msg;
  alertBox.style.display = 'block';
  setTimeout(() => {
    alertBox.style.display = 'none';
  }, 4000);
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = QueueEngine.getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// 1. Session Verification
async function verifyAdminSession() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      window.location.href = 'login-admin.html';
      return;
    }
    const data = await res.json();
    if (!data.success || !data.user || data.user.role !== 'admin') {
      window.location.href = 'login-admin.html';
      return;
    }
    const badge = document.getElementById('adminUserBadge');
    if (badge) {
      badge.textContent = `Admin: ${data.user.name || data.user.username}`;
    }
  } catch (e) {
    window.location.href = 'login-admin.html';
  }
}

// 2. Sign Out
async function handleAdminLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders()
    });
  } catch (e) {}
  QueueEngine.clearAuthToken();
  localStorage.removeItem('queueless_admin_user');
  window.location.href = 'login-admin.html';
}

// 3. Refresh All Dashboard Data
async function refreshAdminData() {
  await Promise.all([
    loadStaff(),
    loadOffices(),
    loadQueueMonitor(),
    loadAuditLogs()
  ]);
}

function startAdminPolling() {
  if (monitorPollTimer) clearInterval(monitorPollTimer);
  monitorPollTimer = setInterval(() => {
    loadQueueMonitor();
    loadAuditLogs();
  }, 2000);
}

// 4. Staff Management & Approvals
async function loadStaff() {
  try {
    const res = await fetch('/api/admin/staff', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    currentStaff = data.staff || [];

    const tableBody = document.getElementById('staffTableBody');
    const badgeCount = document.getElementById('badgePendingCount');
    const metricPending = document.getElementById('metricPendingStaff');

    const pendingStaff = currentStaff.filter(s => s.status === 'PENDING');
    if (badgeCount) badgeCount.textContent = `${pendingStaff.length} Pending`;
    if (metricPending) metricPending.textContent = pendingStaff.length;

    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (currentStaff.length === 0) {
      tableBody.innerHTML = `
        <tr><td colspan="4" style="text-align:center; padding:1.5rem; color:var(--text-dim);">No officers registered yet.</td></tr>
      `;
      return;
    }

    currentStaff.forEach(officer => {
      const tr = document.createElement('tr');
      const isPending = officer.status === 'PENDING';
      const isApproved = officer.status === 'APPROVED';

      let statusBadge = `<span class="badge badge-pending">PENDING</span>`;
      if (isApproved) statusBadge = `<span class="badge badge-approved">APPROVED</span>`;
      else if (officer.status === 'REJECTED') statusBadge = `<span class="badge badge-rejected">REJECTED</span>`;
      else if (officer.status === 'INACTIVE') statusBadge = `<span class="badge badge-inactive">INACTIVE</span>`;

      let actionHtml = '';
      if (isPending) {
        actionHtml = `
          <div style="display:flex; gap:0.35rem; justify-content:flex-end;">
            <button class="btn btn-primary btn-sm" style="background:#15803d; border-color:#15803d; padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="handleApproveStaff('${officer.id}')">
              ✓ Approve
            </button>
            <button class="btn btn-danger btn-sm" style="padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="handleRejectStaff('${officer.id}')">
              ✕ Reject
            </button>
          </div>
        `;
      } else if (isApproved) {
        actionHtml = `
          <div style="text-align:right;">
            <button class="btn btn-secondary btn-sm" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="handleSetStaffStatus('${officer.id}', 'INACTIVE')">
              Deactivate
            </button>
          </div>
        `;
      } else {
        actionHtml = `
          <div style="text-align:right;">
            <button class="btn btn-secondary btn-sm" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="handleSetStaffStatus('${officer.id}', 'APPROVED')">
              Re-activate
            </button>
          </div>
        `;
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight:700; color:var(--text-main);">${officer.name}</div>
          <div style="font-size:0.75rem; color:var(--text-dim); font-family:monospace;">@${officer.username} &bull; ${officer.email}</div>
        </td>
        <td>
          <div style="font-size:0.8rem;">${officer.office || 'Rajkot District'}</div>
          <div style="font-size:0.75rem; color:var(--blue-700); font-weight:600;">${officer.counter || 'Unassigned'}</div>
        </td>
        <td>${statusBadge}</td>
        <td>${actionHtml}</td>
      `;
      tableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading staff:', err);
  }
}

async function handleApproveStaff(userId) {
  try {
    const res = await fetch('/api/admin/staff/approve', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ userId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert(data.message || 'Approval failed.', 'danger');
      return;
    }
    showAlert(`✅ Officer <strong>${data.user.name}</strong> has been approved for desk duty.`, 'success');
    await loadStaff();
  } catch (e) {
    showAlert('Network error: ' + e.message, 'danger');
  }
}

async function handleRejectStaff(userId) {
  try {
    const res = await fetch('/api/admin/staff/reject', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ userId, reason: 'Administrative review' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showAlert(data.message || 'Reject failed.', 'danger');
      return;
    }
    showAlert(`Officer <strong>${data.user.name}</strong> rejected.`, 'warning');
    await loadStaff();
  } catch (e) {
    showAlert('Network error: ' + e.message, 'danger');
  }
}

async function handleSetStaffStatus(userId, status) {
  try {
    const res = await fetch('/api/admin/staff/status', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ userId, status })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showAlert(`Officer status updated to ${status}.`, 'info');
      await loadStaff();
    }
  } catch (e) {
    showAlert('Network error: ' + e.message, 'danger');
  }
}

// 5. Office, Service & Counter Management
async function loadOffices() {
  try {
    const res = await fetch('/api/admin/offices', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    currentOffices = data.offices || [];

    // Populate filter dropdown
    const filterSelect = document.getElementById('filterOffice');
    if (filterSelect) {
      const cur = filterSelect.value;
      filterSelect.innerHTML = '<option value="">All Offices</option>';
      currentOffices.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.name;
        opt.textContent = o.name;
        filterSelect.appendChild(opt);
      });
      filterSelect.value = cur;
    }

    // Render offices card container
    const container = document.getElementById('officeListContainer');
    if (!container) return;
    container.innerHTML = '';

    currentOffices.forEach(office => {
      const card = document.createElement('div');
      card.style.background = '#f8fafc';
      card.style.border = '1px solid var(--border-subtle)';
      card.style.borderRadius = 'var(--radius-sm)';
      card.style.padding = '0.85rem';

      const countersList = (office.counters || []).map(c => 
        `<span class="meta-chip"><strong>${c.name}:</strong> ${c.officerName || 'Standby'}</span>`
      ).join(' ');

      const servicesChips = (office.services || []).map(s =>
        `<span class="badge badge-online" style="font-size:0.75rem; margin-right:0.25rem;">${s}</span>`
      ).join('');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.4rem;">
          <div>
            <div style="font-weight:700; color:var(--text-main); font-size:0.92rem;">${office.name}</div>
            <div style="font-size:0.78rem; color:var(--text-dim);">${office.tagline} &bull; ${office.district}</div>
          </div>
          <button class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:0.2rem 0.5rem;" onclick="promptAddService('${office.id}')">+ Service</button>
        </div>
        <div style="margin-bottom:0.5rem;">${servicesChips}</div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
          <span style="font-size:0.78rem; font-weight:700; color:var(--text-dim);">Counters:</span>
          ${countersList}
          <button class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:0.15rem 0.45rem;" onclick="promptAddCounter('${office.id}')">+ Counter</button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading offices:', err);
  }
}

function toggleAddOfficeModal(show) {
  const modal = document.getElementById('addOfficeModal');
  if (modal) modal.style.display = show ? 'flex' : 'none';
}

async function handleAddOffice(e) {
  e.preventDefault();
  const name = document.getElementById('newOfficeName').value.trim();
  const tagline = document.getElementById('newOfficeTagline').value.trim();
  const district = document.getElementById('newOfficeDistrict').value.trim();

  try {
    const res = await fetch('/api/admin/offices', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, tagline, district })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showAlert(`Office "${name}" added successfully.`, 'success');
      toggleAddOfficeModal(false);
      document.getElementById('newOfficeName').value = '';
      document.getElementById('newOfficeTagline').value = '';
      document.getElementById('newOfficeDistrict').value = '';
      await loadOffices();
    } else {
      showAlert(data.message || 'Failed to add office.', 'danger');
    }
  } catch (err) {
    showAlert(err.message, 'danger');
  }
}

async function promptAddService(officeId) {
  const sName = prompt('Enter service name to offer at this center (e.g. Domicile Certificate):');
  if (!sName || !sName.trim()) return;

  try {
    const res = await fetch('/api/admin/services', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ officeId, serviceName: sName.trim() })
    });
    if (res.ok) {
      showAlert(`Service "${sName}" added to office.`, 'success');
      await loadOffices();
    }
  } catch (e) {
    showAlert(e.message, 'danger');
  }
}

async function promptAddCounter(officeId) {
  const cName = prompt('Enter counter name (e.g. Counter 3):');
  if (!cName || !cName.trim()) return;

  try {
    const res = await fetch('/api/admin/counters', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ officeId, name: cName.trim(), service: 'General Inquiries' })
    });
    if (res.ok) {
      showAlert(`Counter "${cName}" created.`, 'success');
      await loadOffices();
    }
  } catch (e) {
    showAlert(e.message, 'danger');
  }
}

// 6. Global Queue Monitor
async function loadQueueMonitor() {
  const office = document.getElementById('filterOffice')?.value || '';
  const service = document.getElementById('filterService')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';

  const params = new URLSearchParams();
  if (office) params.append('office', office);
  if (service) params.append('service', service);
  if (status) params.append('status', status);

  try {
    const res = await fetch(`/api/admin/queue-monitor?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return;
    const data = await res.json();

    // Update Governance Metrics
    if (data.metrics) {
      const m = data.metrics;
      const elCompleted = document.getElementById('metricTotalServed');
      const elWaiting = document.getElementById('metricWaiting');
      const elServing = document.getElementById('metricServing');

      if (elCompleted) elCompleted.textContent = m.completedCount || 0;
      if (elWaiting) elWaiting.textContent = m.waitingCount || 0;
      if (elServing) elServing.textContent = m.servingCount || 0;
    }

    // Render Table
    const tableBody = document.getElementById('adminQueueTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const tokens = data.tokens || [];
    if (tokens.length === 0) {
      tableBody.innerHTML = `
        <tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--text-dim);">No tokens match the selected filters.</td></tr>
      `;
      return;
    }

    tokens.forEach(t => {
      const tr = document.createElement('tr');
      const isOnline = t.type === 'ONLINE';

      let statusBadge = `<span class="badge badge-waiting">WAITING</span>`;
      if (t.status === 'SERVING') statusBadge = `<span class="badge badge-serving">SERVING</span>`;
      else if (t.status === 'COMPLETED') statusBadge = `<span class="badge badge-completed">COMPLETED</span>`;
      else if (t.status === 'NO_SHOW') statusBadge = `<span class="badge badge-noshow">NO-SHOW</span>`;
      else if (t.status === 'CANCELLED') statusBadge = `<span class="badge badge-noshow">CANCELLED</span>`;

      const timeStr = t.calledAt 
        ? new Date(t.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : (t.createdAt ? new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

      tr.innerHTML = `
        <td class="token-cell">${t.id}</td>
        <td>
          <span class="badge ${isOnline ? 'badge-online' : 'badge-walkin'}">${t.type}</span>
        </td>
        <td>
          <div style="font-weight:600;">${t.customerName || 'Citizen'}</div>
          <div style="font-size:0.75rem; color:var(--text-dim);">${t.mobile ? '******' + String(t.mobile).slice(-4) : '—'}</div>
        </td>
        <td>${t.service}</td>
        <td style="font-size:0.8rem; color:var(--text-muted);">${t.office || 'Rajkot Center'}</td>
        <td>${statusBadge}</td>
        <td><strong>${t.counter || '—'}</strong></td>
        <td style="font-size:0.8rem; color:var(--text-dim);">${timeStr}</td>
      `;
      tableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading queue monitor:', err);
  }
}

function resetFilters() {
  if (document.getElementById('filterOffice')) document.getElementById('filterOffice').value = '';
  if (document.getElementById('filterService')) document.getElementById('filterService').value = '';
  if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = '';
  loadQueueMonitor();
}

// 7. Audit Activity Logs
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/admin/logs?limit=25', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const logs = data.logs || [];

    const container = document.getElementById('activityLogsContainer');
    if (!container) return;
    container.innerHTML = '';

    if (logs.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim); font-size:0.85rem; padding:1rem;">No recent activity logs.</div>';
      return;
    }

    logs.forEach(l => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      const time = new Date(l.timestamp).toLocaleTimeString();
      const actor = l.actor ? `${l.actor.name} [${l.actor.role}]` : 'System';
      const detailsStr = typeof l.details === 'object' ? JSON.stringify(l.details) : l.details;

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.15rem;">
          <strong style="color:var(--blue-800);">${l.action}</strong>
          <span style="color:var(--text-dim); font-size:0.75rem;">${time}</span>
        </div>
        <div style="color:var(--text-muted); font-size:0.78rem;">
          By <strong>${actor}</strong> &bull; <span style="font-family:monospace;">${detailsStr}</span>
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) {}
}

// 8. Seed Demo Queue
async function handleSeedDemoQueue() {
  const btn = document.getElementById('btnSeedDemo');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Seeding...';
  }

  try {
    const res = await fetch('/api/queue/seed', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ force: true })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showAlert('⚡ Demo queue baseline seeded: A-40 Serving, A-41 to A-43 Waiting.', 'success');
      await refreshAdminData();
    } else {
      showAlert(data.message || 'Seeding failed.', 'danger');
    }
  } catch (err) {
    showAlert(err.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Seed Demo Queue';
    }
  }
}
