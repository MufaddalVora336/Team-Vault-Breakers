/**
 * QueueLess — Advance Appointment Booking Logic
 * Dedicated scheduled time slots, server-side persistence, and confirmation pass.
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('appointmentForm');
  const dateInput = document.getElementById('aptDate');
  const bookingCard = document.getElementById('aptBookingCard');
  const passCard = document.getElementById('aptPassCard');

  // Confirmation Pass Elements
  const passAptId = document.getElementById('passAptId');
  const passAptOffice = document.getElementById('passAptOffice');
  const passAptService = document.getElementById('passAptService');
  const passAptDateTime = document.getElementById('passAptDateTime');
  const passAptCitizen = document.getElementById('passAptCitizen');
  const btnBookAnother = document.getElementById('btnBookAnother');

  // Pre-fill tomorrow's date
  if (dateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
    dateInput.min = `${yyyy}-${mm}-${dd}`;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const office = document.getElementById('aptOffice').value;
      const service = document.getElementById('aptService').value;
      const date = dateInput.value;
      const slot = document.getElementById('aptSlot').value;
      const name = document.getElementById('aptName').value.trim();
      const mobile = document.getElementById('aptMobile').value.trim();

      if (!name) {
        showToast('Please enter your full name.', 'warning');
        return;
      }

      if (!mobile || mobile.length < 10) {
        showToast('Please enter a valid 10-digit mobile number.', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            office,
            service,
            date,
            slot,
            name,
            mobile
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          showToast(data.message || 'Failed to book appointment.', 'error');
          return;
        }

        const appointment = data.appointment;

        // Save local backup in localStorage
        try {
          const stored = JSON.parse(localStorage.getItem('queueless_appointments') || '[]');
          stored.unshift(appointment);
          localStorage.setItem('queueless_appointments', JSON.stringify(stored));
        } catch (err) {}

        // Display Confirmation Pass
        const maskedMobile = mobile.length >= 4 ? '******' + mobile.slice(-4) : '******3210';
        if (passAptId) passAptId.textContent = appointment.id;
        if (passAptOffice) passAptOffice.textContent = appointment.office;
        if (passAptService) passAptService.textContent = appointment.service;
        if (passAptDateTime) passAptDateTime.textContent = `${appointment.date} • ${appointment.slot}`;
        if (passAptCitizen) passAptCitizen.textContent = `${appointment.name} (${maskedMobile})`;

        if (bookingCard) bookingCard.style.display = 'none';
        if (passCard) passCard.style.display = 'block';

        showToast(`Appointment ${appointment.id} confirmed for ${appointment.slot}!`, 'success', 4500);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (btnBookAnother) {
    btnBookAnother.addEventListener('click', () => {
      if (bookingCard) bookingCard.style.display = 'block';
      if (passCard) passCard.style.display = 'none';
      if (form) form.reset();
      if (dateInput) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const yyyy = tomorrow.getFullYear();
        const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const dd = String(tomorrow.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
      }
    });
  }
});
