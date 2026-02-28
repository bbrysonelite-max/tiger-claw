# OpenClaw Sequence Diagrams

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. MESSAGE LIFECYCLE

### 1.1 Inbound Message Flow (Happy Path)

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  User   │     │ Channel │     │ Gateway │     │ Session │     │  Agent  │     │   LLM   │
│(Telegram)│     │ Plugin  │     │  Core   │     │ Manager │     │ Runtime │     │Provider │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │               │
     │ Send message  │               │               │               │               │
     │──────────────>│               │               │               │               │
     │               │               │               │               │               │
     │               │ Parse &       │               │               │               │
     │               │ validate      │               │               │               │
     │               │──────────────>│               │               │               │
     │               │               │               │               │               │
     │               │               │ Check DM      │               │               │
     │               │               │ policy        │               │               │
     │               │               │───────┐       │               │               │
     │               │               │       │       │               │               │
     │               │               │<──────┘       │               │               │
     │               │               │ (allowed)     │               │               │
     │               │               │               │               │               │
     │               │               │ Resolve       │               │               │
     │               │               │ session key   │               │               │
     │               │               │──────────────>│               │               │
     │               │               │               │               │               │
     │               │               │               │ Load/create   │               │
     │               │               │               │ session       │               │
     │               │               │               │───────┐       │               │
     │               │               │               │       │       │               │
     │               │               │<──────────────│<──────┘       │               │
     │               │               │               │               │               │
     │               │               │ Invoke agent  │               │               │
     │               │               │──────────────────────────────>│               │
     │               │               │               │               │               │
     │               │               │               │               │ Build prompt  │
     │               │               │               │               │───────┐       │
     │               │               │               │               │       │       │
     │               │               │               │               │<──────┘       │
     │               │               │               │               │               │
     │               │               │               │               │ Stream request│
     │               │               │               │               │──────────────>│
     │               │               │               │               │               │
     │               │               │               │               │   Stream      │
     │               │               │               │               │   response    │
     │               │               │               │               │<─ ─ ─ ─ ─ ─ ─│
     │               │               │               │               │               │
     │               │               │               │ Update tokens │               │
     │               │               │               │<──────────────│               │
     │               │               │               │               │               │
     │               │               │ Response      │               │               │
     │               │<──────────────│<──────────────────────────────│               │
     │               │               │               │               │               │
     │               │ Format &      │               │               │               │
     │               │ send          │               │               │               │
     │<──────────────│               │               │               │               │
     │               │               │               │               │               │
     │ Receive reply │               │               │               │               │
     │               │               │               │               │               │
```

### 1.2 Inbound Message with Pairing

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  User   │     │ Channel │     │ Gateway │     │ Pairing │
│(unknown)│     │ Plugin  │     │  Core   │     │  Store  │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │
     │ Send message  │               │               │
     │──────────────>│               │               │
     │               │               │               │
     │               │ Parse message │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Check policy  │
     │               │               │ (pairing)     │
     │               │               │───────┐       │
     │               │               │       │       │
     │               │               │<──────┘       │
     │               │               │               │
     │               │               │ Check if      │
     │               │               │ paired        │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │    Not found  │
     │               │               │<──────────────│
     │               │               │               │
     │               │               │ Generate code │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   Code: ABC123│
     │               │               │<──────────────│
     │               │               │               │
     │               │ Send pairing  │               │
     │               │ message       │               │
     │<──────────────│<──────────────│               │
     │               │               │               │
     │ "Your code:   │               │               │
     │  ABC123"      │               │               │
     │               │               │               │
     │               │               │               │
     │     ═══════ OWNER APPROVES VIA CLI ═══════   │
     │               │               │               │
     │               │               │ Approve code  │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │  Add to       │
     │               │               │  allowlist    │
     │               │               │<──────────────│
     │               │               │               │
     │               │               │               │
     │     ═══════ USER SENDS AGAIN ═══════         │
     │               │               │               │
     │ Send message  │               │               │
     │──────────────>│               │               │
     │               │               │               │
     │               │ Parse message │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Check paired  │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   ✓ Found     │
     │               │               │<──────────────│
     │               │               │               │
     │               │               │ Process       │
     │               │               │ normally...   │
     │               │               │               │
```

---

## 2. TOOL EXECUTION

