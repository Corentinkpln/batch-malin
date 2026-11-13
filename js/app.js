/**
 * Batch Malin V2.1 — Contrôleur principal, recettes personnelles, partage URL & LocalStorage (app.js)
 */
(function (global) {
  "use strict";

  const STORAGE_KEYS = {
    PREFS: "batch_malin_prefs_v2",
    FAVORITES: "batch_malin_favorites_v2",
    CUSTOM_RECIPES: "batch_malin_custom_recipes_v2",
    CHECKED_SHOPPING: "batch_malin_checked_shop_v2",
    DONE_STEPS: "batch_malin_done_steps_v2"
  };

  const RECIPE_FILES = [
    "data/chicken.json",
    "data/beef.json",
    "data/fish.json",
    "data/vegetarian.json",
    "data/pasta.json",
    "data/rice.json"
  ];

  const CATEGORY_LABELS = {
    chicken: "Volaille",
    beef: "Bœuf",
    fish: "Poisson",
    vegetarian: "Végétarien",
    pasta: "Pâtes",
    rice: "Riz & Bowls"
  };

  const DEFAULT_PREFS = {
    budget: 35,
    days: 5,
    mealsPerDay: 2,
    servings: 1,
    maxTime: 90,
    diet: "all",
    skill: "intermediate",
    startTime: "18:00",
    calorieTargetEnabled: false,
    targetCalories: 600,
    pantryItems: [],
    excludedItems: [],
    equipment: ["Air Fryer", "Four", "Plaques induction", "Micro-ondes"]
  };

  const state = {
    equipmentList: [],
    ingredientsCatalog: {},
    baseRecipes: [],
    customRecipes: [],
    indexedRecipes: { recipes: [], ingredientToRecipes: new Map() },
    prefs: { ...DEFAULT_PREFS },
    favorites: new Set(),
    checkedShopping: new Set(),
    doneBatchSteps: new Set(),
    currentPlan: null,
    currentShopping: null,
    currentSchedule: null,
    variantSeed: 0
  };

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* --------------------------------------------------------------------------
     Encodage UTF-8 Base64 sûr pour le partage par URL (#plan=...)
     -------------------------------------------------------------------------- */
  function encodeSharePayload(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeSharePayload(encoded) {
    try {
      const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------------------------
     Icônes SVG minimalistes
     -------------------------------------------------------------------------- */
  function getEquipmentIconSvg(iconKey) {
    const icons = {
      airfryer: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="4"/><path d="M5 13h14"/><circle cx="12" cy="8" r="2"/></svg>`,
      oven: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/><rect x="7" y="12" width="10" height="5" rx="1"/></svg>`,
      induction: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="12" r="3"/><circle cx="16" cy="12" r="2"/></svg>`,
      microwave: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="3"/><rect x="5" y="9" width="10" height="6" rx="1"/><line x1="18" y1="10" x2="18" y2="14"/></svg>`,
      pot: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7z"/><path d="M8 6h8"/><path d="M2 10h2M20 10h2"/></svg>`,
      blender: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h10l-1.5 11h-7L7 3z"/><rect x="6" y="14" width="12" height="6" rx="2"/></svg>`
    };
    return icons[iconKey] || icons.pot;
  }

  /* --------------------------------------------------------------------------
     Persistence LocalStorage
     -------------------------------------------------------------------------- */
  function loadLocalStorage() {
    try {
      const savedPrefs = JSON.parse(localStorage.getItem(STORAGE_KEYS.PREFS) || "null");
      if (savedPrefs && typeof savedPrefs === "object") {
        state.prefs = { ...DEFAULT_PREFS, ...savedPrefs };
      }
      const savedFavs = JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES) || "[]");
      if (Array.isArray(savedFavs)) state.favorites = new Set(savedFavs);

      const savedCustom = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_RECIPES) || "[]");
      if (Array.isArray(savedCustom)) state.customRecipes = savedCustom;

      const savedShop = JSON.parse(localStorage.getItem(STORAGE_KEYS.CHECKED_SHOPPING) || "[]");
      if (Array.isArray(savedShop)) state.checkedShopping = new Set(savedShop);

      const savedSteps = JSON.parse(localStorage.getItem(STORAGE_KEYS.DONE_STEPS) || "[]");
      if (Array.isArray(savedSteps)) state.doneBatchSteps = new Set(savedSteps);
    } catch (err) {
      console.warn("Lecture LocalStorage ignorée :", err);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(state.prefs));
    } catch (err) {
      console.warn(err);
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(Array.from(state.favorites)));
      updateHeaderCounters();
    } catch (err) {
      console.warn(err);
    }
  }

  function saveCustomRecipes() {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_RECIPES, JSON.stringify(state.customRecipes));
      rebuildCombinedIndex();
      updateHeaderCounters();
    } catch (err) {
      console.warn(err);
    }
  }

  function saveCheckedShopping() {
    try {
      localStorage.setItem(STORAGE_KEYS.CHECKED_SHOPPING, JSON.stringify(Array.from(state.checkedShopping)));
    } catch (err) {
      console.warn(err);
    }
  }

  function saveDoneBatchSteps() {
    try {
      localStorage.setItem(STORAGE_KEYS.DONE_STEPS, JSON.stringify(Array.from(state.doneBatchSteps)));
    } catch (err) {
      console.warn(err);
    }
  }

  function rebuildCombinedIndex() {
    const combined = [...state.baseRecipes, ...state.customRecipes];
    state.indexedRecipes = global.BatchPlanner.buildRecipeIndex(combined);
    const countEl = document.getElementById("header-recipe-count");
    if (countEl) countEl.textContent = `${combined.length} recettes indexées`;
  }

  /* --------------------------------------------------------------------------
     Chargement JSON strict
     -------------------------------------------------------------------------- */
  async function loadAllData() {
    const banner = document.getElementById("cors-banner");

    if (window.location.protocol === "file:") {
      banner.classList.remove("hidden");
      return;
    }

    async function fetchJsonStrict(path) {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`${path} introuvable (HTTP ${response.status})`);
      try {
        return await response.json();
      } catch {
        throw new Error(`${path} contient une erreur de syntaxe JSON`);
      }
    }

    try {
      const [equipRes, ingRes, ...recipeResults] = await Promise.all([
        fetchJsonStrict("data/equipment.json"),
        fetchJsonStrict("data/ingredients.json"),
        ...RECIPE_FILES.map((path) =>
          fetchJsonStrict(path).catch((err) => {
            console.warn(err.message);
            return [];
          })
        )
      ]);

      state.equipmentList = Array.isArray(equipRes) ? equipRes : [];
      state.ingredientsCatalog = ingRes && typeof ingRes === "object" ? ingRes : {};
      state.baseRecipes = recipeResults.flat().filter((r) => r && r.id && r.name);

      populateIngredientsDatalist();
      rebuildCombinedIndex();
      banner.classList.add("hidden");
    } catch (error) {
      console.error("Erreur de chargement JSON :", error);
      banner.querySelector(".cors-banner__badge").textContent = "Erreur Fichier JSON";
      banner.querySelector("p").textContent = error.message;
      banner.classList.remove("hidden");
      document.getElementById("header-recipe-count").textContent = "Erreur données";
    }
  }

  function populateIngredientsDatalist() {
    const dl = document.getElementById("ingredients-datalist");
    if (!dl) return;
    const keys = Object.keys(state.ingredientsCatalog).sort((a, b) => a.localeCompare(b, "fr"));
    dl.innerHTML = keys.map((k) => `<option value="${escapeHtml(k)}"></option>`).join("");
  }

  /* --------------------------------------------------------------------------
     Synchronisation UI des paramètres
     -------------------------------------------------------------------------- */
  function syncInputsFromPrefs() {
    document.getElementById("input-budget").value = state.prefs.budget;
    document.getElementById("input-days").value = state.prefs.days;
    document.getElementById("input-meals-per-day").value = state.prefs.mealsPerDay;
    document.getElementById("input-servings").value = state.prefs.servings;
    document.getElementById("input-max-time").value = state.prefs.maxTime;
    document.getElementById("input-diet").value = state.prefs.diet;
    document.getElementById("input-skill").value = state.prefs.skill;
    document.getElementById("input-start-time").value = state.prefs.startTime;

    const calToggle = document.getElementById("toggle-calorie-target");
    const calSlider = document.getElementById("input-target-calories");
    const calControls = document.getElementById("calorie-target-controls");
    calToggle.checked = Boolean(state.prefs.calorieTargetEnabled);
    calSlider.value = state.prefs.targetCalories || 600;
    calSlider.disabled = !calToggle.checked;
    calControls.classList.toggle("is-disabled", !calToggle.checked);
    document.getElementById("display-target-calories").textContent = calSlider.value;

    document.querySelectorAll(".segmented-btn").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.meals) === Number(state.prefs.mealsPerDay));
    });

    updateConfigHints();
    renderTagContainers();
    renderEquipmentCards();
  }

  function updateConfigHints() {
    const budget = Number(state.prefs.budget);
    const days = Number(state.prefs.days);
    const mealsPerDay = Number(state.prefs.mealsPerDay);
    const servings = Number(state.prefs.servings);
    const maxTime = Number(state.prefs.maxTime);

    const totalMeals = days * mealsPerDay;
    const totalPortions = totalMeals * servings;
    const perPortion = budget / Math.max(1, totalPortions);

    document.getElementById("display-budget").textContent = budget;
    document.getElementById("display-days").textContent = days;
    document.getElementById("display-meals-per-day").textContent = mealsPerDay;
    document.getElementById("display-servings").textContent = servings;
    document.getElementById("display-max-time").textContent = maxTime;

    document.getElementById("hint-per-meal").textContent = `Soit ~${perPortion.toFixed(2).replace(".", ",")} € / portion`;
    document.getElementById("hint-total-meals").textContent = `${totalMeals} repas à préparer`;
    document.getElementById("hint-total-portions").textContent = `${totalPortions} portions totales`;
  }

  function renderTagContainers() {
    const pantryBox = document.getElementById("pantry-tags");
    pantryBox.innerHTML = (state.prefs.pantryItems || [])
      .map(
        (item, idx) =>
          `<span class="filter-tag filter-tag--pantry">${escapeHtml(item)} <button type="button" data-remove-pantry="${idx}" aria-label="Retirer ${escapeHtml(item)}">×</button></span>`
      )
      .join("");

    const excludeBox = document.getElementById("exclude-tags");
    excludeBox.innerHTML = (state.prefs.excludedItems || [])
      .map(
        (item, idx) =>
          `<span class="filter-tag filter-tag--exclude">${escapeHtml(item)} <button type="button" data-remove-exclude="${idx}" aria-label="Retirer ${escapeHtml(item)}">×</button></span>`
      )
      .join("");
  }

  function renderEquipmentCards() {
    const grid = document.getElementById("equipment-grid");
    const selectedSet = new Set(state.prefs.equipment);

    grid.innerHTML = state.equipmentList
      .map((eq) => {
        const isSelected = selectedSet.has(eq.name);
        return `
          <button type="button" class="equip-card ${isSelected ? "is-selected" : ""}" data-equip="${escapeHtml(eq.name)}" aria-pressed="${isSelected}">
            <div class="equip-card__top">
              <span class="equip-card__icon">${getEquipmentIconSvg(eq.icon)}</span>
              <span class="equip-card__check" aria-hidden="true">✓</span>
            </div>
            <div>
              <div class="equip-card__name">${escapeHtml(eq.name)}</div>
              <div class="equip-card__cat">${escapeHtml(eq.category)}</div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  /* --------------------------------------------------------------------------
     Génération & Restitution du Plan
     -------------------------------------------------------------------------- */
  function runFullGeneration(resetChecklists = true) {
    if (resetChecklists) {
      state.checkedShopping.clear();
      state.doneBatchSteps.clear();
      saveCheckedShopping();
      saveDoneBatchSteps();
    }

    const plan = global.BatchPlanner.generatePlan(state.indexedRecipes, state.prefs, {
      seed: state.variantSeed
    });
    applyPlanAndRender(plan);
  }

  function applyPlanAndRender(plan) {
    const shopping = global.BatchShopping.buildShoppingList(
      plan.selectedRecipes,
      state.ingredientsCatalog,
      state.prefs.pantryItems
    );
    const schedule = global.BatchScheduler.generateBatchSchedule(
      plan.selectedRecipes,
      shopping,
      state.prefs.startTime,
      state.prefs.days
    );

    state.currentPlan = plan;
    state.currentShopping = shopping;
    state.currentSchedule = schedule;

    renderAllResults();
  }

  function renderAllResults() {
    const plan = state.currentPlan;
    const shopping = state.currentShopping;
    const schedule = state.currentSchedule;
    if (!plan) return;

    const noticeEl = document.getElementById("plan-notice");
    if (plan.notice) {
      noticeEl.textContent = plan.notice;
      noticeEl.classList.remove("hidden");
    } else {
      noticeEl.classList.add("hidden");
    }

    // KPI 1 : Coût & Budget
    const displayCost = shopping.totalEstimatedCost;
    const maxBudget = Number(state.prefs.budget);
    const costPerPortion = displayCost / Math.max(1, plan.totalPortions);
    const budgetRatio = Math.min(100, Math.round((displayCost / Math.max(1, maxBudget)) * 100));

    document.getElementById("kpi-total-cost").textContent = `${displayCost.toFixed(2).replace(".", ",")} €`;
    document.getElementById("kpi-cost-detail").textContent =
      shopping.savedFromPantry > 0
        ? `${costPerPortion.toFixed(2).replace(".", ",")} € / portion · -${shopping.savedFromPantry.toFixed(2).replace(".", ",")} € via frigo`
        : `${costPerPortion.toFixed(2).replace(".", ",")} € / portion · ${plan.totalPortions} portions`;

    const budgetStatus = document.getElementById("kpi-budget-status");
    const budgetBar = document.getElementById("kpi-budget-bar");
    budgetBar.style.width = `${budgetRatio}%`;

    if (displayCost <= maxBudget) {
      budgetStatus.textContent = `-${(maxBudget - displayCost).toFixed(2).replace(".", ",")} € sous budget`;
      budgetStatus.className = "kpi-pill kpi-pill--green";
      budgetBar.className = "progress-fill progress-fill--blue";
    } else {
      budgetStatus.textContent = `+${(displayCost - maxBudget).toFixed(2).replace(".", ",")} €`;
      budgetStatus.className = "kpi-pill kpi-pill--red";
      budgetBar.className = "progress-fill progress-fill--red";
    }

    // KPI 2 : Anti-gaspi
    document.getElementById("kpi-synergy-score").textContent = `${plan.synergyScore} %`;
    document.getElementById("kpi-synergy-detail").textContent =
      plan.sharedIngredients.length > 0
        ? `${plan.sharedIngredients.length} ingrédients communs (${plan.sharedIngredients.slice(0, 3).join(", ")})`
        : `${shopping.totalItemsCount} ingrédients au total`;
    document.getElementById("kpi-synergy-bar").style.width = `${plan.synergyScore}%`;

    // KPI 3 : Temps Batch Cooking
    const maxTime = Number(state.prefs.maxTime);
    const timeRatio = Math.min(100, Math.round((schedule.totalDurationMin / Math.max(1, maxTime)) * 100));
    document.getElementById("kpi-total-time").textContent = `${schedule.totalDurationMin} min`;
    document.getElementById("kpi-time-detail").textContent = `${schedule.startClock} → ${schedule.endClock} (max ${maxTime} min)`;
    document.getElementById("kpi-time-saved").textContent = `-${schedule.timeSavedMin} min gagnées`;
    document.getElementById("kpi-time-bar").style.width = `${timeRatio}%`;

    // KPI 4 : Nutrition
    document.getElementById("kpi-avg-calories").textContent = `${plan.nutrition.avgCalories} kcal`;
    document.getElementById("kpi-weekly-kcal").textContent = `${plan.nutrition.totalCalories.toLocaleString("fr-FR")} kcal total`;
    document.getElementById("kpi-avg-protein").textContent = `${plan.nutrition.avgProtein}g`;
    document.getElementById("kpi-avg-carbs").textContent = `${plan.nutrition.avgCarbs}g`;
    document.getElementById("kpi-avg-fat").textContent = `${plan.nutrition.avgFat}g`;

    document.getElementById("tab-shopping-count").textContent = shopping.totalItemsCount;
    updateHeaderCounters();

    renderMenuCards(plan);
    renderShoppingView(shopping);
    renderBatchTimeline(schedule);
    renderCustomRecipesView();
    renderFavoritesView();
  }

  /* --------------------------------------------------------------------------
     Rendu des cartes recettes (Menu, Perso, Favoris)
     -------------------------------------------------------------------------- */
  function renderMenuCards(plan) {
    const grid = document.getElementById("menu-grid");
    const sharedSet = new Set(plan.sharedIngredients);
    const pantrySet = new Set((state.prefs.pantryItems || []).map(global.BatchPlanner.normalizeText));

    if (!plan.selectedRecipes.length) {
      grid.innerHTML = `<div class="empty-state">Aucune recette sélectionnée. Ajustez vos appareils ou vos exclusions.</div>`;
      return;
    }

    document.getElementById("menu-summary-text").textContent =
      `${plan.selectedRecipes.length} recettes distinctes pour couvrir ${plan.totalMeals} repas (${plan.totalPortions} portions).`;

    grid.innerHTML = plan.selectedRecipes
      .map((recipe) => renderSingleRecipeCard(recipe, sharedSet, pantrySet, "plan"))
      .join("");
  }

  function renderSingleRecipeCard(recipe, sharedSet, pantrySet, mode) {
    const isFav = state.favorites.has(recipe.id);
    const totalTime = (Number(recipe.prepTime) || 0) + (Number(recipe.cookTime) || 0);
    const catLabel = CATEGORY_LABELS[recipe.category] || recipe.category;
    const portions = recipe.totalPortions || state.prefs.servings;
    const scale = recipe._calorieScale || 1;
    const unitPrice = recipe._effectivePrice != null ? recipe._effectivePrice : Number(recipe.price);
    const unitCal = recipe._effectiveCalories != null ? recipe._effectiveCalories : recipe.calories;
    const unitProt = recipe._effectiveProtein != null ? recipe._effectiveProtein : recipe.protein;
    const unitCarbs = recipe._effectiveCarbs != null ? recipe._effectiveCarbs : recipe.carbs;
    const unitFat = recipe._effectiveFat != null ? recipe._effectiveFat : recipe.fat;

    const ingChips = (recipe.ingredients || [])
      .slice(0, 6)
      .map((ing) => {
        const norm = global.BatchPlanner.normalizeText(ing.name);
        const isPantry = pantrySet && pantrySet.has(norm);
        const isShared = sharedSet && sharedSet.has(norm);
        const cls = isPantry ? "is-pantry" : isShared ? "is-shared" : "";
        return `<span class="ing-chip ${cls}">${escapeHtml(ing.name)}</span>`;
      })
      .join("");

    return `
      <article class="recipe-card">
        <div class="recipe-card__header">
          <div class="recipe-badges">
            <span class="cat-badge">${escapeHtml(catLabel)}</span>
            ${recipe.isCustom ? `<span class="custom-badge">Perso</span>` : ""}
            ${mode === "plan" ? `<span class="portions-badge">${portions} portions</span>` : ""}
            ${recipe.freezable ? `<span class="freeze-badge">Congélable</span>` : ""}
            ${mode === "plan" && scale !== 1 ? `<span class="scale-badge">Portion ×${scale}</span>` : ""}
          </div>
          <button type="button" class="fav-btn ${isFav ? "is-fav" : ""}" data-toggle-fav="${recipe.id}" aria-label="Ajouter aux favoris">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
        </div>

        <h3 class="recipe-card__title">${escapeHtml(recipe.name)}</h3>

        <div class="recipe-card__metrics">
          <div>
            <span class="metric-item__val">${unitPrice.toFixed(2).replace(".", ",")} €</span>
            <span class="metric-item__lbl">/ portion</span>
          </div>
          <div>
            <span class="metric-item__val">${totalTime} min</span>
            <span class="metric-item__lbl">${recipe.prepTime}m + ${recipe.cookTime}m</span>
          </div>
          <div>
            <span class="metric-item__val">${unitCal}</span>
            <span class="metric-item__lbl">kcal / port.</span>
          </div>
        </div>

        <div class="recipe-card__macros">
          <span>Protéines : <strong>${unitProt}g</strong></span>
          <span>Glucides : <strong>${unitCarbs}g</strong></span>
          <span>Lipides : <strong>${unitFat}g</strong></span>
        </div>

        <div class="recipe-card__ingredients">${ingChips}</div>

        <div class="recipe-card__equip">
          Matériel : ${escapeHtml((recipe.equipment || []).join(" · ") || "Sans cuisson")}
        </div>

        <div class="recipe-card__actions">
          <button type="button" class="btn btn--subtle btn--sm" data-inspect-recipe="${recipe.id}">
            Voir la recette
          </button>
          ${
            mode === "plan"
              ? `<button type="button" class="btn btn--ghost btn--sm" data-replace-recipe="${recipe.id}">Remplacer</button>`
              : mode === "custom"
              ? `<button type="button" class="btn btn--danger-ghost btn--sm" data-delete-custom="${recipe.id}">Supprimer</button>`
              : ""
          }
        </div>
      </article>
    `;
  }

  /* --------------------------------------------------------------------------
     Rendu Liste de courses
     -------------------------------------------------------------------------- */
  function renderShoppingView(shopping) {
    const container = document.getElementById("shopping-container");

    if (!shopping.items.length) {
      container.innerHTML = `<div class="empty-state">Aucun ingrédient à afficher.</div>`;
      return;
    }

    const aislesHtml = shopping.groupedByAisle
      .map((group) => {
        const rows = group.items
          .map((item) => {
            const checked = state.checkedShopping.has(item.id);
            return `
              <li class="shopping-item ${checked ? "is-checked" : ""} ${item.inPantry ? "is-in-pantry" : ""}" data-toggle-shop="${escapeHtml(item.id)}">
                <div class="shopping-item__left">
                  <span class="shopping-checkbox" aria-hidden="true">✓</span>
                  <div>
                    <span class="shopping-item__name">${escapeHtml(item.name)}</span>
                    <span class="shopping-item__sub">
                      ${item.inPantry ? "Déjà dans votre frigo" : item.recipeCount > 1 ? `Mutualisé sur ${item.recipeCount} recettes` : escapeHtml(item.recipesList[0])}
                    </span>
                  </div>
                </div>
                <div class="shopping-item__right">
                  <span class="shopping-item__qty">${escapeHtml(item.formattedQty)}</span>
                  <span class="shopping-item__price">
                    ${item.inPantry ? "0,00 € (en stock)" : `~${item.estimatedCost.toFixed(2).replace(".", ",")} €`}
                  </span>
                </div>
              </li>
            `;
          })
          .join("");

        return `
          <section class="aisle-card">
            <h3 class="aisle-card__title">
              <span>${escapeHtml(group.aisle)}</span>
              <span class="kpi-pill">${group.items.length}</span>
            </h3>
            <ul class="shopping-list">${rows}</ul>
          </section>
        `;
      })
      .join("");

    const mutualizedCount = shopping.items.filter((i) => i.recipeCount > 1).length;

    container.innerHTML = `
      <div class="aisles-grid">${aislesHtml}</div>
      <aside class="shopping-summary-card">
        <h3 class="subsection-title" style="margin-bottom: 12px;">Synthèse panier</h3>
        <div class="summary-row">
          <span>Articles distincts</span>
          <strong>${shopping.totalItemsCount}</strong>
        </div>
        <div class="summary-row">
          <span>Ingrédients mutualisés</span>
          <strong>${mutualizedCount}</strong>
        </div>
        <div class="summary-row">
          <span>Économie restes frigo</span>
          <strong style="color: var(--green);">-${shopping.savedFromPantry.toFixed(2).replace(".", ",")} €</strong>
        </div>
        <div class="summary-row">
          <span>Coût par portion</span>
          <strong>${(shopping.totalEstimatedCost / Math.max(1, state.currentPlan.totalPortions)).toFixed(2).replace(".", ",")} €</strong>
        </div>
        <div class="summary-row">
          <span>Total à payer</span>
          <strong style="color: var(--accent);">${shopping.totalEstimatedCost.toFixed(2).replace(".", ",")} €</strong>
        </div>
      </aside>
    `;
  }

  /* --------------------------------------------------------------------------
     Rendu Planning Batch Cooking (avec toutes les étapes détaillées)
     -------------------------------------------------------------------------- */
  function renderBatchTimeline(schedule) {
    const container = document.getElementById("batch-timeline");

    if (!schedule.steps.length) {
      container.innerHTML = `<div class="empty-state">Aucune étape de planification disponible.</div>`;
      return;
    }

    container.innerHTML = schedule.steps
      .map((step) => {
        const isDone = state.doneBatchSteps.has(step.id);
        const subStepsHtml =
          Array.isArray(step.subSteps) && step.subSteps.length > 0
            ? `<ol class="timeline-substeps">${step.subSteps
                .map((s) => `<li>${escapeHtml(s)}</li>`)
                .join("")}</ol>`
            : "";

        return `
          <article class="timeline-step ${isDone ? "is-done" : ""}" data-toggle-step="${escapeHtml(step.id)}" style="cursor: pointer;">
            <div class="timeline-step__time">
              <span class="timeline-time-main">${escapeHtml(step.clock)}</span>
              <span class="timeline-time-dur">${step.durationMin} min</span>
            </div>
            <div class="timeline-step__body">
              <div class="timeline-step__main">
                <h3 class="timeline-step__title">
                  ${escapeHtml(step.title)}
                  ${step.isCustom ? `<span class="custom-badge" style="margin-left: 8px; vertical-align: middle;">Perso</span>` : ""}
                </h3>
                <p class="timeline-step__desc">${escapeHtml(step.description)}</p>
                ${subStepsHtml}
              </div>
              <div class="timeline-step__tags">
                <span class="step-type-pill step-type-pill--${step.type}">${escapeHtml(step.typeLabel)}</span>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  /* --------------------------------------------------------------------------
     Rendu Mes Recettes Personnelles & Favoris
     -------------------------------------------------------------------------- */
  function renderCustomRecipesView() {
    const grid = document.getElementById("custom-recipes-grid");
    if (!state.customRecipes.length) {
      grid.innerHTML = `<div class="empty-state">Vous n’avez pas encore créé de recette personnelle. Cliquez sur <strong>« + Créer une recette »</strong> pour ajouter vos plats fétiches.</div>`;
      return;
    }

    grid.innerHTML = state.customRecipes
      .map((r) => renderSingleRecipeCard(r, null, null, "custom"))
      .join("");
  }

  function renderFavoritesView() {
    const grid = document.getElementById("favorites-grid");
    const favRecipes = state.indexedRecipes.recipes.filter((r) => state.favorites.has(r.id));

    if (!favRecipes.length) {
      grid.innerHTML = `<div class="empty-state">Aucune recette favorite. Cliquez sur le cœur d’une recette pour la sauvegarder.</div>`;
      return;
    }

    grid.innerHTML = favRecipes
      .map((r) => renderSingleRecipeCard(r, null, null, "fav"))
      .join("");
  }

  function updateHeaderCounters() {
    document.getElementById("favorites-count").textContent = state.favorites.size;
    document.getElementById("tab-fav-count").textContent = state.favorites.size;
    document.getElementById("tab-custom-count").textContent = state.customRecipes.length;
  }

  /* --------------------------------------------------------------------------
     Modale Détail Recette
     -------------------------------------------------------------------------- */
  function openRecipeModal(recipeId) {
    const recipe =
      (state.currentPlan && state.currentPlan.selectedRecipes.find((r) => r.id === recipeId)) ||
      state.indexedRecipes.recipes.find((r) => r.id === recipeId);

    if (!recipe) return;

    const mult = recipe.totalPortions || state.prefs.servings;
    const scale = recipe._calorieScale || 1;
    const unitPrice = recipe._effectivePrice != null ? recipe._effectivePrice : Number(recipe.price);
    const unitCal = recipe._effectiveCalories != null ? recipe._effectiveCalories : recipe.calories;
    const unitProt = recipe._effectiveProtein != null ? recipe._effectiveProtein : recipe.protein;
    const unitCarbs = recipe._effectiveCarbs != null ? recipe._effectiveCarbs : recipe.carbs;
    const unitFat = recipe._effectiveFat != null ? recipe._effectiveFat : recipe.fat;

    const ingredientsHtml = (recipe.ingredients || [])
      .map((ing) => {
        const scaledQty = Math.round(ing.quantity * scale * mult * 10) / 10;
        return `<li><strong>${escapeHtml(ing.name)}</strong> : ${scaledQty.toLocaleString("fr-FR")} ${escapeHtml(ing.unit)}</li>`;
      })
      .join("");

    const stepsHtml = (recipe.steps || []).map((st) => `<li>${escapeHtml(st)}</li>`).join("");

    document.getElementById("modal-recipe-body").innerHTML = `
      <div class="recipe-badges">
        <span class="cat-badge">${escapeHtml(CATEGORY_LABELS[recipe.category] || recipe.category)}</span>
        ${recipe.isCustom ? `<span class="custom-badge">Recette personnelle</span>` : ""}
      </div>
      <h2 id="modal-recipe-title" style="margin: 12px 0 8px; font-size: 1.6rem; letter-spacing: -0.025em;">${escapeHtml(recipe.name)}</h2>
      <p style="margin: 0 0 18px; color: var(--text-secondary);">
        Quantités ajustées pour <strong>${mult} portion${mult > 1 ? "s" : ""}</strong> ·
        Préparation ${recipe.prepTime} min · Cuisson ${recipe.cookTime} min ·
        ${unitCal} kcal / portion
      </p>
      <div class="macro-mini-bars" style="margin-bottom: 20px;">
        <span class="macro-tag macro-tag--p">Protéines <strong>${unitProt}g</strong></span>
        <span class="macro-tag macro-tag--c">Glucides <strong>${unitCarbs}g</strong></span>
        <span class="macro-tag macro-tag--f">Lipides <strong>${unitFat}g</strong></span>
        <span class="macro-tag">Coût total : <strong>${(unitPrice * mult).toFixed(2).replace(".", ",")} €</strong></span>
      </div>
      <h3 class="subsection-title">Ingrédients nécessaires</h3>
      <ul class="modal-list">${ingredientsHtml}</ul>
      <h3 class="subsection-title">Étapes de préparation</h3>
      <ol class="modal-list">${stepsHtml}</ol>
    `;

    document.getElementById("recipe-modal").classList.remove("hidden");
  }

  function closeRecipeModal() {
    document.getElementById("recipe-modal").classList.add("hidden");
  }

  /* --------------------------------------------------------------------------
     Modale Création de Recette Personnelle + Estimation Auto
     -------------------------------------------------------------------------- */
  function openCustomRecipeModal() {
    const form = document.getElementById("custom-recipe-form");
    form.reset();
    document.getElementById("cr-auto-macros").checked = true;
    document.getElementById("cr-manual-overrides").classList.add("hidden");

    const equipContainer = document.getElementById("cr-equipment-list");
    equipContainer.innerHTML = state.equipmentList
      .map(
        (eq, idx) =>
          `<button type="button" class="cr-equip-chip ${idx === 2 ? "is-active" : ""}" data-cr-equip="${escapeHtml(eq.name)}">${escapeHtml(eq.name)}</button>`
      )
      .join("");

    const rowsContainer = document.getElementById("cr-ingredients-rows");
    rowsContainer.innerHTML = "";
    addCustomIngredientRow("Poulet", 150, "g");
    addCustomIngredientRow("Riz basmati", 75, "g");
    addCustomIngredientRow("Carottes", 80, "g");

    recalculateCustomRecipePreview();
    document.getElementById("custom-recipe-modal").classList.remove("hidden");
  }

  function closeCustomRecipeModal() {
    document.getElementById("custom-recipe-modal").classList.add("hidden");
  }

  function addCustomIngredientRow(defaultName = "", defaultQty = 100, defaultUnit = "g") {
    const rowsContainer = document.getElementById("cr-ingredients-rows");
    const row = document.createElement("div");
    row.className = "cr-ing-row";
    row.innerHTML = `
      <input type="text" class="select-input cr-ing-name" list="ingredients-datalist" placeholder="Ingrédient (ex: Poulet)" value="${escapeHtml(defaultName)}" />
      <input type="number" class="select-input cr-ing-qty" min="0.1" step="any" placeholder="Qté" value="${defaultQty}" />
      <select class="select-input cr-ing-unit">
        <option value="g" ${defaultUnit === "g" ? "selected" : ""}>g</option>
        <option value="ml" ${defaultUnit === "ml" ? "selected" : ""}>ml</option>
        <option value="pièce" ${defaultUnit === "pièce" ? "selected" : ""}>pièce</option>
        <option value="gousse" ${defaultUnit === "gousse" ? "selected" : ""}>gousse</option>
        <option value="boîte" ${defaultUnit === "boîte" ? "selected" : ""}>boîte</option>
      </select>
      <button type="button" class="btn btn--danger-ghost cr-remove-ing" aria-label="Supprimer cette ligne">×</button>
    `;
    rowsContainer.appendChild(row);
  }

  function collectCustomIngredients() {
    const rows = document.querySelectorAll("#cr-ingredients-rows .cr-ing-row");
    const list = [];
    rows.forEach((row) => {
      const name = row.querySelector(".cr-ing-name").value.trim();
      const quantity = parseFloat(row.querySelector(".cr-ing-qty").value) || 0;
      const unit = row.querySelector(".cr-ing-unit").value;
      if (name && quantity > 0) {
        list.push({ name, quantity, unit });
      }
    });
    return list;
  }

  function estimateNutritionAndPriceFromIngredients(ingredients) {
    const catalogByNorm = new Map();
    Object.entries(state.ingredientsCatalog).forEach(([k, v]) => {
      catalogByNorm.set(global.BatchPlanner.normalizeText(k), v);
    });

    let price = 0;
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;

    ingredients.forEach((ing) => {
      const norm = global.BatchPlanner.normalizeText(ing.name);
      const meta = catalogByNorm.get(norm);
      const u = ing.unit.toLowerCase();

      if (meta) {
        let factor = 0;
        if (meta.unit === "kg" && u === "g") factor = ing.quantity / 1000;
        else if (meta.unit === "L" && u === "ml") factor = ing.quantity / 1000;
        else if (meta.unit === "g" && u === "g") factor = ing.quantity;
        else factor = ing.quantity;

        price += factor * (Number(meta.unitPrice) || 0);
        calories += factor * (Number(meta.kcalPerUnit) || 0);
        protein += factor * (Number(meta.pPerUnit) || 0);
        carbs += factor * (Number(meta.cPerUnit) || 0);
        fat += factor * (Number(meta.fPerUnit) || 0);
      } else {
        const fallbackFactor = u === "g" || u === "ml" ? ing.quantity / 100 : ing.quantity;
        price += fallbackFactor * 0.45;
        calories += fallbackFactor * 120;
        protein += fallbackFactor * 6;
        carbs += fallbackFactor * 14;
        fat += fallbackFactor * 4;
      }
    });

    return {
      price: Math.max(0.5, Math.round(price * 100) / 100),
      calories: Math.max(80, Math.round(calories)),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat)
    };
  }

  function recalculateCustomRecipePreview() {
    const auto = document.getElementById("cr-auto-macros").checked;
    const ingredients = collectCustomIngredients();
    const est = auto
      ? estimateNutritionAndPriceFromIngredients(ingredients)
      : {
          price: parseFloat(document.getElementById("cr-price").value) || 2.5,
          calories: parseInt(document.getElementById("cr-calories").value, 10) || 500,
          protein: parseInt(document.getElementById("cr-protein").value, 10) || 30,
          carbs: parseInt(document.getElementById("cr-carbs").value, 10) || 50,
          fat: parseInt(document.getElementById("cr-fat").value, 10) || 15
        };

    if (auto) {
      document.getElementById("cr-price").value = est.price.toFixed(2);
      document.getElementById("cr-calories").value = est.calories;
      document.getElementById("cr-protein").value = est.protein;
      document.getElementById("cr-carbs").value = est.carbs;
      document.getElementById("cr-fat").value = est.fat;
    }

    document.getElementById("cr-live-preview").innerHTML = `
      <span class="macro-tag">Prix : <strong>${est.price.toFixed(2).replace(".", ",")} €</strong></span>
      <span class="macro-tag">Énergie : <strong>${est.calories} kcal</strong></span>
      <span class="macro-tag macro-tag--p">Protéines <strong>${est.protein}g</strong></span>
      <span class="macro-tag macro-tag--c">Glucides <strong>${est.carbs}g</strong></span>
      <span class="macro-tag macro-tag--f">Lipides <strong>${est.fat}g</strong></span>
    `;
  }

  /* --------------------------------------------------------------------------
     Partage sans serveur via URL Hash (#plan=...)
     -------------------------------------------------------------------------- */
  async function shareCurrentPlanByUrl() {
    if (!state.currentPlan || !state.currentPlan.selectedRecipes.length) {
      showToast("Générez d'abord un plan avant de le partager");
      return;
    }

    const usedCustomRecipes = state.currentPlan.selectedRecipes
      .filter((r) => r.isCustom)
      .map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        price: r.price,
        prepTime: r.prepTime,
        cookTime: r.cookTime,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        freezable: r.freezable,
        batchFriendly: true,
        isCustom: true,
        equipment: r.equipment,
        ingredients: r.ingredients,
        steps: r.steps
      }));

    const payload = {
      v: 2,
      prefs: {
        budget: state.prefs.budget,
        days: state.prefs.days,
        mealsPerDay: state.prefs.mealsPerDay,
        servings: state.prefs.servings,
        maxTime: state.prefs.maxTime,
        diet: state.prefs.diet,
        skill: state.prefs.skill,
        startTime: state.prefs.startTime,
        calorieTargetEnabled: state.prefs.calorieTargetEnabled,
        targetCalories: state.prefs.targetCalories,
        pantryItems: state.prefs.pantryItems,
        excludedItems: state.prefs.excludedItems,
        equipment: state.prefs.equipment
      },
      slots: state.currentPlan.selectedRecipes.map((r) => ({ id: r.id, batches: r.batches })),
      custom: usedCustomRecipes
    };

    const encoded = encodeSharePayload(payload);
    const shareUrl = `${window.location.origin}${window.location.pathname}#plan=${encoded}`;
    window.history.replaceState(null, "", `#plan=${encoded}`);

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Lien de partage copié ! Envoyez-le sur WhatsApp ou par mail.");
    } catch {
      showToast("Lien mis à jour dans la barre d'adresse du navigateur.");
    }
  }

  function tryRestorePlanFromUrlHash() {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#plan=")) return false;

    const encoded = hash.slice(6);
    const payload = decodeSharePayload(encoded);
    if (!payload || !Array.isArray(payload.slots)) return false;

    if (payload.prefs && typeof payload.prefs === "object") {
      state.prefs = { ...DEFAULT_PREFS, ...payload.prefs };
    }

    if (Array.isArray(payload.custom) && payload.custom.length > 0) {
      const existingIds = new Set(state.customRecipes.map((r) => r.id));
      payload.custom.forEach((cr) => {
        if (!existingIds.has(cr.id)) {
          state.customRecipes.push({ ...cr, isCustom: true });
        }
      });
      rebuildCombinedIndex();
    }

    syncInputsFromPrefs();
    const restoredPlan = global.BatchPlanner.rebuildPlanFromSavedSlots(
      payload.slots,
      state.indexedRecipes,
      state.prefs
    );

    if (restoredPlan) {
      applyPlanAndRender(restoredPlan);
      showToast("Plan partagé chargé avec succès");
      return true;
    }
    return false;
  }

  /* --------------------------------------------------------------------------
     Toast & Navigation Onglets
     -------------------------------------------------------------------------- */
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === `panel-${tabName}`);
    });
  }

  /* --------------------------------------------------------------------------
     Écouteurs d'événements
     -------------------------------------------------------------------------- */
  function bindEvents() {
    const rangeMap = [
      ["input-budget", "budget"],
      ["input-days", "days"],
      ["input-servings", "servings"],
      ["input-max-time", "maxTime"]
    ];

    rangeMap.forEach(([elId, key]) => {
      document.getElementById(elId).addEventListener("input", (e) => {
        state.prefs[key] = Number(e.target.value);
        updateConfigHints();
        savePrefs();
      });
    });

    document.querySelectorAll(".segmented-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const meals = Number(btn.dataset.meals);
        state.prefs.mealsPerDay = meals;
        document.getElementById("input-meals-per-day").value = meals;
        document.querySelectorAll(".segmented-btn").forEach((b) =>
          b.classList.toggle("is-active", b === btn)
        );
        updateConfigHints();
        savePrefs();
      });
    });

    ["input-diet", "input-skill", "input-start-time"].forEach((id) => {
      document.getElementById(id).addEventListener("change", (e) => {
        const map = {
          "input-diet": "diet",
          "input-skill": "skill",
          "input-start-time": "startTime"
        };
        state.prefs[map[id]] = e.target.value;
        savePrefs();
      });
    });

    // Ciblage calorique
    document.getElementById("toggle-calorie-target").addEventListener("change", (e) => {
      const enabled = e.target.checked;
      state.prefs.calorieTargetEnabled = enabled;
      const slider = document.getElementById("input-target-calories");
      slider.disabled = !enabled;
      document.getElementById("calorie-target-controls").classList.toggle("is-disabled", !enabled);
      savePrefs();
    });

    document.getElementById("input-target-calories").addEventListener("input", (e) => {
      state.prefs.targetCalories = Number(e.target.value);
      document.getElementById("display-target-calories").textContent = e.target.value;
      savePrefs();
    });

    // Tags Vider mon frigo & Exclusions
    function addTagItem(inputId, listKey) {
      const input = document.getElementById(inputId);
      const val = input.value.trim();
      if (!val) return;
      const list = state.prefs[listKey] || [];
      if (!list.some((x) => global.BatchPlanner.normalizeText(x) === global.BatchPlanner.normalizeText(val))) {
        list.push(val);
        state.prefs[listKey] = list;
        savePrefs();
        renderTagContainers();
      }
      input.value = "";
    }

    document.getElementById("btn-add-pantry").addEventListener("click", () => addTagItem("pantry-input", "pantryItems"));
    document.getElementById("pantry-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTagItem("pantry-input", "pantryItems");
      }
    });

    document.getElementById("btn-add-exclude").addEventListener("click", () => addTagItem("exclude-input", "excludedItems"));
    document.getElementById("exclude-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTagItem("exclude-input", "excludedItems");
      }
    });

    // Matériel cliquable
    document.getElementById("equipment-grid").addEventListener("click", (e) => {
      const card = e.target.closest(".equip-card");
      if (!card) return;
      const name = card.dataset.equip;
      const set = new Set(state.prefs.equipment);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      state.prefs.equipment = Array.from(set);
      savePrefs();
      renderEquipmentCards();
    });

    document.getElementById("btn-equip-essentials").addEventListener("click", () => {
      state.prefs.equipment = ["Four", "Plaques induction", "Micro-ondes"];
      savePrefs();
      renderEquipmentCards();
      showToast("Matériel essentiel sélectionné");
    });

    document.getElementById("btn-equip-all").addEventListener("click", () => {
      state.prefs.equipment = state.equipmentList.map((e) => e.name);
      savePrefs();
      renderEquipmentCards();
      showToast("Tout le matériel sélectionné");
    });

    // Boutons Génération & Partage
    ["btn-generate-top", "btn-generate-main"].forEach((id) => {
      document.getElementById(id).addEventListener("click", () => {
        if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
        runFullGeneration(true);
        document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
        showToast("Plan de batch cooking optimisé généré");
      });
    });

    document.getElementById("btn-regenerate-variant").addEventListener("click", () => {
      state.variantSeed += 1;
      runFullGeneration(true);
      showToast("Nouvelle variante générée");
    });

    document.getElementById("btn-share-plan").addEventListener("click", shareCurrentPlanByUrl);

    document.getElementById("btn-reset-prefs").addEventListener("click", () => {
      state.prefs = { ...DEFAULT_PREFS, pantryItems: [], excludedItems: [] };
      savePrefs();
      syncInputsFromPrefs();
      runFullGeneration(true);
      showToast("Paramètres réinitialisés");
    });

    // Onglets
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.getElementById("btn-open-favorites").addEventListener("click", () => {
      switchTab("favorites");
      document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
    });

    // Ouverture modale recette personnelle
    ["btn-open-custom-modal", "btn-new-recipe-tab"].forEach((id) => {
      document.getElementById(id).addEventListener("click", openCustomRecipeModal);
    });

    document.getElementById("btn-add-cr-ingredient").addEventListener("click", () => {
      addCustomIngredientRow("", 100, "g");
      recalculateCustomRecipePreview();
    });

    document.getElementById("cr-auto-macros").addEventListener("change", (e) => {
      document.getElementById("cr-manual-overrides").classList.toggle("hidden", e.target.checked);
      recalculateCustomRecipePreview();
    });

    document.getElementById("custom-recipe-form").addEventListener("input", (e) => {
      if (
        e.target.closest("#cr-ingredients-rows") ||
        e.target.closest("#cr-manual-overrides")
      ) {
        recalculateCustomRecipePreview();
      }
    });

    document.getElementById("custom-recipe-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("cr-name").value.trim();
      const ingredients = collectCustomIngredients();

      if (!name) {
        showToast("Indiquez un nom pour votre recette");
        document.getElementById("cr-name").focus();
        return;
      }

      if (!ingredients.length) {
        showToast("Ajoutez au moins un ingrédient avec une quantité");
        return;
      }

      const selectedEquip = Array.from(
        document.querySelectorAll("#cr-equipment-list .cr-equip-chip.is-active")
      ).map((btn) => btn.dataset.crEquip);

      const rawSteps = document
        .getElementById("cr-steps")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const newRecipe = {
        id: Date.now(),
        name,
        category: document.getElementById("cr-category").value,
        price: Math.max(0.1, parseFloat(document.getElementById("cr-price").value) || 2.5),
        prepTime: Math.max(0, parseInt(document.getElementById("cr-prep").value, 10) || 10),
        cookTime: Math.max(0, parseInt(document.getElementById("cr-cook").value, 10) || 15),
        calories: Math.max(10, parseInt(document.getElementById("cr-calories").value, 10) || 500),
        protein: Math.max(0, parseInt(document.getElementById("cr-protein").value, 10) || 30),
        carbs: Math.max(0, parseInt(document.getElementById("cr-carbs").value, 10) || 50),
        fat: Math.max(0, parseInt(document.getElementById("cr-fat").value, 10) || 15),
        freezable: document.getElementById("cr-freezable").checked,
        batchFriendly: true,
        isCustom: true,
        equipment: selectedEquip.length ? selectedEquip : ["Plaques induction"],
        ingredients,
        steps: rawSteps.length
          ? rawSteps
          : ["Préparer et découper les ingrédients.", "Cuire selon le matériel choisi.", "Assembler et répartir en boîtes."]
      };

      state.customRecipes.push(newRecipe);
      saveCustomRecipes();
      runFullGeneration(true);
      closeCustomRecipeModal();
      switchTab("batch");
      showToast(`Recette « ${name} » ajoutée et intégrée au planning`);
    });

    // Délégation globale sur les clics dynamiques
    document.body.addEventListener("click", (e) => {
      const remPantry = e.target.closest("[data-remove-pantry]");
      if (remPantry) {
        state.prefs.pantryItems.splice(Number(remPantry.dataset.removePantry), 1);
        savePrefs();
        renderTagContainers();
        return;
      }

      const remExclude = e.target.closest("[data-remove-exclude]");
      if (remExclude) {
        state.prefs.excludedItems.splice(Number(remExclude.dataset.removeExclude), 1);
        savePrefs();
        renderTagContainers();
        return;
      }

      const crEquipChip = e.target.closest("[data-cr-equip]");
      if (crEquipChip) {
        crEquipChip.classList.toggle("is-active");
        return;
      }

      if (e.target.closest(".cr-remove-ing")) {
        const rows = document.querySelectorAll("#cr-ingredients-rows .cr-ing-row");
        if (rows.length > 1) {
          e.target.closest(".cr-ing-row").remove();
          recalculateCustomRecipePreview();
        }
        return;
      }

      const deleteCustomBtn = e.target.closest("[data-delete-custom]");
      if (deleteCustomBtn) {
        const id = Number(deleteCustomBtn.dataset.deleteCustom);
        state.customRecipes = state.customRecipes.filter((r) => r.id !== id);
        state.favorites.delete(id);
        saveCustomRecipes();
        saveFavorites();
        runFullGeneration(false);
        showToast("Recette personnelle supprimée");
        return;
      }

      const favBtn = e.target.closest("[data-toggle-fav]");
      if (favBtn) {
        const id = Number(favBtn.dataset.toggleFav);
        if (state.favorites.has(id)) {
          state.favorites.delete(id);
          showToast("Retiré des favoris");
        } else {
          state.favorites.add(id);
          showToast("Ajouté aux favoris");
        }
        saveFavorites();
        renderAllResults();
        return;
      }

      const inspectBtn = e.target.closest("[data-inspect-recipe]");
      if (inspectBtn) {
        openRecipeModal(Number(inspectBtn.dataset.inspectRecipe));
        return;
      }

      const replaceBtn = e.target.closest("[data-replace-recipe]");
      if (replaceBtn && state.currentPlan) {
        const id = Number(replaceBtn.dataset.replaceRecipe);
        const updatedPlan = global.BatchPlanner.replaceRecipeInPlan(
          state.currentPlan,
          id,
          state.indexedRecipes,
          state.prefs
        );
        applyPlanAndRender(updatedPlan);
        showToast("Recette remplacée en conservant la synergie");
        return;
      }

      const shopItem = e.target.closest("[data-toggle-shop]");
      if (shopItem) {
        const id = shopItem.dataset.toggleShop;
        if (state.checkedShopping.has(id)) state.checkedShopping.delete(id);
        else state.checkedShopping.add(id);
        saveCheckedShopping();
        renderShoppingView(state.currentShopping);
        return;
      }

      const stepItem = e.target.closest("[data-toggle-step]");
      if (stepItem) {
        const id = stepItem.dataset.toggleStep;
        if (state.doneBatchSteps.has(id)) state.doneBatchSteps.delete(id);
        else state.doneBatchSteps.add(id);
        saveDoneBatchSteps();
        renderBatchTimeline(state.currentSchedule);
        return;
      }

      if (e.target.closest("[data-close-modal]")) closeRecipeModal();
      if (e.target.closest("[data-close-custom-modal]")) closeCustomRecipeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeRecipeModal();
        closeCustomRecipeModal();
      }
    });

    document.getElementById("btn-copy-shopping").addEventListener("click", async () => {
      if (!state.currentShopping) return;
      const text = global.BatchShopping.formatShoppingListAsText(state.currentShopping);
      try {
        await navigator.clipboard.writeText(text);
        showToast("Liste de courses copiée dans le presse-papiers");
      } catch {
        showToast("Copie impossible sur ce navigateur");
      }
    });

    document.getElementById("btn-print-plan").addEventListener("click", () => {
      window.print();
    });
  }

  /* --------------------------------------------------------------------------
     Initialisation
     -------------------------------------------------------------------------- */
  async function init() {
    loadLocalStorage();
    bindEvents();
    await loadAllData();
    syncInputsFromPrefs();

    const restoredFromUrl = tryRestorePlanFromUrlHash();
    if (!restoredFromUrl) {
      runFullGeneration(false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);
