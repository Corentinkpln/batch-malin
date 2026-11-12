/**
 * Batch Malin — Moteur d'optimisation de menu & anti-gaspillage (planner.js)
 * Conçu pour gérer 500+ recettes en mémoire via index inversé d'ingrédients.
 */
(function (global) {
  "use strict";

  // Ingrédients de fond de placard ignorés dans le calcul de synergie anti-gaspi
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
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Construit un index inversé ingrédient -> Set<recipeId> en O(N)
   * Permet de scorer des centaines de recettes instantanément.
   */
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

  /**
   * Vérifie la compatibilité stricte d'une recette avec les contraintes utilisateur
   */
  function isRecipeEligible(recipe, config) {
    // 1. Matériel disponible
    const available = new Set((config.equipment || []).map(normalizeText));
    const reqEquip = recipe.equipment || [];
    for (let i = 0; i < reqEquip.length; i++) {
      if (!available.has(normalizeText(reqEquip[i]))) {
        return false;
      }
    }

    // 2. Régime alimentaire
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
      if ((Number(recipe.protein) || 0) < 28) return false;
    }

    // 3. Niveau en cuisine
    const skill = config.skill || "intermediate";
    if (skill === "beginner" && recipe._difficulty === "advanced") {
      return false;
    }

    return true;
  }

  /**
   * Calcule le ratio de recouvrement d'ingrédients entre une recette candidate et l'ensemble déjà choisi
   */
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

  /**
   * Génère un plan de repas optimisé (budget, anti-gaspi, matériel, temps)
   */
  function generatePlan(indexedData, config, options = {}) {
    const totalMeals = Math.max(1, (Number(config.days) || 5) * (Number(config.mealsPerDay) || 2));
    const servings = Math.max(1, Number(config.servings) || 1);
    const totalPortions = totalMeals * servings;
    const maxBudget = Math.max(5, Number(config.budget) || 35);
    const targetPricePerPortion = maxBudget / totalPortions;
    const randomizeSeed = Number(options.seed) || 0;

    let eligible = indexedData.recipes.filter((r) => isRecipeEligible(r, config));
    let notice = null;

    // Fallback progressif si les filtres sont trop restrictifs
    if (eligible.length === 0) {
      eligible = indexedData.recipes.filter((r) =>
        isRecipeEligible(r, { ...config, skill: "advanced" })
      );
      notice = "Filtre de niveau élargi automatiquement pour trouver des recettes compatibles avec votre matériel.";
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
        notice: "Aucune recette ne correspond à votre sélection de matériel et de régime. Ajoutez au moins une source de cuisson (ex: Plaques induction, Four ou Air Fryer)."
      };
    }

    // Nombre optimal de recettes distinctes pour maximiser la réutilisation sans monotonie
    const targetDistinct = Math.min(
      eligible.length,
      Math.max(1, Math.min(5, Math.ceil(totalMeals / 2.2)))
    );

    // Pré-calcul de la connectivité anti-gaspi de chaque recette dans l'index
    const connectivityMap = new Map();
    eligible.forEach((r) => {
      const neighbors = new Set();
      r._coreIngredients.forEach((ing) => {
        const set = indexedData.ingredientToRecipes.get(ing);
        if (set) set.forEach((id) => neighbors.add(id));
      });
      connectivityMap.set(r.id, neighbors.size);
    });

    // Étape 1 : Sélection de la recette pivot (bon rapport prix/connectivité)
    const rankedStarters = [...eligible].sort((a, b) => {
      const budgetPenaltyA = Math.max(0, a.price - targetPricePerPortion * 1.15) * 4;
      const budgetPenaltyB = Math.max(0, b.price - targetPricePerPortion * 1.15) * 4;
      const scoreA = (connectivityMap.get(a.id) || 0) - budgetPenaltyA - a._totalTime * 0.05;
      const scoreB = (connectivityMap.get(b.id) || 0) - budgetPenaltyB - b._totalTime * 0.05;
      return scoreB - scoreA;
    });

    const starterIndex = randomizeSeed % Math.min(rankedStarters.length, 4);
    const chosen = [rankedStarters[starterIndex]];

    // Étape 2 : Ajout glouton pondéré par synergie d'ingrédients + respect du budget + diversité
    while (chosen.length < targetDistinct) {
      const chosenIds = new Set(chosen.map((r) => r.id));
      const chosenCats = new Set(chosen.map((r) => r.category));

      let bestCandidate = null;
      let bestScore = -Infinity;

      eligible.forEach((cand) => {
        if (chosenIds.has(cand.id)) return;

        const overlap = computeOverlapScore(cand, chosen);
        const priceRatio = targetPricePerPortion / Math.max(0.5, cand.price);
        const budgetScore = Math.min(1.3, priceRatio);
        const catBonus = chosenCats.has(cand.category) ? 0 : 0.22;
        const batchBonus = cand.batchFriendly ? 0.15 : 0;
        const timePenalty = cand._totalTime > (Number(config.maxTime) || 90) * 0.65 ? 0.35 : 0;
        const jitter = randomizeSeed > 0 ? ((cand.id * 17 + randomizeSeed * 31) % 10) * 0.025 : 0;

        const totalScore =
          overlap * 2.4 + budgetScore * 1.5 + catBonus + batchBonus - timePenalty + jitter;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestCandidate = cand;
        }
      });

      if (!bestCandidate) break;
      chosen.push(bestCandidate);
    }

    // Étape 3 : Répartition des créneaux de repas (batches)
    // On favorise légèrement les recettes les moins chères et batchFriendly pour absorber plus de repas
    const sortedForAllocation = [...chosen].sort((a, b) => a.price - b.price);
    const baseBatches = Math.floor(totalMeals / sortedForAllocation.length);
    let remainder = totalMeals % sortedForAllocation.length;

    const planned = sortedForAllocation.map((recipe) => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      const batches = baseBatches + extra;
      return {
        ...recipe,
        batches,
        totalPortions: batches * servings
      };
    });

    // Étape 4 : Passe d'ajustement budgétaire si dépassement
    let currentCost = computePlanCost(planned);
    if (currentCost > maxBudget) {
      const cheaperPool = eligible
        .filter((r) => !planned.some((p) => p.id === r.id))
        .sort((a, b) => a.price - b.price);

      for (let i = planned.length - 1; i >= 0 && currentCost > maxBudget; i--) {
        const expensive = planned[i];
        const replacement = cheaperPool.find((c) => c.price < expensive.price * 0.85);
        if (replacement) {
          planned[i] = {
            ...replacement,
            batches: expensive.batches,
            totalPortions: expensive.totalPortions
          };
          cheaperPool.splice(cheaperPool.indexOf(replacement), 1);
          currentCost = computePlanCost(planned);
        }
      }
      if (currentCost > maxBudget) {
        notice = `Le coût estimé (${currentCost.toFixed(2)} €) dépasse légèrement votre cible (${maxBudget.toFixed(2)} €) pour ${totalPortions} portions. Réduisez les portions ou augmentez le budget.`;
      }
    }

    return finalizePlanMetrics(planned, totalMeals, totalPortions, notice);
  }

  /**
   * Remplace une seule recette du plan tout en conservant la synergie d'ingrédients
   */
  function replaceRecipeInPlan(currentPlan, recipeIdToReplace, indexedData, config) {
    const servings = Math.max(1, Number(config.servings) || 1);
    const currentIds = new Set(currentPlan.selectedRecipes.map((r) => r.id));
    const others = currentPlan.selectedRecipes.filter((r) => r.id !== recipeIdToReplace);
    const targetSlot = currentPlan.selectedRecipes.find((r) => r.id === recipeIdToReplace);

    if (!targetSlot) return currentPlan;

    const candidates = indexedData.recipes
      .filter((r) => !currentIds.has(r.id) && isRecipeEligible(r, config))
      .sort((a, b) => {
        const ovA = computeOverlapScore(a, others);
        const ovB = computeOverlapScore(b, others);
        return ovB - ovA || a.price - b.price;
      });

    if (candidates.length === 0) return currentPlan;

    const replacement = {
      ...candidates[0],
      batches: targetSlot.batches,
      totalPortions: targetSlot.batches * servings
    };

    const updatedRecipes = currentPlan.selectedRecipes.map((r) =>
      r.id === recipeIdToReplace ? replacement : r
    );

    return finalizePlanMetrics(
      updatedRecipes,
      currentPlan.totalMeals,
      currentPlan.totalPortions,
      null
    );
  }

  function computePlanCost(plannedRecipes) {
    return plannedRecipes.reduce((sum, r) => sum + r.price * r.totalPortions, 0);
  }

  function finalizePlanMetrics(plannedRecipes, totalMeals, totalPortions, notice) {
    const totalCost = computePlanCost(plannedRecipes);

    // Calcul du score anti-gaspi (part d'ingrédients frais utilisés dans >= 2 recettes)
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

    // Calcul nutritionnel global et moyen par repas
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    plannedRecipes.forEach((r) => {
      totalCalories += (Number(r.calories) || 0) * r.totalPortions;
      totalProtein += (Number(r.protein) || 0) * r.totalPortions;
      totalCarbs += (Number(r.carbs) || 0) * r.totalPortions;
      totalFat += (Number(r.fat) || 0) * r.totalPortions;
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
    replaceRecipeInPlan
  };
})(window);
