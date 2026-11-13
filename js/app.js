// js/app.js — Contrôleur principal Batch Malin V2.3

(function () {
  const STORAGE_KEY = "batch_malin_v2_3_state";

  const defaultState = {
    plan: [
      { recipeId: "poulet_curry_coco_riz", portions: 4 },
      { recipeId: "dahl_lentilles_corail", portions: 4 }
    ],
    settings: {
      days: 5,
      people: 1,
      kcalTarget: 2200
    },
    fridgeStock: {},        // { ingredientId: qty }
    checkedShopping: {},    // { ingredientId: true }
    customPrices: {},       // { ingredientId: number }
    storeName: "",
    customRecipes: [],
    customIngredients: []
  };

  let state = loadState();
  let sharedPreviewPlan = null; // Cloisonnement strict V2.3 pour les URLs partagées
  let baseRecipes = [];
  let baseIngredients = [];
  let equipmentMap = {};
  let draftRecipeIngredients = [];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(defaultState),
        ...parsed,
        settings: { ...defaultState.settings, ...(parsed.settings || {}) }
      };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    if (sharedPreviewPlan) return; // Ne jamais écraser les données perso pendant un aperçu partagé
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Erreur sauvegarde localStorage", e);
    }
  }

  function getActivePlan() {
    return sharedPreviewPlan ? sharedPreviewPlan.plan : state.plan;
  }

  function getActiveSettings() {
    return sharedPreviewPlan ? sharedPreviewPlan.settings : state.settings;
  }

  function getAllIngredientsMap() {
    const map = {};
    [...baseIngredients, ...(state.customIngredients || [])].forEach(ing => {
      map[ing.id] = ing;
    });
    return map;
  }

  function getAllRecipesList() {
    return [...baseRecipes, ...(state.customRecipes || [])];
  }

  function getAllRecipesMap() {
    const map = {};
    getAllRecipesList().forEach(r => {
      map[r.id] = r;
    });
    return map;
  }

  function formatEuro(val) {
    return `${(Number(val) || 0).toFixed(2).replace('.', ',')} €`;
  }

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
  }

  // --- Initialisation ---
  async function init() {
    try {
      const [recRes, ingRes, eqRes] = await Promise.all([
        fetch("data/recipes.json"),
        fetch("data/ingredients.json"),
        fetch("data/equipment.json")
      ]);
      baseRecipes = await recRes.json();
      baseIngredients = await ingRes.json();
      const eqList = await eqRes.json();
      eqList.forEach(e => { equipmentMap[e.id] = e; });
    } catch (err) {
      console.error("Erreur chargement JSON:", err);
      showToast("Erreur de chargement des fichiers data/*.json (utilisez un serveur local ou GitHub Pages).");
    }

    checkSharedUrlHash();
    bindEvents();
    populateIngredientSelects();
    renderAll();
  }

  // --- Cloisonnement URL partagée V2.3 ---
  function checkSharedUrlHash() {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#plan=")) return;
    try {
      const encoded = hash.slice(6);
      const jsonStr = decodeURIComponent(escape(atob(encoded)));
      const payload = JSON.parse(jsonStr);
      if (payload && Array.isArray(payload.plan)) {
        sharedPreviewPlan = {
          plan: payload.plan,
          settings: { ...defaultState.settings, ...(payload.settings || {}) }
        };
        document.getElementById("shared-plan-banner").classList.remove("hidden");
      }
    } catch (e) {
      console.warn("Lien de partage invalide:", e);
    }
  }

  function generateShareUrl() {
    const payload = {
      plan: getActivePlan(),
      settings: getActiveSettings()
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const url = `${window.location.origin}${window.location.pathname}#plan=${encoded}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        showToast("Lien du planning copié ! Vos données privées restent isolées.");
      });
    } else {
      prompt("Copiez ce lien de partage :", url);
    }
  }

  // --- Navigation & Modales ---
  function switchTab(tabName) {
    document.querySelectorAll(".nav-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
      panel.classList.toggle("active", panel.id === `tab-${tabName}`);
    });
  }

  function openModal(id) {
    document.getElementById(id).classList.remove("hidden");
  }

  function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
  }

  // --- Rendu Global ---
  function renderAll() {
    const ingredientsMap = getAllIngredientsMap();
    const recipesMap = getAllRecipesMap();
    const plan = getActivePlan();
    const settings = getActiveSettings();

    const consolidated = BatchShopping.consolidate(
      plan,
      recipesMap,
      ingredientsMap,
      state.customPrices,
      state.fridgeStock
    );

    const totalPortions = plan.reduce((acc, p) => acc + (Number(p.portions) || 0), 0);
    const perMeal = totalPortions > 0 ? consolidated.totalNet / totalPortions : 0;

    document.getElementById("kpi-portions").textContent = totalPortions;
    document.getElementById("kpi-budget").textContent = formatEuro(consolidated.totalNet);
    document.getElementById("kpi-per-meal").textContent = formatEuro(perMeal);

    const remainingCount = consolidated.items.filter(i => i.netQty > 0 && !state.checkedShopping[i.id]).length;
    document.getElementById("nav-shopping-count").textContent = remainingCount;

    renderCatalog(recipesMap, ingredientsMap);
    renderPlanner(plan, settings, recipesMap, ingredientsMap);
    renderShopping(consolidated, ingredientsMap);
    renderBatch(plan, recipesMap);
    renderPricesTab(ingredientsMap);
  }

  // --- 1. Catalogue ---
  function renderCatalog(recipesMap, ingredientsMap) {
    const query = (document.getElementById("catalog-search").value || "").toLowerCase().trim();
    const cat = document.getElementById("catalog-category").value;
    const storage = document.getElementById("catalog-storage").value;
    const sort = document.getElementById("catalog-sort").value;

    const customIds = new Set((state.customRecipes || []).map(r => r.id));

    let list = getAllRecipesList().map(rec => {
      const metrics = BatchPlanner.computeRecipeMetrics(rec, ingredientsMap, state.customPrices);
      return { rec, metrics, isCustom: customIds.has(rec.id) };
    });

    list = list.filter(({ rec, isCustom }) => {
      if (cat === "CUSTOM" && !isCustom) return false;
      if (cat !== "ALL" && cat !== "CUSTOM" && rec.category !== cat) return false;
      if (storage === "FREEZER" && !(rec.freezerDays > 0)) return false;
      if (storage === "FRIDGE4" && !(rec.fridgeDays >= 4)) return false;
      if (query) {
        const titleMatch = rec.title.toLowerCase().includes(query);
        const ingMatch = (rec.ingredients || []).some(item => {
          const ing = ingredientsMap[item.id];
          return ing && ing.name.toLowerCase().includes(query);
        });
        if (!titleMatch && !ingMatch) return false;
      }
      return true;
    });

    if (sort === "price-asc") list.sort((a, b) => a.metrics.costPerPortion - b.metrics.costPerPortion);
    if (sort === "kcal-desc") list.sort((a, b) => b.metrics.kcalPerPortion - a.metrics.kcalPerPortion);
    if (sort === "time-asc") list.sort((a, b) => (a.rec.prepTime + a.rec.cookTime) - (b.rec.prepTime + b.rec.cookTime));

    const grid = document.getElementById("catalog-grid");
    if (!list.length) {
      grid.innerHTML = `<div class="card">Aucune recette ne correspond à vos filtres.</div>`;
      return;
    }

    grid.innerHTML = list.map(({ rec, metrics, isCustom }) => `
      <article class="recipe-card">
        <div>
          <div class="recipe-top">
            <span class="badge ${isCustom ? 'badge-custom' : ''}">${isCustom ? '✨ Perso · ' : ''}${rec.category}</span>
            <span class="badge badge-price">${formatEuro(metrics.costPerPortion)} / port.</span>
          </div>
          <h3 class="recipe-title">${rec.title}</h3>
          <div class="recipe-meta">
            <span>🔥 ${metrics.kcalPerPortion} kcal</span>
            <span>💪 ${metrics.protPerPortion}g prot</span>
            <span>⏱️ ${rec.prepTime + rec.cookTime} min</span>
            <span>🧊 ${rec.fridgeDays}j</span>
            <span>${rec.freezerDays > 0 ? `❄️ ${rec.freezerDays}j` : '🚫 Congél.'}</span>
          </div>
        </div>
        <div class="recipe-actions">
          <button class="btn btn-ghost btn-sm" data-view-recipe="${rec.id}">Détails</button>
          <button class="btn btn-primary btn-sm" data-add-plan="${rec.id}">+ Planifier (${rec.basePortions}p)</button>
        </div>
      </article>
    `).join("");
  }

  function showRecipeDetail(recipeId) {
    const recipesMap = getAllRecipesMap();
    const ingredientsMap = getAllIngredientsMap();
    const rec = recipesMap[recipeId];
    if (!rec) return;
    const metrics = BatchPlanner.computeRecipeMetrics(rec, ingredientsMap, state.customPrices);

    document.getElementById("detail-title").textContent = rec.title;
    document.getElementById("detail-body").innerHTML = `
      <div class="summary-strip">
        <div class="strip-pill"><strong>${formatEuro(metrics.costPerPortion)}</strong> / portion (${formatEuro(metrics.totalCost)} total)</div>
        <div class="strip-pill"><strong>${metrics.kcalPerPortion} kcal</strong> · P ${metrics.protPerPortion}g · G ${metrics.carbsPerPortion}g · L ${metrics.fatPerPortion}g</div>
        <div class="strip-pill">🧊 Frigo : ${rec.fridgeDays}j · ${rec.freezerDays > 0 ? `❄️ Congél : ${rec.freezerDays}j` : 'Non congélable'}</div>
      </div>
      <h3>Ingrédients (pour ${rec.basePortions} portions)</h3>
      <ul>
        ${rec.ingredients.map(it => {
          const ing = ingredientsMap[it.id];
          if (!ing) return "";
          const price = BatchPlanner.getEffectivePrice(ing, state.customPrices);
          const cost = (it.qty / (ing.unitFactor || 1000)) * price;
          return `<li><strong>${ing.name}</strong> : ${BatchShopping.formatQty(it.qty, ing.unit)} <span class="muted">(${formatEuro(cost)})</span></li>`;
        }).join("")}
      </ul>
      <h3>Préparation</h3>
      <ol>
        ${rec.steps.map(s => `<li>${s}</li>`).join("")}
      </ol>
      <div class="modal-footer">
        <button class="btn btn-primary" data-add-plan="${rec.id}" data-close-modal="modal-recipe-detail">+ Ajouter au planning</button>
      </div>
    `;
    openModal("modal-recipe-detail");
  }

  // --- 2. Planning ---
  function renderPlanner(plan, settings, recipesMap, ingredientsMap) {
    document.getElementById("plan-days").value = settings.days;
    document.getElementById("plan-people").value = settings.people;
    document.getElementById("plan-kcal-target").value = settings.kcalTarget;

    const splitItems = BatchPlanner.splitFridgeFreezer(plan, recipesMap, settings.people);

    let totalKcal = 0;
    let totalPortions = 0;
    let totalFridge = 0;
    let totalFreezer = 0;

    splitItems.forEach(item => {
      const m = BatchPlanner.computeRecipeMetrics(item.recipe, ingredientsMap, state.customPrices);
      totalKcal += m.kcalPerPortion * item.portions;
      totalPortions += item.portions;
      totalFridge += item.fridgePortions;
      totalFreezer += item.freezerPortions;
    });

    const targetKcal = settings.days * settings.people * settings.kcalTarget;
    const avgDailyKcal = Math.round(totalKcal / Math.max(1, settings.days * settings.people));

    document.getElementById("planner-summary-bar").innerHTML = `
      <div class="strip-pill">🎯 Cible : <strong>${targetKcal.toLocaleString('fr-FR')} kcal</strong> (${settings.kcalTarget} kcal/j/pers)</div>
      <div class="strip-pill">🔥 Planifié : <strong>${totalKcal.toLocaleString('fr-FR')} kcal</strong> (~${avgDailyKcal} kcal/j/pers)</div>
      <div class="strip-pill">🧊 Frigo : <strong>${totalFridge} port.</strong> · ❄️ Congélateur : <strong>${totalFreezer} port.</strong></div>
    `;

    const container = document.getElementById("planner-list");
    if (!splitItems.length) {
      container.innerHTML = `<div class="card">Votre planning est vide. Ajoutez des recettes depuis l'onglet <strong>Catalogue & Recettes</strong>.</div>`;
      return;
    }

    container.innerHTML = splitItems.map((item, idx) => {
      const m = BatchPlanner.computeRecipeMetrics(item.recipe, ingredientsMap, state.customPrices);
      return `
        <div class="plan-item">
          <div>
            <strong>${item.recipe.title}</strong>
            <div class="muted">${m.kcalPerPortion} kcal / port. · ${formatEuro(m.costPerPortion)} / port. · Total : ${formatEuro(m.costPerPortion * item.portions)}</div>
            <div class="storage-badges">
              ${item.fridgePortions > 0 ? `<span class="tag-fridge">🧊 ${item.fridgePortions} au frigo (≤ ${item.recipe.fridgeDays}j)</span>` : ''}
              ${item.freezerPortions > 0 ? `<span class="tag-freezer">❄️ ${item.freezerPortions} au congélateur</span>` : ''}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="stepper">
              <button data-plan-delta="-1" data-plan-idx="${idx}" aria-label="Diminuer">−</button>
              <span>${item.portions}p</span>
              <button data-plan-delta="1" data-plan-idx="${idx}" aria-label="Augmenter">+</button>
            </div>
            <button class="btn btn-ghost btn-sm" data-plan-remove="${idx}" aria-label="Supprimer">🗑️</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- 3. Liste de courses & Frigo ---
  function renderShopping(consolidated, ingredientsMap) {
    const storeLabel = (state.storeName || "").trim() || "Prix catalogue par défaut";
    document.getElementById("shopping-store-label").textContent = storeLabel;

    const stockKeys = Object.keys(state.fridgeStock || {}).filter(k => state.fridgeStock[k] > 0);
    document.getElementById("fridge-items-count").textContent = stockKeys.length;

    const stockContainer = document.getElementById("fridge-stock-list");
    stockContainer.innerHTML = stockKeys.length
      ? stockKeys.map(id => {
          const ing = ingredientsMap[id];
          if (!ing) return "";
          return `<span class="fridge-tag">${ing.name} : ${BatchShopping.formatQty(state.fridgeStock[id], ing.unit)} <button data-remove-fridge="${id}">✕</button></span>`;
        }).join("")
      : `<span class="muted">Aucun ingrédient déclaré en stock.</span>`;

    document.getElementById("shop-total-net").textContent = formatEuro(consolidated.totalNet);
    document.getElementById("shop-total-saved").textContent = formatEuro(consolidated.totalSaved);
    const remaining = consolidated.items.filter(i => i.netQty > 0 && !state.checkedShopping[i.id]).length;
    document.getElementById("shop-items-remaining").textContent = remaining;

    const aislesContainer = document.getElementById("shopping-aisles");
    if (!consolidated.orderedAisles.length) {
      aislesContainer.innerHTML = `<div class="card">Ajoutez des recettes dans votre planning pour générer automatiquement la liste de courses.</div>`;
      return;
    }

    aislesContainer.innerHTML = consolidated.orderedAisles.map(aisle => {
      const items = consolidated.grouped[aisle];
      const aisleTotal = items.reduce((sum, it) => sum + it.netCost, 0);
      return `
        <div class="aisle-card">
          <div class="aisle-header">
            <span class="aisle-title">${aisle}</span>
            <strong>${formatEuro(aisleTotal)}</strong>
          </div>
          ${items.map(it => {
            const fullyCovered = it.netQty <= 0;
            const checked = Boolean(state.checkedShopping[it.id]) || fullyCovered;
            return `
              <div class="shop-row ${checked ? 'checked' : ''}">
                <label class="shop-left">
                  <input type="checkbox" data-toggle-shop="${it.id}" ${checked ? 'checked' : ''} ${fullyCovered ? 'disabled' : ''} />
                  <div>
                    <div class="shop-name"><strong>${it.name}</strong> — ${BatchShopping.formatQty(it.netQty, it.unit)}</div>
                    ${it.stockQty > 0 ? `<div class="muted" style="font-size:0.78rem;">Besoin ${BatchShopping.formatQty(it.grossQty, it.unit)} − Frigo ${BatchShopping.formatQty(it.stockQty, it.unit)}</div>` : ''}
                  </div>
                </label>
                <div class="shop-right">
                  <button class="inline-price-btn ${it.isCustomPrice ? 'custom' : ''}" data-quick-price="${it.id}" title="Modifier le prix unitaire">
                    ${it.unitPrice.toFixed(2).replace('.', ',')} €/${it.priceUnit} ✏️
                  </button>
                  <strong>${formatEuro(it.netCost)}</strong>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }).join("");
  }

  // --- 4. Session Batch ---
  function renderBatch(plan, recipesMap) {
    const schedule = BatchScheduler.buildSchedule(plan, recipesMap, equipmentMap);
    const eqContainer = document.getElementById("batch-equipment");
    const tlContainer = document.getElementById("batch-timeline");

    if (!schedule.phases.length) {
      eqContainer.innerHTML = `<span class="muted">Aucun matériel requis tant que le planning est vide.</span>`;
      tlContainer.innerHTML = `<div class="card">Planifiez des recettes pour obtenir l'ordonnancement de votre session.</div>`;
      return;
    }

    eqContainer.innerHTML = `
      <strong>🧰 Matériel nécessaire (${schedule.equipmentList.length}) :</strong>
      <div class="fridge-tags" style="margin-top:8px;">
        ${schedule.equipmentList.map(eq => `<span class="badge">${eq.icon} ${eq.name}</span>`).join("")}
      </div>
    `;

    tlContainer.innerHTML = schedule.phases.map(phase => `
      <div class="batch-phase">
        <h3>${phase.title}</h3>
        <p class="muted" style="margin-top:0;">${phase.subtitle}</p>
        ${phase.tasks.map(t => `<div class="batch-step">${t}</div>`).join("")}
      </div>
    `).join("");
  }

  // --- 5. Onglet Mes Prix & Sauvegarde ---
  function renderPricesTab(ingredientsMap) {
    document.getElementById("store-name-input").value = state.storeName || "";

    const allIngs = Object.values(ingredientsMap).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const overrideCount = Object.keys(state.customPrices || {}).length;
    document.getElementById("prices-override-stats").textContent =
      `${overrideCount} prix personnalisé${overrideCount > 1 ? 's' : ''}`;

    // Populate aisle filter once
    const aisleSelect = document.getElementById("prices-aisle-filter");
    if (aisleSelect.options.length <= 1) {
      const aisles = Array.from(new Set(allIngs.map(i => i.aisle))).sort();
      aisles.forEach(a => {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        aisleSelect.appendChild(opt);
      });
    }

    const q = (document.getElementById("prices-search").value || "").toLowerCase().trim();
    const aisleFilter = aisleSelect.value;
    const onlyModified = document.getElementById("prices-only-modified").checked;

    const filtered = allIngs.filter(ing => {
      const isMod = Object.prototype.hasOwnProperty.call(state.customPrices || {}, ing.id);
      if (onlyModified && !isMod) return false;
      if (aisleFilter !== "ALL" && ing.aisle !== aisleFilter) return false;
      if (q && !ing.name.toLowerCase().includes(q)) return false;
      return true;
    });

    const tbody = document.getElementById("prices-tbody");
    tbody.innerHTML = filtered.map(ing => {
      const isMod = Object.prototype.hasOwnProperty.call(state.customPrices || {}, ing.id);
      const activePrice = BatchPlanner.getEffectivePrice(ing, state.customPrices);
      return `
        <tr class="${isMod ? 'is-modified' : ''}">
          <td>
            <strong>${ing.name}</strong>
            ${isMod ? '<span class="badge badge-price" style="margin-left:6px;">Perso</span>' : ''}
          </td>
          <td><span class="badge">${ing.aisle}</span></td>
          <td class="muted">${Number(ing.defaultPrice).toFixed(2).replace('.', ',')} €</td>
          <td class="price-input-cell">
            <input type="number" step="0.01" min="0" value="${activePrice.toFixed(2)}"
              class="${isMod ? 'modified' : ''}"
              data-price-input="${ing.id}" aria-label="Prix de ${ing.name}" />
          </td>
          <td>/ ${ing.priceUnit}</td>
          <td>
            ${isMod ? `<button class="btn btn-ghost btn-sm" data-reset-price="${ing.id}" title="Rétablir prix par défaut">↺ Défaut</button>` : '<span class="muted">—</span>'}
          </td>
        </tr>
      `;
    }).join("");
  }

  function populateIngredientSelects() {
    const allIngs = Object.values(getAllIngredientsMap()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const optionsHtml = allIngs.map(ing =>
      `<option value="${ing.id}">${ing.name} (${ing.unit})</option>`
    ).join("");
    document.getElementById("fridge-ingredient-select").innerHTML = optionsHtml;
    document.getElementById("rec-ing-select").innerHTML = optionsHtml;
  }

  // --- Export iPhone ---
  function refreshIphonePreview() {
    const ingredientsMap = getAllIngredientsMap();
    const recipesMap = getAllRecipesMap();
    const consolidated = BatchShopping.consolidate(
      getActivePlan(),
      recipesMap,
      ingredientsMap,
      state.customPrices,
      state.fridgeStock
    );
    const mode = document.querySelector('input[name="iphone-format"]:checked').value;
    const includeChecked = document.getElementById("iphone-include-checked").checked;
    const text = BatchShopping.buildIphoneExportText(consolidated, state.checkedShopping, {
      mode,
      includeChecked,
      storeName: state.storeName
    });
    document.getElementById("iphone-preview-text").value = text;
  }

  // --- Événements ---
  function bindEvents() {
    // Tabs
    document.querySelectorAll(".nav-tab").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // Close modals
    document.querySelectorAll("[data-close-modal]").forEach(el => {
      el.addEventListener("click", () => closeModal(el.dataset.closeModal));
    });

    // Shared plan banner
    document.getElementById("btn-import-shared").addEventListener("click", () => {
      if (!sharedPreviewPlan) return;
      state.plan = sharedPreviewPlan.plan;
      state.settings = sharedPreviewPlan.settings;
      sharedPreviewPlan = null;
      window.history.replaceState(null, "", window.location.pathname);
      document.getElementById("shared-plan-banner").classList.add("hidden");
      saveState();
      renderAll();
      showToast("Planning partagé importé !");
    });
    document.getElementById("btn-exit-shared").addEventListener("click", () => {
      sharedPreviewPlan = null;
      window.history.replaceState(null, "", window.location.pathname);
      document.getElementById("shared-plan-banner").classList.add("hidden");
      renderAll();
    });

    // Catalog filters
    ["catalog-search", "catalog-category", "catalog-storage", "catalog-sort"].forEach(id => {
      document.getElementById(id).addEventListener("input", () => renderAll());
    });

    // Global click delegation
    document.body.addEventListener("click", e => {
      const viewBtn = e.target.closest("[data-view-recipe]");
      if (viewBtn) {
        showRecipeDetail(viewBtn.dataset.viewRecipe);
        return;
      }

      const addPlanBtn = e.target.closest("[data-add-plan]");
      if (addPlanBtn) {
        const recId = addPlanBtn.dataset.addPlan;
        const rec = getAllRecipesMap()[recId];
        if (!rec) return;
        const targetPlan = getActivePlan();
        const existing = targetPlan.find(p => p.recipeId === recId);
        if (existing) {
          existing.portions += Number(rec.basePortions) || 4;
        } else {
          targetPlan.push({ recipeId: recId, portions: Number(rec.basePortions) || 4 });
        }
        saveState();
        renderAll();
        showToast(`+${rec.basePortions} portions de "${rec.title}" ajoutées au planning`);
        return;
      }

      const deltaBtn = e.target.closest("[data-plan-delta]");
      if (deltaBtn) {
        const idx = Number(deltaBtn.dataset.planIdx);
        const delta = Number(deltaBtn.dataset.planDelta);
        const targetPlan = getActivePlan();
        if (targetPlan[idx]) {
          targetPlan[idx].portions = Math.max(1, targetPlan[idx].portions + delta);
          saveState();
          renderAll();
        }
        return;
      }

      const remPlanBtn = e.target.closest("[data-plan-remove]");
      if (remPlanBtn) {
        const idx = Number(remPlanBtn.dataset.planIdx || remPlanBtn.dataset.planRemove);
        getActivePlan().splice(idx, 1);
        saveState();
        renderAll();
        return;
      }

      const remFridgeBtn = e.target.closest("[data-remove-fridge]");
      if (remFridgeBtn) {
        delete state.fridgeStock[remFridgeBtn.dataset.removeFridge];
        saveState();
        renderAll();
        return;
      }

      const quickPriceBtn = e.target.closest("[data-quick-price]");
      if (quickPriceBtn) {
        const ingId = quickPriceBtn.dataset.quickPrice;
        const ing = getAllIngredientsMap()[ingId];
        if (!ing) return;
        const current = BatchPlanner.getEffectivePrice(ing, state.customPrices);
        const ans = prompt(`Nouveau prix pour "${ing.name}" (€ / ${ing.priceUnit}) :
(Laissez vide pour rétablir ${ing.defaultPrice.toFixed(2)} €)`, current.toFixed(2));
        if (ans === null) return;
        if (ans.trim() === "") {
          delete state.customPrices[ingId];
        } else {
          const parsed = parseFloat(ans.replace(',', '.'));
          if (!Number.isNaN(parsed) && parsed >= 0) {
            state.customPrices[ingId] = Math.round(parsed * 100) / 100;
          }
        }
        saveState();
        renderAll();
        showToast(`Prix mis à jour pour ${ing.name}`);
        return;
      }

      const resetPriceBtn = e.target.closest("[data-reset-price]");
      if (resetPriceBtn) {
        delete state.customPrices[resetPriceBtn.dataset.resetPrice];
        saveState();
        renderAll();
        showToast("Prix par défaut rétabli.");
        return;
      }

      const remDraftIngBtn = e.target.closest("[data-remove-draft-ing]");
      if (remDraftIngBtn) {
        const idx = Number(remDraftIngBtn.dataset.removeDraftIng);
        draftRecipeIngredients.splice(idx, 1);
        renderDraftRecipeIngredients();
      }
    });

    // Shopping checkboxes
    document.body.addEventListener("change", e => {
      if (e.target.matches("[data-toggle-shop]")) {
        const id = e.target.dataset.toggleShop;
        if (e.target.checked) state.checkedShopping[id] = true;
        else delete state.checkedShopping[id];
        saveState();
        renderAll();
      }
      if (e.target.matches("[data-price-input]")) {
        const id = e.target.dataset.priceInput;
        const ing = getAllIngredientsMap()[id];
        const val = parseFloat(e.target.value.replace(',', '.'));
        if (!Number.isNaN(val) && val >= 0) {
          const rounded = Math.round(val * 100) / 100;
          if (ing && Math.abs(rounded - Number(ing.defaultPrice)) < 0.001) {
            delete state.customPrices[id];
          } else {
            state.customPrices[id] = rounded;
          }
          saveState();
          renderAll();
        }
      }
    });

    // Planner controls
    ["plan-days", "plan-people", "plan-kcal-target"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => {
        const s = getActiveSettings();
        s.days = Math.max(1, Math.min(14, Number(document.getElementById("plan-days").value) || 5));
        s.people = Math.max(1, Math.min(10, Number(document.getElementById("plan-people").value) || 1));
        s.kcalTarget = Math.max(1000, Number(document.getElementById("plan-kcal-target").value) || 2200);
        saveState();
        renderAll();
      });
    });

    document.getElementById("btn-auto-scale").addEventListener("click", () => {
      const scaled = BatchPlanner.autoScalePortions(
        getActivePlan(),
        getAllRecipesMap(),
        getAllIngredientsMap(),
        state.customPrices,
        getActiveSettings()
      );
      if (sharedPreviewPlan) sharedPreviewPlan.plan = scaled;
      else state.plan = scaled;
      saveState();
      renderAll();
      showToast("Portions ajustées à votre objectif calorique !");
    });

    document.getElementById("btn-clear-plan").addEventListener("click", () => {
      if (sharedPreviewPlan) sharedPreviewPlan.plan = [];
      else state.plan = [];
      saveState();
      renderAll();
    });

    document.getElementById("btn-share-plan").addEventListener("click", generateShareUrl);

    // Shopping & Fridge
    document.getElementById("btn-goto-prices").addEventListener("click", () => switchTab("prices"));
    document.getElementById("btn-toggle-fridge").addEventListener("click", () => {
      document.getElementById("fridge-panel").classList.toggle("hidden");
    });
    document.getElementById("btn-add-fridge").addEventListener("click", () => {
      const id = document.getElementById("fridge-ingredient-select").value;
      const qty = Number(document.getElementById("fridge-qty-input").value);
      if (!id || !(qty > 0)) return;
      state.fridgeStock[id] = (state.fridgeStock[id] || 0) + qty;
      document.getElementById("fridge-qty-input").value = "";
      saveState();
      renderAll();
      showToast("Ingrédient ajouté au stock frigo.");
    });
    document.getElementById("btn-clear-fridge").addEventListener("click", () => {
      state.fridgeStock = {};
      saveState();
      renderAll();
    });

    // iPhone Export Modal
    document.getElementById("btn-open-iphone-export").addEventListener("click", () => {
      document.getElementById("iphone-feedback").textContent = "";
      refreshIphonePreview();
      openModal("modal-iphone");
    });
    document.querySelectorAll('input[name="iphone-format"]').forEach(r => {
      r.addEventListener("change", refreshIphonePreview);
    });
    document.getElementById("iphone-include-checked").addEventListener("change", refreshIphonePreview);

    document.getElementById("btn-ios-native-share").addEventListener("click", async () => {
      const text = document.getElementById("iphone-preview-text").value;
      const fb = document.getElementById("iphone-feedback");
      if (navigator.share) {
        try {
          await navigator.share({ title: "Liste de courses Batch Malin", text });
          fb.textContent = "✅ Liste envoyée via la feuille de partage.";
        } catch (err) {
          if (err.name !== "AbortError") {
            fb.textContent = "Partage annulé ou indisponible sur ce navigateur.";
          }
        }
      } else {
        await navigator.clipboard.writeText(text);
        fb.textContent = "📋 Partage natif indisponible sur ce navigateur PC : liste copiée dans le presse-papiers !";
      }
    });

    document.getElementById("btn-ios-copy").addEventListener("click", async () => {
      const text = document.getElementById("iphone-preview-text").value;
      await navigator.clipboard.writeText(text);
      document.getElementById("iphone-feedback").textContent =
        "✅ Copié ! Ouvrez Apple Rappels ou Notes sur iPhone et collez : chaque ligne devient une case.";
    });

    document.getElementById("btn-ios-download-txt").addEventListener("click", () => {
      const text = document.getElementById("iphone-preview-text").value;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "liste-courses-batch-malin.txt";
      a.click();
      URL.revokeObjectURL(a.href);
      document.getElementById("iphone-feedback").textContent = "✅ Fichier checklist .txt téléchargé.";
    });

    // Prices Tab
    document.getElementById("store-name-input").addEventListener("input", e => {
      state.storeName = e.target.value;
      saveState();
      document.getElementById("shopping-store-label").textContent = state.storeName.trim() || "Prix catalogue par défaut";
    });
    ["prices-search", "prices-aisle-filter", "prices-only-modified"].forEach(id => {
      document.getElementById(id).addEventListener("input", () => renderPricesTab(getAllIngredientsMap()));
    });
    document.getElementById("btn-reset-all-prices").addEventListener("click", () => {
      if (!Object.keys(state.customPrices || {}).length) return;
      if (confirm("Réinitialiser tous vos prix personnalisés vers les prix par défaut ?")) {
        state.customPrices = {};
        saveState();
        renderAll();
        showToast("Tous les prix ont été réinitialisés.");
      }
    });

    // JSON Backup Export/Import V2.3
    document.getElementById("btn-export-json").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `batch-malin-v2.3-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("Sauvegarde JSON exportée !");
    });

    document.getElementById("input-import-json").addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          state = {
            ...structuredClone(defaultState),
            ...imported,
            settings: { ...defaultState.settings, ...(imported.settings || {}) }
          };
          saveState();
          populateIngredientSelects();
          renderAll();
          showToast("Sauvegarde restaurée avec succès !");
        } catch {
          showToast("Fichier JSON invalide.");
        }
      };
      reader.readAsText(file);
    });

    // Custom Recipe Modal
    document.getElementById("btn-open-recipe-modal").addEventListener("click", () => {
      draftRecipeIngredients = [];
      document.getElementById("form-create-recipe").reset();
      renderDraftRecipeIngredients();
      openModal("modal-create-recipe");
    });

    document.getElementById("btn-rec-add-ing").addEventListener("click", () => {
      const id = document.getElementById("rec-ing-select").value;
      const qty = Number(document.getElementById("rec-ing-qty").value);
      if (!id || !(qty > 0)) return;
      draftRecipeIngredients.push({ id, qty });
      document.getElementById("rec-ing-qty").value = "";
      renderDraftRecipeIngredients();
    });

    document.getElementById("rec-portions").addEventListener("input", renderDraftRecipeIngredients);

    document.getElementById("form-create-recipe").addEventListener("submit", e => {
      e.preventDefault();
      if (!draftRecipeIngredients.length) {
        showToast("Ajoutez au moins un ingrédient.");
        return;
      }
      const stepsRaw = document.getElementById("rec-steps").value.trim();
      const newRec = {
        id: `custom_rec_${Date.now()}`,
        title: document.getElementById("rec-title").value.trim(),
        category: document.getElementById("rec-category").value,
        basePortions: Math.max(1, Number(document.getElementById("rec-portions").value) || 4),
        prepTime: Math.max(0, Number(document.getElementById("rec-prep").value) || 15),
        cookTime: Math.max(0, Number(document.getElementById("rec-cook").value) || 20),
        fridgeDays: Math.max(1, Number(document.getElementById("rec-fridge-days").value) || 4),
        freezerDays: Math.max(0, Number(document.getElementById("rec-freezer-days").value) || 0),
        equipment: ["poele", "boites"],
        ingredients: structuredClone(draftRecipeIngredients),
        steps: stepsRaw ? stepsRaw.split("\n").map(s => s.trim()).filter(Boolean) : ["Préparer et cuire les ingrédients."]
      };
      state.customRecipes.push(newRec);
      saveState();
      closeModal("modal-create-recipe");
      renderAll();
      showToast(`Recette "${newRec.title}" enregistrée !`);
    });

    // Custom Ingredient Modal
    document.getElementById("btn-open-custom-ing-modal").addEventListener("click", () => {
      document.getElementById("form-custom-ingredient").reset();
      openModal("modal-custom-ingredient");
    });

    document.getElementById("form-custom-ingredient").addEventListener("submit", e => {
      e.preventDefault();
      const unit = document.getElementById("ing-unit").value;
      const price = Math.round(parseFloat(document.getElementById("ing-price").value) * 100) / 100;
      const newIng = {
        id: `custom_ing_${Date.now()}`,
        name: document.getElementById("ing-name").value.trim(),
        aisle: document.getElementById("ing-aisle").value,
        unit,
        priceUnit: unit === "g" ? "kg" : unit === "ml" ? "L" : "pièce",
        unitFactor: unit === "pièce" ? 1 : 1000,
        defaultPrice: price,
        kcal100: Number(document.getElementById("ing-kcal").value) || 100,
        prot100: 10,
        carbs100: 10,
        fat100: 5,
        storage: "frigo"
      };
      state.customIngredients.push(newIng);
      saveState();
      populateIngredientSelects();
      closeModal("modal-custom-ingredient");
      renderAll();
      showToast(`Aliment "${newIng.name}" ajouté !`);
    });
  }

  function renderDraftRecipeIngredients() {
    const ingredientsMap = getAllIngredientsMap();
    const listEl = document.getElementById("rec-ing-list");
    listEl.innerHTML = draftRecipeIngredients.map((item, idx) => {
      const ing = ingredientsMap[item.id];
      return `<span class="fridge-tag">${ing ? ing.name : item.id} (${item.qty}${ing ? ing.unit : ''}) <button type="button" data-remove-draft-ing="${idx}">✕</button></span>`;
    }).join("");

    const tempRec = {
      basePortions: Math.max(1, Number(document.getElementById("rec-portions").value) || 4),
      ingredients: draftRecipeIngredients
    };
    const m = BatchPlanner.computeRecipeMetrics(tempRec, ingredientsMap, state.customPrices);
    document.getElementById("rec-live-metrics").textContent =
      `Coût estimé : ${formatEuro(m.totalCost)} (${formatEuro(m.costPerPortion)} / portion) · ${m.kcalPerPortion} kcal / portion`;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