### 2.1 Exec Tool with Approval

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Agent  │     │  Tool   │     │Approval │     │ Sandbox │     │Operator │
│ Runtime │     │Registry │     │ System  │     │Container│     │  (CLI)  │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ Tool call:    │               │               │               │
     │ exec          │               │               │               │
     │──────────────>│               │               │               │
     │               │               │               │               │
     │               │ Analyze       │               │               │
     │               │ command       │               │               │
     │               │───────┐       │               │               │
     │               │       │       │               │               │
     │               │<──────┘       │               │               │
     │               │               │               │               │
     │               │ Check         │               │               │
     │               │ allowlist     │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │   Not in      │               │               │
     │               │   allowlist   │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Request       │               │               │
     │               │ approval      │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │               │ Emit approval │               │
     │               │               │ event         │               │
     │               │               │──────────────────────────────>│
     │               │               │               │               │
     │               │               │               │   Display     │
     │               │               │               │   prompt      │
     │               │               │               │<──────────────│
     │               │               │               │               │
     │               │               │               │   User        │
     │               │               │               │   approves    │
     │               │               │               │──────────────>│
     │               │               │               │               │
     │               │               │ Approval      │               │
     │               │               │ received      │               │
     │               │               │<──────────────────────────────│
     │               │               │               │               │
     │               │   Approved    │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Execute in    │               │               │
     │               │ sandbox       │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │               │    stdout,    │               │
     │               │               │    stderr,    │               │
     │               │               │    exitCode   │               │
     │               │<──────────────────────────────│               │
     │               │               │               │               │
     │   Tool result │               │               │               │
     │<──────────────│               │               │               │
     │               │               │               │               │
```

### 2.2 Browser Tool Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Agent  │     │ Browser │     │   CDP   │     │ Chrome  │
│ Runtime │     │  Tool   │     │ Client  │     │ Browser │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │
     │ browser:      │               │               │
     │ open URL      │               │               │
     │──────────────>│               │               │
     │               │               │               │
     │               │ Check browser │               │
     │               │ status        │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │   Not running │               │
     │               │<──────────────│               │
     │               │               │               │
     │               │ Launch browser│               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Spawn process │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   CDP ready   │
     │               │               │<──────────────│
     │               │               │               │
     │               │   Connected   │               │
     │               │<──────────────│               │
     │               │               │               │
     │               │ Create new    │               │
     │               │ tab           │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Target.       │
     │               │               │ createTarget  │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   targetId    │
     │               │               │<──────────────│
     │               │               │               │
     │               │ Navigate to   │               │
     │               │ URL           │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Page.navigate │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   Load event  │
     │               │               │<──────────────│
     │               │               │               │
     │   Tab info    │               │               │
     │<──────────────│               │               │
     │               │               │               │
     │ browser:      │               │               │
     │ snapshot      │               │               │
     │──────────────>│               │               │
     │               │               │               │
     │               │ Get DOM       │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Runtime.      │
     │               │               │ evaluate      │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   DOM content │
     │               │               │<──────────────│
     │               │               │               │
     │   Snapshot    │               │               │
     │<──────────────│               │               │
     │               │               │               │
```

---

## 3. AUTHENTICATION

### 3.1 Gateway Connect with Device Pairing

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Client │     │ Gateway │     │  Auth   │     │ Device  │
│ (macOS) │     │  Core   │     │ Module  │     │  Store  │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │
     │ WebSocket     │               │               │
     │ connect       │               │               │
     │──────────────>│               │               │
     │               │               │               │
     │   Challenge   │               │               │
     │   (nonce)     │               │               │
     │<──────────────│               │               │
     │               │               │               │
     │ Sign challenge│               │               │
     │ with device   │               │               │
     │ private key   │               │               │
     │───────┐       │               │               │
     │       │       │               │               │
     │<──────┘       │               │               │
     │               │               │               │
     │ Connect req   │               │               │
     │ (device auth) │               │               │
     │──────────────>│               │               │
     │               │               │               │
     │               │ Verify        │               │
     │               │ signature     │               │
     │               │──────────────>│               │
     │               │               │               │
     │               │               │ Check device  │
     │               │               │ known         │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   Not found   │
     │               │               │   (new device)│
     │               │               │<──────────────│
     │               │               │               │
     │               │               │ Is local      │
     │               │               │ connection?   │
     │               │               │───────┐       │
     │               │               │       │       │
     │               │               │<──────┘       │
     │               │               │ (yes, auto-   │
     │               │               │  approve)     │
     │               │               │               │
     │               │               │ Issue token   │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │   Stored      │
     │               │               │<──────────────│
     │               │               │               │
     │               │   Token       │               │
     │               │<──────────────│               │
     │               │               │               │
     │   hello-ok    │               │               │
     │   (device     │               │               │
     │    token)     │               │               │
     │<──────────────│               │               │
     │               │               │               │
     │ Store token   │               │               │
     │ for future    │               │               │
     │───────┐       │               │               │
     │       │       │               │               │
     │<──────┘       │               │               │
     │               │               │               │
