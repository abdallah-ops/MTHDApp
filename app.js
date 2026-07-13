const STORAGE_KEY = "mthd:v1";
const LEGACY_STORAGE_KEY = "peptoot:v1";
const ADD_PROFILE_VALUE = "__add_profile__";
const INSTALL_PROMPT_DISMISSED_KEY = "mthd:installPromptDismissed";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WEEK_HOURS = 7 * 24;

const PEPTIDE_PRESETS = {
  ghkCu: {
    name: "GHK-Cu",
    halfLifeHours: 25 / 60,
    halfLifeLabel: "20-30 minutes systemic",
    note: "Circulating levels are short-lived; local tissue effects may last longer.",
  },
  nad: {
    name: "NAD+",
    halfLifeHours: 3,
    halfLifeLabel: "2-4 hours IV",
    note: "Intracellular metabolic effects may persist beyond plasma clearance.",
  },
  klowStack: {
    name: "KLOW Stack",
    halfLifeHours: null,
    halfLifeLabel: "No single half-life",
    note: "Track as one vial, but do not show one accumulation curve unless component ratios are known.",
    stackComponents: [
      { name: "GHK-Cu", halfLifeLabel: "20-30 minutes" },
      { name: "KPV", halfLifeLabel: "minutes to about 30 minutes" },
      { name: "BPC-157", halfLifeLabel: "<30 minutes, preclinical PK" },
      { name: "TB-500", halfLifeLabel: "unknown published PK; biological effects may last days" },
    ],
  },
  melanotanIi: {
    name: "Melanotan II",
    halfLifeHours: 33,
    halfLifeLabel: "30-36 hours",
    note: "Stored as the midpoint for accumulation estimates.",
  },
  glutathione: {
    name: "Glutathione",
    halfLifeHours: 15 / 60,
    halfLifeLabel: "10-20 minutes IV",
    note: "Cellular antioxidant effects may outlast plasma levels.",
  },
  retatrutide: {
    name: "Retatrutide",
    halfLifeHours: 144,
    halfLifeLabel: "about 6 days",
    note: "Investigational GLP-1/GIP/glucagon receptor agonist; weekly models are trial-average references.",
  },
  tirzepatide: {
    name: "Tirzepatide",
    halfLifeHours: 120,
    halfLifeLabel: "about 5 days",
    note: "GIP/GLP-1 receptor agonist; weekly models are trial-average references.",
  },
};

const PROJECTION_MODELS = {
  tirzepatideSurmount1: {
    compoundKey: "tirzepatide",
    label: "Tirzepatide SURMOUNT-1, 72 weeks",
    endpointWeeks: 72,
    sourceLabel: "SURMOUNT-1 / NEJM 2022",
    sourceUrl: "https://www.nejm.org/doi/full/10.1056/NEJMoa2206038",
    caution: "Adults without diabetes; averages do not predict an individual response.",
    dosePoints: [
      { doseMg: 5, lossPct: 15.0 },
      { doseMg: 10, lossPct: 19.5 },
      { doseMg: 15, lossPct: 20.9 },
    ],
  },
  retatrutidePhase2: {
    compoundKey: "retatrutide",
    label: "Retatrutide phase 2, 48 weeks",
    endpointWeeks: 48,
    sourceLabel: "Retatrutide phase 2 / NEJM 2023",
    sourceUrl: "https://www.nejm.org/doi/full/10.1056/NEJMoa2301972",
    caution: "Investigational medication; published phase 2 averages only.",
    dosePoints: [
      { doseMg: 1, lossPct: 8.7 },
      { doseMg: 4, lossPct: 17.1 },
      { doseMg: 8, lossPct: 22.8 },
      { doseMg: 12, lossPct: 24.2 },
    ],
  },
  retatrutideReportedPhase3: {
    compoundKey: "retatrutide",
    label: "Retatrutide reported phase 3, 80 weeks",
    endpointWeeks: 80,
    sourceLabel: "TRIUMPH-1 reported results, 2026",
    sourceUrl: "https://www.theguardian.com/science/2026/may/21/weight-loss-shot-eli-lilly-glp-1",
    caution: "Reported company trial results; keep separate from peer-reviewed phase 2 data.",
    dosePoints: [
      { doseMg: 4, lossPct: 19.0 },
      { doseMg: 9, lossPct: 25.9 },
      { doseMg: 12, lossPct: 28.3 },
    ],
  },
};

let storageAvailable = true;
let state = loadState();
let currentView = "overview";
let doseFilter = "all";
let reminderTimers = [];
let deferredInstallPrompt = null;
const unlockedProfiles = new Set();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  bindEvents();
  bindInstallPrompt();
  registerServiceWorker();
  maybeShowInstallPrompt();
  activateViewFromHash();
  render();
  window.addEventListener("resize", debounce(drawCharts, 120));
});

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  document.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-view-jump]");
    if (jump) {
      showView(jump.dataset.viewJump);
      return;
    }

    const doseAction = event.target.closest("[data-dose-action]");
    if (doseAction) {
      updateDoseStatus(doseAction.dataset.id, doseAction.dataset.doseAction);
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      deleteRecord(deleteButton.dataset.delete, deleteButton.dataset.id);
    }
  });

  window.addEventListener("hashchange", activateViewFromHash);

  $("#profileSelect").addEventListener("change", (event) => {
    if (event.target.value === ADD_PROFILE_VALUE) {
      showView("profiles");
      renderProfiles();
      $("#profileName").focus();
      return;
    }

    state.activeProfileId = event.target.value;
    saveState();
    render();
  });

  $("#profileForm").addEventListener("submit", addProfile);
  $("#unlockForm").addEventListener("submit", unlockActiveProfile);
  $("#profilePasswordForm").addEventListener("submit", saveActiveProfilePassword);
  $("#lockActiveProfileButton").addEventListener("click", lockActiveProfile);
  $("#peptideForm").addEventListener("submit", addPeptide);
  $("#doseForm").addEventListener("submit", addDose);
  $("#weightForm").addEventListener("submit", addWeight);
  $("#findingForm").addEventListener("submit", addFinding);
  $("#projectionForm").addEventListener("submit", (event) => event.preventDefault());
  $("#peptidePreset").addEventListener("change", applyPeptidePreset);
  $("#projectionPeptide").addEventListener("change", () => {
    renderProjectionModelOptions();
    renderProjection();
    requestAnimationFrame(drawCharts);
  });
  $("#projectionModel").addEventListener("change", () => {
    renderProjection();
    requestAnimationFrame(drawCharts);
  });

  ["#vialMg", "#diluentMl"].forEach((selector) => {
    $(selector).addEventListener("input", renderConcentrationPreview);
  });

  ["#halfLifeHours", "#peptideName"].forEach((selector) => {
    $(selector).addEventListener("input", renderPresetPreview);
  });

  ["#dosePeptide", "#doseAmount", "#doseUnit"].forEach((selector) => {
    $(selector).addEventListener("input", renderDosePreview);
  });

  $$(".segmented-control [data-dose-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      doseFilter = button.dataset.doseFilter;
      $$(".segmented-control [data-dose-filter]").forEach((item) => {
        item.classList.toggle("is-selected", item === button);
      });
      renderDoseList();
    });
  });

  $("#notifyButton").addEventListener("click", enableNotifications);
  $("#exportButton").addEventListener("click", exportData);
  $("#settingsExportButton").addEventListener("click", exportData);
  $("#importButton").addEventListener("click", () => $("#importFile").click());
  $("#settingsImportButton").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", importData);
  $("#clearDataButton").addEventListener("click", clearLocalData);
  $("#cloudSyncForm").addEventListener("submit", (event) => event.preventDefault());
  $("#cloudPushButton").addEventListener("click", pushCloudBackup);
  $("#cloudPullButton").addEventListener("click", pullCloudBackup);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // PWA install still works as a website if registration is blocked.
    });
  });
}

function bindInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    maybeShowInstallPrompt();
  });

  $("#installPromptClose").addEventListener("click", dismissInstallPrompt);
  $("#installPromptAction").addEventListener("click", handleInstallPromptAction);
}

function maybeShowInstallPrompt() {
  if (isStandaloneApp() || localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) === "true") return;

  const shouldPrompt = isIosDevice() || Boolean(deferredInstallPrompt);
  if (!shouldPrompt) return;

  window.setTimeout(showInstallPrompt, 900);
}

function showInstallPrompt() {
  if (isStandaloneApp() || localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) === "true") return;

  const prompt = $("#installPrompt");
  const steps = $("#iosInstallSteps");
  const copy = $("#installPromptCopy");
  const action = $("#installPromptAction");
  const ios = isIosDevice();

  steps.hidden = !ios;
  copy.textContent = ios
    ? "iPhone does not allow websites to open the install sheet automatically. These are the quickest steps."
    : "Install MTHD for a standalone app experience.";
  action.textContent = ios ? "Got it" : "Install";
  prompt.hidden = false;
}

function dismissInstallPrompt() {
  localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "true");
  $("#installPrompt").hidden = true;
}

async function handleInstallPromptAction() {
  if (isIosDevice() || !deferredInstallPrompt) {
    dismissInstallPrompt();
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  dismissInstallPrompt();
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return createInitialState();
    return normalizeState(JSON.parse(raw));
  } catch {
    storageAvailable = false;
    return createInitialState();
  }
}

function createInitialState() {
  return {
    version: 1,
    activeProfileId: "",
    profiles: [],
    peptides: [],
    doses: [],
    weights: [],
    findings: [],
    settings: {
      notificationsEnabled: false,
    },
  };
}

function normalizeState(value) {
  const fallback = createInitialState();
  const next = {
    version: 1,
    activeProfileId: value.activeProfileId || fallback.activeProfileId,
    profiles: Array.isArray(value.profiles) ? value.profiles.map(normalizeProfile) : fallback.profiles,
    peptides: Array.isArray(value.peptides) ? value.peptides.map(normalizePeptide) : [],
    doses: Array.isArray(value.doses) ? value.doses : [],
    weights: Array.isArray(value.weights) ? value.weights : [],
    findings: Array.isArray(value.findings) ? value.findings : [],
    settings: {
      notificationsEnabled: Boolean(value.settings?.notificationsEnabled),
    },
  };

  next.profiles = removeLegacyDefaultProfiles(next);

  if (!next.profiles.some((profile) => profile.id === next.activeProfileId)) {
    next.activeProfileId = next.profiles[0]?.id || "";
  }

  return next;
}

function removeLegacyDefaultProfiles(next) {
  return next.profiles.filter((profile) => {
    const isLegacyMe = profile.name === "Me" && (profile.label === "Self" || !profile.label) && !profile.passwordHash;
    const hasRecords = [...next.peptides, ...next.doses, ...next.weights, ...next.findings].some(
      (record) => record.profileId === profile.id,
    );
    return !(isLegacyMe && !hasRecords);
  });
}

function normalizeProfile(profile) {
  return {
    ...profile,
    passwordHash: profile.passwordHash || "",
    passwordSalt: profile.passwordSalt || "",
    passwordUpdatedAt: profile.passwordUpdatedAt || null,
  };
}

function normalizePeptide(peptide) {
  const inferredKey = peptide.presetKey || inferPresetKey(peptide.name);
  const preset = PEPTIDE_PRESETS[inferredKey] || null;

  if (!preset) return peptide;

  return {
    ...peptide,
    presetKey: peptide.presetKey || inferredKey,
    halfLifeHours: peptide.halfLifeHours || preset.halfLifeHours || null,
    halfLifeLabel: peptide.halfLifeLabel || preset.halfLifeLabel || "",
    halfLifeNote: peptide.halfLifeNote || preset.note || "",
    stackComponents: peptide.stackComponents || preset.stackComponents || null,
  };
}

function inferPresetKey(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("ghk")) return "ghkCu";
  if (normalized.includes("nad")) return "nad";
  if (normalized.includes("klow")) return "klowStack";
  if (normalized.includes("melanotan")) return "melanotanIi";
  if (normalized.includes("glutathione")) return "glutathione";
  if (normalized.includes("reta")) return "retatrutide";
  if (normalized.includes("tirz") || normalized.includes("mounjaro") || normalized.includes("zepbound")) {
    return "tirzepatide";
  }
  return "";
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  scheduleReminderTimers();
}

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0] || null;
}

function profileRecords(collection) {
  if (!activeProfile()) return [];
  return collection.filter((record) => record.profileId === state.activeProfileId);
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setDefaultDates() {
  $("#doseAt").value = toDateTimeInput(new Date());
  $("#weightDate").value = toDateInput(new Date());
  $("#findingAt").value = toDateTimeInput(new Date());
  $("#reconstitutedAt").value = toDateInput(new Date());
}

function showView(view) {
  currentView = view || "overview";
  $$(".view").forEach((panel) => {
    panel.classList.toggle("is-visible", panel.dataset.viewPanel === currentView);
  });
  $$(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === currentView);
  });
  const nextUrl = urlForView(currentView);
  if (`${location.pathname}${location.hash}` !== nextUrl) {
    history.replaceState(null, "", nextUrl);
  }
  requestAnimationFrame(drawCharts);
}

function activateViewFromHash() {
  const view = routeView();
  const exists = $(`[data-view-panel="${view}"]`);
  showView(exists ? view : "overview");
}

function routeView() {
  const hashView = location.hash.replace("#", "");
  if (hashView) return hashView;

  const pathView = location.pathname.replace(/^\/+|\/+$/g, "");
  if (!pathView || pathView === "index.html") return "overview";
  return pathView.split("/")[0];
}

function urlForView(view) {
  if (location.protocol === "file:") return `#${view}`;
  return view === "overview" ? "/" : `/${view}`;
}

function render() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  renderProfiles();
  renderProfilePasswordStatus();
  renderLockState();

  if (!activeProfile()) {
    showView("profiles");
    renderNoProfileState();
    updateNotificationButton();
    return;
  }

  if (isActiveProfileLocked()) {
    clearSensitiveViews();
    updateNotificationButton();
    return;
  }

  renderPresetOptions();
  renderPeptideOptions();
  renderProjectionOptions();
  renderConcentrationPreview();
  renderPresetPreview();
  renderDosePreview();
  renderOverview();
  renderPeptides();
  renderDoseList();
  renderWeights();
  renderProjection();
  renderFindings();
  updateNotificationButton();
  requestAnimationFrame(drawCharts);
}

