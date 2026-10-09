# QueueLess — Virtual Queue & Appointment Management System

> **Tagline:** *Join the Queue. Not the Crowd.*  
> **Problem Statement:** PS-02 — Virtual Queue & Appointment Management System for Government Offices  
> **Hackathon Prototype MVP:** 36-Hour Working Build  

---

## 🚀 Quick Start (Instant Run)

QueueLess requires **zero external npm dependencies** to run.

### Running with Node.js Server (Real-Time Terminal Observability)
Open a terminal in the project directory:
```bash
npm start
# OR
node server.js
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

> 🖥️ **Watch Your Terminal:**  
> The Node.js server prints detailed, formatted, real-time activity logs to the CMD/terminal whenever users interact with the system (token creation, walk-in registration, counter calls, completions, etc.).

### Running Automated Test Suites
- **Phase 1 Flow Test:**
  ```bash
  node test-flow.js
  ```
- **Phase 2 MongoDB & Firebase Integration Test:**
  ```bash
  node test-phase2.js
  ```

---

## ⚙️ Configuration (.env)

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Supply your real credentials for MongoDB Atlas and Firebase Phone Authentication. When unconfigured, QueueLess runs safely in file persistence fallback mode without crashing.

---

## 🖥️ Real-Time Terminal Activity Logging

Whenever you interact with QueueLess, the server displays structured administrative logs:

### 1. Server Startup
```
==================================================
QUEUELESS SERVER
================

Server Status : RUNNING
Environment   : Development
Port          : 3000
Storage       : JSON File Persistence (data/queue.json, data/appointments.json)
Started At    : 09 Oct 2026, 18:32:37
==================================================

QueueLess API is ready.
```

### 2. Citizen Token Created
```
--------------------------------------------------
[TOKEN CREATED]
Time          : 23:27:42
Token         : A-44
Type          : ONLINE
Service       : Income Certificate
Office        : Rajkot District Service Center
Mobile        : ******3210
People Ahead  : 3
Estimated Wait: 15 min
Status        : WAITING
--------------------------------------------------
```

### 3. Officer Adds Walk-in
```
--------------------------------------------------
[WALK-IN ADDED]
Time       : 23:29:10
Token      : A-45
Type       : WALK-IN
Customer   : Rahul Patel
Service    : Income Certificate
Office     : Rajkot District Service Center
Added By   : Officer
Queue Pos  : 5
ETA        : 25 min
Status     : WAITING
--------------------------------------------------
```

### 4. Officer Calls Next Citizen
```
--------------------------------------------------
[QUEUE ACTION]
Time       : 23:30:04
Action     : CALL NEXT
Token      : A-41
Service    : Income Certificate
Previous   : WAITING
Current    : CALLED / SERVING
Counter    : Counter 2
--------------------------------------------------
```

### 5. Officer Completes Customer
```
--------------------------------------------------
[SERVICE COMPLETED]
Time       : 23:35:18
Token      : A-41
Service    : Income Certificate
Counter    : Counter 2
Duration   : 05 min
Status     : COMPLETED
Next Queue : A-42
--------------------------------------------------
```

---

## 🎬 60-Second Hackathon Demo Script

The prototype is engineered to support the exact official hackathon demo flow with 100% stability.

> 💡 **Dual-Screen Split View (`demo-split.html`):**  
> Displays the **Citizen Portal** on the left and the **Officer Console** on the right side-by-side. Every action synchronizes in real time across the two screens without needing to switch tabs!

| Step | Action | Expected Result | Terminal Log |
|---|---|---|---|
| **Step 1** | Open `demo-split.html` or `index.html`. | Clean, practical government civic-tech dashboard. | `GET /api/queue` |
| **Step 2** | In Citizen Portal, select **Rajkot District Service Center** & **Income Certificate**. | Document checklist shows 4 required documents (Readiness Score: 100%). | &mdash; |
| **Step 3** | Enter mobile `9876543210` and verify with OTP `123456`. | Verification succeeds. | `[AUTH] OTP verification: SUCCESS` |
| **Step 4** | Click **Verify & Get Token**. | Virtual Token **`A-44`** issued (3 ahead, 15 min wait, recommended arrival window). | `[TOKEN CREATED]` |
| **Step 5** | Switch to Officer Console (or check right pane). | Live queue displays A-41, A-42, A-43, and **A-44**! | &mdash; |
| **Step 6** | Click **+ Add Walk-in**. Enter `Rahul Patel` & `Income Certificate`. | Physical token slip **`A-45`** issued. | `[WALK-IN ADDED]` |
| **Step 7** | Check Live Unified Queue table. | **`A-44 (Online)`** and **`A-45 (Walk-in)`** appear in the **same unified queue**! | &mdash; |
| **Step 8** | Officer clicks **CALL NEXT**. | Chime sounds. Active desk shows **`NOW SERVING: A-41 (Counter 2)`**. | `[QUEUE ACTION]` |
| **Step 9** | Officer clicks **Complete**. | Customer finished. Next customer becomes eligible. | `[SERVICE COMPLETED]` |
| **Step 10** | Observe Citizen portal. | Citizen **A-44** updates: **People Ahead drops to 2**, **ETA drops to 10 min**! | `[QUEUE UPDATE]` |

---

## 🏆 Key Features

- **Unified Queue Engine:** Online and walk-in citizens in one single sequence (`A-41` Online, `A-42` Walk-in, `A-43` Online, `A-44` Online, `A-45` Walk-in).
- **Smart Arrival Window:** Dynamic 10-minute window (e.g. *3:45 PM – 3:55 PM*) to prevent overcrowded waiting halls.
- **Service Readiness Checklist:** Pre-visit document confirmation reduces rejected turns at the counter.
- **Queue Protection:** Limits citizens to 1 active token per service, preventing spam bookings.
- **Advance Appointments:** Dedicated scheduled time slots (`appointment.html`) with digital pass receipts.
- **Human-Designed UI:** Clean administrative aesthetic (solid navy/blue palette, realistic tables, small border radii, zero neon glow or AI startup hype).

---

## ⌨️ Presentation Keyboard Shortcuts

- **`Alt + R`**: Instant Reset to initial demo starting data (A-40 serving, A-41 to A-43 waiting).
- **`Alt + S`**: Instant Simulate Queue step (advances queue by 1 customer).
