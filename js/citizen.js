/**
 * QueueLess — Citizen Portal Logic
 * Virtual Token Generation, Smart Document Readiness, Real Firebase Phone OTP Verification,
 * and Real-time Queue Tracking.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Service Document Checklist Mapping for Smart Service Readiness
  const SERVICE_DOCUMENTS = {
    'Income Certificate': [
      'Aadhaar Card (UIDAI)',
      'Address Proof (Electricity Bill / Ration Card)',
      'Income Proof (Salary Slip / Form 16 / ITR)',
      'Passport-size Photograph'
    ],
    'Residence Certificate': [
      'Aadhaar Card (UIDAI)',
      'Electricity Bill / Water Bill',
      'Ration Card / Voter ID',
      'Passport-size Photograph'
    ],
    'Birth Certificate': [
      'Hospital Discharge / Birth Slip',
      "Mother's Aadhaar Card",
      "Father's Aadhaar Card",
      'Marriage Registration Certificate'
    ],
    'Caste Certificate': [
      'Aadhaar Card (UIDAI)',
      'School Leaving Certificate (LC)',
      "Father's Caste Certificate",
      'Self-Declaration Affidavit'
    ],
    'Land Records & RoR (7/12)': [
      'Aadhaar Card (UIDAI)',
      'Survey Number / Khata Number',
      'Prior Land Ownership Deed',
      'Property Tax Receipt'
    ]
  };

  const serviceSelect = document.getElementById('citizenServiceSelect');
  const readinessDocList = document.getElementById('readinessDocList');
  const readinessScoreBadge = document.getElementById('readinessScoreBadge');
  const mobileInput = document.getElementById('citizenMobile');
  const btnGetToken = document.getElementById('btnGetToken');

  // OTP Modal Elements
  const otpModal = document.getElementById('otpModal');
  const btnVerifyOtp = document.getElementById('btnVerifyOtp');
  const btnCancelOtp = document.getElementById('btnCancelOtp');
  const btnCancelOtpModal = document.getElementById('btnCancelOtpModal');
  const btnResendOtp = document.getElementById('btnResendOtp');
  const otpInputs = document.querySelectorAll('.otp-digit');
  const otpStatusBanner = document.getElementById('otpStatusBanner');
  const otpTargetPhone = document.getElementById('otpTargetPhone');

  // Containers
  const bookingSection = document.getElementById('bookingSection');
  const tokenDashboardSection = document.getElementById('tokenDashboardSection');

  let currentBookingData = null;
  let previousPeopleAhead = null;
  let confirmationResult = null;
  let resendTimerInterval = null;
  let isFirebaseConfigured = false;

  // ==========================================
  // Firebase Client Initialization
  // ==========================================

  async function initFirebaseClient() {
    try {
      const active = typeof window.loadActiveFirebaseConfig === 'function'
        ? await window.loadActiveFirebaseConfig()
        : { configured: false, config: null };

      if (active && active.configured && active.config) {
        isFirebaseConfigured = true;
        if (typeof firebase !== 'undefined' && !firebase.apps.length) {
          firebase.initializeApp(active.config);
          console.log(`[FIREBASE CLIENT] Initialized successfully (${active.source}) for project:`, active.config.projectId);
        }
      } else {
        isFirebaseConfigured = false;
        console.info('[FIREBASE CLIENT] Firebase credentials pending in .env or js/firebase-config.js.');
      }
    } catch (err) {
      isFirebaseConfigured = false;
      console.warn('[FIREBASE CLIENT] Error initializing Firebase:', err.message);
    }
  }

  // Ensure DOM container is completely clean so grecaptcha never throws duplicate render errors
  function resetRecaptchaContainer() {
    const oldContainer = document.getElementById('recaptcha-container');
    if (oldContainer && oldContainer.parentNode) {
      const newContainer = document.createElement('div');
      newContainer.id = 'recaptcha-container';
      oldContainer.parentNode.replaceChild(newContainer, oldContainer);
    }
  }

  function cleanupRecaptcha() {
    if (window.recaptchaVerifier) {
      try {
        if (typeof window.recaptchaVerifier.clear === 'function') {
          window.recaptchaVerifier.clear();
        }
      } catch (e) {
        console.warn('[RECAPTCHA] Error clearing verifier:', e.message);
      }
      window.recaptchaVerifier = null;
    }
    resetRecaptchaContainer();
  }

  function getOrInitRecaptcha() {
    if (typeof firebase === 'undefined' || !isFirebaseConfigured) return null;

    if (window.recaptchaVerifier) {
      return window.recaptchaVerifier;
    }

    resetRecaptchaContainer();

    try {
      window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible',
        callback: () => {
          // Invisible reCAPTCHA successfully solved
        },
        'expired-callback': () => {
          showOtpBanner('reCAPTCHA verification expired. Please request a new SMS code.', 'warning');
          cleanupRecaptcha();
        }
      });
      return window.recaptchaVerifier;
    } catch (err) {
      console.warn('[RECAPTCHA] Init error:', err.message);
      cleanupRecaptcha();
      return null;
    }
  }

  function showOtpBanner(message, type = 'info') {
    if (!otpStatusBanner) return;
    if (!message) {
      otpStatusBanner.style.display = 'none';
      otpStatusBanner.textContent = '';
      otpStatusBanner.className = 'otp-status-banner';
      return;
    }
    otpStatusBanner.className = `otp-status-banner ${type}`;
    otpStatusBanner.textContent = message;
    otpStatusBanner.style.display = 'block';
  }

  function startResendCountdown(seconds = 30) {
    const timerEl = document.getElementById('resendTimer');
    const countdownText = document.getElementById('resendCountdownText');
    if (!timerEl || !btnResendOtp) return;

    if (resendTimerInterval) clearInterval(resendTimerInterval);

    let remaining = seconds;
    btnResendOtp.disabled = true;
    if (countdownText) countdownText.style.display = 'inline';
    timerEl.textContent = remaining;

    resendTimerInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimerInterval);
        btnResendOtp.disabled = false;
        if (countdownText) countdownText.style.display = 'none';
      } else {
        timerEl.textContent = remaining;
      }
    }, 1000);
  }

  async function sendFirebaseSms(phoneNumber) {
    if (!isFirebaseConfigured || typeof firebase === 'undefined') {
      showOtpBanner('⚠️ Firebase Phone Auth is not configured. Please supply Firebase credentials in .env. Real SMS cannot be dispatched without configuration.', 'warning');
      return false;
    }

    if (window.location.hostname === '127.0.0.1') {
      showOtpBanner('⚠️ Notice: You are accessing via 127.0.0.1. Firebase Authentication authorized domains only permit "localhost" by default. If verification fails, please access via http://localhost:3000/citizen.html or add 127.0.0.1 in Firebase Console.', 'warning');
    }

    const verifier = getOrInitRecaptcha();
    if (!verifier) {
      showOtpBanner('Failed to initialize reCAPTCHA verifier. Please refresh the page.', 'error');
      return false;
    }

    showOtpBanner(`Sending verification code via SMS to ${phoneNumber}...`, 'info');

    try {
      confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, verifier);
      showOtpBanner(`SMS verification code sent to ${phoneNumber}. Please enter the 6-digit code below.`, 'success');
      startResendCountdown(30);
      return true;
    } catch (err) {
      console.error('[FIREBASE SMS ERROR]', err);
      let userMsg = 'Failed to send SMS code.';
      if (err.code === 'auth/invalid-phone-number') {
        userMsg = 'Invalid phone number format. Must be an Indian 10-digit mobile number (+91).';
      } else if (err.code === 'auth/invalid-api-key') {
        userMsg = 'Invalid Firebase API key. Please check your FIREBASE_CLIENT_API_KEY in .env.';
      } else if (err.code === 'auth/unauthorized-domain') {
        userMsg = 'Domain not authorized in Firebase Console. Please access via http://localhost:3000/citizen.html (not 127.0.0.1) or add 127.0.0.1 in Firebase Console > Authentication > Settings > Authorized domains.';
      } else if (err.code === 'auth/operation-not-allowed') {
        userMsg = 'Phone sign-in is not enabled for project queueless-25589 in Firebase Console. Go to Authentication > Sign-in method > Phone, enable it, and click Save.';
      } else if (err.code === 'auth/quota-exceeded') {
        userMsg = 'Firebase SMS quota exceeded. Use configured test phone numbers (e.g. +91 9876543210 with code 123456) in Firebase Console.';
      } else if (err.code === 'auth/too-many-requests') {
        userMsg = 'Too many requests. Firebase has temporarily rate-limited this device. Please wait a few minutes or use a test phone number.';
      } else if (err.code === 'auth/captcha-check-failed' || (err.message && err.message.includes('reCAPTCHA'))) {
        userMsg = 'reCAPTCHA check failed. A fresh reCAPTCHA has been loaded — please try again.';
      } else if (err.code === 'auth/network-request-failed') {
        userMsg = 'Network error connecting to Firebase Authentication servers.';
      } else if (err.message) {
        userMsg = err.message;
      }

      showOtpBanner(userMsg, 'error');
      cleanupRecaptcha();
      return false;
    }
  }

  // ==========================================
  // Smart Document Readiness Checklist
  // ==========================================

  function updateReadinessChecklist() {
    if (!serviceSelect || !readinessDocList) return;
    const selectedService = serviceSelect.value;
    const docs = SERVICE_DOCUMENTS[selectedService] || SERVICE_DOCUMENTS['Income Certificate'];

    readinessDocList.innerHTML = '';
    docs.forEach((doc, idx) => {
      const li = document.createElement('li');
      li.className = 'doc-item';
      li.innerHTML = `
        <input type="checkbox" id="doc_${idx}" class="doc-checkbox" checked>
        <label for="doc_${idx}" style="cursor: pointer; color: var(--text-main); font-weight: 500;">✓ ${doc}</label>
      `;
      readinessDocList.appendChild(li);
    });

    updateReadinessScore();

    readinessDocList.querySelectorAll('.doc-checkbox').forEach(cb => {
      cb.addEventListener('change', updateReadinessScore);
    });
  }

  function updateReadinessScore() {
    if (!readinessDocList || !readinessScoreBadge) return;
    const checkboxes = readinessDocList.querySelectorAll('.doc-checkbox');
    const checked = Array.from(checkboxes).filter(cb => cb.checked).length;
    const total = checkboxes.length;
    const pct = total > 0 ? Math.round((checked / total) * 100) : 100;

    readinessScoreBadge.textContent = `Readiness Score: ${pct}%`;
    if (pct === 100) {
      readinessScoreBadge.style.color = '#15803d';
      readinessScoreBadge.style.backgroundColor = '#ecfdf5';
      readinessScoreBadge.style.borderColor = '#a7f3d0';
    } else {
      readinessScoreBadge.style.color = '#b45309';
      readinessScoreBadge.style.backgroundColor = '#fffbeb';
      readinessScoreBadge.style.borderColor = '#fde68a';
    }
  }

  if (serviceSelect) {
    serviceSelect.addEventListener('change', updateReadinessChecklist);
    updateReadinessChecklist();
  }

  // OTP Input Auto-focus Navigation
  if (otpInputs.length) {
    otpInputs.forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        if (e.target.value.length === 1 && idx < otpInputs.length - 1) {
          otpInputs[idx + 1].focus();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
          otpInputs[idx - 1].focus();
        }
      });
    });
  }

  // ==========================================
  // Trigger OTP Verification Modal
  // ==========================================

  if (btnGetToken) {
    btnGetToken.addEventListener('click', async (e) => {
      e.preventDefault();
      const office = document.getElementById('citizenOfficeSelect').value;
      const service = serviceSelect.value;
      let rawMobile = mobileInput.value.trim().replace(/\D/g, '');

      // Normalize Indian mobile numbers if entered with leading +91 or 0
      if (rawMobile.length === 12 && rawMobile.startsWith('91')) {
        rawMobile = rawMobile.slice(2);
      } else if (rawMobile.length === 11 && rawMobile.startsWith('0')) {
        rawMobile = rawMobile.slice(1);
      }

      // Indian Mobile Number Validation: 10 digits starting with 6, 7, 8, or 9
      if (rawMobile.length !== 10 || !/^[6-9]\d{9}$/.test(rawMobile)) {
        showToast('Please enter a valid 10-digit Indian mobile number (e.g. 9876543210, starting with 6–9).', 'warning');
        mobileInput.focus();
        return;
      }

      // Anti-abuse check
      if (QueueEngine.hasActiveTokenForService(rawMobile, service)) {
        showToast(`You already have an active token for ${service}. QueueLess limits 1 active token per service to prevent abuse.`, 'warning', 4500);
        return;
      }

      // Check document readiness
      const checkboxes = readinessDocList.querySelectorAll('.doc-checkbox');
      const unchecked = Array.from(checkboxes).filter(cb => !cb.checked);
      if (unchecked.length > 0) {
        const proceed = confirm(`Notice: You have unchecked ${unchecked.length} required document(s). Do you still wish to proceed?`);
        if (!proceed) return;
      }

      const formattedPhone = `+91${rawMobile}`;
      currentBookingData = {
        type: 'ONLINE',
        office,
        service,
        mobile: rawMobile,
        formattedPhone,
        customerName: 'Citizen'
      };

      if (otpTargetPhone) {
        otpTargetPhone.textContent = `+91 ${rawMobile.slice(0, 5)} ${rawMobile.slice(5)}`;
      }

      otpModal.classList.add('active');
      otpInputs.forEach(i => i.value = '');
      if (otpInputs[0]) otpInputs[0].focus();

      btnGetToken.disabled = true;
      btnGetToken.textContent = 'Sending SMS...';

      await sendFirebaseSms(formattedPhone);

      btnGetToken.disabled = false;
      btnGetToken.textContent = 'Verify Mobile & Get Token';
    });
  }

  // Resend OTP Button (Guarded against multi-clicks while cooldown active)
  if (btnResendOtp) {
    btnResendOtp.addEventListener('click', async () => {
      if (btnResendOtp.disabled) return;
      if (!currentBookingData) return;
      cleanupRecaptcha();
      await sendFirebaseSms(currentBookingData.formattedPhone);
    });
  }

  // Close OTP Modal
  function closeOtpModal() {
    otpModal.classList.remove('active');
    showOtpBanner('');
    confirmationResult = null;
    if (resendTimerInterval) clearInterval(resendTimerInterval);
    cleanupRecaptcha();
    currentBookingData = null;
  }

  if (btnCancelOtp) btnCancelOtp.addEventListener('click', closeOtpModal);
  if (btnCancelOtpModal) btnCancelOtpModal.addEventListener('click', closeOtpModal);

  // ==========================================
  // Verify OTP & Issue Token
  // ==========================================

  if (btnVerifyOtp) {
    btnVerifyOtp.addEventListener('click', async () => {
      let enteredOtp = '';
      otpInputs.forEach(inp => enteredOtp += inp.value.trim());

      if (enteredOtp.length !== 6) {
        showOtpBanner('Please enter the full 6-digit verification code.', 'warning');
        return;
      }

      if (!isFirebaseConfigured && !confirmationResult) {
        showOtpBanner('Firebase Phone Auth credentials are not configured in .env. Please configure Firebase credentials in .env (see .env.example). Token creation is blocked until real verification is configured.', 'error');
        return;
      }

      if (!confirmationResult) {
        showOtpBanner('No active verification session found. Please click Resend OTP to request a verification code.', 'warning');
        return;
      }

      btnVerifyOtp.disabled = true;
      btnVerifyOtp.textContent = 'Verifying Code...';

      try {
        let idToken = null;

        if (confirmationResult) {
          // Genuine Firebase verification (handles both live carrier SMS and Firebase test numbers)
          const userCredential = await confirmationResult.confirm(enteredOtp);
          idToken = await userCredential.user.getIdToken();
          showOtpBanner('Phone verified successfully!', 'success');
        }

        // Call server to issue token with verified credentials
        const token = await QueueEngine.addToken({
          ...currentBookingData,
          idToken
        });

        closeOtpModal();
        showToast(`Token ${token.id} issued successfully!`, 'success');
        renderCitizenView();
      } catch (err) {
        console.error('[FIREBASE OTP CONFIRM ERROR]', err);
        if (err.code === 'auth/invalid-verification-code') {
          showOtpBanner('Incorrect verification code. Please check your SMS code or configured test code (e.g. 123456).', 'error');
        } else if (err.code === 'auth/code-expired') {
          showOtpBanner('Verification code has expired. Please click Resend OTP to get a new code.', 'error');
        } else {
          showOtpBanner(err.message || 'Verification failed. Please try again.', 'error');
        }
      } finally {
        btnVerifyOtp.disabled = false;
        btnVerifyOtp.textContent = 'Verify & Get Token';
      }
    });
  }

  // ==========================================
  // Render Citizen Portal View
  // ==========================================

  function renderCitizenView() {
    const activeTokenId = QueueEngine.getActiveCitizenTokenId();

    if (!activeTokenId) {
      if (bookingSection) bookingSection.style.display = 'block';
      if (tokenDashboardSection) tokenDashboardSection.style.display = 'none';
      return;
    }

    const metrics = QueueEngine.getTokenMetrics(activeTokenId);
    if (!metrics) {
      QueueEngine.clearActiveCitizenTokenId();
      if (bookingSection) bookingSection.style.display = 'block';
      if (tokenDashboardSection) tokenDashboardSection.style.display = 'none';
      return;
    }

    if (bookingSection) bookingSection.style.display = 'none';
    if (tokenDashboardSection) tokenDashboardSection.style.display = 'block';

    const { token, peopleAhead, estimatedMinutes, status, arrivalWindow } = metrics;

    if (previousPeopleAhead !== null && peopleAhead < previousPeopleAhead) {
      if (peopleAhead === 0) {
        showToast(`🔔 Your Turn! Please proceed to ${token.counter || 'Counter 2'}.`, 'success', 5000);
      } else if (peopleAhead === 1) {
        showToast('🔔 Almost Your Turn: You have 1 person ahead.', 'info', 4000);
      } else {
        showToast(`🔔 Queue Update: You have ${peopleAhead} people ahead of you.`, 'info', 4000);
      }
    }
    previousPeopleAhead = peopleAhead;

    // Populate Hero Details
    document.getElementById('myTokenId').textContent = token.id;
    document.getElementById('myServiceBadge').textContent = token.service;
    document.getElementById('myOfficeBadge').textContent = token.office;

    // Status Badge
    const myStatusBadge = document.getElementById('myStatusBadge');
    if (myStatusBadge) {
      myStatusBadge.className = `badge badge-${status.toLowerCase()}`;
      myStatusBadge.textContent = status;
      if (status === 'SERVING') {
        myStatusBadge.innerHTML = `<span class="pulse-dot"></span> NOW SERVING`;
      }
    }

    // Metric Cards
    document.getElementById('metricPeopleAhead').textContent = status === 'SERVING' ? '0 (Now Serving)' : peopleAhead;
    document.getElementById('metricWaitTime').textContent = status === 'SERVING' ? '0 min' : (peopleAhead === 0 ? 'Your Turn Next' : `${estimatedMinutes} min`);
    
    const state = QueueEngine.getState();
    const currentServingText = state.currentServing ? `${state.currentServing.id} (${state.currentServing.counter || 'Counter 2'})` : 'Idle';
    document.getElementById('metricCurrentServing').textContent = currentServingText;

    // Arrival Window
    document.getElementById('arrivalWindowText').textContent = status === 'SERVING' 
      ? `Please proceed immediately to ${token.counter || 'Counter 2'}`
      : arrivalWindow;

    renderQueuePipeline(token, state);
  }

  // Render Visual Queue Progress Pipeline
  function renderQueuePipeline(userToken, state) {
    const pipelineTrack = document.getElementById('pipelineTrack');
    if (!pipelineTrack) return;

    pipelineTrack.innerHTML = '';

    if (state.currentServing) {
      const servingNode = document.createElement('div');
      const isUserServing = state.currentServing.id === userToken.id;
      servingNode.className = `pipeline-node ${isUserServing ? 'node-you node-serving' : 'node-serving'}`;
      servingNode.innerHTML = `
        <div class="pipeline-bubble">${state.currentServing.id}</div>
        <div class="pipeline-label">${isUserServing ? 'YOU (SERVING)' : 'Serving'}</div>
      `;
      pipelineTrack.appendChild(servingNode);
    }

    const waitingTokens = state.tokens.filter(t => t.status === 'WAITING');
    const userIndex = waitingTokens.findIndex(t => t.id === userToken.id);

    const visibleTokens = userIndex !== -1 ? waitingTokens.slice(0, userIndex + 1) : waitingTokens.slice(0, 4);

    visibleTokens.forEach((t) => {
      const arrow = document.createElement('div');
      arrow.className = 'pipeline-arrow';
      arrow.textContent = '→';
      pipelineTrack.appendChild(arrow);

      const isMe = t.id === userToken.id;
      const node = document.createElement('div');
      node.className = `pipeline-node ${isMe ? 'node-you' : 'node-waiting'}`;
      node.innerHTML = `
        <div class="pipeline-bubble">${t.id}</div>
        <div class="pipeline-label">${isMe ? 'YOU' : 'Waiting'}</div>
      `;
      pipelineTrack.appendChild(node);
    });
  }

  // Cancel Token Button
  const btnCancelToken = document.getElementById('btnCancelToken');
  if (btnCancelToken) {
    btnCancelToken.addEventListener('click', async () => {
      const activeTokenId = QueueEngine.getActiveCitizenTokenId();
      if (!activeTokenId) return;

      if (confirm(`Are you sure you want to cancel token ${activeTokenId}?`)) {
        try {
          await QueueEngine.cancelToken(activeTokenId);
          showToast(`Token ${activeTokenId} cancelled successfully.`, 'info');
          previousPeopleAhead = null;
          renderCitizenView();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  }

  // Digital Pass Modal Trigger
  const btnViewPass = document.getElementById('btnViewPass');
  const passModal = document.getElementById('passModal');
  const btnClosePass = document.getElementById('btnClosePass');
  if (btnViewPass && passModal) {
    btnViewPass.addEventListener('click', () => {
      const activeTokenId = QueueEngine.getActiveCitizenTokenId();
      if (!activeTokenId) return;
      const metrics = QueueEngine.getTokenMetrics(activeTokenId);
      if (metrics) {
        document.getElementById('passTokenId').textContent = metrics.token.id;
        document.getElementById('passService').textContent = metrics.token.service;
        const rawMobile = metrics.token.mobile || '';
        const masked = rawMobile.length >= 4 ? '+91 ******' + rawMobile.slice(-4) : '+91 ******3210';
        document.getElementById('passMobile').textContent = masked;
        document.getElementById('passArrival').textContent = metrics.arrivalWindow;
        passModal.classList.add('active');
      }
    });
  }

  if (btnClosePass && passModal) {
    btnClosePass.addEventListener('click', () => {
      passModal.classList.remove('active');
    });
  }

  // Simulate Button on Citizen page
  const btnCitizenSimulate = document.getElementById('btnCitizenSimulate');
  if (btnCitizenSimulate) {
    btnCitizenSimulate.addEventListener('click', async () => {
      try {
        const next = await QueueEngine.simulateQueueUpdate();
        if (next) {
          showToast(`Queue advanced: Now Serving ${next.id}`, 'info');
        } else {
          showToast('Queue advanced.', 'info');
        }
      } catch (err) {
        showToast(err.message, 'warning');
      }
    });
  }

  window.addEventListener('queueless:updated', () => {
    renderCitizenView();
  });

  // Initialize Firebase Client
  initFirebaseClient();

  // Initial load
  renderCitizenView();
});
