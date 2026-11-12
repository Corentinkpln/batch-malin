/**
 * Batch Malin — Contrôleur principal, gestion d'état & sauvegarde LocalStorage (app.js)
 */
(function (global) {
  "use strict";

  const STORAGE_KEYS = {
    PREFS: "batch_malin_prefs_v1",
    FAVORITES: "batch_malin_favorites_v1",
    CHECKED_SHOPPING: "batch_malin_checked_shop_v1",
    DONE_STEPS: "batch_malin_done_steps_v1"
  };

  // Manifeste extensible : ajouter simplement un nouveau fichier JSON ici pour passer à 500+ recettes
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
    equipment: ["Air Fryer", "Four", "Plaques induction", "Micro-ondes"]
  };

  const state = {
    equipmentList: [],
    ingredientsCatalog: {},
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

  /* --------------------------------------------------------------------------
     Icônes SVG minimalistes pour le matériel
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
      if (Array.isArray(savedFavs)) {
        state.favorites = new Set(savedFavs);
      }
      const savedShop = JSON.parse(localStorage.getItem(STORAGE_KEYS.CHECKED_SHOPPING) || "[]");
      if (Array.isArray(savedShop)) {
        state.checkedShopping = new Set(savedShop);
      }
      const savedSteps = JSON.parse(localStorage.getItem(STORAGE_KEYS.DONE_STEPS) || "[]");
      if (Array.isArray(savedSteps)) {
        state.doneBatchSteps = new Set(savedSteps);
      }
    } catch (err) {
      console.warn("Lecture LocalStorage ignorée :", err);
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(state.prefs));
    } catch (err) {
      console.warn("Sauvegarde préférences impossible :", err);
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(Array.from(state.favorites)));
      updateFavoritesCounters();
    } catch (err) {
      console.warn("Sauvegarde favoris impossible :", err);
    }
  }

  function saveCheckedShopping() {
    try {
      localStorage.setItem(STORAGE_KEYS.CHECKED_SHOPPING, JSON.stringify(Array.from(state.checkedShopping)));
    } catch (err) {
      console.warn("Sauvegarde courses impossible :", err);
    }
  }

  function saveDoneBatchSteps() {
    try {
      localStorage.setItem(STORAGE_KEYS.DONE_STEPS, JSON.stringify(Array.from(state.doneBatchSteps)));
    } catch (err) {
      console.warn("Sauvegarde étapes impossible :", err);
    }
  }

  /* --------------------------------------------------------------------------
     Chargement parallèle des données JSON
     -------------------------------------------------------------------------- */
  async function loadAllData() {
    if (window.location.protocol === "file:") {
      document.getElementById("cors-banner").classList.remove("hidden");
    }

    try {
      const [equipRes, ingRes, ...recipeResults] = await Promise.all([
        fetch("data/equipment.json").then((r) => r.json()),
        fetch("data/ingredients.json").then((r) => r.json()),
        ...RECIPE_FILES.map((path) =>
          fetch(path)
            .then((r) => r.json())
            .catch(() => [])
        )
      ]);

      state.equipmentList = Array.isArray(equipRes) ? equipRes : [];
      state.ingredientsCatalog = ingRes && typeof ingRes === "object" ? ingRes : {};

      const allRecipes = recipeResults.flat().filter((r) => r && r.id && r.name);
      state.indexedRecipes = global.BatchPlanner.buildRecipeIndex(allRecipes);

      document.getElementById("header-recipe-count").textContent = `${allRecipes.length} recettes indexées`;
    } catch (error) {
      console.error("Erreur de chargement JSON :", error);
      document.getElementById("cors-banner").classList.remove("hidden");
      document.getElementById("header-recipe-count").textContent = "Erreur chargement JSON";
    }
  }

  /* --------------------------------------------------------------------------
     Synchronisation UI des contrôles
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

    document.querySelectorAll(".segmented-btn").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.meals) === Number(state.prefs.mealsPerDay));
    });

    updateConfigHints();
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

  function renderEquipmentCards() {
    const grid = document.getElementById("equipment-grid");
    const selectedSet = new Set(state.prefs.equipment);

    grid.innerHTML = state.equipmentList
      .map((eq) => {
        const isSelected = selectedSet.has(eq.name);
        return `
          <button type="button" class="equip-card ${isSelected ? "is-selected" : ""}" data-equip="${eq.name}" aria-pressed="${isSelected}">
            <div class="equip-card__top">
              <span class="equip-card__icon">${getEquipmentIconSvg(eq.icon)}</span>
              <span class="equip-card__check" aria-hidden="true">✓</span>
            </div>
            <div>
              <div class="equip-card__name">${eq.name}</div>
              <div class="equip-card__cat">${eq.category}</div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  /* --------------------------------------------------------------------------
     Exécution complète de la génération
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
    const shopping = global.BatchShopping.buildShoppingList(
      plan.selectedRecipes,
      state.ingredientsCatalog
    );
    const schedule = global.BatchScheduler.generateBatchSchedule(
      plan.selectedRecipes,
      shopping,
      state.prefs.startTime
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

    // Notice éventuelle
    const noticeEl = document.getElementById("plan-notice");
    if (plan.notice) {
      noticeEl.textContent = plan.notice;
      noticeEl.classList.remove("hidden");
    } else {
      noticeEl.classList.add("hidden");
    }

    // KPI 1 : Coût & Budget
    const displayCost = shopping.totalEstimatedCost > 0 ? shopping.totalEstimatedCost : plan.totalCost;
    const maxBudget = Number(state.prefs.budget);
    const costPerPortion = displayCost / Math.max(1, plan.totalPortions);
    const budgetRatio = Math.min(100, Math.round((displayCost / Math.max(1, maxBudget)) * 100));

    document.getElementById("kpi-total-cost").textContent = `${displayCost.toFixed(2).replace(".", ",")} €`;
    document.getElementById("kpi-cost-detail").textContent = `${costPerPortion.toFixed(2).replace(".", ",")} € / portion · ${plan.totalPortions} portions`;
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
    updateFavoritesCounters();

    renderMenuCards(plan);
    renderShoppingView(shopping);
    renderBatchTimeline(schedule);
    renderFavoritesView();
  }

  /* --------------------------------------------------------------------------
     Rendu Vue 1 : Menu Optimisé
     -------------------------------------------------------------------------- */
  function renderMenuCards(plan) {
    const grid = document.getElementById("menu-grid");
    const sharedSet = new Set(plan.sharedIngredients);

    if (!plan.selectedRecipes.length) {
      grid.innerHTML = `<div class="empty-state">Aucune recette sélectionnée. Ajustez vos appareils de cuisson ci-dessus.</div>`;
      return;
    }

    document.getElementById("menu-summary-text").textContent =
      `${plan.selectedRecipes.length} recettes distinctes pour couvrir ${plan.totalMeals} repas (${plan.totalPortions} portions).`;

    grid.innerHTML = plan.selectedRecipes
      .map((recipe) => renderSingleRecipeCard(recipe, sharedSet, true))
      .join("");
  }

  function renderSingleRecipeCard(recipe, sharedSet, isPlanMode) {
    const isFav = state.favorites.has(recipe.id);
    const totalTime = (Number(recipe.prepTime) || 0) + (Number(recipe.cookTime) || 0);
    const catLabel = CATEGORY_LABELS[recipe.category] || recipe.category;
    const portions = recipe.totalPortions || state.prefs.servings;

    const ingChips = (recipe.ingredients || [])
      .slice(0, 6)
      .map((ing) => {
        const norm = global.BatchPlanner.normalizeText(ing.name);
        const isShared = sharedSet && sharedSet.has(norm);
        return `<span class="ing-chip ${isShared ? "is-shared" : ""}">${ing.name}</span>`;
      })
      .join("");

    return `
      <article class="recipe-card">
        <div class="recipe-card__header">
          <div class="recipe-badges">
            <span class="cat-badge">${catLabel}</span>
            ${isPlanMode ? `<span class="portions-badge">${portions} portions</span>` : ""}
            ${recipe.freezable ? `<span class="freeze-badge">Congélable</span>` : ""}
          </div>
          <button type="button" class="fav-btn ${isFav ? "is-fav" : ""}" data-toggle-fav="${recipe.id}" aria-label="Ajouter aux favoris">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
        </div>

        <h3 class="recipe-card__title">${recipe.name}</h3>

        <div class="recipe-card__metrics">
          <div>
            <span class="metric-item__val">${Number(recipe.price).toFixed(2).replace(".", ",")} €</span>
            <span class="metric-item__lbl">/ portion</span>
          </div>
          <div>
            <span class="metric-item__val">${totalTime} min</span>
            <span class="metric-item__lbl">${recipe.prepTime}m + ${recipe.cookTime}m</span>
          </div>
          <div>
            <span class="metric-item__val">${recipe.calories}</span>
            <span class="metric-item__lbl">kcal / port.</span>
          </div>
        </div>

        <div class="recipe-card__macros">
          <span>Protéines : <strong>${recipe.protein}g</strong></span>
          <span>Glucides : <strong>${recipe.carbs}g</strong></span>
          <span>Lipides : <strong>${recipe.fat}g</strong></span>
        </div>

        <div class="recipe-card__ingredients">${ingChips}</div>

        <div class="recipe-card__equip">
          Matériel : ${(recipe.equipment || []).join(" · ") || "Sans cuisson"}
        </div>

        <div class="recipe-card__actions">
          <button type="button" class="btn btn--subtle btn--sm" data-inspect-recipe="${recipe.id}">
            Voir la recette
          </button>
          ${
            isPlanMode
              ? `<button type="button" class="btn btn--ghost btn--sm" data-replace-recipe="${recipe.id}">Remplacer</button>`
              : ""
          }
        </div>
      </article>
    `;
  }

  /* --------------------------------------------------------------------------
     Rendu Vue 2 : Liste de courses
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
              <li class="shopping-item ${checked ? "is-checked" : ""}" data-toggle-shop="${item.id}">
                <div class="shopping-item__left">
                  <span class="shopping-checkbox" aria-hidden="true">✓</span>
                  <div>
                    <span class="shopping-item__name">${item.name}</span>
                    <span class="shopping-item__sub">${item.recipeCount > 1 ? `Mutualisé sur ${item.recipeCount} recettes` : item.recipesList[0]}</span>
                  </div>
                </div>
                <div class="shopping-item__right">
                  <span class="shopping-item__qty">${item.formattedQty}</span>
                  <span class="shopping-item__price">~${item.estimatedCost.toFixed(2).replace(".", ",")} €</span>
                </div>
              </li>
            `;
          })
          .join("");

        return `
          <section class="aisle-card">
            <h3 class="aisle-card__title">
              <span>${group.aisle}</span>
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
          <span>Portions couvertes</span>
          <strong>${state.currentPlan.totalPortions}</strong>
        </div>
        <div class="summary-row">
          <span>Coût par portion</span>
          <strong>${(shopping.totalEstimatedCost / Math.max(1, state.currentPlan.totalPortions)).toFixed(2).replace(".", ",")} €</strong>
        </div>
        <div class="summary-row">
          <span>Total estimé</span>
          <strong style="color: var(--accent);">${shopping.totalEstimatedCost.toFixed(2).replace(".", ",")} €</strong>
        </div>
      </aside>
    `;
  }

  /* --------------------------------------------------------------------------
     Rendu Vue 3 : Planning Batch Cooking
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
        return `
          <article class="timeline-step ${isDone ? "is-done" : ""}" data-toggle-step="${step.id}" style="cursor: pointer;">
            <div class="timeline-step__time">
              <span class="timeline-time-main">${step.clock}</span>
              <span class="timeline-time-dur">${step.durationMin} min</span>
            </div>
            <div class="timeline-step__body">
              <div>
                <h3 class="timeline-step__title">${step.title}</h3>
                <p class="timeline-step__desc">${step.description}</p>
              </div>
              <div class="timeline-step__tags">
                <span class="step-type-pill step-type-pill--${step.type}">${step.typeLabel}</span>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  /* --------------------------------------------------------------------------
     Rendu Vue 4 : Favoris
     -------------------------------------------------------------------------- */
  function renderFavoritesView() {
    const grid = document.getElementById("favorites-grid");
    const favRecipes = state.indexedRecipes.recipes.filter((r) => state.favorites.has(r.id));

    if (!favRecipes.length) {
      grid.innerHTML = `<div class="empty-state">Vous n’avez pas encore de recettes favorites. Cliquez sur le cœur d’une recette pour l’enregistrer.</div>`;
      return;
    }

    grid.innerHTML = favRecipes
      .map((r) => renderSingleRecipeCard(r, null, false))
      .join("");
  }

  function updateFavoritesCounters() {
    const count = state.favorites.size;
    document.getElementById("favorites-count").textContent = count;
    document.getElementById("tab-fav-count").textContent = count;
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
    const ingredientsHtml = (recipe.ingredients || [])
      .map((ing) => {
        const scaledQty = Math.round(ing.quantity * mult * 10) / 10;
        return `<li><strong>${ing.name}</strong> : ${scaledQty.toLocaleString("fr-FR")} ${ing.unit}</li>`;
      })
      .join("");

    const stepsHtml = (recipe.steps || [])
      .map((st) => `<li>${st}</li>`)
      .join("");

    document.getElementById("modal-recipe-body").innerHTML = `
      <span class="cat-badge">${CATEGORY_LABELS[recipe.category] || recipe.category}</span>
      <h2 id="modal-recipe-title" style="margin: 12px 0 8px; font-size: 1.6rem; letter-spacing: -0.025em;">${recipe.name}</h2>
      <p style="margin: 0 0 18px; color: var(--text-secondary);">
        Quantités ajustées pour <strong>${mult} portion${mult > 1 ? "s" : ""}</strong> ·
        Préparation ${recipe.prepTime} min · Cuisson ${recipe.cookTime} min ·
        ${recipe.calories} kcal / portion
      </p>
      <div class="macro-mini-bars" style="margin-bottom: 20px;">
        <span class="macro-tag macro-tag--p">Protéines <strong>${recipe.protein}g</strong></span>
        <span class="macro-tag macro-tag--c">Glucides <strong>${recipe.carbs}g</strong></span>
        <span class="macro-tag macro-tag--f">Lipides <strong>${recipe.fat}g</strong></span>
        <span class="macro-tag">Coût : <strong>${(recipe.price * mult).toFixed(2).replace(".", ",")} €</strong></span>
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
     Toast & Navigation Onglets
     -------------------------------------------------------------------------- */
  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
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
    // Sliders & Sélecteurs
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

    // Boutons de génération
    ["btn-generate-top", "btn-generate-main"].forEach((id) => {
      document.getElementById(id).addEventListener("click", () => {
        runFullGeneration(true);
        document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
        showToast("Plan de batch cooking optimisé généré");
      });
    });

    document.getElementById("btn-regenerate-variant").addEventListener("click", () => {
      state.variantSeed += 1;
      runFullGeneration(true);
      showToast("Nouvelle variante anti-gaspillage générée");
    });

    document.getElementById("btn-reset-prefs").addEventListener("click", () => {
      state.prefs = { ...DEFAULT_PREFS };
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

    // Actions déléguées sur les cartes recettes, courses et planning
    document.body.addEventListener("click", (e) => {
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
        state.currentPlan = global.BatchPlanner.replaceRecipeInPlan(
          state.currentPlan,
          id,
          state.indexedRecipes,
          state.prefs
        );
        state.currentShopping = global.BatchShopping.buildShoppingList(
          state.currentPlan.selectedRecipes,
          state.ingredientsCatalog
        );
        state.currentSchedule = global.BatchScheduler.generateBatchSchedule(
          state.currentPlan.selectedRecipes,
          state.currentShopping,
          state.prefs.startTime
        );
        renderAllResults();
        showToast("Recette remplacée en conservant la synergie d'ingrédients");
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

      if (e.target.closest("[data-close-modal]")) {
        closeRecipeModal();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeRecipeModal();
    });

    // Copier / Imprimer liste de courses
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
     Point d'entrée
     -------------------------------------------------------------------------- */
  async function init() {
    loadLocalStorage();
    bindEvents();
    await loadAllData();
    syncInputsFromPrefs();
    runFullGeneration(false);
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);
