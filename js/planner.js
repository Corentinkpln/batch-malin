// js/planner.js — Logique de calcul des coûts/macros, ciblage calorique et tri Frigo/Congélateur

const BatchPlanner = (() => {
  function getEffectivePrice(ingredient, customPrices) {
    if (customPrices && Object.prototype.hasOwnProperty.call(customPrices, ingredient.id)) {
      const val = Number(customPrices[ingredient.id]);
      if (!Number.isNaN(val) && val >= 0) return val;
    }
    return Number(ingredient.defaultPrice) || 0;
  }

  function computeRecipeMetrics(recipe, ingredientsMap, customPrices) {
    let totalCost = 0;
    let totalKcal = 0;
    let totalProt = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    (recipe.ingredients || []).forEach(item => {
      const ing = ingredientsMap[item.id];
      if (!ing) return;
      const qty = Number(item.qty) || 0;
      const unitPrice = getEffectivePrice(ing, customPrices);
      const factor = Number(ing.unitFactor) || 1000;
      totalCost += (qty / factor) * unitPrice;

      // Macros: kcal100 is per 100g/100ml, or per 1 piece when unit === 'pièce'
      const macroFactor = ing.unit === 'pièce' ? 1 : 100;
      totalKcal += (qty / macroFactor) * (Number(ing.kcal100) || 0);
      totalProt += (qty / macroFactor) * (Number(ing.prot100) || 0);
      totalCarbs += (qty / macroFactor) * (Number(ing.carbs100) || 0);
      totalFat += (qty / macroFactor) * (Number(ing.fat100) || 0);
    });

    const basePortions = Math.max(1, Number(recipe.basePortions) || 1);
    return {
      totalCost: Math.round(totalCost * 100) / 100,
      costPerPortion: Math.round((totalCost / basePortions) * 100) / 100,
      kcalPerPortion: Math.round(totalKcal / basePortions),
      protPerPortion: Math.round(totalProt / basePortions),
      carbsPerPortion: Math.round(totalCarbs / basePortions),
      fatPerPortion: Math.round(totalFat / basePortions)
    };
  }

  /**
   * Répartit les portions planifiées entre Frigo (consommation immédiate) et Congélateur
   * en fonction de la durée de conservation frigo de chaque recette et du nombre de personnes.
   */
  function splitFridgeFreezer(planItems, recipesMap, peopleCount) {
    const people = Math.max(1, Number(peopleCount) || 1);
    return planItems.map(entry => {
      const recipe = recipesMap[entry.recipeId];
      if (!recipe) return null;
      const portions = Math.max(1, Number(entry.portions) || 1);
      const fridgeDays = Math.max(1, Number(recipe.fridgeDays) || 3);
      const canFreeze = (Number(recipe.freezerDays) || 0) > 0;

      // Capacité maximale consommable avant péremption au frigo (2 repas/jour max par personne pour ce plat)
      const maxFridgePortions = canFreeze ? Math.min(portions, fridgeDays * people) : portions;
      const freezerPortions = Math.max(0, portions - maxFridgePortions);

      return {
        ...entry,
        recipe,
        fridgePortions: maxFridgePortions,
        freezerPortions,
        canFreeze
      };
    }).filter(Boolean);
  }

  /**
   * Ajuste proportionnellement les portions des recettes sélectionnées pour atteindre
   * l'objectif calorique global (days * people * dailyKcalTarget).
   */
  function autoScalePortions(planItems, recipesMap, ingredientsMap, customPrices, settings) {
    if (!planItems.length) return planItems;
    const targetTotalKcal = (Number(settings.days) || 5) * (Number(settings.people) || 1) * (Number(settings.kcalTarget) || 2200);
    let currentKcal = 0;

    const enriched = planItems.map(item => {
      const rec = recipesMap[item.recipeId];
      const metrics = rec ? computeRecipeMetrics(rec, ingredientsMap, customPrices) : { kcalPerPortion: 500 };
      currentKcal += metrics.kcalPerPortion * item.portions;
      return { item, kcal: Math.max(100, metrics.kcalPerPortion) };
    });

    if (currentKcal <= 0) return planItems;
    const ratio = targetTotalKcal / currentKcal;

    return enriched.map(({ item }) => ({
      ...item,
      portions: Math.max(1, Math.round(item.portions * ratio))
    }));
  }

  return {
    getEffectivePrice,
    computeRecipeMetrics,
    splitFridgeFreezer,
    autoScalePortions
  };
})();
