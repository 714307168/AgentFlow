package handler

const adminHTML = adminHTMLPart1 + adminHTMLPart2 + adminHTMLPart3 + adminHTMLPart4

const adminHTMLPart1 = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relay Admin</title>
<style>
  :root {
    --bg: #f4f0e8;
    --bg-accent: #efe5d7;
    --surface: rgba(255, 250, 244, 0.88);
    --surface-strong: rgba(255, 252, 248, 0.96);
    --surface-soft: rgba(247, 239, 228, 0.72);
    --border: rgba(111, 87, 55, 0.18);
    --text: #1f1a14;
    --muted: #726657;
    --label: #8c7a67;
    --accent: #106a5a;
    --accent-strong: #0a5144;
    --danger: #b2463f;
    --danger-soft: rgba(178, 70, 63, 0.10);
    --shadow: 0 18px 50px rgba(78, 56, 31, 0.12);
    --radius-xl: 28px;
    --radius-lg: 20px;
    --radius-md: 14px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    font-family: "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(16, 106, 90, 0.14), transparent 34%),
      radial-gradient(circle at top right, rgba(207, 162, 94, 0.18), transparent 28%),
      linear-gradient(160deg, var(--bg) 0%, var(--bg-accent) 48%, #efe6da 100%);
    font-size: 14px;
    line-height: 1.5;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255,255,255,0.22) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.22) 1px, transparent 1px);
    background-size: 26px 26px;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 65%);
  }
  button, input, select { font: inherit; }
  button { border: none; }
  #loginPage {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px;
  }
  .login-shell {
    width: min(1040px, 100%);
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(320px, 420px);
    gap: 24px;
    align-items: stretch;
  }
  .hero-panel, .login-panel, .stats-card, .guide-card, .table-panel {
    backdrop-filter: blur(14px);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .hero-panel {
    border-radius: var(--radius-xl);
    padding: 34px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 28px;
  }
  .hero-panel::after {
    content: "";
    position: absolute;
    inset: auto -60px -90px auto;
    width: 260px;
    height: 260px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(16, 106, 90, 0.18), transparent 70%);
  }
  .hero-kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: var(--surface-soft);
    color: var(--accent-strong);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hero-title {
    margin: 0;
    font-size: clamp(32px, 5vw, 56px);
    line-height: 1.02;
    letter-spacing: -0.04em;
  }
  .hero-copy {
    max-width: 540px;
    color: var(--muted);
    font-size: 16px;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .hero-metric {
    border-radius: 18px;
    padding: 16px;
    background: var(--surface-strong);
  }
  .hero-metric strong {
    display: block;
    font-size: 24px;
    line-height: 1;
    margin-bottom: 8px;
  }
  .hero-metric span { color: var(--muted); font-size: 12px; }
  .login-panel {
    border-radius: var(--radius-xl);
    padding: 28px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 18px;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-mark {
    width: 50px;
    height: 50px;
    border-radius: 18px;
    background:
      radial-gradient(circle at top left, rgba(93, 208, 255, 0.9), transparent 40%),
      linear-gradient(135deg, #123247, #0f5f53);
    position: relative;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.24);
  }
  .brand-mark::before, .brand-mark::after {
    content: "";
    position: absolute;
    border-radius: 999px;
    background: rgba(255,255,255,0.86);
  }
  .brand-mark::before { width: 26px; height: 4px; left: 12px; top: 23px; }
  .brand-mark::after { width: 4px; height: 26px; left: 23px; top: 12px; }
  .brand-copy h1, .brand-copy p, .login-heading h2, .login-heading p { margin: 0; }
  .brand-copy h1 { font-size: 18px; letter-spacing: -0.02em; }
  .brand-copy p { color: var(--muted); font-size: 12px; }
  .login-heading h2 { font-size: 24px; letter-spacing: -0.03em; }
  .login-heading p { margin-top: 8px; color: var(--muted); }
  .field { display: flex; flex-direction: column; gap: 8px; }
  .field label {
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .field input, .toolbar input, .toolbar select, .lang-switch {
    width: 100%;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid rgba(111, 87, 55, 0.16);
    background: rgba(255,255,255,0.78);
    color: var(--text);
    outline: none;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
  }
  .field input:focus, .toolbar input:focus, .toolbar select:focus, .lang-switch:focus {
    border-color: rgba(16, 106, 90, 0.45);
    box-shadow: 0 0 0 4px rgba(16, 106, 90, 0.10);
  }
  .primary-btn, .ghost-btn, .danger-btn, .subtle-btn {
    border-radius: 999px;
    padding: 11px 18px;
    cursor: pointer;
    transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
  }
  .primary-btn:hover, .ghost-btn:hover, .danger-btn:hover, .subtle-btn:hover { transform: translateY(-1px); }
  .primary-btn {
    background: linear-gradient(135deg, var(--accent), #17826f);
    color: #fdf8f1;
    font-weight: 700;
    box-shadow: 0 12px 24px rgba(16, 106, 90, 0.18);
  }
  .ghost-btn, .subtle-btn {
    background: rgba(255,255,255,0.60);
    color: var(--text);
    border: 1px solid rgba(111, 87, 55, 0.16);
  }
  .danger-btn {
    background: transparent;
    color: var(--danger);
    border: 1px solid rgba(178, 70, 63, 0.26);
  }
  .danger-btn:hover { background: var(--danger-soft); }
  .login-error {
    display: none;
    color: var(--danger);
    background: rgba(255,255,255,0.62);
    border: 1px solid rgba(178, 70, 63, 0.22);
    border-radius: 14px;
    padding: 12px 14px;
  }
  #dashboard { display: none; min-height: 100vh; padding: 20px; }
  .shell {
    width: min(1240px, 100%);
    margin: 0 auto;
    border-radius: 34px;
    background: rgba(255, 252, 248, 0.62);
    border: 1px solid rgba(111, 87, 55, 0.12);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .shell-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 22px 28px;
    background: rgba(255, 252, 248, 0.92);
    border-bottom: 1px solid rgba(111, 87, 55, 0.10);
  }
  .shell-topbar h1, .shell-topbar p, .section-heading h2, .section-heading p,
  .guide-card h3, .guide-card p, .table-panel h2, .table-panel p, .notice-box h4, .notice-box p { margin: 0; }
  .shell-topbar h1 { font-size: 18px; letter-spacing: -0.03em; }
  .shell-topbar p { color: var(--muted); font-size: 12px; }
  .topbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .user-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 999px;
    background: var(--surface-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .lang-switch { width: auto; min-width: 132px; }
  .shell-content { padding: 24px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
  .tab {
    padding: 11px 16px;
    border-radius: 999px;
    background: rgba(255,255,255,0.52);
    border: 1px solid rgba(111, 87, 55, 0.12);
    color: var(--muted);
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
  }
  .tab.active {
    background: rgba(16, 106, 90, 0.12);
    border-color: rgba(16, 106, 90, 0.22);
    color: var(--accent-strong);
    font-weight: 700;
  }
  .tab:hover { transform: translateY(-1px); }
  .panel { display: none; }
  .panel.active { display: block; }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 18px;
  }
  .stats-card { padding: 18px; border-radius: 22px; }
  .stats-card .label {
    color: var(--label);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stats-card .value {
    margin-top: 10px;
    font-size: clamp(24px, 4vw, 34px);
    letter-spacing: -0.05em;
    line-height: 1;
  }
  .stats-card .meta { margin-top: 10px; color: var(--muted); font-size: 13px; }
`
const adminHTMLPart2 = `
  .overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: 16px;
  }
  .guide-stack { display: grid; gap: 16px; }
  .guide-card, .table-panel { border-radius: 24px; padding: 20px; }
  .section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }
  .section-heading h2, .table-panel h2 { font-size: 22px; letter-spacing: -0.03em; }
  .section-heading p, .guide-card p, .table-panel p { color: var(--muted); }
  .guide-card h3 { font-size: 16px; letter-spacing: -0.02em; }
  .guide-subtext { margin-top: 8px; color: var(--muted); }
  .info-row { margin-top: 16px; display: flex; gap: 10px; align-items: center; }
  .endpoint-chip {
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    border-radius: 16px;
    background: rgba(255,255,255,0.76);
    border: 1px solid rgba(111, 87, 55, 0.14);
    font-family: "SF Mono", "Consolas", monospace;
    font-size: 12px;
    color: var(--accent-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(16, 106, 90, 0.10);
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .info-code {
    margin-top: 14px;
    padding: 16px;
    border-radius: 18px;
    background: linear-gradient(180deg, rgba(32, 27, 22, 0.96), rgba(16, 14, 11, 0.94));
    color: #eef2ec;
    font-family: "SF Mono", "Consolas", monospace;
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .notice-box {
    margin-top: 16px;
    padding: 16px;
    border-radius: 18px;
    background: linear-gradient(135deg, rgba(16, 106, 90, 0.08), rgba(207, 162, 94, 0.12));
    border: 1px solid rgba(16, 106, 90, 0.16);
  }
  .notice-box h4 { font-size: 14px; margin-bottom: 8px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
  .toolbar .grow { flex: 1 1 180px; }
  .toolbar-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
    color: var(--muted);
    font-weight: 600;
  }
  .toolbar-check input { width: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    padding: 14px 12px;
    text-align: left;
    border-bottom: 1px solid rgba(111, 87, 55, 0.10);
    vertical-align: top;
  }
  th {
    color: var(--label);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  td { font-size: 14px; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.38); }
  .mono { font-family: "SF Mono", "Consolas", monospace; font-size: 12px; }
  .muted { color: var(--muted); }
  .empty { padding: 34px 16px; text-align: center; color: var(--muted); }
  .table-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .role-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 6px 10px;
    background: rgba(111, 87, 55, 0.10);
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
  }
  .role-chip.admin {
    background: rgba(16, 106, 90, 0.12);
    color: var(--accent-strong);
  }
  .panel-note { margin-bottom: 16px; color: var(--muted); }
  .toast {
    position: fixed;
    right: 22px;
    bottom: 22px;
    max-width: min(420px, calc(100vw - 28px));
    padding: 14px 16px;
    border-radius: 18px;
    box-shadow: var(--shadow);
    display: none;
    z-index: 999;
    background: rgba(255, 252, 248, 0.96);
  }
  .toast.ok { border: 1px solid rgba(16, 106, 90, 0.20); color: var(--accent-strong); }
  .toast.err { border: 1px solid rgba(178, 70, 63, 0.22); color: var(--danger); }
  @media (max-width: 1040px) {
    .login-shell, .overview-grid { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    #dashboard { padding: 12px; }
    .shell { border-radius: 24px; }
    .shell-topbar, .shell-content, .guide-card, .table-panel { padding: 18px; }
    .shell-topbar { flex-direction: column; align-items: flex-start; }
    .topbar-actions { width: 100%; }
    .tabs { gap: 8px; }
    .tab { flex: 1 1 calc(50% - 8px); text-align: center; }
    .stats-grid, .hero-grid { grid-template-columns: 1fr; }
    .info-row { flex-direction: column; align-items: stretch; }
  }
</style>
</head>
<body>
<div id="loginPage">
  <div class="login-shell">
    <section class="hero-panel">
      <div>
        <div class="hero-kicker" data-i18n="hero.kicker">Control plane for desktop, relay, and mobile</div>
        <h1 class="hero-title" data-i18n="hero.title">Operate the whole relay chain from one console.</h1>
        <p class="hero-copy" data-i18n="hero.copy">Create accounts for teammates, register desktop agents and phones, and keep the connection path readable without digging through raw IDs or tokens.</p>
      </div>
      <div class="hero-grid">
        <div class="hero-metric">
          <strong data-i18n="hero.metric1.value">1 account</strong>
          <span data-i18n="hero.metric1.label">Sign in directly from desktop and mobile.</span>
        </div>
        <div class="hero-metric">
          <strong data-i18n="hero.metric2.value">0 manual tokens</strong>
          <span data-i18n="hero.metric2.label">The relay issues session tokens automatically after login.</span>
        </div>
        <div class="hero-metric">
          <strong data-i18n="hero.metric3.value">Multi-user ready</strong>
          <span data-i18n="hero.metric3.label">Create separate accounts before giving the app to friends or teammates.</span>
        </div>
      </div>
    </section>
    <section class="login-panel">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div class="brand-copy">
          <h1>Relay Admin</h1>
          <p data-i18n="brand.tagline">Multi-user relay console</p>
        </div>
      </div>
      <div class="login-heading">
        <h2 data-i18n="login.title">Sign in to the admin console</h2>
        <p data-i18n="login.subtitle">Use an admin account to manage users, desktop agents, and devices.</p>
      </div>
      <div class="field">
        <label for="loginUser" data-i18n="login.username">Username</label>
        <input type="text" id="loginUser" autocomplete="username" data-i18n-placeholder="login.username.placeholder" placeholder="Enter username">
      </div>
      <div class="field">
        <label for="loginPass" data-i18n="login.password">Password</label>
        <input type="password" id="loginPass" autocomplete="current-password" data-i18n-placeholder="login.password.placeholder" placeholder="Enter password">
      </div>
      <button class="primary-btn" id="loginBtn" data-i18n="login.submit">Sign In</button>
      <div class="login-error" id="loginErr" data-i18n="login.error">Invalid credentials</div>
    </section>
  </div>
</div>
<div id="dashboard">
  <div class="shell">
    <header class="shell-topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div class="brand-copy">
          <h1 data-i18n="title">Relay Admin</h1>
          <p data-i18n="shell.subtitle">Manage accounts, agents, devices, and sign-in guidance in one place.</p>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="user-badge" id="currentUserLabel">Not signed in</span>
        <select class="lang-switch" id="langSwitch" aria-label="Language">
          <option value="en">English</option>
          <option value="zh">简体中文</option>
        </select>
        <button class="ghost-btn" id="logoutBtn" data-i18n="logout">Sign Out</button>
      </div>
    </header>
    <main class="shell-content">
      <div class="tabs">
        <button class="tab active" type="button" data-tab="overview" data-i18n="tab.overview">Overview</button>
        <button class="tab" type="button" data-tab="agents" data-i18n="tab.agents">Agents</button>
        <button class="tab" type="button" data-tab="devices" data-i18n="tab.devices">Devices</button>
        <button class="tab" type="button" data-tab="users" id="usersTab" style="display:none;" data-i18n="tab.users">Users</button>
      </div>
      <section class="panel active" id="overviewPanel">
        <div class="section-heading">
          <div>
            <h2 data-i18n="overview.heading">Relay overview</h2>
            <p data-i18n="overview.subheading">Use this page as the single source of truth for registration, sign-in, and current access scope.</p>
          </div>
          <div class="pill" data-i18n="overview.mode">Password login only</div>
        </div>
        <div class="stats-grid">
          <article class="stats-card">
            <div class="label" data-i18n="overview.stats.agents.label">Agents</div>
            <div class="value" id="summaryAgentsCount">0</div>
            <div class="meta" data-i18n="overview.stats.agents.meta">Desktop clients registered under this account.</div>
          </article>
          <article class="stats-card">
            <div class="label" data-i18n="overview.stats.devices.label">Devices</div>
            <div class="value" id="summaryDevicesCount">0</div>
            <div class="meta" data-i18n="overview.stats.devices.meta">Phones and tablets allowed to connect.</div>
          </article>
          <article class="stats-card">
            <div class="label" data-i18n="overview.stats.users.label">Users</div>
            <div class="value" id="summaryUsersCount">-</div>
            <div class="meta" id="summaryUsersMeta"></div>
          </article>
          <article class="stats-card">
            <div class="label" data-i18n="overview.stats.access.label">Current access</div>
            <div class="value" id="summaryAccessValue">-</div>
            <div class="meta" id="summaryAccessMeta"></div>
          </article>
        </div>
        <div class="overview-grid">
          <div class="guide-stack">
            <article class="guide-card">
              <div class="section-heading">
                <div>
                  <h3 data-i18n="relay.title">Relay endpoint</h3>
                  <p class="guide-subtext" data-i18n="relay.copy">Use the same endpoint for desktop and Android. HTTPS automatically maps to WSS on this page.</p>
                </div>
              </div>
              <div class="info-row">
                <div class="endpoint-chip" id="wsUrl">ws://localhost:8080/ws</div>
                <button class="subtle-btn" type="button" id="copyWsUrlBtn" data-i18n="btn.copy">Copy</button>
              </div>
            </article>
            <article class="guide-card">
              <h3 data-i18n="overview.notice.title">Manual token issuance is retired</h3>
              <div class="notice-box">
                <h4 data-i18n="overview.notice.headline">Sign in from each client with username, password, and client ID.</h4>
                <p id="overviewNoticeBody"></p>
              </div>
            </article>
          </div>
          <div class="guide-stack">
            <article class="guide-card">
              <h3 data-i18n="desktop.title">Desktop agent setup</h3>
              <p class="guide-subtext" data-i18n="desktop.copy">Register the desktop first, then sign in from the Local Agent app.</p>
              <div class="info-code" id="desktopSetupCode"></div>
            </article>
            <article class="guide-card">
              <h3 data-i18n="mobile.title">Android app setup</h3>
              <p class="guide-subtext" data-i18n="mobile.copy">Register the phone, optionally bind it to an agent, then sign in inside the Android app.</p>
              <div class="info-code" id="mobileSetupCode"></div>
            </article>
          </div>
        </div>
      </section>
`
const adminHTMLPart3 = `
      <section class="panel" id="agentsPanel">
        <div class="table-panel">
          <div class="section-heading">
            <div>
              <h2 data-i18n="agents.heading">Desktop agents</h2>
              <p data-i18n="agents.subheading">Every desktop installation needs a stable agent ID before it can sign in.</p>
            </div>
          </div>
          <div class="toolbar">
            <input class="grow" type="text" id="agentId" data-i18n-placeholder="agents.id.placeholder" placeholder="Agent ID">
            <input class="grow" type="text" id="agentNote" data-i18n-placeholder="agents.note.placeholder" placeholder="Note (optional)">
            <button class="primary-btn" type="button" id="addAgentBtn" data-i18n="agents.add">Add Agent</button>
          </div>
          <table>
            <thead>
              <tr>
                <th data-i18n="agents.table.id">Agent ID</th>
                <th data-i18n="agents.table.note">Note</th>
                <th data-i18n="agents.table.created">Created</th>
                <th data-i18n="table.actions">Actions</th>
              </tr>
            </thead>
            <tbody id="agentsTbody"></tbody>
          </table>
        </div>
      </section>
      <section class="panel" id="devicesPanel">
        <div class="table-panel">
          <div class="section-heading">
            <div>
              <h2 data-i18n="devices.heading">Devices</h2>
              <p data-i18n="devices.subheading">Phones can share an account, but each device still needs its own device ID.</p>
            </div>
          </div>
          <div class="toolbar">
            <input class="grow" type="text" id="deviceId" data-i18n-placeholder="devices.id.placeholder" placeholder="Device ID">
            <select class="grow" id="deviceAgent">
              <option value="" data-i18n="devices.agent.placeholder">Bind to an agent (optional)</option>
            </select>
            <input class="grow" type="text" id="deviceNote" data-i18n-placeholder="devices.note.placeholder" placeholder="Note (optional)">
            <button class="primary-btn" type="button" id="addDeviceBtn" data-i18n="devices.add">Add Device</button>
          </div>
          <table>
            <thead>
              <tr>
                <th data-i18n="devices.table.id">Device ID</th>
                <th data-i18n="devices.table.agent">Bound agent</th>
                <th data-i18n="devices.table.note">Note</th>
                <th data-i18n="devices.table.created">Created</th>
                <th data-i18n="table.actions">Actions</th>
              </tr>
            </thead>
            <tbody id="devicesTbody"></tbody>
          </table>
        </div>
      </section>
      <section class="panel" id="usersPanel">
        <div class="table-panel">
          <div class="section-heading">
            <div>
              <h2 data-i18n="users.heading">Users</h2>
              <p data-i18n="users.subheading">Create separate accounts for friends or teammates so each person signs in with their own username and password.</p>
            </div>
          </div>
          <p class="panel-note" data-i18n="users.note">Password reset only changes the password. Existing agent and device ownership stays with the same user.</p>
          <div class="toolbar">
            <input class="grow" type="text" id="newUsername" data-i18n-placeholder="users.username.placeholder" placeholder="Username">
            <input class="grow" type="password" id="newUserPassword" data-i18n-placeholder="users.password.placeholder" placeholder="Temporary password">
            <label class="toolbar-check"><input type="checkbox" id="newUserIsAdmin"><span data-i18n="users.admin">Admin access</span></label>
            <button class="primary-btn" type="button" id="addUserBtn" data-i18n="users.add">Create User</button>
          </div>
          <table>
            <thead>
              <tr>
                <th data-i18n="users.table.username">Username</th>
                <th data-i18n="users.table.role">Role</th>
                <th data-i18n="users.table.agents">Agents</th>
                <th data-i18n="users.table.devices">Devices</th>
                <th data-i18n="users.table.created">Created</th>
                <th data-i18n="table.actions">Actions</th>
              </tr>
            </thead>
            <tbody id="usersTbody"></tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const $ = function(id) { return document.getElementById(id); };
const state = {
  currentLang: localStorage.getItem('adminLang') === 'zh' ? 'zh' : 'en',
  currentAdminUser: null,
  agents: [],
  devices: [],
  users: []
};
const i18n = {
  en: {
    title: 'Relay Admin',
    logout: 'Sign Out',
    'brand.tagline': 'Multi-user relay console',
    'shell.subtitle': 'Manage accounts, agents, devices, and sign-in guidance in one place.',
    'hero.kicker': 'Control plane for desktop, relay, and mobile',
    'hero.title': 'Operate the whole relay chain from one console.',
    'hero.copy': 'Create accounts for teammates, register desktop agents and phones, and keep the connection path readable without digging through raw IDs or tokens.',
    'hero.metric1.value': '1 account',
    'hero.metric1.label': 'Sign in directly from desktop and mobile.',
    'hero.metric2.value': '0 manual tokens',
    'hero.metric2.label': 'The relay issues session tokens automatically after login.',
    'hero.metric3.value': 'Multi-user ready',
    'hero.metric3.label': 'Create separate accounts before giving the app to friends or teammates.',
    'login.title': 'Sign in to the admin console',
    'login.subtitle': 'Use an admin account to manage users, desktop agents, and devices.',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.username.placeholder': 'Enter username',
    'login.password.placeholder': 'Enter password',
    'login.submit': 'Sign In',
    'login.error': 'Invalid credentials',
    'tab.overview': 'Overview',
    'tab.agents': 'Agents',
    'tab.devices': 'Devices',
    'tab.users': 'Users',
    'overview.heading': 'Relay overview',
    'overview.subheading': 'Use this page as the single source of truth for registration, sign-in, and current access scope.',
    'overview.mode': 'Password login only',
    'overview.stats.agents.label': 'Agents',
    'overview.stats.agents.meta': 'Desktop clients registered under this account.',
    'overview.stats.devices.label': 'Devices',
    'overview.stats.devices.meta': 'Phones and tablets allowed to connect.',
    'overview.stats.users.label': 'Users',
    'overview.stats.access.label': 'Current access',
    'overview.stats.users.meta.admin': 'Accounts you can manage from this admin session.',
    'overview.stats.users.meta.restricted': 'Visible after signing in with an admin account.',
    'overview.stats.access.meta.admin': 'You can manage users, agents, and devices.',
    'overview.stats.access.meta.user': 'You can manage only the agents and devices under your own account.',
    'overview.access.admin': 'Admin',
    'overview.access.user': 'User',
    'relay.title': 'Relay endpoint',
    'relay.copy': 'Use the same endpoint for desktop and Android. HTTPS automatically maps to WSS on this page.',
    'overview.notice.title': 'Manual token issuance is retired',
    'overview.notice.headline': 'Sign in from each client with username, password, and client ID.',
    'overview.notice.body': 'Do not copy JWT tokens into desktop or mobile anymore. After a successful sign-in, the relay server issues and refreshes the session token automatically.',
    'desktop.title': 'Desktop agent setup',
    'desktop.copy': 'Register the desktop first, then sign in from the Local Agent app.',
    'desktop.code': '1. In Agents, create one stable agent ID for this computer.\n2. Open the Local Agent app.\n3. Fill in Relay Server URL: {wsUrl}\n4. Fill in Agent ID: the agent ID you just created.\n5. Sign in with the user account that owns this agent.\n6. After sign-in, the desktop keeps its session automatically.',
    'mobile.title': 'Android app setup',
    'mobile.copy': 'Register the phone, optionally bind it to an agent, then sign in inside the Android app.',
    'mobile.code': '1. In Devices, create one device ID for this phone.\n2. Optionally bind the device to a specific agent.\n3. Open the Android app settings.\n4. Fill in Relay Server URL: {wsUrl}\n5. Fill in Device ID: the device ID you just created.\n6. Sign in with the same user account.\n7. The app will fetch and refresh its session automatically.',
    'agents.heading': 'Desktop agents',
    'agents.subheading': 'Every desktop installation needs a stable agent ID before it can sign in.',
    'agents.id.placeholder': 'Agent ID',
    'agents.note.placeholder': 'Note (optional)',
    'agents.add': 'Add Agent',
    'agents.table.id': 'Agent ID',
    'agents.table.note': 'Note',
    'agents.table.created': 'Created',
    'agents.empty': 'No agents registered yet.',
    'devices.heading': 'Devices',
    'devices.subheading': 'Phones can share an account, but each device still needs its own device ID.',
    'devices.id.placeholder': 'Device ID',
    'devices.note.placeholder': 'Note (optional)',
    'devices.agent.placeholder': 'Bind to an agent (optional)',
    'devices.add': 'Add Device',
    'devices.table.id': 'Device ID',
    'devices.table.agent': 'Bound agent',
    'devices.table.note': 'Note',
    'devices.table.created': 'Created',
    'devices.empty': 'No devices registered yet.',
    'users.heading': 'Users',
    'users.subheading': 'Create separate accounts for friends or teammates so each person signs in with their own username and password.',
    'users.note': 'Password reset only changes the password. Existing agent and device ownership stays with the same user.',
    'users.username.placeholder': 'Username',
    'users.password.placeholder': 'Temporary password',
    'users.admin': 'Admin access',
    'users.add': 'Create User',
    'users.table.username': 'Username',
    'users.table.role': 'Role',
    'users.table.agents': 'Agents',
    'users.table.devices': 'Devices',
    'users.table.created': 'Created',
    'users.empty': 'No users created yet.',
    'users.forbidden': 'Admin access is required to view users.',
    'users.role.admin': 'Admin',
    'users.role.user': 'User',
    'users.resetPassword': 'Reset Password',
    'users.delete': 'Delete User',
    'table.actions': 'Actions',
    'btn.copy': 'Copy',
    'btn.delete': 'Delete',
    'status.signedOut': 'Not signed in',
    'status.admin': 'Admin',
    'status.user': 'User',
    'toast.copied': 'Copied to clipboard.',
    'toast.copyFailed': 'Unable to copy.',
    'toast.agentAdded': 'Agent added.',
    'toast.agentDeleted': 'Agent deleted.',
    'toast.deviceAdded': 'Device added.',
    'toast.deviceDeleted': 'Device deleted.',
    'toast.userAdded': 'User created.',
    'toast.userDeleted': 'User deleted.',
    'toast.passwordReset': 'Password reset.',
    'toast.enterAgentId': 'Please enter an agent ID.',
    'toast.enterDeviceId': 'Please enter a device ID.',
    'toast.userFieldsRequired': 'Username and password are required.',
    'toast.passwordRequired': 'Password cannot be empty.',
    'confirm.deleteAgent': 'Delete agent {id}?',
    'confirm.deleteDevice': 'Delete device {id}?',
    'confirm.deleteUser': 'Delete user {username}?',
    'prompt.resetPassword': 'Enter a new password for {username}',
    'error.invalidCredentials': 'Invalid credentials.',
    'error.unauthorized': 'Your admin session has expired. Please sign in again.',
    'error.usernameExists': 'This username already exists.',
    'error.agentExists': 'This agent ID already exists.',
    'error.deviceExists': 'This device ID already exists.',
    'error.currentAdminDelete': 'You cannot delete the admin account currently in use.',
    'error.lastAdminDelete': 'You cannot delete the last remaining admin account.',
    'error.userNotFound': 'User not found.',
    'error.agentNotFound': 'Agent not found.',
    'error.deviceNotFound': 'Device not found.',
    'error.usernameRequired': 'Username is required.',
    'error.usernameTooShort': 'Username must be at least 3 characters long.',
    'error.usernameTooLong': 'Username must be 64 characters or fewer.',
    'error.usernameWhitespace': 'Username cannot contain spaces.',
    'error.passwordTooShort': 'Password must be at least 8 characters long.',
    'error.passwordEmpty': 'Password cannot be empty.',
    'error.tokenRetired': 'Manual token issuance has been retired. Sign in from the client with username and password instead.'
  },
`
const adminHTMLPart4 = `
  zh: {
    title: 'Relay 管理后台',
    logout: '退出登录',
    'brand.tagline': '多用户中继控制台',
    'shell.subtitle': '在一个后台里统一管理账号、客户端、设备和登录说明。',
    'hero.kicker': '桌面端、Relay 与移动端的一体化控制台',
    'hero.title': '用一个后台把整条中继链路管清楚。',
    'hero.copy': '给朋友或团队成员创建独立账号，登记桌面端和手机端设备，把接入路径讲清楚，不再靠记 token 或翻原始 ID。',
    'hero.metric1.value': '一个账号体系',
    'hero.metric1.label': '桌面端和手机端都直接账号登录。',
    'hero.metric2.value': '不再手动发 token',
    'hero.metric2.label': '登录成功后由 Relay 自动签发和刷新会话。',
    'hero.metric3.value': '已支持多用户',
    'hero.metric3.label': '给朋友或团队开通前，先在后台创建独立用户。',
    'login.title': '登录管理后台',
    'login.subtitle': '使用管理员账号管理用户、桌面客户端和移动设备。',
    'login.username': '用户名',
    'login.password': '密码',
    'login.username.placeholder': '输入用户名',
    'login.password.placeholder': '输入密码',
    'login.submit': '登录',
    'login.error': '用户名或密码错误',
    'tab.overview': '概述',
    'tab.agents': '客户端',
    'tab.devices': '设备',
    'tab.users': '用户',
    'overview.heading': '中继概述',
    'overview.subheading': '把注册、登录方式和当前权限范围统一收口到这一页，避免再靠口头说明。',
    'overview.mode': '仅保留账号登录',
    'overview.stats.agents.label': '客户端',
    'overview.stats.agents.meta': '当前账号下已登记的桌面客户端数量。',
    'overview.stats.devices.label': '设备',
    'overview.stats.devices.meta': '允许连接的手机或平板数量。',
    'overview.stats.users.label': '用户',
    'overview.stats.access.label': '当前权限',
    'overview.stats.users.meta.admin': '本次管理员会话可管理的账号数量。',
    'overview.stats.users.meta.restricted': '使用管理员账号登录后可查看。',
    'overview.stats.access.meta.admin': '可管理用户、客户端和设备。',
    'overview.stats.access.meta.user': '只能管理自己账号下的客户端和设备。',
    'overview.access.admin': '管理员',
    'overview.access.user': '普通用户',
    'relay.title': 'Relay 接入地址',
    'relay.copy': '桌面端和 Android 使用同一套地址。当前页面如果走 HTTPS，会自动对应为 WSS。',
    'overview.notice.title': '已取消手动签发 token',
    'overview.notice.headline': '每个客户端都使用 用户名 + 密码 + 客户端 ID 直接登录。',
    'overview.notice.body': '不需要再把 JWT token 手工复制到桌面端或手机端。登录成功后，Relay 会自动签发并续期会话 token。',
    'desktop.title': '桌面客户端接入',
    'desktop.copy': '先在后台登记桌面客户端，再到 Local Agent 内登录。',
    'desktop.code': '1. 在“客户端”里为这台电脑创建一个稳定的客户端 ID。\n2. 打开 Local Agent。\n3. 填入中继服务器地址：{wsUrl}\n4. 填入客户端 ID：刚刚创建的客户端 ID。\n5. 使用拥有该客户端的账号登录。\n6. 登录后桌面端会自动维持会话。',
    'mobile.title': 'Android 接入',
    'mobile.copy': '先在后台登记设备，可选绑定到指定客户端，然后到 Android 应用内登录。',
    'mobile.code': '1. 在“设备”里为这台手机创建一个设备 ID。\n2. 如有需要，把设备绑定到指定客户端。\n3. 打开 Android 应用设置。\n4. 填入 Relay 地址：{wsUrl}\n5. 填入设备 ID：刚刚创建的设备 ID。\n6. 使用同一个用户账号登录。\n7. 应用会自动拉取并刷新会话。',
    'agents.heading': '桌面客户端',
    'agents.subheading': '每个桌面安装实例都需要先有一个稳定的客户端 ID，之后才能登录。',
    'agents.id.placeholder': '客户端 ID',
    'agents.note.placeholder': '备注（可选）',
    'agents.add': '添加客户端',
    'agents.table.id': '客户端 ID',
    'agents.table.note': '备注',
    'agents.table.created': '创建时间',
    'agents.empty': '还没有登记客户端。',
    'devices.heading': '设备',
    'devices.subheading': '手机可以共享账号，但每台设备仍然需要独立的设备 ID。',
    'devices.id.placeholder': '设备 ID',
    'devices.note.placeholder': '备注（可选）',
    'devices.agent.placeholder': '绑定到客户端（可选）',
    'devices.add': '添加设备',
    'devices.table.id': '设备 ID',
    'devices.table.agent': '绑定客户端',
    'devices.table.note': '备注',
    'devices.table.created': '创建时间',
    'devices.empty': '还没有登记设备。',
    'users.heading': '用户',
    'users.subheading': '给朋友或团队成员创建独立账号，让每个人都用自己的用户名和密码登录。',
    'users.note': '重置密码只会修改密码本身，不会改变该用户名下的客户端和设备归属。',
    'users.username.placeholder': '用户名',
    'users.password.placeholder': '临时密码',
    'users.admin': '管理员权限',
    'users.add': '创建用户',
    'users.table.username': '用户名',
    'users.table.role': '角色',
    'users.table.agents': '客户端数',
    'users.table.devices': '设备数',
    'users.table.created': '创建时间',
    'users.empty': '还没有创建用户。',
    'users.forbidden': '只有管理员可以查看用户列表。',
    'users.role.admin': '管理员',
    'users.role.user': '普通用户',
    'users.resetPassword': '重置密码',
    'users.delete': '删除用户',
    'table.actions': '操作',
    'btn.copy': '复制',
    'btn.delete': '删除',
    'status.signedOut': '未登录',
    'status.admin': '管理员',
    'status.user': '普通用户',
    'toast.copied': '已复制到剪贴板。',
    'toast.copyFailed': '复制失败。',
    'toast.agentAdded': '客户端已添加。',
    'toast.agentDeleted': '客户端已删除。',
    'toast.deviceAdded': '设备已添加。',
    'toast.deviceDeleted': '设备已删除。',
    'toast.userAdded': '用户已创建。',
    'toast.userDeleted': '用户已删除。',
    'toast.passwordReset': '密码已重置。',
    'toast.enterAgentId': '请输入客户端 ID。',
    'toast.enterDeviceId': '请输入设备 ID。',
    'toast.userFieldsRequired': '用户名和密码不能为空。',
    'toast.passwordRequired': '密码不能为空。',
    'confirm.deleteAgent': '确定删除客户端 {id} 吗？',
    'confirm.deleteDevice': '确定删除设备 {id} 吗？',
    'confirm.deleteUser': '确定删除用户 {username} 吗？',
    'prompt.resetPassword': '为 {username} 输入一个新密码',
    'error.invalidCredentials': '用户名或密码错误。',
    'error.unauthorized': '管理后台会话已失效，请重新登录。',
    'error.usernameExists': '该用户名已存在。',
    'error.agentExists': '该客户端 ID 已存在。',
    'error.deviceExists': '该设备 ID 已存在。',
    'error.currentAdminDelete': '不能删除当前正在使用的管理员账号。',
    'error.lastAdminDelete': '不能删除最后一个管理员账号。',
    'error.userNotFound': '用户不存在。',
    'error.agentNotFound': '客户端不存在。',
    'error.deviceNotFound': '设备不存在。',
    'error.usernameRequired': '用户名不能为空。',
    'error.usernameTooShort': '用户名至少需要 3 个字符。',
    'error.usernameTooLong': '用户名不能超过 64 个字符。',
    'error.usernameWhitespace': '用户名不能包含空白字符。',
    'error.passwordTooShort': '密码至少需要 8 个字符。',
    'error.passwordEmpty': '密码不能为空。',
    'error.tokenRetired': '后台已经取消手动签发 token，请直接在客户端使用用户名和密码登录。'
  }
};
function t(key, params) {
  const dict = i18n[state.currentLang] || i18n.en;
  let text = dict[key] || i18n.en[key] || key;
  const values = params || {};
  Object.keys(values).forEach(function(name) {
    text = text.replace(new RegExp('\\{' + name + '\\}', 'g'), String(values[name]));
  });
  return text;
}
function setTextContent(target, text) {
  const el = typeof target === 'string'
    ? document.getElementById(target) || document.querySelector(target)
    : target;
  if (el) el.textContent = text;
}
function updateWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/ws';
  setTextContent('wsUrl', wsUrl);
  return wsUrl;
}
function renderOverviewCopy() {
  const wsUrl = updateWsUrl();
  setTextContent('desktopSetupCode', t('desktop.code', { wsUrl: wsUrl }));
  setTextContent('mobileSetupCode', t('mobile.code', { wsUrl: wsUrl }));
  setTextContent('overviewNoticeBody', t('overview.notice.body'));
}
function renderOverviewStats() {
  setTextContent('summaryAgentsCount', String(state.agents.length));
  setTextContent('summaryDevicesCount', String(state.devices.length));
  if (state.currentAdminUser && state.currentAdminUser.is_admin) {
    setTextContent('summaryUsersCount', String(state.users.length));
    setTextContent('summaryUsersMeta', t('overview.stats.users.meta.admin'));
  } else {
    setTextContent('summaryUsersCount', '-');
    setTextContent('summaryUsersMeta', t('overview.stats.users.meta.restricted'));
  }
  if (!state.currentAdminUser) {
    setTextContent('summaryAccessValue', '-');
    setTextContent('summaryAccessMeta', t('overview.stats.users.meta.restricted'));
    return;
  }
  setTextContent('summaryAccessValue', state.currentAdminUser.is_admin ? t('overview.access.admin') : t('overview.access.user'));
  setTextContent('summaryAccessMeta', state.currentAdminUser.is_admin ? t('overview.stats.access.meta.admin') : t('overview.stats.access.meta.user'));
}
function applySessionUI() {
  const usersTab = $('usersTab');
  if (!state.currentAdminUser) {
    setTextContent('currentUserLabel', t('status.signedOut'));
    usersTab.style.display = 'none';
    renderOverviewStats();
    return;
  }
  const roleLabel = state.currentAdminUser.is_admin ? t('status.admin') : t('status.user');
  setTextContent('currentUserLabel', state.currentAdminUser.username + ' · ' + roleLabel);
  usersTab.style.display = state.currentAdminUser.is_admin ? '' : 'none';
  if (!state.currentAdminUser.is_admin && $('usersPanel').classList.contains('active')) activateTab('overview');
  renderOverviewStats();
}
function applyI18n() {
  document.documentElement.lang = state.currentLang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(function(el) { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  $('langSwitch').value = state.currentLang;
  renderOverviewCopy();
  applySessionUI();
  renderAgents();
  renderDevices();
  renderUsers();
}
function activateTab(name) {
  document.querySelectorAll('.tab').forEach(function(tab) { tab.classList.toggle('active', tab.dataset.tab === name); });
  document.querySelectorAll('.panel').forEach(function(panel) { panel.classList.toggle('active', panel.id === name + 'Panel'); });
}
function showToast(message, ok) {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = 'toast ' + (ok ? 'ok' : 'err');
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.style.display = 'none'; }, 2600);
}
function normalizeErrorMessage(message) {
  const text = String(message || '').trim();
  if (!text) return state.currentLang === 'zh' ? '请求失败。' : 'Request failed.';
  const exactMap = {
    'invalid credentials': t('error.invalidCredentials'),
    'unauthorized': t('error.unauthorized'),
    'username is required': t('error.usernameRequired'),
    'username must be at least 3 characters long': t('error.usernameTooShort'),
    'username must be 64 characters or fewer': t('error.usernameTooLong'),
    'username cannot contain whitespace': t('error.usernameWhitespace'),
    'password must be at least 8 characters long': t('error.passwordTooShort'),
    'password cannot be empty': t('error.passwordEmpty'),
    'cannot delete the current admin user': t('error.currentAdminDelete'),
    'cannot delete the last admin user': t('error.lastAdminDelete'),
    'user not found': t('error.userNotFound'),
    'agent not found': t('error.agentNotFound'),
    'device not found': t('error.deviceNotFound'),
    'manual token issuance is retired; sign in from the local agent or Android app with username/password instead': t('error.tokenRetired')
  };
  if (exactMap[text]) return exactMap[text];
  if (text.indexOf('UNIQUE constraint failed: users.username') >= 0 || text.indexOf('username already exists') >= 0) return t('error.usernameExists');
  if (text.indexOf('UNIQUE constraint failed: agents.id') >= 0 || text.indexOf('agent id already exists') >= 0) return t('error.agentExists');
  if (text.indexOf('UNIQUE constraint failed: devices.id') >= 0 || text.indexOf('device id already exists') >= 0) return t('error.deviceExists');
  return text;
}
async function api(method, path, body) {
  const response = await fetch(path, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(normalizeErrorMessage(text || response.statusText));
  }
  return response.json().catch(function() { return {}; });
}
function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(state.currentLang === 'zh' ? 'zh-CN' : 'en-US');
}
function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function encodeJsString(value) {
  return JSON.stringify(String(value));
}
function refreshDeviceAgentSelect() {
  const select = $('deviceAgent');
  const currentValue = select.value;
  select.innerHTML = '<option value="">' + esc(t('devices.agent.placeholder')) + '</option>' +
    state.agents.map(function(agent) { return '<option value="' + esc(agent.id) + '">' + esc(agent.id) + '</option>'; }).join('');
  select.value = currentValue;
}
async function loadAgents() {
  state.agents = await api('GET', '/admin/api/agents');
  if (!Array.isArray(state.agents)) state.agents = [];
  renderAgents();
  refreshDeviceAgentSelect();
  renderOverviewStats();
}
function renderAgents() {
  const tbody = $('agentsTbody');
  if (!tbody) return;
  if (!state.agents.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">' + esc(t('agents.empty')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = state.agents.map(function(agent) {
    return '<tr><td class="mono">' + esc(agent.id) + '</td><td class="muted">' + esc(agent.note || '') + '</td><td class="mono">' + esc(fmtDate(agent.created_at)) + '</td><td><div class="table-actions"><button type="button" class="danger-btn" onclick="deleteAgent(' + encodeJsString(agent.id) + ')">' + esc(t('btn.delete')) + '</button></div></td></tr>';
  }).join('');
}
async function deleteAgent(id) {
  if (!window.confirm(t('confirm.deleteAgent', { id: id }))) return;
  try {
    await api('DELETE', '/admin/api/agents/' + encodeURIComponent(id));
    showToast(t('toast.agentDeleted'), true);
    await loadAgents();
  } catch (error) {
    showToast(error.message, false);
  }
}
async function loadDevices() {
  state.devices = await api('GET', '/admin/api/devices');
  if (!Array.isArray(state.devices)) state.devices = [];
  renderDevices();
  renderOverviewStats();
}
function renderDevices() {
  const tbody = $('devicesTbody');
  if (!tbody) return;
  if (!state.devices.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">' + esc(t('devices.empty')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = state.devices.map(function(device) {
    return '<tr><td class="mono">' + esc(device.id) + '</td><td class="mono">' + esc(device.agent_id || '—') + '</td><td class="muted">' + esc(device.note || '') + '</td><td class="mono">' + esc(fmtDate(device.created_at)) + '</td><td><div class="table-actions"><button type="button" class="danger-btn" onclick="deleteDevice(' + encodeJsString(device.id) + ')">' + esc(t('btn.delete')) + '</button></div></td></tr>';
  }).join('');
}
async function deleteDevice(id) {
  if (!window.confirm(t('confirm.deleteDevice', { id: id }))) return;
  try {
    await api('DELETE', '/admin/api/devices/' + encodeURIComponent(id));
    showToast(t('toast.deviceDeleted'), true);
    await loadDevices();
  } catch (error) {
    showToast(error.message, false);
  }
}
async function loadUsers() {
  if (!state.currentAdminUser || !state.currentAdminUser.is_admin) {
    state.users = [];
    renderUsers();
    renderOverviewStats();
    return;
  }
  state.users = await api('GET', '/admin/api/users');
  if (!Array.isArray(state.users)) state.users = [];
  renderUsers();
  renderOverviewStats();
}
function renderUsers() {
  const tbody = $('usersTbody');
  if (!tbody) return;
  if (!state.currentAdminUser || !state.currentAdminUser.is_admin) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">' + esc(t('users.forbidden')) + '</td></tr>';
    return;
  }
  if (!state.users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">' + esc(t('users.empty')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = state.users.map(function(user) {
    const roleText = user.is_admin ? t('users.role.admin') : t('users.role.user');
    const actions = ['<button type="button" class="ghost-btn" onclick="resetUserPassword(' + user.id + ', ' + encodeJsString(user.username) + ')">' + esc(t('users.resetPassword')) + '</button>'];
    if (!state.currentAdminUser || user.id !== state.currentAdminUser.id) actions.push('<button type="button" class="danger-btn" onclick="deleteUser(' + user.id + ', ' + encodeJsString(user.username) + ')">' + esc(t('users.delete')) + '</button>');
    return '<tr><td class="mono">' + esc(user.username) + '</td><td><span class="role-chip ' + (user.is_admin ? 'admin' : '') + '">' + esc(roleText) + '</span></td><td class="mono">' + esc(user.agent_count) + '</td><td class="mono">' + esc(user.device_count) + '</td><td class="mono">' + esc(fmtDate(user.created_at)) + '</td><td><div class="table-actions">' + actions.join('') + '</div></td></tr>';
  }).join('');
}
async function resetUserPassword(id, username) {
  const password = window.prompt(t('prompt.resetPassword', { username: username }));
  if (password === null) return;
  if (!String(password).trim()) {
    showToast(t('toast.passwordRequired'), false);
    return;
  }
  try {
    await api('POST', '/admin/api/users/' + encodeURIComponent(id) + '/password', { password: password });
    showToast(t('toast.passwordReset'), true);
  } catch (error) {
    showToast(error.message, false);
  }
}
async function deleteUser(id, username) {
  if (!window.confirm(t('confirm.deleteUser', { username: username }))) return;
  try {
    await api('DELETE', '/admin/api/users/' + encodeURIComponent(id));
    showToast(t('toast.userDeleted'), true);
    await loadUsers();
  } catch (error) {
    showToast(error.message, false);
  }
}
async function showDashboard() {
  const session = await api('GET', '/admin/api/check');
  state.currentAdminUser = session.user || null;
  $('loginPage').style.display = 'none';
  $('dashboard').style.display = 'block';
  applyI18n();
  await Promise.all([loadAgents(), loadDevices(), state.currentAdminUser && state.currentAdminUser.is_admin ? loadUsers() : Promise.resolve()]);
}
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() { activateTab(tab.dataset.tab); });
});
$('langSwitch').addEventListener('change', function(event) {
  state.currentLang = event.target.value === 'zh' ? 'zh' : 'en';
  localStorage.setItem('adminLang', state.currentLang);
  applyI18n();
});
$('copyWsUrlBtn').addEventListener('click', function() {
  navigator.clipboard.writeText($('wsUrl').textContent).then(function() {
    showToast(t('toast.copied'), true);
  }).catch(function() {
    showToast(t('toast.copyFailed'), false);
  });
});
$('loginBtn').addEventListener('click', async function() {
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value;
  try {
    const response = await api('POST', '/admin/api/login', { username: username, password: password });
    state.currentAdminUser = response.user || null;
    $('loginErr').style.display = 'none';
    await showDashboard();
  } catch (error) {
    $('loginErr').textContent = error.message || t('login.error');
    $('loginErr').style.display = 'block';
  }
});
$('loginPass').addEventListener('keydown', function(event) {
  if (event.key === 'Enter') $('loginBtn').click();
});
$('logoutBtn').addEventListener('click', async function() {
  await api('POST', '/admin/api/logout', {}).catch(function() {});
  state.currentAdminUser = null;
  state.users = [];
  state.agents = [];
  state.devices = [];
  $('dashboard').style.display = 'none';
  $('loginPage').style.display = 'flex';
  applyI18n();
});
$('addAgentBtn').addEventListener('click', async function() {
  const id = $('agentId').value.trim();
  if (!id) {
    showToast(t('toast.enterAgentId'), false);
    return;
  }
  try {
    await api('POST', '/admin/api/agents', { id: id, note: $('agentNote').value.trim() });
    $('agentId').value = '';
    $('agentNote').value = '';
    showToast(t('toast.agentAdded'), true);
    await loadAgents();
  } catch (error) {
    showToast(error.message, false);
  }
});
$('addDeviceBtn').addEventListener('click', async function() {
  const id = $('deviceId').value.trim();
  if (!id) {
    showToast(t('toast.enterDeviceId'), false);
    return;
  }
  try {
    await api('POST', '/admin/api/devices', {
      id: id,
      agent_id: $('deviceAgent').value,
      note: $('deviceNote').value.trim()
    });
    $('deviceId').value = '';
    $('deviceNote').value = '';
    $('deviceAgent').value = '';
    showToast(t('toast.deviceAdded'), true);
    await loadDevices();
  } catch (error) {
    showToast(error.message, false);
  }
});
$('addUserBtn').addEventListener('click', async function() {
  const username = $('newUsername').value.trim();
  const password = $('newUserPassword').value;
  if (!username || !password) {
    showToast(t('toast.userFieldsRequired'), false);
    return;
  }
  try {
    await api('POST', '/admin/api/users', {
      username: username,
      password: password,
      is_admin: $('newUserIsAdmin').checked
    });
    $('newUsername').value = '';
    $('newUserPassword').value = '';
    $('newUserIsAdmin').checked = false;
    showToast(t('toast.userAdded'), true);
    await loadUsers();
  } catch (error) {
    showToast(error.message, false);
  }
});
window.addEventListener('DOMContentLoaded', function() {
  updateWsUrl();
  applyI18n();
  api('GET', '/admin/api/check').then(function() { return showDashboard(); }).catch(function() {});
});
</script>
</body>
</html>`
