(function initSettingsAccessGrants(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsAccessGrants = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsAccessGrants() {
  function normalizeProjectId(projectId) {
    return String(projectId || "").trim();
  }

  function normalizeProjectIds(projectIds) {
    if (!Array.isArray(projectIds)) {
      return [];
    }
    const seen = new Set();
    const items = [];
    for (const projectId of projectIds) {
      const normalized = normalizeProjectId(projectId);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      items.push(normalized);
    }
    return items;
  }

  function filterProjects(projects, filterText) {
    const needle = String(filterText || "").trim().toLowerCase();
    if (!needle) {
      return Array.isArray(projects) ? projects.slice() : [];
    }
    return (Array.isArray(projects) ? projects : []).filter((project) => {
      const haystacks = [
        project?.name,
        project?.path,
        project?.cliProvider,
      ];
      return haystacks.some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }

  function buildProjectPickerMarkup(options = {}) {
    const projects = Array.isArray(options.projects) ? options.projects : [];
    if (!projects.length) {
      return `<div class="empty-state">${options.emptyMessage || "No local projects available yet."}</div>`;
    }

    const selected = new Set(normalizeProjectIds(options.selectedProjectIds));
    const visibleProjects = filterProjects(projects, options.filterText);
    if (!visibleProjects.length) {
      return `<div class="empty-state">${options.noResultsMessage || "No matching local projects."}</div>`;
    }

    return visibleProjects.map((project) => {
      const projectId = normalizeProjectId(project?.id);
      const checked = selected.has(projectId);
      const providerLabel = typeof options.resolveProviderLabel === "function"
        ? options.resolveProviderLabel(project)
        : String(project?.cliProvider || "");
      const escapeHtml = typeof options.escapeHtml === "function"
        ? options.escapeHtml
        : (value) => String(value || "");
      return `
        <label class="workgroup-agent-picker-item">
          <input type="checkbox" data-access-grant-project-id="${escapeHtml(projectId)}" value="${escapeHtml(projectId)}" ${checked ? "checked" : ""}>
          <div class="project-info">
            <div class="project-name">${escapeHtml(project?.name || projectId)}</div>
            <div class="project-path">${escapeHtml(providerLabel)}</div>
            <div class="project-path">${escapeHtml(project?.path || "")}</div>
          </div>
        </label>
      `;
    }).join("");
  }

  function formatProjectSelectionSummary(options = {}) {
    const projects = Array.isArray(options.projects) ? options.projects : [];
    const availableProjectIds = new Set(projects.map((project) => normalizeProjectId(project?.id)).filter(Boolean));
    const selectedCount = normalizeProjectIds(options.selectedProjectIds)
      .filter((projectId) => availableProjectIds.has(projectId))
      .length;
    const totalCount = availableProjectIds.size;
    if (typeof options.formatter === "function") {
      return options.formatter(selectedCount, totalCount);
    }
    if (!totalCount) {
      return "0 selected";
    }
    return `${selectedCount} / ${totalCount} selected`;
  }

  return {
    buildProjectPickerMarkup,
    filterProjects,
    formatProjectSelectionSummary,
    normalizeProjectId,
    normalizeProjectIds,
  };
});
