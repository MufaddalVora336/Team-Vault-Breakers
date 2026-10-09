/**
 * QueueLess — Officer Dashboard Logic
 * Unified Live Queue, Now Serving Callout, Offline Walk-in Modal, and Queue Operations.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statWaiting = document.getElementById('statWaiting');
  const statServing = document.getElementById('statServing');
  const statCompleted = document.getElementById('statCompleted');
  const statWalkins = document.getElementById('statWalkins');

  // Serving Hero Banner
  const servingTokenNumber = document.getElementById('servingTokenNumber');
  const servingCounterName = document.getElementById('servingCounterName');
  const servingDetails = document.getElementById('servingDetails');
  const btnCallNext = document.getElementById('btnCallNext');
  const btnCompleteCurrent = document.getElementById('btnCompleteCurrent');

  // Unified Queue Table Body
  const queueTableBody = document.getElementById('queueTableBody');

  // Walk-in Modal Elements
  const btnOpenWalkinModal = document.getElementById('btnOpenWalkinModal');
  const walkinModal = document.getElementById('walkinModal');
  const btnCloseWalkinModal = document.getElementById('btnCloseWalkinModal');
  const btnAddWalkin = document.getElementById('btnAddWalkin');
  const walkinNameInput = document.getElementById('walkinName');
  const walkinMobileInput = document.getElementById('walkinMobile');
  const walkinServiceSelect = document.getElementById('walkinService');

  // Slip Issued Confirmation Card inside modal
  const walkinFormContainer = document.getElementById('walkinFormContainer');
  const walkinSlipContainer = document.getElementById('walkinSlipContainer');
  const slipTokenId = document.getElementById('slipTokenId');
  const slipCustomerName = document.getElementById('slipCustomerName');
  const slipService = document.getElementById('slipService');
  const btnPrintSlipDone = document.getElementById('btnPrintSlipDone');

  // Demo Controls
  const btnSimulateOfficer = document.getElementById('btnSimulateOfficer');
  const btnResetDemo = document.getElementById('btnResetDemo');

  // Render Dashboard
  function renderOfficerDashboard() {
    const state = QueueEngine.getState();
    const stats = QueueEngine.getStats();

    // Stats
    if (statWaiting) statWaiting.textContent = stats.waiting;
    if (statServing) statServing.textContent = stats.serving;
    if (statCompleted) statCompleted.textContent = stats.completed;
    if (statWalkins) statWalkins.textContent = stats.walkins;

    // Serving Banner
    if (state.currentServing && state.currentServing.status === 'SERVING') {
      servingTokenNumber.textContent = state.currentServing.id;
      servingCounterName.textContent = state.currentServing.counter || 'Counter 2';
      servingDetails.innerHTML = `
        <strong>${state.currentServing.customerName || 'Citizen'}</strong> &bull; 
        ${state.currentServing.service} &bull; 
        <span class="badge ${state.currentServing.type === 'ONLINE' ? 'badge-online' : 'badge-walkin'}">${state.currentServing.type}</span>
      `;
      btnCompleteCurrent.disabled = false;
    } else {
      servingTokenNumber.textContent = 'None';
      servingCounterName.textContent = 'Counter 2 — Standby';
      servingDetails.textContent = 'No customer currently being served. Click CALL NEXT to proceed.';
      btnCompleteCurrent.disabled = true;
    }

    // Call Next button state
    if (btnCallNext) {
      btnCallNext.disabled = stats.waiting === 0;
    }

    // Render Unified Queue Table
    if (queueTableBody) {
      queueTableBody.innerHTML = '';

      if (state.tokens.length === 0) {
        queueTableBody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-dim);">
              No customers in queue. Click <strong>+ Add Offline Walk-in</strong> or wait for online citizens.
            </td>
          </tr>
        `;
        return;
      }

      state.tokens.forEach((token, index) => {
        const tr = document.createElement('tr');
        const waitMinutes = (index + 1) * 5;
        const isOnline = token.type === 'ONLINE';
        const masked = (token.mobile && token.mobile.length >= 4) ? '******' + token.mobile.slice(-4) : (token.mobile ? '******' : '—');

        tr.innerHTML = `
          <td class="token-cell">${token.id}</td>
          <td>
            <span class="badge ${isOnline ? 'badge-online' : 'badge-walkin'}">
              ${isOnline ? 'Online' : 'Walk-in'}
            </span>
          </td>
          <td>
            <div style="font-weight: 600;">${token.customerName}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${masked}</div>
          </td>
          <td>${token.service}</td>
          <td>
            <span class="badge badge-waiting">Waiting</span>
          </td>
          <td style="font-weight: 700; color: #0284c7;">${waitMinutes} min</td>
          <td>
            <div style="display: flex; gap: 0.35rem;">
              <button class="btn btn-sm btn-primary btn-call-row" data-id="${token.id}">
                Call
              </button>
              <button class="btn btn-sm btn-warning btn-noshow-row" data-id="${token.id}">
                No-Show
              </button>
              <button class="btn btn-sm btn-danger btn-cancel-row" data-id="${token.id}">
                ✕
              </button>
            </div>
          </td>
        `;
        queueTableBody.appendChild(tr);
      });

      // Attach row action listeners
      queueTableBody.querySelectorAll('.btn-call-row').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          handleDirectCall(id);
        });
      });

      queueTableBody.querySelectorAll('.btn-noshow-row').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (confirm(`Mark Token ${id} as No-Show?`)) {
            try {
              await QueueEngine.markNoShow(id);
              showToast(`Token ${id} marked as No-Show.`, 'warning');
              renderOfficerDashboard();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        });
      });

      queueTableBody.querySelectorAll('.btn-cancel-row').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (confirm(`Cancel and remove Token ${id}?`)) {
            try {
              await QueueEngine.cancelToken(id);
              showToast(`Token ${id} removed from queue.`, 'info');
              renderOfficerDashboard();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        });
      });
    }
  }

  // Handle Calling Next Customer
  async function handleCallNext() {
    try {
      const called = await QueueEngine.callNext('Counter 2');
      showToast(`📢 NOW SERVING: ${called.id} at Counter 2 (${called.service})`, 'success', 4500);
      renderOfficerDashboard();
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  // Handle Calling a specific waiting customer directly
  async function handleDirectCall(tokenId) {
    try {
      const called = await QueueEngine.callNext('Counter 2', tokenId);
      showToast(`📢 NOW SERVING: ${called.id} at Counter 2 (${called.service})`, 'success', 4500);
      renderOfficerDashboard();
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  // Handle Completing Current Customer
  async function handleComplete() {
    try {
      const completed = await QueueEngine.completeCurrent();
      showToast(`Customer ${completed.id} marked as Completed. Ready for next citizen.`, 'success');
      renderOfficerDashboard();
    } catch (err) {
      showToast(err.message, 'warning');
    }
  }

  // Attach primary action listeners
  if (btnCallNext) {
    btnCallNext.addEventListener('click', handleCallNext);
  }

  if (btnCompleteCurrent) {
    btnCompleteCurrent.addEventListener('click', handleComplete);
  }

  // Open Walk-in Modal
  if (btnOpenWalkinModal && walkinModal) {
    btnOpenWalkinModal.addEventListener('click', () => {
      // Pre-fill demo data for the fastest video demo recording!
      walkinNameInput.value = 'Rahul Patel';
      walkinMobileInput.value = '9876543210';
      walkinServiceSelect.value = 'Income Certificate';

      walkinFormContainer.style.display = 'block';
      walkinSlipContainer.style.display = 'none';
      walkinModal.classList.add('active');
    });
  }

  if (btnCloseWalkinModal && walkinModal) {
    btnCloseWalkinModal.addEventListener('click', () => {
      walkinModal.classList.remove('active');
    });
  }

  // Submit Offline Walk-in Customer
  if (btnAddWalkin) {
    btnAddWalkin.addEventListener('click', async () => {
      const name = walkinNameInput.value.trim();
      const mobile = walkinMobileInput.value.trim();
      const service = walkinServiceSelect.value;

      if (!name) {
        showToast('Please enter customer name.', 'warning');
        walkinNameInput.focus();
        return;
      }

      if (!mobile || mobile.length < 10) {
        showToast('Please enter customer 10-digit mobile number.', 'warning');
        walkinMobileInput.focus();
        return;
      }

      try {
        const token = await QueueEngine.addToken({
          type: 'WALK-IN',
          service,
          office: 'Rajkot District Service Center',
          customerName: name,
          mobile
        });

        // Show Physical Token Slip View inside modal
        walkinFormContainer.style.display = 'none';
        walkinSlipContainer.style.display = 'block';
        slipTokenId.textContent = token.id;
        slipCustomerName.textContent = token.customerName;
        slipService.textContent = token.service;

        showToast(`Walk-in customer ${token.customerName} issued physical token ${token.id}. Added to unified queue!`, 'success', 4000);
        renderOfficerDashboard();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Close slip view
  if (btnPrintSlipDone && walkinModal) {
    btnPrintSlipDone.addEventListener('click', () => {
      walkinModal.classList.remove('active');
    });
  }

  // Simulation Button on Officer Console
  if (btnSimulateOfficer) {
    btnSimulateOfficer.addEventListener('click', async () => {
      try {
        const next = await QueueEngine.simulateQueueUpdate();
        if (next) {
          showToast(`Simulated: Called ${next.id} to Counter 2`, 'info');
        } else {
          showToast('Simulated: Completed current customer.', 'info');
        }
        renderOfficerDashboard();
      } catch (err) {
        showToast(err.message, 'warning');
      }
    });
  }

  // Reset Demo Data Button
  if (btnResetDemo) {
    btnResetDemo.addEventListener('click', async () => {
      if (confirm('Reset QueueLess demo to step 1 initial data?')) {
        await QueueEngine.resetDemoData();
        showToast('Demo data reset to clean initial state.', 'info');
        renderOfficerDashboard();
      }
    });
  }

  // Real-time synchronization
  window.addEventListener('queueless:updated', () => {
    renderOfficerDashboard();
  });

  // Initial render
  renderOfficerDashboard();
});
