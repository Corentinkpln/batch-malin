/**
 * Batch Malin V2.1 — Moteur d'optimisation de menu (planner.js)
 * Intègre : horizon 1-14j, restes frigo, liste noire d'ingrédients,
 * ciblage calorique dynamique et priorisation des recettes personnelles.
 */
(function (global) {
  "use strict";

  const PANTRY_STAPLES = new Set([
    "sel",
    "poivre",
    "eau",
    "huile d'olive",
    "huile neutre",
    "ail",
    "herbes de provence",
    "épices curry",
    "paprika",
    "cumin",
    "sauce soja"
  ]);

  const PORK_KEYWORDS = ["porc", "lardon", "jambon", "chorizo", "bacon", "saucisse"];
  const MEAT_CATEGORIES = new Set(["chicken", "beef"]);
  const ANIMAL_FLESH_CATEGORIES = new Set(["chicken", "beef", "fish"]);

  function normalizeText(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/œ/g, "oe")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function buildRecipeIndex(recipes) {
    const ingredientToRecipes = new Map();
    const enriched = recipes.map((recipe) => {
      const coreIngredients = [];
      const allNormalized = [];

      (recipe.ingredients || []).forEach((ing) => {
        const norm = normalizeText(ing.name);
        allNormalized.push(norm);
        if (!PANTRY_STAPLES.has(norm)) {
          coreIngredients.push(norm);
          if (!ingredientToRecipes.has(norm)) {
            ingredientToRecipes.set(norm, new Set());
          }
          ingredientToRecipes.get(norm).add(recipe.id);
        }
      });

      const totalTime = (Number(recipe.prepTime) || 0) + (Number(recipe.cookTime) || 0);
      const difficulty =
        recipe.difficulty ||
        (totalTime <= 25 && (recipe.steps || []).length <= 4
          ? "beginner"
          : totalTime <= 45
          ? "intermediate"
          : "advanced");

      return {
        ...recipe,
        _coreIngredients: Array.from(new Set(coreIngredients)),
        _allIngredientsNorm: allNormalized,
        _totalTime: totalTime,
        _difficulty: difficulty
      };
    });

    return { recipes: enriched, ingredientToRecipes };
  }

  function getCalorieScale(recipe, config) {
    if (!config || !config.calorieTargetEnabled) return 1;
    const target = Number(config.targetCalories) || 600;
    const base = Math.max(150, Number(recipe.calories) || 500);
    const raw = target / base;
    return Math.round(Math.min(1.65, Math.max(0.65, raw)) * 100) / 100;
  }

  function applyScaleToRecipe(recipe, batches, servings, config) {
    const scale = getCalorieScale(recipe, config);
    const totalPortions = batches * servings;
    return {
      ...recipe,
      batches,
      totalPortions,
      _calorieScale: scale,
      _effectivePrice: Math.round(Number(recipe.price) * scale * 100) / 100,
      _effectiveCalories: Math.round((Number(recipe.calories) || 0) * scale),
      _effectiveProtein: Math.round((Number(recipe.protein) || 0) * scale),
      _effectiveCarbs: Math.round((Number(recipe.carbs) || 0) * scale),
      _effectiveFat: Math.round((Number(recipe.fat) || 0) * scale)
    };
  }

  function isRecipeEligible(recipe, config) {
    const excludedList = (config.excludedItems || []).map(normalizeText).filter(Boolean);
    if (excludedList.length > 0) {
      const hasExcluded = recipe._allIngredientsNorm.some((ingNorm) =>
        excludedList.some((ex) => ingNorm.includes(ex) || ex.includes(ingNorm))
      );
      if (hasExcluded) return false;
    }

    const available = new Set((config.equipment || []).map(normalizeText));
    const reqEquip = recipe.equipment || [];
    for (let i = 0; i < reqEquip.length; i++) {
      if (!available.has(normalizeText(reqEquip[i]))) {
        return false;
      }
    }

    const diet = config.diet || "all";
    if (diet === "vegetarian") {
      if (ANIMAL_FLESH_CATEGORIES.has(recipe.category)) return false;
      const hasFlesh = recipe._allIngredientsNorm.some((ing) =>
        ["poulet", "boeuf", "saumon", "thon", "cabillaud", "colin", "dinde", ...PORK_KEYWORDS].some((k) =>
          ing.includes(k)
        )
      );
      if (hasFlesh) return false;
    } else if (diet === "pescatarian") {
      if (MEAT_CATEGORIES.has(recipe.category)) return false;
      const hasMeat = recipe._allIngredientsNorm.some((ing) =>
        ["poulet", "boeuf", "dinde", ...PORK_KEYWORDS].some((k) => ing.includes(k))
      );
      if (hasMeat) return false;
    } else if (diet === "no_pork") {
      const hasPork = recipe._allIngredientsNorm.some((ing) =>
        PORK_KEYWORDS.some((k) => ing.includes(k))
      );
      if (hasPork) return false;
    } else if (diet === "high_protein") {
      const effProt = (Number(recipe.protein) || 0) * getCalorieScale(recipe, config);
      if (effProt < 28) return false;
    }

    const skill = config.skill || "intermediate";
    if (!recipe.isCustom && skill === "beginner" && recipe._difficulty === "advanced") {
      return false;
    }

    return true;
  }

  function computeOverlapScore(candidate, selectedRecipes) {
    if (!selectedRecipes.length || !candidate._coreIngredients.length) return 0.5;
    const pool = new Set();
    selectedRecipes.forEach((r) => {
      r._coreIngredients.forEach((ing) => pool.add(ing));
    });

    let matches = 0;
    candidate._coreIngredients.forEach((ing) => {
      if (pool.has(ing)) matches++;
    });

    return matches / candidate._coreIngredients.length;
  }

  function computePantryBonus(recipe, pantryNormSet) {
    if (!pantryNormSet.size || !recipe._coreIngredients.length) return 0;
    let hits = 0;
    recipe._coreIngredients.forEach((ing) => {
      if (pantryNormSet.has(ing)) hits++;
    });
    return hits * 1.4;
  }

  function generatePlan(indexedData, config, options = {}) {
    const days = Math.max(1, Number(config.days) || 5);
    const totalMeals = days * (Number(config.mealsPerDay) || 2);
    const servings = Math.max(1, Number(config.servings) || 1);
    const totalPortions = totalMeals * servings;
    const maxBudget = Math.max(5, Number(config.budget) || 35);
    const targetPricePerPortion = maxBudget / totalPortions;
    const randomizeSeed = Number(options.seed) || 0;
    const isLongHorizon = days > 5;
    const pantryNormSet = new Set((config.pantryItems || []).map(normalizeText).filter(Boolean));

    let eligible = indexedData.recipes.filter((r) => isRecipeEligible(r, config));
    let notice = null;

    if (eligible.length === 0) {
      eligible = indexedData.recipes.filter((r) =>
        isRecipeEligible(r, { ...config, skill: "advanced" })
      );
      if (eligible.length > 0) {
        notice = "Filtre de niveau élargi automatiquement pour trouver des recettes compatibles.";
      }
    }

    if (eligible.length === 0) {
      return {
        selectedRecipes: [],
        totalMeals,
        totalPortions,
        totalCost: 0,
        synergyScore: 0,
        sharedIngredients: [],
        nutrition: { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, avgCalories: 0, avgProtein: 0, avgCarbs: 0, avgFat: 0 },
        notice: "Aucune recette compatible avec votre matériel et vos exclusions. Vérifiez vos filtres."
      };
    }

    const maxRecipesCap = days > 7 ? 8 : 5;
    const targetDistinct = Math.min(
      eligible.length,
      Math.max(1, Math.min(maxRecipesCap, Math.ceil(totalMeals / 2.5)))
    );

    const connectivityMap = new Map();
    eligible.forEach((r) => {
      const neighbors = new Set();
      r._coreIngredients.forEach((ing) => {
        const set = indexedData.ingredientToRecipes.get(ing);
        if (set) set.forEach((id) => neighbors.add(id));
      });
      connectivityMap.set(r.id, neighbors.size);
    });

    const rankedStarters = [...eligible].sort((a, b) => {
      const effPriceA = a.price * getCalorieScale(a, config);
      const effPriceB = b.price * getCalorieScale(b, config);
      const budgetPenaltyA = Math.max(0, effPriceA - targetPricePerPortion * 1.15) * 4;
      const budgetPenaltyB = Math.max(0, effPriceB - targetPricePerPortion * 1.15) * 4;
      const freezeBoostA = isLongHorizon && a.freezable ? 3 : 0;
      const freezeBoostB = isLongHorizon && b.freezable ? 3 : 0;
      const pantryA = computePantryBonus(a, pantryNormSet) * 2;
      const pantryB = computePantryBonus(b, pantryNormSet) * 2;
      const customBoostA = a.isCustom ? 5 : 0;
      const customBoostB = b.isCustom ? 5 : 0;

      const scoreA =
        (connectivityMap.get(a.id) || 0) + freezeBoostA + pantryA + customBoostA - budgetPenaltyA - a._totalTime * 0.05;
      const scoreB =
        (connectivityMap.get(b.id) || 0) + freezeBoostB + pantryB + customBoostB - budgetPenaltyB - b._totalTime * 0.05;
      return scoreB - scoreA;
    });

    const hasCustomEligible = rankedStarters.some((r) => r.isCustom);
    const starterIndex = hasCustomEligible ? 0 : randomizeSeed % Math.min(rankedStarters.length, 4);
    const chosen = [rankedStarters[starterIndex]];

    while (chosen.length < targetDistinct) {
      const chosenIds = new Set(chosen.map((r) => r.id));
      const chosenCats = new Set(chosen.map((r) => r.category));

      let bestCandidate = null;
      let bestScore = -Infinity;

      eligible.forEach((cand) => {
        if (chosenIds.has(cand.id)) return;

        const effPrice = cand.price * getCalorieScale(cand, config);
        const overlap = computeOverlapScore(cand, chosen);
        const pantryBonus = computePantryBonus(cand, pantryNormSet);
        const priceRatio = targetPricePerPortion / Math.max(0.5, effPrice);
        const budgetScore = Math.min(1.3, priceRatio);
        const catBonus = chosenCats.has(cand.category) ? 0 : 0.25;
        const batchBonus = cand.batchFriendly ? 0.15 : 0;
        const freezeBonus = isLongHorizon ? (cand.freezable ? 0.6 : -0.4) : 0;
        const customBonus = cand.isCustom ? 4.5 : 0;
        const timePenalty = cand._totalTime > (Number(config.maxTime) || 90) * 0.65 ? 0.35 : 0;
        const jitter = randomizeSeed > 0 ? ((cand.id * 17 + randomizeSeed * 31) % 10) * 0.025 : 0;

        const totalScore =
          overlap * 2.4 +
          pantryBonus +
          budgetScore * 1.5 +
          catBonus +
          batchBonus +
          freezeBonus +
          customBonus -
          timePenalty +
          jitter;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestCandidate = cand;
        }
      });

      if (!bestCandidate) break;
      chosen.push(bestCandidate);
    }

    const sortedForAllocation = [...chosen].sort(
      (a, b) => a.price * getCalorieScale(a, config) - b.price * getCalorieScale(b, config)
    );
    const baseBatches = Math.floor(totalMeals / sortedForAllocation.length);
    let remainder = totalMeals % sortedForAllocation.length;

    const planned = sortedForAllocation.map((recipe) => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      const batches = baseBatches + extra;
      return applyScaleToRecipe(recipe, batches, servings, config);
    });

    let currentCost = computePlanCost(planned);
    if (currentCost > maxBudget) {
      const cheaperPool = eligible
        .filter((r) => !planned.some((p) => p.id === r.id))
        .sort((a, b) => a.price * getCalorieScale(a, config) - b.price * getCalorieScale(b, config));

      for (let i = planned.length - 1; i >= 0 && currentCost > maxBudget; i--) {
        const expensive = planned[i];
        if (expensive.isCustom) continue;
        const replacement = cheaperPool.find(
          (c) => c.price * getCalorieScale(c, config) < expensive._effectivePrice * 0.85
        );
        if (replacement) {
          planned[i] = applyScaleToRecipe(replacement, expensive.batches, servings, config);
          cheaperPool.splice(cheaperPool.indexOf(replacement), 1);
          currentCost = computePlanCost(planned);
        }
      }
      if (currentCost > maxBudget) {
        notice = `Le coût brut (${currentCost.toFixed(2)} €) dépasse votre cible (${maxBudget.toFixed(2)} €) pour ${totalPortions} portions.`;
      }
    }

    if (!notice && isLongHorizon) {
      notice = `Plan sur ${days} jours (${totalPortions} portions) : conservez les 4 premiers jours au réfrigérateur et congelez le reste dès refroidissement.`;
    }

    return finalizePlanMetrics(planned, totalMeals, totalPortions, notice);
  }

  function replaceRecipeInPlan(currentPlan, recipeIdToReplace, indexedData, config) {
    const servings = Math.max(1, Number(config.servings) || 1);
    const currentIds = new Set(currentPlan.selectedRecipes.map((r) => r.id));
    const others = currentPlan.selectedRecipes.filter((r) => r.id !== recipeIdToReplace);
    const targetSlot = currentPlan.selectedRecipes.find((r) => r.id === recipeIdToReplace);
    const pantryNormSet = new Set((config.pantryItems || []).map(normalizeText).filter(Boolean));

    if (!targetSlot) return currentPlan;

    const candidates = indexedData.recipes
      .filter((r) => !currentIds.has(r.id) && isRecipeEligible(r, config))
      .sort((a, b) => {
        const scoreA = computeOverlapScore(a, others) * 2 + computePantryBonus(a, pantryNormSet);
        const scoreB = computeOverlapScore(b, others) * 2 + computePantryBonus(b, pantryNormSet);
        return scoreB - scoreA || a.price - b.price;
      });

    if (candidates.length === 0) return currentPlan;

    const replacement = applyScaleToRecipe(candidates[0], targetSlot.batches, servings, config);
    const updatedRecipes = currentPlan.selectedRecipes.map((r) =>
      r.id === recipeIdToReplace ? replacement : r
    );

    return finalizePlanMetrics(
      updatedRecipes,
      currentPlan.totalMeals,
      currentPlan.totalPortions,
      currentPlan.notice
    );
  }

  function rebuildPlanFromSavedSlots(slots, indexedData, config) {
    const servings = Math.max(1, Number(config.servings) || 1);
    const byId = new Map(indexedData.recipes.map((r) => [r.id, r]));
    const planned = [];
    let totalMeals = 0;

    slots.forEach(({ id, batches }) => {
      const rec = byId.get(id);
      if (rec) {
        const b = Math.max(1, Number(batches) || 1);
        totalMeals += b;
        planned.push(applyScaleToRecipe(rec, b, servings, config));
      }
    });

    if (!planned.length) return null;
    const totalPortions = totalMeals * servings;
    return finalizePlanMetrics(planned, totalMeals, totalPortions, "Plan chargé depuis un lien partagé.");
  }

  function computePlanCost(plannedRecipes) {
    return plannedRecipes.reduce((sum, r) => sum + r._effectivePrice * r.totalPortions, 0);
  }

  function finalizePlanMetrics(plannedRecipes, totalMeals, totalPortions, notice) {
    const totalCost = computePlanCost(plannedRecipes);

    const usageCount = new Map();
    plannedRecipes.forEach((r) => {
      r._coreIngredients.forEach((ing) => {
        usageCount.set(ing, (usageCount.get(ing) || 0) + 1);
      });
    });

    const sharedIngredients = [];
    let totalCoreSlots = 0;
    let sharedCoreSlots = 0;

    usageCount.forEach((count, ing) => {
      totalCoreSlots += count;
      if (count >= 2) {
        sharedIngredients.push(ing);
        sharedCoreSlots += count;
      }
    });

    const synergyScore =
      plannedRecipes.length <= 1
        ? 100
        : totalCoreSlots > 0
        ? Math.min(100, Math.round((sharedCoreSlots / totalCoreSlots) * 100))
        : 0;

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    plannedRecipes.forEach((r) => {
      totalCalories += r._effectiveCalories * r.totalPortions;
      totalProtein += r._effectiveProtein * r.totalPortions;
      totalCarbs += r._effectiveCarbs * r.totalPortions;
      totalFat += r._effectiveFat * r.totalPortions;
    });

    const denom = Math.max(1, totalPortions);

    return {
      selectedRecipes: plannedRecipes,
      totalMeals,
      totalPortions,
      totalCost,
      synergyScore,
      sharedIngredients,
      nutrition: {
        totalCalories: Math.round(totalCalories),
        totalProtein: Math.round(totalProtein),
        totalCarbs: Math.round(totalCarbs),
        totalFat: Math.round(totalFat),
        avgCalories: Math.round(totalCalories / denom),
        avgProtein: Math.round(totalProtein / denom),
        avgCarbs: Math.round(totalCarbs / denom),
        avgFat: Math.round(totalFat / denom)
      },
      notice
    };
  }

  global.BatchPlanner = {
    normalizeText,
    buildRecipeIndex,
    isRecipeEligible,
    generatePlan,
    replaceRecipeInPlan,
    rebuildPlanFromSavedSlots
  };
})(window);