function renderProfiles() {
  const select = $("#profileSelect");
  const profileOptions = state.profiles
    .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`)
    .join("");
  const emptyOption = state.profiles.length ? "" : '<option value="">No profile selected</option>';
  select.innerHTML = `${emptyOption}${profileOptions}<option value="${ADD_PROFILE_VALUE}">Add new profile...</option>`;
  select.value = state.activeProfileId || "";

  $("#profileList").innerHTML = state.profiles.length
    ? state.profiles
        .map((profile) => {
          const active = profile.id === state.activeProfileId;
          return `
            <article class="profile-pill">
              <div>
                <strong>${escapeHtml(profile.name)}</strong>
                <span>${escapeHtml(profile.label || "Family")} · ${profilePrivacyLabel(profile)}</span>
              </div>
              <button class="${active ? "" : "secondary"}" data-profile-id="${escapeHtml(profile.id)}" type="button">
                ${active ? "Active" : "Switch"}
              </button>
            </article>
          `;
        })
        .join("")
    : emptyState("Add a profile to start tracking.");

  $$("#profileList [data-profile-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeProfileId = button.dataset.profileId;
      saveState();
      render();
    });
  });
}

function renderLockState() {
  const locked = isActiveProfileLocked();
  const profile = activeProfile();
  $("#profileLockView").hidden = !locked;
  $("#lockProfileName").textContent = profile?.name || "Private profile";
  $("#lockActiveProfileButton").hidden = !profile?.passwordHash || locked;
  $$(".view").forEach((panel) => {
    panel.hidden = locked;
  });
}

function renderNoProfileState() {
  $("#profileLockView").hidden = true;
  $("#lockActiveProfileButton").hidden = true;
  drawCharts();
}

function renderProfilePasswordStatus() {
  const profile = activeProfile();
  const status = $("#profilePasswordStatus");
  if (!status || !profile) return;
  status.textContent = profile.passwordHash
    ? "This profile has a local password. Lock it from the top bar when you are done."
    : "This profile is not password protected yet.";
}

function clearSensitiveViews() {
  $("#statPeptides").textContent = "Locked";
  $("#statNextDose").textContent = "Locked";
  $("#statActiveAmount").textContent = "Locked";
  $("#statWeightTrend").textContent = "Locked";
  $("#upcomingList").innerHTML = emptyState("Unlock this profile to show timeline data.");
  $("#recentFindings").innerHTML = emptyState("Unlock this profile to show findings.");
  $("#peptideList").innerHTML = emptyState("Unlock this profile to show peptides.");
  $("#doseList").innerHTML = emptyState("Unlock this profile to show dose history.");
  $("#weightList").innerHTML = emptyState("Unlock this profile to show weight logs.");
  $("#findingList").innerHTML = emptyState("Unlock this profile to show findings.");
  $("#projectionNotes").innerHTML = emptyState("Unlock this profile to show projections.");
  drawCharts();
}

function profilePrivacyLabel(profile) {
  if (!profile.passwordHash) return "no password";
  return unlockedProfiles.has(profile.id) ? "unlocked" : "locked";
}

function isActiveProfileLocked() {
  const profile = activeProfile();
  return Boolean(profile?.passwordHash && !unlockedProfiles.has(profile.id));
}

function renderPresetOptions() {
  const select = $("#peptidePreset");
  const selected = select.value;
  select.innerHTML =
    '<option value="">Custom peptide</option>' +
    Object.entries(PEPTIDE_PRESETS)
      .map(([key, preset]) => `<option value="${escapeHtml(key)}">${escapeHtml(preset.name)}</option>`)
      .join("");

  if (selected && PEPTIDE_PRESETS[selected]) {
    select.value = selected;
  }
}

function renderPeptideOptions() {
  const peptides = profileRecords(state.peptides).sort((a, b) => a.name.localeCompare(b.name));
  const doseOptions = peptides
    .map((peptide) => `<option value="${escapeHtml(peptide.id)}">${escapeHtml(peptide.name)}</option>`)
    .join("");

  $("#dosePeptide").innerHTML = doseOptions || '<option value="">Add a peptide first</option>';

  $("#findingPeptide").innerHTML =
    '<option value="">Not linked</option>' +
    peptides
      .map((peptide) => `<option value="${escapeHtml(peptide.id)}">${escapeHtml(peptide.name)}</option>`)
      .join("");
}

function renderProjectionOptions() {
  const select = $("#projectionPeptide");
  const selected = select.value;
  const peptides = projectionCapablePeptides();

  select.innerHTML = peptides.length
    ? peptides
        .map((peptide) => `<option value="${escapeHtml(peptide.id)}">${escapeHtml(peptide.name)}</option>`)
        .join("")
    : '<option value="">Add retatrutide or tirzepatide first</option>';

  if (peptides.some((peptide) => peptide.id === selected)) {
    select.value = selected;
  }

  renderProjectionModelOptions();
}

function renderProjectionModelOptions() {
  const select = $("#projectionModel");
  const selected = select.value;
  const peptide = getPeptide($("#projectionPeptide").value) || projectionCapablePeptides()[0];
  const compoundKey = getProjectionCompoundKey(peptide);
  const models = Object.entries(PROJECTION_MODELS).filter(([, model]) => model.compoundKey === compoundKey);

  select.innerHTML = models.length
    ? models
        .map(([key, model]) => `<option value="${escapeHtml(key)}">${escapeHtml(model.label)}</option>`)
        .join("")
    : '<option value="">No model available</option>';

  if (models.some(([key]) => key === selected)) {
    select.value = selected;
  }
}

function renderOverview() {
  const peptides = profileRecords(state.peptides);
  const doses = profileRecords(state.doses);
  const weights = profileRecords(state.weights).sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date));
  const findings = profileRecords(state.findings).sort((a, b) => new Date(b.at) - new Date(a.at));
  const now = new Date();
  const nextDose = doses
    .filter((dose) => dose.status === "planned")
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0];
  const activeAmount = calculateProfileActiveAmount(now);

  $("#statPeptides").textContent = String(peptides.length);
  $("#statNextDose").textContent = nextDose ? relativeDateLabel(nextDose.at) : "None";
  $("#statActiveAmount").textContent = `${formatNumber(activeAmount, 3)} mg`;
  $("#statWeightTrend").textContent = weightTrendLabel(weights);

  $("#upcomingList").innerHTML = upcomingDoseCards(doses);
  $("#recentFindings").innerHTML = findings.length
    ? findings.slice(0, 4).map(findingCard).join("")
    : emptyState("No findings recorded.");
}

function renderPeptides() {
  const peptides = profileRecords(state.peptides).sort((a, b) => a.name.localeCompare(b.name));
  $("#peptideList").innerHTML = peptides.length
    ? peptides.map(peptideCard).join("")
    : emptyState("No peptides saved.");
}

function renderDoseList() {
  let doses = profileRecords(state.doses).sort((a, b) => new Date(b.at) - new Date(a.at));
  if (doseFilter !== "all") {
    doses = doses.filter((dose) => dose.status === doseFilter);
  }

  $("#doseList").innerHTML = doses.length
    ? doses.map(doseCard).join("")
    : emptyState("No dose events in this view.");
}

function renderWeights() {
  const weights = profileRecords(state.weights).sort((a, b) => parseDateValue(b.date) - parseDateValue(a.date));
  $("#weightList").innerHTML = weights.length
    ? weights.map(weightCard).join("")
    : emptyState("No weight entries.");

  const sorted = [...weights].sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date));
  $("#weightRange").textContent = sorted.length ? `${formatWeight(sorted[0])} to ${formatWeight(sorted.at(-1))}` : "";
}

function renderFindings() {
  const findings = profileRecords(state.findings).sort((a, b) => new Date(b.at) - new Date(a.at));
  $("#findingList").innerHTML = findings.length
    ? findings.map(findingCard).join("")
    : emptyState("No findings recorded.");
}

function renderProjection() {
  const context = getProjectionContext();

  if (!context) {
    $("#projectionBaseline").textContent = "No data";
    $("#projectionCurrent").textContent = "No data";
    $("#projectionTarget").textContent = "No model";
    $("#projectionExposure").textContent = "No dose";
    $("#projectionChartRange").textContent = "";
    $("#projectionNotes").innerHTML = emptyState("Add retatrutide or tirzepatide, then log weight and taken doses.");
    return;
  }

  const {
    activeAmount,
    baselineWeight,
    currentWeight,
    currentDose,
    elapsedWeeks,
    expectedNowWeight,
    model,
    projectedTargetWeight,
    steadyStateFactor,
    targetLossPct,
  } = context;
  const actualChange = currentWeight ? currentWeight.weightLb - baselineWeight.weightLb : 0;
  const expectedChange = expectedNowWeight - baselineWeight.weightLb;

  $("#projectionBaseline").textContent = formatWeight(baselineWeight);
  $("#projectionCurrent").textContent = currentWeight
    ? `${formatWeight(currentWeight)} (${signedNumber(actualChange)} lb)`
    : "No current weight";
  $("#projectionTarget").textContent = `${formatNumber(targetLossPct, 1)}% / ${formatNumber(projectedTargetWeight, 1)} lb`;
  $("#projectionExposure").textContent = currentDose
    ? `${formatDose(currentDose.doseMg)} latest · ${formatNumber(activeAmount, 2)} mg active`
    : "No taken dose";
  $("#projectionChartRange").textContent = `Week ${formatNumber(elapsedWeeks, 1)} of ${model.endpointWeeks}`;

  $("#projectionNotes").innerHTML = `
    <article class="finding-card">
      <div class="item-header">
        <div>
          <h3>${escapeHtml(model.label)}</h3>
          <p>${escapeHtml(model.sourceLabel)}</p>
        </div>
        <span class="privacy-chip">${formatNumber(targetLossPct, 1)}%</span>
      </div>
      <p class="meta-line">Matched to ${formatDose(currentDose?.doseMg || model.dosePoints[0].doseMg)} weekly using linear interpolation between trial dose groups.</p>
      <p class="meta-line">Expected weight at current week: ${formatNumber(expectedNowWeight, 1)} lb (${signedNumber(expectedChange)} lb from baseline).</p>
      <p class="meta-line">Weekly accumulation factor at this half-life: ${steadyStateFactor ? `${formatNumber(steadyStateFactor, 2)}x` : "not available"}.</p>
      <p class="meta-line">${escapeHtml(model.caution)}</p>
      <a class="source-link" href="${escapeHtml(model.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>
    </article>
  `;
}

function renderConcentrationPreview() {
  const vialMg = parsePositiveNumber($("#vialMg").value);
  const diluentMl = parsePositiveNumber($("#diluentMl").value);
  const preview = $("#concentrationPreview");

  if (!vialMg || !diluentMl) {
    preview.textContent = "Enter vial amount and diluent.";
    return;
  }

  const concentration = vialMg / diluentMl;
  const mcgPerUnit = (concentration * 1000) / 100;
  preview.textContent = `${formatNumber(concentration, 4)} mg/mL · ${formatNumber(mcgPerUnit, 2)} mcg per U-100 unit`;
}

function renderDosePreview() {
  const peptide = getPeptide($("#dosePeptide").value);
  const amount = parsePositiveNumber($("#doseAmount").value);
  const unit = $("#doseUnit").value;
  const preview = $("#dosePreview");

  if (!peptide) {
    preview.textContent = "Select a peptide to calculate volume.";
    return;
  }

  const concentration = getConcentration(peptide);
  if (!concentration) {
    preview.textContent = "This peptide needs vial amount and diluent before volume can be calculated.";
    return;
  }

  if (!amount) {
    preview.textContent = `${peptide.name}: ${formatNumber(concentration, 4)} mg/mL concentration.`;
    return;
  }

  const doseMg = unit === "mcg" ? amount / 1000 : amount;
  const volumeMl = doseMg / concentration;
  preview.textContent = `${formatDose(doseMg)} = ${formatNumber(volumeMl, 4)} mL · ${formatNumber(volumeMl * 100, 2)} U-100 units`;
}

function renderPresetPreview() {
  const preset = PEPTIDE_PRESETS[$("#peptidePreset").value];
  const preview = $("#presetPreview");

  if (!preset) {
    const halfLife = parsePositiveNumber($("#halfLifeHours").value);
    preview.textContent = halfLife
      ? `Custom half-life: ${formatNumber(halfLife, 2)} hours.`
      : "Choose a preset to auto-fill the half-life notes.";
    return;
  }

  if (preset.stackComponents?.length) {
    preview.innerHTML = `
      <strong>${escapeHtml(preset.name)}:</strong> ${escapeHtml(preset.halfLifeLabel)}.
      <span class="fine-print">${escapeHtml(preset.note)}</span>
    `;
    return;
  }

  preview.innerHTML = `
    <strong>${escapeHtml(preset.name)}:</strong> ${escapeHtml(preset.halfLifeLabel)}.
    <span class="fine-print">${escapeHtml(preset.note || "Half-life prefilled for estimates.")}</span>
  `;
}

function applyPeptidePreset() {
  const key = $("#peptidePreset").value;
  const preset = PEPTIDE_PRESETS[key];

  if (!preset) {
    renderPresetPreview();
    return;
  }

  $("#peptideName").value = preset.name;
  $("#halfLifeHours").value = preset.halfLifeHours ? formatNumber(preset.halfLifeHours, 3) : "";

  const currentNotes = $("#peptideNotes").value.trim();
  if (!currentNotes) {
    $("#peptideNotes").value = presetNoteText(preset);
  }

  renderPresetPreview();
}

async function addProfile(event) {
  event.preventDefault();
  const name = $("#profileName").value.trim();
  const password = $("#profilePassword").value;
  if (!name) return;
  if (!password) {
    alert("Add a password for this profile.");
    return;
  }

  let passwordRecord;
  try {
    passwordRecord = await createPasswordRecord(password);
  } catch {
    alert("This browser cannot create profile passwords.");
    return;
  }

  const profile = {
    id: createId(),
    name,
    label: $("#profileLabel").value.trim(),
    ...passwordRecord,
    createdAt: new Date().toISOString(),
  };

  state.profiles.push(profile);
  state.activeProfileId = profile.id;
  unlockedProfiles.add(profile.id);
  event.target.reset();
  saveState();
  render();
}

function addPeptide(event) {
  event.preventDefault();
  const vialMg = parsePositiveNumber($("#vialMg").value);
  const diluentMl = parsePositiveNumber($("#diluentMl").value);
  const presetKey = $("#peptidePreset").value;
  const preset = PEPTIDE_PRESETS[presetKey] || null;
  const halfLifeHours = parsePositiveNumber($("#halfLifeHours").value) || null;

  if (!vialMg || !diluentMl) {
    alert("Enter a vial amount and diluent amount.");
    return;
  }

  state.peptides.push({
    id: createId(),
    profileId: state.activeProfileId,
    name: $("#peptideName").value.trim(),
    vialMg,
    diluentMl,
    presetKey: preset ? presetKey : null,
    halfLifeHours,
    halfLifeLabel: preset?.halfLifeLabel || (halfLifeHours ? `${formatNumber(halfLifeHours, 2)} hours` : ""),
    halfLifeNote: preset?.note || "",
    stackComponents: preset?.stackComponents || null,
    reconstitutedAt: $("#reconstitutedAt").value || null,
    discardAt: $("#discardAt").value || null,
    lotNumber: $("#lotNumber").value.trim(),
    storageNotes: $("#storageNotes").value.trim(),
    notes: $("#peptideNotes").value.trim(),
    createdAt: new Date().toISOString(),
  });

  event.target.reset();
  $("#peptidePreset").value = "";
  $("#reconstitutedAt").value = toDateInput(new Date());
  saveState();
  render();
}

function addDose(event) {
  event.preventDefault();
  const peptide = getPeptide($("#dosePeptide").value);
  const amount = parsePositiveNumber($("#doseAmount").value);

  if (!peptide || !amount) {
    alert("Choose a peptide and enter the dose you want to record.");
    return;
  }

  state.doses.push({
    id: createId(),
    profileId: state.activeProfileId,
    peptideId: peptide.id,
    at: new Date($("#doseAt").value).toISOString(),
    doseMg: $("#doseUnit").value === "mcg" ? amount / 1000 : amount,
    status: $("#doseStatus").value,
    site: $("#doseSite").value,
    note: $("#doseNote").value.trim(),
    createdAt: new Date().toISOString(),
  });

  event.target.reset();
  $("#doseAt").value = toDateTimeInput(new Date());
  saveState();
  render();
}

function addWeight(event) {
  event.preventDefault();
  const value = parsePositiveNumber($("#weightValue").value);
  if (!value) return;

  const unit = $("#weightUnit").value;
  state.weights.push({
    id: createId(),
    profileId: state.activeProfileId,
    date: $("#weightDate").value,
    value,
    unit,
    weightLb: unit === "kg" ? value * 2.2046226218 : value,
    note: $("#weightNote").value.trim(),
    createdAt: new Date().toISOString(),
  });

  event.target.reset();
  $("#weightDate").value = toDateInput(new Date());
  saveState();
  render();
}

function addFinding(event) {
  event.preventDefault();
  state.findings.push({
    id: createId(),
    profileId: state.activeProfileId,
    peptideId: $("#findingPeptide").value || null,
    at: new Date($("#findingAt").value).toISOString(),
    category: $("#findingCategory").value,
    intensity: Number($("#findingIntensity").value),
    note: $("#findingNote").value.trim(),
    createdAt: new Date().toISOString(),
  });

  event.target.reset();
  $("#findingAt").value = toDateTimeInput(new Date());
  $("#findingIntensity").value = "0";
  saveState();
  render();
}

function deleteRecord(type, id) {
  const collectionMap = {
    peptide: "peptides",
    dose: "doses",
    weight: "weights",
    finding: "findings",
  };
  const collection = collectionMap[type];
  if (!collection) return;

  const linkedDoses = type === "peptide" ? state.doses.some((dose) => dose.peptideId === id) : false;
  const message = linkedDoses
    ? "Delete this peptide? Existing dose events will remain, but their peptide name will show as archived."
    : "Delete this record?";

  if (!confirm(message)) return;

  state[collection] = state[collection].filter((record) => record.id !== id);
  saveState();
  render();
}

function updateDoseStatus(id, action) {
  const dose = state.doses.find((item) => item.id === id);
  if (!dose) return;

  if (action === "taken") {
    dose.status = "taken";
    dose.at = new Date().toISOString();
  }

  if (action === "skip") {
    dose.status = "skipped";
  }

  if (action === "planned") {
    dose.status = "planned";
  }

  saveState();
  render();
}

async function unlockActiveProfile(event) {
  event.preventDefault();
  const profile = activeProfile();
  const password = $("#unlockPassword").value;
  if (!profile?.passwordHash) return;

  let isValid = false;
  try {
    isValid = await verifyProfilePassword(profile, password);
  } catch {
    alert("This browser cannot unlock profile passwords.");
    return;
  }
  if (!isValid) {
    alert("That password did not match this profile.");
    return;
  }

  unlockedProfiles.add(profile.id);
  $("#unlockPassword").value = "";
  render();
}

function lockActiveProfile() {
  const profile = activeProfile();
  if (!profile?.passwordHash) return;
  unlockedProfiles.delete(profile.id);
  render();
}

async function saveActiveProfilePassword(event) {
  event.preventDefault();
  const profile = activeProfile();
  const password = $("#activeProfilePassword").value;
  if (!profile || !password) return;

  try {
    Object.assign(profile, await createPasswordRecord(password));
  } catch {
    alert("This browser cannot create profile passwords.");
    return;
  }
  unlockedProfiles.add(profile.id);
  $("#activeProfilePassword").value = "";
  saveState();
  render();
}

async function createPasswordRecord(password) {
  const passwordSalt = createSalt();
  const passwordHash = await hashPassword(password, passwordSalt);
  return {
    passwordHash,
    passwordSalt,
    passwordUpdatedAt: new Date().toISOString(),
  };
}

async function verifyProfilePassword(profile, password) {
  if (!profile?.passwordHash || !profile?.passwordSalt) return true;
  return (await hashPassword(password, profile.passwordSalt)) === profile.passwordHash;
}

function createSalt() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Password hashing is not available in this browser.");
  }

  const data = new TextEncoder().encode(`${salt}:${password}`);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function peptideCard(peptide) {
  const concentration = getConcentration(peptide);
  const active = calculatePeptideActiveAmount(peptide.id, new Date());
  const discard = peptide.discardAt ? relativeDateLabel(peptide.discardAt) : "Not set";
  const mcgPerUnit = concentration ? (concentration * 1000) / 100 : 0;
  const isStack = Boolean(peptide.stackComponents?.length);
  const halfLifeText = getHalfLifeLabel(peptide);

  return `
    <article class="peptide-card">
      <div class="item-header">
        <div>
          <h3>${escapeHtml(peptide.name)}</h3>
          <p>${escapeHtml(peptide.storageNotes || "No storage note")}</p>
        </div>
        <button class="secondary" data-delete="peptide" data-id="${escapeHtml(peptide.id)}" type="button">Delete</button>
      </div>
      <div class="metric-row">
        <div class="metric">
          <span>Concentration</span>
          <strong>${formatNumber(concentration, 4)} mg/mL</strong>
        </div>
        <div class="metric">
          <span>U-100</span>
          <strong>${formatNumber(mcgPerUnit, 2)} mcg/unit</strong>
        </div>
        <div class="metric">
          <span>Active Estimate</span>
          <strong>${isStack ? "Component stack" : `${formatNumber(active, 3)} mg`}</strong>
        </div>
      </div>
      <p class="meta-line">Vial ${formatNumber(peptide.vialMg, 3)} mg · Diluent ${formatNumber(peptide.diluentMl, 2)} mL · Half-life ${escapeHtml(halfLifeText)} · Discard ${discard}</p>
      ${isStack ? stackComponentList(peptide.stackComponents) : ""}
      ${peptide.halfLifeNote ? `<p class="meta-line">${escapeHtml(peptide.halfLifeNote)}</p>` : ""}
      ${peptide.notes ? `<p class="meta-line">${escapeHtml(peptide.notes)}</p>` : ""}
    </article>
  `;
}

function doseCard(dose) {
  const peptide = getPeptide(dose.peptideId);
  const concentration = peptide ? getConcentration(peptide) : null;
  const volume = concentration ? dose.doseMg / concentration : null;
  const actions =
    dose.status === "planned"
      ? `
        <button data-dose-action="taken" data-id="${escapeHtml(dose.id)}" type="button">Taken now</button>
        <button class="secondary" data-dose-action="skip" data-id="${escapeHtml(dose.id)}" type="button">Skip</button>
      `
      : `
        <button class="secondary" data-dose-action="planned" data-id="${escapeHtml(dose.id)}" type="button">Set planned</button>
      `;

  return `
    <article class="event-card">
      <div class="item-header">
        <div>
          <h3>${escapeHtml(peptide?.name || "Archived peptide")}</h3>
          <p>${formatDateTime(dose.at)} · ${escapeHtml(dose.site || "No site")}</p>
        </div>
        <span class="status-pill ${escapeHtml(dose.status)}">${escapeHtml(titleCase(dose.status))}</span>
      </div>
      <div class="metric-row">
        <div class="metric">
          <span>Dose</span>
          <strong>${formatDose(dose.doseMg)}</strong>
        </div>
        <div class="metric">
          <span>Volume</span>
          <strong>${volume ? `${formatNumber(volume, 4)} mL` : "N/A"}</strong>
        </div>
        <div class="metric">
          <span>U-100</span>
          <strong>${volume ? `${formatNumber(volume * 100, 2)} units` : "N/A"}</strong>
        </div>
      </div>
      ${dose.note ? `<p class="meta-line">${escapeHtml(dose.note)}</p>` : ""}
      <div class="action-row">
        ${actions}
        <button class="secondary" data-delete="dose" data-id="${escapeHtml(dose.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function upcomingDoseCards(doses) {
  const planned = doses
    .filter((dose) => dose.status === "planned")
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(0, 5);

  if (!planned.length) return emptyState("No planned jabs.");

  return planned
    .map((dose) => {
      const peptide = getPeptide(dose.peptideId);
      return `
        <article class="event-card">
          <div class="item-header">
            <div>
              <h3>${escapeHtml(peptide?.name || "Archived peptide")}</h3>
              <p>${formatDateTime(dose.at)} · ${formatDose(dose.doseMg)}</p>
            </div>
            <span class="status-pill planned">${escapeHtml(relativeDateLabel(dose.at))}</span>
          </div>
          <div class="action-row">
            <button data-dose-action="taken" data-id="${escapeHtml(dose.id)}" type="button">Taken now</button>
            <button class="secondary" data-dose-action="skip" data-id="${escapeHtml(dose.id)}" type="button">Skip</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function weightCard(weight) {
  return `
    <article class="weight-card">
      <div class="item-header">
        <div>
          <h3>${formatWeight(weight)}</h3>
          <p>${formatDate(weight.date)}</p>
        </div>
        <button class="secondary" data-delete="weight" data-id="${escapeHtml(weight.id)}" type="button">Delete</button>
      </div>
      ${weight.note ? `<p class="meta-line">${escapeHtml(weight.note)}</p>` : ""}
    </article>
  `;
}

function findingCard(finding) {
  const peptide = finding.peptideId ? getPeptide(finding.peptideId) : null;
  return `
    <article class="finding-card">
      <div class="item-header">
        <div>
          <h3>${escapeHtml(finding.category)}</h3>
          <p>${formatDateTime(finding.at)}${peptide ? ` · ${escapeHtml(peptide.name)}` : ""}</p>
        </div>
        <span class="privacy-chip">${Number(finding.intensity)}/5</span>
      </div>
      <p class="meta-line">${escapeHtml(finding.note)}</p>
      <div class="action-row">
        <button class="secondary" data-delete="finding" data-id="${escapeHtml(finding.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function stackComponentList(components) {
  return `
    <div class="component-list">
      ${components
        .map(
          (component) => `
            <span>
              <strong>${escapeHtml(component.name)}</strong>
              ${escapeHtml(component.halfLifeLabel)}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function getHalfLifeLabel(peptide) {
  if (peptide?.halfLifeLabel) return peptide.halfLifeLabel;
  if (peptide?.halfLifeHours) return `${formatNumber(peptide.halfLifeHours, 2)} hours`;
  return "not set";
}

function presetNoteText(preset) {
  const componentText = preset.stackComponents?.length
    ? ` Components: ${preset.stackComponents
        .map((component) => `${component.name} (${component.halfLifeLabel})`)
        .join("; ")}.`
    : "";

  return `${preset.halfLifeLabel}. ${preset.note || ""}${componentText}`.trim();
}

function getPeptide(id) {
  return state.peptides.find((peptide) => peptide.id === id) || null;
}

function getConcentration(peptide) {
  if (!peptide?.vialMg || !peptide?.diluentMl) return null;
  return peptide.vialMg / peptide.diluentMl;
}

function calculateProfileActiveAmount(at) {
  return profileRecords(state.peptides).reduce((sum, peptide) => {
    return sum + calculatePeptideActiveAmount(peptide.id, at);
  }, 0);
}

function calculatePeptideActiveAmount(peptideId, at) {
  const peptide = getPeptide(peptideId);
  if (!peptide?.halfLifeHours) return 0;

  return profileRecords(state.doses)
    .filter((dose) => dose.peptideId === peptideId && dose.status === "taken")
    .reduce((sum, dose) => {
      const elapsedHours = (new Date(at) - new Date(dose.at)) / HOUR_MS;
      if (elapsedHours < 0) return sum;
      return sum + dose.doseMg * Math.pow(0.5, elapsedHours / peptide.halfLifeHours);
    }, 0);
}

function activeSeries() {
  const doses = profileRecords(state.doses).filter((dose) => dose.status === "taken");
  const peptidesById = new Map(profileRecords(state.peptides).map((peptide) => [peptide.id, peptide]));
  const supported = doses.filter((dose) => peptidesById.get(dose.peptideId)?.halfLifeHours);

  if (!supported.length) return [];

  const now = new Date();
  const earliestDose = Math.min(...supported.map((dose) => new Date(dose.at).getTime()));
  const startTime = Math.max(earliestDose, now.getTime() - 28 * DAY_MS);
  const points = 72;
  const step = (now.getTime() - startTime) / Math.max(points - 1, 1);

  return Array.from({ length: points }, (_, index) => {
    const at = new Date(startTime + step * index);
    const value = supported.reduce((sum, dose) => {
      const peptide = peptidesById.get(dose.peptideId);
      const elapsedHours = (at - new Date(dose.at)) / HOUR_MS;
      if (!peptide?.halfLifeHours || elapsedHours < 0) return sum;
      return sum + dose.doseMg * Math.pow(0.5, elapsedHours / peptide.halfLifeHours);
    }, 0);
    return { at, value };
  });
}

function projectionCapablePeptides() {
  return profileRecords(state.peptides)
    .filter((peptide) => Boolean(getProjectionCompoundKey(peptide)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getProjectionCompoundKey(peptide) {
  if (!peptide) return "";
  const key = peptide.presetKey || inferPresetKey(peptide.name);
  if (key === "retatrutide") return "retatrutide";
  if (key === "tirzepatide") return "tirzepatide";
  return "";
}

function getProjectionContext() {
  const peptide = getPeptide($("#projectionPeptide").value) || projectionCapablePeptides()[0];
  const model = PROJECTION_MODELS[$("#projectionModel").value];
  const weights = profileRecords(state.weights).sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date));

  if (!peptide || !model || !weights.length) return null;

  const doses = profileRecords(state.doses)
    .filter((dose) => dose.peptideId === peptide.id && dose.status === "taken")
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const firstDose = doses[0] || null;
  const currentDose = doses.at(-1) || null;
  const startDate = firstDose ? new Date(firstDose.at) : parseDateValue(weights[0].date);
  const baselineWeight = findBaselineWeight(weights, startDate);
  const currentWeight = weights.at(-1);
  const doseForModel = currentDose?.doseMg || model.dosePoints[0].doseMg;
  const targetLossPct = interpolateDoseLoss(model.dosePoints, doseForModel);
  const elapsedWeeks = Math.max(0, (Date.now() - startDate.getTime()) / (7 * DAY_MS));
  const currentProgress = Math.min(elapsedWeeks / model.endpointWeeks, 1);
  const expectedNowLossPct = targetLossPct * currentProgress;
  const projectedTargetWeight = baselineWeight.weightLb * (1 - targetLossPct / 100);
  const expectedNowWeight = baselineWeight.weightLb * (1 - expectedNowLossPct / 100);
  const activeAmount = calculatePeptideActiveAmount(peptide.id, new Date());
  const steadyStateFactor = peptide.halfLifeHours
    ? 1 / (1 - Math.pow(0.5, WEEK_HOURS / peptide.halfLifeHours))
    : null;

  return {
    activeAmount,
    baselineWeight,
    currentDose,
    currentWeight,
    doses,
    elapsedWeeks,
    expectedNowWeight,
    model,
    peptide,
    projectedTargetWeight,
    startDate,
    steadyStateFactor,
    targetLossPct,
    weights,
  };
}

function findBaselineWeight(weights, startDate) {
  const beforeStart = weights.filter((weight) => parseDateValue(weight.date) <= startDate);
  return beforeStart.at(-1) || weights[0];
}

function interpolateDoseLoss(points, doseMg) {
  const sorted = [...points].sort((a, b) => a.doseMg - b.doseMg);
  if (doseMg <= sorted[0].doseMg) return sorted[0].lossPct;
  if (doseMg >= sorted.at(-1).doseMg) return sorted.at(-1).lossPct;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    if (doseMg >= lower.doseMg && doseMg <= upper.doseMg) {
      const progress = (doseMg - lower.doseMg) / (upper.doseMg - lower.doseMg);
      return lower.lossPct + (upper.lossPct - lower.lossPct) * progress;
    }
  }

  return sorted.at(-1).lossPct;
}

function weightTrendLabel(weights) {
  if (weights.length < 2) return weights.length ? formatWeight(weights.at(-1)) : "No data";
  const change = weights.at(-1).weightLb - weights[0].weightLb;
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${formatNumber(change, 1)} lb`;
}

function drawCharts() {
  if (isActiveProfileLocked()) {
    drawEmptyCanvas($("#accumulationChart"), "Unlock profile to show chart.");
    drawEmptyCanvas($("#weightChart"), "Unlock profile to show chart.");
    drawEmptyCanvas($("#weightDetailChart"), "Unlock profile to show chart.");
    drawEmptyCanvas($("#projectionChart"), "Unlock profile to show chart.");
    return;
  }

  drawActiveChart($("#accumulationChart"));
  drawWeightChart($("#weightChart"), profileRecords(state.weights));
  drawWeightChart($("#weightDetailChart"), profileRecords(state.weights));
  drawProjectionChart($("#projectionChart"));
}

function drawEmptyCanvas(canvas, message) {
  if (!canvas) return;
  const context = prepareCanvas(canvas);
  if (!context) return;
  drawEmptyChart(context.ctx, context.width, context.height, message);
}

function drawActiveChart(canvas) {
  if (!canvas) return;
  const context = prepareCanvas(canvas);
  if (!context) return;

  const { ctx, width, height } = context;
  const series = activeSeries();

  if (!series.length) {
    $("#activeChartRange").textContent = "";
    drawEmptyChart(ctx, width, height, "Log taken doses with half-life values.");
    return;
  }

  $("#activeChartRange").textContent = `${formatDate(series[0].at)} to ${formatDate(series.at(-1).at)}`;

  drawFrame(ctx, width, height);
  const max = Math.max(...series.map((point) => point.value), 0.001);
  const padding = 32;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  ctx.beginPath();
  series.forEach((point, index) => {
    const x = padding + (index / (series.length - 1)) * chartWidth;
    const y = padding + chartHeight - (point.value / max) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0d0d0c";
  ctx.stroke();

  ctx.lineTo(width - padding, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fillStyle = "rgba(13, 13, 12, 0.08)";
  ctx.fill();

  drawChartLabels(ctx, width, height, `0 mg`, `${formatNumber(max, 2)} mg`);
}

function drawWeightChart(canvas, weights) {
  if (!canvas) return;
  const context = prepareCanvas(canvas);
  if (!context) return;

  const { ctx, width, height } = context;
  const sorted = [...weights].sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date));

  if (sorted.length < 2) {
    drawEmptyChart(ctx, width, height, "Add at least two weight entries.");
    return;
  }

  drawFrame(ctx, width, height);

  const padding = 32;
  const values = sorted.map((weight) => weight.weightLb);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  ctx.beginPath();
  sorted.forEach((weight, index) => {
    const x = padding + (index / (sorted.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((weight.weightLb - min) / span) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0d0d0c";
  ctx.stroke();

  sorted.forEach((weight, index) => {
    const x = padding + (index / (sorted.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((weight.weightLb - min) / span) * chartHeight;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0d0d0c";
    ctx.stroke();
  });

  drawChartLabels(ctx, width, height, `${formatNumber(min, 1)} lb`, `${formatNumber(max, 1)} lb`);
}

function drawProjectionChart(canvas) {
  if (!canvas) return;
  const context = prepareCanvas(canvas);
  if (!context) return;

  const { ctx, width, height } = context;
  const projection = getProjectionContext();

  if (!projection) {
    drawEmptyChart(ctx, width, height, "Add weight and a reta/tirz dose.");
    return;
  }

  const { baselineWeight, model, startDate, targetLossPct, weights } = projection;
  const padding = 36;
  const endDate = new Date(startDate.getTime() + model.endpointWeeks * 7 * DAY_MS);
  const projectionPoints = Array.from({ length: 80 }, (_, index) => {
    const progress = index / 79;
    return {
      at: new Date(startDate.getTime() + (endDate - startDate) * progress),
      weightLb: baselineWeight.weightLb * (1 - (targetLossPct * progress) / 100),
    };
  });
  const actualPoints = weights.map((weight) => ({
    at: parseDateValue(weight.date),
    weightLb: weight.weightLb,
  }));
  const allWeights = [...projectionPoints, ...actualPoints].map((point) => point.weightLb);
  const min = Math.min(...allWeights) - 2;
  const max = Math.max(...allWeights) + 2;
  const span = Math.max(max - min, 1);
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const timeSpan = Math.max(endDate - startDate, DAY_MS);
  const toX = (date) => padding + ((date - startDate) / timeSpan) * chartWidth;
  const toY = (weightLb) => padding + chartHeight - ((weightLb - min) / span) * chartHeight;

  drawFrame(ctx, width, height);

  ctx.beginPath();
  projectionPoints.forEach((point, index) => {
    const x = toX(point.at);
    const y = toY(point.weightLb);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = "#b45309";
  ctx.stroke();
  ctx.setLineDash([]);

  if (actualPoints.length) {
    ctx.beginPath();
    actualPoints.forEach((point, index) => {
      const x = Math.max(padding, Math.min(width - padding, toX(point.at)));
      const y = toY(point.weightLb);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 3;
  ctx.strokeStyle = "#0d0d0c";
    ctx.stroke();

    actualPoints.forEach((point) => {
      const x = Math.max(padding, Math.min(width - padding, toX(point.at)));
      const y = toY(point.weightLb);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0d0d0c";
      ctx.stroke();
    });
  }

  ctx.fillStyle = "#637083";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText("Actual", width - 130, 24);
  ctx.fillStyle = "#0d0d0c";
  ctx.fillRect(width - 170, 16, 28, 3);
  ctx.fillStyle = "#637083";
  ctx.fillText("Projection", width - 130, 44);
  ctx.fillStyle = "#b45309";
  ctx.fillRect(width - 170, 36, 28, 3);
  drawChartLabels(ctx, width, height, `${formatNumber(min, 1)} lb`, `${formatNumber(max, 1)} lb`);
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width), 260);
  const height = Number(canvas.getAttribute("height")) || 240;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawFrame(ctx, width, height) {
  const padding = 32;
  ctx.strokeStyle = "#d7dee8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  ctx.strokeStyle = "rgba(215, 222, 232, 0.7)";
  for (let index = 1; index < 4; index += 1) {
    const y = padding + ((height - padding * 2) / 4) * index;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }
}

function drawChartLabels(ctx, width, height, low, high) {
  ctx.fillStyle = "#637083";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText(high, 36, 22);
  ctx.fillText(low, 36, height - 10);
}

function drawEmptyChart(ctx, width, height, message) {
  ctx.fillStyle = "#f8fbfc";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d7dee8";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = "#637083";
  ctx.font = "14px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = "left";
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    alert("This browser does not support notifications.");
    return;
  }

  const permission = await Notification.requestPermission();
  state.settings.notificationsEnabled = permission === "granted";
  saveState();
  updateNotificationButton();

  if (permission !== "granted") {
    alert("Notifications were not enabled.");
  }
}

function updateNotificationButton() {
  const enabled = state.settings.notificationsEnabled && "Notification" in window && Notification.permission === "granted";
  $("#notifyButton").textContent = enabled ? "Reminders on" : "Enable reminders";
  $("#notifyButton").classList.toggle("secondary", enabled);
  scheduleReminderTimers();
}

function scheduleReminderTimers() {
  reminderTimers.forEach((timer) => clearTimeout(timer));
  reminderTimers = [];

  if (!state.settings.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const now = Date.now();
  profileRecords(state.doses)
    .filter((dose) => dose.status === "planned")
    .forEach((dose) => {
      const delay = new Date(dose.at).getTime() - now;
      if (delay <= 0 || delay > 7 * DAY_MS) return;

      const timer = setTimeout(() => {
        const peptide = getPeptide(dose.peptideId);
        const profile = activeProfile();
        new Notification("MTHD reminder", {
          body: `${profile.name}: ${peptide?.name || "Dose"} scheduled now.`,
        });
      }, delay);

      reminderTimers.push(timer);
    });
}

function exportData() {
  const backup = {
    exportedAt: new Date().toISOString(),
    app: "MTHD",
    data: state,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mthd-backup-${toDateInput(new Date())}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const [file] = event.target.files;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const imported = parsed.data || parsed;
      const normalized = normalizeState(imported);
      if (!confirm("Replace the current local MTHD data with this import?")) return;
      state = normalized;
      saveState();
      render();
    } catch {
      alert("That file could not be imported.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function clearLocalData() {
  if (!confirm("Clear all local MTHD data in this browser?")) return;
  state = createInitialState();
  saveState();
  render();
}

async function pushCloudBackup() {
  const credentials = getCloudCredentials();
  if (!credentials) return;

  setCloudStatus("Encrypting local backup...");
  try {
    const encrypted = await encryptVaultPayload(state, credentials.secret);
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mthd-vault-secret": credentials.secret,
      },
      body: JSON.stringify({
        vaultId: credentials.vaultId,
        data: encrypted,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Cloud push failed.");
    setCloudStatus(`Encrypted backup pushed ${formatDateTime(result.updatedAt)}.`);
  } catch (error) {
    setCloudStatus(error.message || "Cloud push failed.");
  }
}

async function pullCloudBackup() {
  const credentials = getCloudCredentials();
  if (!credentials) return;
  if (!confirm("Replace this browser's local MTHD data with the encrypted MongoDB backup?")) return;

  setCloudStatus("Fetching encrypted backup...");
  try {
    const params = new URLSearchParams({ vaultId: credentials.vaultId });
    const response = await fetch(`/api/sync?${params.toString()}`, {
      headers: {
        "x-mthd-vault-secret": credentials.secret,
      },
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Cloud pull failed.");
    if (!result.data) {
      setCloudStatus("No backup found for this vault.");
      return;
    }

    state = normalizeState(await decryptVaultPayload(result.data, credentials.secret));
    saveState();
    render();
    setCloudStatus(`Encrypted backup pulled ${result.updatedAt ? formatDateTime(result.updatedAt) : ""}.`);
  } catch (error) {
    setCloudStatus(error.message || "Cloud pull failed.");
  }
}

function getCloudCredentials() {
  const vaultId = $("#cloudVaultId").value.trim();
  const secret = $("#cloudVaultSecret").value;

  if (!vaultId || !secret) {
    setCloudStatus("Enter a vault ID and vault secret.");
    return null;
  }

  return { vaultId, secret };
}

function setCloudStatus(message) {
  $("#cloudSyncStatus").textContent = message;
}

async function encryptVaultPayload(payload, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(secret, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    version: 1,
    algorithm: "AES-GCM",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptVaultPayload(payload, secret) {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const key = await deriveVaultKey(secret, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function deriveVaultKey(secret, salt) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function parsePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}

function signedNumber(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, 1)}`;
}

function formatDose(doseMg) {
  if (!Number.isFinite(doseMg)) return "N/A";
  if (doseMg < 1) return `${formatNumber(doseMg * 1000, 2)} mcg`;
  return `${formatNumber(doseMg, 3)} mg`;
}

function formatWeight(weight) {
  if (!weight) return "N/A";
  return `${formatNumber(weight.value, 1)} ${weight.unit}`;
}

function toDateInput(date) {
  const value = new Date(date);
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function toDateTimeInput(date) {
  const value = new Date(date);
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseDateValue(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function relativeDateLabel(value) {
  const target = parseDateValue(value);
  const now = new Date();
  const diffDays = Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays < 7) return `In ${diffDays}d`;
  return formatDate(target);
}

function startOfDay(value) {
  const date = parseDateValue(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseDateValue(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

function titleCase(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(callback, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}
