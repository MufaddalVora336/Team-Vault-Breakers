/**
 * QueueLess — Shared UI Utilities & Notification Engine
 */

// Toast notification helper
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    warning: '⚠',
    error: '✕',
    info: '🔔'
  };

  toast.innerHTML = `
    <span style="font-weight: 800; font-size: 1.1rem;">${icons[type] || '🔔'}</span>
    <div style="flex: 1; font-weight: 500;">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(15px) scale(0.95)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, duration);
}

// Global Demo Floating Controls & Presentation Shortcuts
document.addEventListener('DOMContentLoaded', () => {
  // Highlight active nav link based on current path
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && (currentPath.endsWith(href) || (href === 'index.html' && currentPath.endsWith('/')))) {
      link.classList.add('active');
    }
  });

  // Global keyboard shortcut for presenters:
  // Press Alt+R to Reset Demo Data
  // Press Alt+S to Simulate Queue Change
  window.addEventListener('keydown', async (e) => {
    if (e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      if (confirm('Reset QueueLess demo data to starting state?')) {
        await QueueEngine.resetDemoData();
        showToast('Demo data reset to Initial State (A-40 Serving, A-41 to A-43 Waiting).', 'info');
      }
    } else if (e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      try {
        const next = await QueueEngine.simulateQueueUpdate();
        if (next) {
          showToast(`Simulated: Now Serving ${next.id} (${next.service})`, 'success');
        } else {
          showToast('Simulated queue advance: completed current serving.', 'info');
        }
      } catch (err) {
        showToast(err.message, 'warning');
      }
    }
  });
});