```

### 3.2 Subsequent Connection with Token

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│  Client │     │ Gateway │     │  Auth   │
│ (macOS) │     │  Core   │     │ Module  │
└────┬────┘     └────┬────┘     └────┬────┘
     │               │               │
     │ WebSocket     │               │
     │ connect       │               │
     │──────────────>│               │
     │               │               │
     │   Challenge   │               │
     │<──────────────│               │
     │               │               │
     │ Connect req   │               │
     │ (device token)│               │
     │──────────────>│               │
     │               │               │
     │               │ Validate      │
     │               │ token         │
     │               │──────────────>│
     │               │               │
     │               │   Valid       │
     │               │<──────────────│
     │               │               │
     │   hello-ok    │               │
     │<──────────────│               │
     │               │               │
```

---

## 4. CRON EXECUTION

### 4.1 Isolated Cron Job

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Cron   │     │ Gateway │     │ Session │     │  Agent  │     │ Channel │
│Scheduler│     │  Core   │     │ Manager │     │ Runtime │     │ Router  │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ Timer fires   │               │               │               │
     │───────┐       │               │               │               │
     │       │       │               │               │               │
     │<──────┘       │               │               │               │
     │               │               │               │               │
     │ Load job      │               │               │               │
     │ config        │               │               │               │
     │───────┐       │               │               │               │
     │       │       │               │               │               │
     │<──────┘       │               │               │               │
     │               │               │               │               │
     │ Execute job   │               │               │               │
     │──────────────>│               │               │               │
     │               │               │               │               │
     │               │ Create        │               │               │
     │               │ isolated      │               │               │
     │               │ session       │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │               │ Create        │               │
     │               │               │ cron:jobId    │               │
     │               │               │───────┐       │               │
     │               │               │       │       │               │
     │               │               │<──────┘       │               │
     │               │               │               │               │
     │               │   Session     │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Invoke agent  │               │               │
     │               │ with payload  │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │               │               │ Process...    │
     │               │               │               │───────┐       │
     │               │               │               │       │       │
     │               │               │               │<──────┘       │
     │               │               │               │               │
     │               │               │   Response    │               │
     │               │<──────────────────────────────│               │
     │               │               │               │               │
     │               │ Delivery mode │               │               │
     │               │ = announce    │               │               │
     │               │───────┐       │               │               │
     │               │       │       │               │               │
     │               │<──────┘       │               │               │
     │               │               │               │               │
     │               │ Route to      │               │               │
     │               │ channel       │               │               │
     │               │──────────────────────────────────────────────>│
     │               │               │               │               │
     │               │               │               │   Send to     │
     │               │               │               │   Telegram    │
     │               │               │               │<──────────────│
     │               │               │               │               │
     │ Update job    │               │               │               │
     │ state         │               │               │               │
     │<──────────────│               │               │               │
     │               │               │               │               │
     │ Record run    │               │               │               │
     │───────┐       │               │               │               │
     │       │       │               │               │               │
     │<──────┘       │               │               │               │
     │               │               │               │               │
```

---

## 5. MODEL FAILOVER

### 5.1 Provider Failure with Fallback

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Agent  │     │  Model  │     │ Circuit │     │ Primary │     │Fallback │
│ Runtime │     │ Router  │     │ Breaker │     │   LLM   │     │   LLM   │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ Request       │               │               │               │
     │ completion    │               │               │               │
     │──────────────>│               │               │               │
     │               │               │               │               │
     │               │ Check circuit │               │               │
     │               │ for primary   │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │   CLOSED      │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Call primary  │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │               │    500 Error  │               │
     │               │<──────────────────────────────│               │
     │               │               │               │               │
     │               │ Record        │               │               │
     │               │ failure       │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │               │ Increment     │               │
     │               │               │ failure count │               │
     │               │               │───────┐       │               │
     │               │               │       │       │               │
     │               │               │<──────┘       │               │
     │               │               │               │               │
     │               │ Get fallback  │               │               │
     │               │ model         │               │               │
     │               │───────┐       │               │               │
     │               │       │       │               │               │
     │               │<──────┘       │               │               │
     │               │               │               │               │
     │               │ Check circuit │               │               │
     │               │ for fallback  │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │   CLOSED      │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Call fallback │               │               │
     │               │──────────────────────────────────────────────>│
     │               │               │               │               │
     │               │               │               │    Response   │
     │               │<──────────────────────────────────────────────│
     │               │               │               │               │
     │               │ Emit metric   │               │               │
     │               │ (failover)    │               │               │
     │               │───────┐       │               │               │
     │               │       │       │               │               │
     │               │<──────┘       │               │               │
     │               │               │               │               │
     │   Response    │               │               │               │
     │   (from       │               │               │               │
     │    fallback)  │               │               │               │
     │<──────────────│               │               │               │
     │               │               │               │               │
```

