// js/batch.js — Ordonnancement parallèle de la session Batch Cooking

const BatchScheduler = (() => {
  function buildSchedule(planItems, recipesMap, equipmentMap) {
    if (!planItems.length) {
      return { equipmentList: [], phases: [], totalPrep: 0, totalCook: 0 };
    }

    const eqIds = new Set();
    let totalPrep = 0;
    let maxCook = 0;

    const ovenRecipes = [];
    const stoveRecipes = [];
    const coldRecipes = [];

    planItems.forEach(entry => {
      const rec = recipesMap[entry.recipeId];
      if (!rec) return;
      totalPrep += Number(rec.prepTime) || 0;
      maxCook = Math.max(maxCook, Number(rec.cookTime) || 0);

      (rec.equipment || []).forEach(id => eqIds.add(id));

      const eq = rec.equipment || [];
      if (eq.includes('four')) {
        ovenRecipes.push({ rec, portions: entry.portions });
      } else if ((Number(rec.cookTime) || 0) > 0) {
        stoveRecipes.push({ rec, portions: entry.portions });
      } else {
        coldRecipes.push({ rec, portions: entry.portions });
      }
    });

    const equipmentList = Array.from(eqIds)
      .map(id => equipmentMap[id])
      .filter(Boolean);

    const phases = [];

    // Phase 1 : Préparation groupée
    phases.push({
      title: "1️⃣ Mise en place & découpe groupée",
      subtitle: "Sortez tout le matériel et découpez tous vos légumes et viandes en une seule fois.",
      tasks: planItems.map(entry => {
        const rec = recipesMap[entry.recipeId];
        return `<strong>${rec.title}</strong> (${entry.portions} port.) — ${rec.steps[0] || "Préparer les ingrédients."}`;
      })
    });

    // Phase 2 : Four
    if (ovenRecipes.length) {
      phases.push({
        title: "2️⃣ Lancement des cuissons au Four (en parallèle)",
        subtitle: "Enfournez ces plats en premier pour libérer vos mains pendant la cuisson.",
        tasks: ovenRecipes.map(({ rec, portions }) =>
          `<strong>${rec.title}</strong> (${portions} port. · ~${rec.cookTime} min) — ${rec.steps.slice(1).join(' ')}`
        )
      });
    }

    // Phase 3 : Plaques & Mijotage
    if (stoveRecipes.length) {
      phases.push({
        title: "3️⃣ Cuissons sur Plaques / Mijotage",
        subtitle: "Pendant que le four tourne, enchaînez les cuissons à la poêle, casserole ou faitout.",
        tasks: stoveRecipes.map(({ rec, portions }) =>
          `<strong>${rec.title}</strong> (${portions} port. · ~${rec.cookTime} min) — ${rec.steps.slice(1).join(' ')}`
        )
      });
    }

    // Phase 4 : Sans cuisson
    if (coldRecipes.length) {
      phases.push({
        title: "4️⃣ Assemblages à froid",
        subtitle: "Préparations sans cuisson prêtes en quelques minutes.",
        tasks: coldRecipes.map(({ rec, portions }) =>
          `<strong>${rec.title}</strong> (${portions} port.) — ${rec.steps.join(' ')}`
        )
      });
    }

    // Phase 5 : Refroidissement & Stockage
    const split = BatchPlanner.splitFridgeFreezer(planItems, recipesMap, 1);
    phases.push({
      title: "5️⃣ Refroidissement, Mise en Boîtes & Étiquetage",
      subtitle: "Laissez tiédir 20-30 min avant de fermer les boîtes pour éviter la condensation.",
      tasks: split.map(item => {
        const parts = [];
        if (item.fridgePortions > 0) parts.push(`🧊 ${item.fridgePortions} port. au Frigo (max ${item.recipe.fridgeDays} j)`);
        if (item.freezerPortions > 0) parts.push(`❄️ ${item.freezerPortions} port. au Congélateur`);
        return `<strong>${item.recipe.title}</strong> : ${parts.join(' · ')}`;
      })
    });

    return { equipmentList, phases, totalPrep, totalCook: maxCook };
  }

  return { buildSchedule };
})();
