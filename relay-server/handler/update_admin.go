package handler

import (
	"net/http"

	"github.com/claudecode/relay-server/config"
)

const releasesAdminHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Release Center</title>
<style>
  :root {
    --bg: #f4f0e8;
    --surface: rgba(255, 252, 248, 0.92);
    --surface-soft: rgba(255,255,255,0.72);
    --border: rgba(111, 87, 55, 0.18);
    --text: #1f1a14;
    --muted: #74695b;
    --accent: #0f6a5b;
    --danger: #b2463f;
    --shadow: 0 18px 50px rgba(78, 56, 31, 0.12);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    font: 14px/1.5 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(16, 106, 90, 0.12), transparent 32%),
      linear-gradient(160deg, #f4f0e8, #efe5d7);
  }
  .shell {
    max-width: 1180px;
    margin: 0 auto;
    background: rgba(255,252,248,0.78);
    border: 1px solid rgba(111, 87, 55, 0.12);
    border-radius: 28px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 22px 26px;
    background: rgba(255,252,248,0.95);
    border-bottom: 1px solid rgba(111, 87, 55, 0.10);
  }
  h1, h2, p { margin: 0; }
  .topbar p { color: var(--muted); margin-top: 4px; }
  .topbar-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 22px;
    box-shadow: var(--shadow);
  }
  .content {
    padding: 24px;
    display: grid;
    gap: 18px;
  }
  .form-card { padding: 20px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .field {
    display: grid;
    gap: 8px;
  }
  label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-weight: 700;
  }
  input, select, textarea {
    width: 100%;
    border: 1px solid rgba(111, 87, 55, 0.16);
    border-radius: 14px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.86);
    color: var(--text);
    font: inherit;
  }
  textarea { min-height: 100px; resize: vertical; }
  .wide { grid-column: 1 / -1; }
  .toggle-row {
    display: flex;
    gap: 18px;
    align-items: center;
    flex-wrap: wrap;
    padding-top: 6px;
  }
  .toggle-row label {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    text-transform: none;
    letter-spacing: normal;
    color: var(--text);
  }
  button, .link-btn {
    border: 0;
    border-radius: 999px;
    padding: 11px 18px;
    cursor: pointer;
    font: inherit;
    text-decoration: none;
    transition: transform 0.18s ease, opacity 0.18s ease;
  }
  button:hover, .link-btn:hover { transform: translateY(-1px); }
  .primary { background: linear-gradient(135deg, var(--accent), #16826f); color: #fff; }
  .ghost {
    background: rgba(255,255,255,0.70);
    border: 1px solid rgba(111, 87, 55, 0.16);
    color: var(--text);
  }
  .danger {
    background: transparent;
    border: 1px solid rgba(178, 70, 63, 0.28);
    color: var(--danger);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    text-align: left;
    padding: 14px 12px;
    border-bottom: 1px solid rgba(111, 87, 55, 0.10);
    vertical-align: top;
  }
  th {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: "SF Mono", "Consolas", monospace; font-size: 12px; }
  .muted { color: var(--muted); }
  .table-card { padding: 18px 20px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--muted);
  }
  .toast {
    position: fixed;
    right: 22px;
    bottom: 22px;
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(255,252,248,0.96);
    border: 1px solid rgba(111, 87, 55, 0.18);
    box-shadow: var(--shadow);
    display: none;
  }
  @media (max-width: 900px) {
    body { padding: 12px; }
    .content { padding: 16px; }
    .grid { grid-template-columns: 1fr; }
    .topbar { flex-direction: column; align-items: flex-start; }
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div>
        <h1>Release Center</h1>
        <p>Upload Windows installers and Android APKs, then expose one update feed to both clients.</p>
      </div>
      <div class="topbar-actions">
        <a class="link-btn ghost" href="/admin">Back to Admin</a>
        <button type="button" class="ghost" id="refreshBtn">Refresh</button>
      </div>
    </div>
    <div class="content">
      <section class="card form-card">
        <h2>Publish Release</h2>
        <p class="muted" style="margin-top:6px;">Files are stored on the relay host under the server data directory.</p>
        <form id="releaseForm" style="margin-top:18px;">
          <div class="grid">
            <div class="field">
              <label for="platform">Platform</label>
              <select id="platform" name="platform" required>
                <option value="desktop-win">desktop-win</option>
                <option value="android">android</option>
              </select>
            </div>
            <div class="field">
              <label for="channel">Channel</label>
              <input id="channel" name="channel" value="stable">
            </div>
            <div class="field">
              <label for="arch">Arch</label>
              <input id="arch" name="arch" placeholder="x64 or leave blank">
            </div>
            <div class="field">
              <label for="version">Version</label>
              <input id="version" name="version" placeholder="1.1.0" required>
            </div>
            <div class="field">
              <label for="build">Build</label>
              <input id="build" name="build" type="number" value="0">
            </div>
            <div class="field">
              <label for="minSupportedVersion">Min Supported Version</label>
              <input id="minSupportedVersion" name="min_supported_version" placeholder="Optional">
            </div>
            <div class="field wide">
              <label for="notes">Release Notes</label>
              <textarea id="notes" name="notes" placeholder="What changed in this build?"></textarea>
            </div>
            <div class="field wide">
              <label for="packageFile">Package File</label>
              <input id="packageFile" name="package" type="file" required>
            </div>
          </div>
          <div class="toggle-row">
            <label><input id="mandatory" name="mandatory" type="checkbox"> Force update</label>
            <label><input id="published" name="published" type="checkbox" checked> Publish immediately</label>
          </div>
          <div class="actions" style="margin-top:18px;">
            <button type="submit" class="primary">Upload Release</button>
          </div>
        </form>
      </section>
      <section class="card table-card">
        <h2>Published Packages</h2>
        <p class="muted" style="margin-top:6px;">The public update check endpoint always serves the newest published record for the requested platform, channel, and arch.</p>
        <div style="overflow:auto; margin-top:16px;">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Target</th>
                <th>Version</th>
                <th>Package</th>
                <th>Size</th>
                <th>Published</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="releasesBody"></tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
  <div class="toast" id="toast"></div>
<script>
const $ = (id) => document.getElementById(id);
function showToast(message, ok) {
  const toast = $('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  toast.style.borderColor = ok ? 'rgba(15, 106, 91, 0.22)' : 'rgba(178, 70, 63, 0.26)';
  toast.style.color = ok ? '#0f6a5b' : '#b2463f';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2600);
}
async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    body,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error((await response.text()).trim() || response.statusText);
  }
  return response.json().catch(() => ({}));
}
function formatBytes(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}
async function loadReleases() {
  const releases = await api('GET', '/admin/api/releases');
  const tbody = $('releasesBody');
  if (!Array.isArray(releases) || releases.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No packages uploaded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = releases.map((release) => {
    const target = [release.platform, release.channel, release.arch].filter(Boolean).join(' / ');
    const published = release.published ? new Date(release.published_at || release.created_at).toLocaleString() : 'Draft';
    return '<tr>' +
      '<td class="mono">' + escapeHtml(release.id) + '</td>' +
      '<td>' + escapeHtml(target) + '</td>' +
      '<td><strong>' + escapeHtml(release.version) + '</strong><div class="muted">build ' + escapeHtml(release.build) + '</div></td>' +
      '<td><div>' + escapeHtml(release.original_filename) + '</div><div class="mono muted">' + escapeHtml(release.sha256) + '</div></td>' +
      '<td>' + escapeHtml(formatBytes(release.size)) + '</td>' +
      '<td>' + escapeHtml(published) + '</td>' +
      '<td><div class="actions"><a class="link-btn ghost" href="/api/update/download/' + encodeURIComponent(release.id) + '">Download</a><button type="button" class="danger" onclick="deleteRelease(' + encodeURIComponent(release.id) + ')">Delete</button></div></td>' +
      '</tr>';
  }).join('');
}
async function deleteRelease(id) {
  if (!window.confirm('Delete release #' + id + '?')) return;
  try {
    await api('DELETE', '/admin/api/releases/' + encodeURIComponent(id));
    showToast('Release deleted', true);
    await loadReleases();
  } catch (error) {
    showToast(error.message, false);
  }
}
$('refreshBtn').addEventListener('click', () => { void loadReleases(); });
$('releaseForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (!$('published').checked) {
    form.set('published', 'false');
  }
  if ($('mandatory').checked) {
    form.set('mandatory', 'true');
  }
  try {
    await api('POST', '/admin/api/releases', form);
    event.currentTarget.reset();
    $('channel').value = 'stable';
    $('build').value = '0';
    $('published').checked = true;
    showToast('Release uploaded', true);
    await loadReleases();
  } catch (error) {
    showToast(error.message, false);
  }
});
void loadReleases();
</script>
</body>
</html>`

func AdminReleasesPageHandler(cfg *config.Config) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(releasesAdminHTML))
	})
}