---

## 6. SESSION TOOLS

### 6.1 Spawn Sub-Agent

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Main   │     │ Session │     │ Session │     │Sub-Agent│     │ Channel │
│  Agent  │     │  Tool   │     │ Manager │     │ Runtime │     │ Router  │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ sessions_spawn│               │               │               │
     │ (task, mode)  │               │               │               │
     │──────────────>│               │               │               │
     │               │               │               │               │
     │               │ Create        │               │               │
     │               │ sub-session   │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │               │ Generate key  │               │
     │               │               │ spawn:parent: │               │
     │               │               │ {label}       │               │
     │               │               │───────┐       │               │
     │               │               │       │       │               │
     │               │               │<──────┘       │               │
     │               │               │               │               │
     │               │   Session     │               │               │
     │               │   created     │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Start         │               │               │
     │               │ sub-agent     │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │               │               │ Process task  │
     │               │               │               │───────┐       │
     │               │               │               │       │       │
     │               │               │               │<──────┘       │
     │               │               │               │               │
     │   Spawn ack   │               │               │               │
     │   (sessionKey)│               │               │               │
     │<──────────────│               │               │               │
     │               │               │               │               │
     │ (main agent   │               │               │               │
     │  continues)   │               │               │               │
     │               │               │               │               │
     │               │               │               │               │
     │   ══════ SUB-AGENT COMPLETES (ASYNC) ══════  │               │
     │               │               │               │               │
     │               │               │               │ Task complete │
     │               │               │               │───────┐       │
     │               │               │               │       │       │
     │               │               │               │<──────┘       │
     │               │               │               │               │
     │               │               │               │ Announce      │
     │               │               │               │ result        │
     │               │               │               │──────────────>│
     │               │               │               │               │
     │               │               │               │  Deliver to   │
     │               │               │               │  channel      │
     │               │               │               │<──────────────│
     │               │               │               │               │
```

---

## 7. ERROR SCENARIOS

### 7.1 Poison Message Handling

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Channel │     │ Gateway │     │  Agent  │     │ Poison  │     │  Dead   │
│ Plugin  │     │  Core   │     │ Runtime │     │Detector │     │ Letter  │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ Message #1    │               │               │               │
     │──────────────>│               │               │               │
     │               │               │               │               │
     │               │ Process       │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │    ERROR      │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Record        │               │               │
     │               │ failure       │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │               │   count: 1    │               │
     │               │<──────────────────────────────│               │
     │               │               │               │               │
     │               │ Retry         │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │    ERROR      │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Record        │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │               │   count: 2    │               │
     │               │<──────────────────────────────│               │
     │               │               │               │               │
     │               │ Retry         │               │               │
     │               │──────────────>│               │               │
     │               │               │               │               │
     │               │    ERROR      │               │               │
     │               │<──────────────│               │               │
     │               │               │               │               │
     │               │ Record        │               │               │
     │               │──────────────────────────────>│               │
     │               │               │               │               │
     │               │   THRESHOLD   │               │               │
     │               │   EXCEEDED    │               │               │
     │               │<──────────────────────────────│               │
     │               │               │               │               │
     │               │ Quarantine    │               │               │
     │               │──────────────────────────────────────────────>│
     │               │               │               │               │
     │               │               │               │   Stored      │
     │               │<──────────────────────────────────────────────│
     │               │               │               │               │
     │ Error message │               │               │               │
     │ to user       │               │               │               │
     │<──────────────│               │               │               │
     │               │               │               │               │
```

---

*These sequence diagrams illustrate the key operational flows in OpenClaw. Use for implementation reference and documentation.*
