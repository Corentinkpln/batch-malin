/**
 * Batch Malin — Ordonnanceur parallèle de Batch Cooking (batch.js)
 * Regroupe les tâches de mise en place similaires et exécute les cuissons en parallèle
 * par appareil afin de minimiser la durée totale de session.
 */
(function (global) {
  "use strict";

  function parseStartTimeToMinutes(timeStr) {
    const parts = String(timeStr || "18:00").split(":");
    const h = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 18));
    const m = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
    return h * 60 + m;
  }

  function formatMinutesAsClock(totalMinutes) {
    const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}`;
  }

  /**
   * Génère un planning chronologique optimisé minimisant le temps total
   */
  function generateBatchSchedule(selectedRecipes, shoppingData, startTimeStr = "18:00") {
    if (!selectedRecipes || !selectedRecipes.length) {
      return {
        steps: [],
        totalDurationMin: 0,
        sequentialDurationMin: 0,
        timeSavedMin: 0,
        startClock: formatMinutesAsClock(parseStartTimeToMinutes(startTimeStr)),
        endClock: formatMinutesAsClock(parseStartTimeToMinutes(startTimeStr))
      };
    }

    const startMin = parseStartTimeToMinutes(startTimeStr);
    const timeline = [];

    // Calcul du temps séquentiel naïf (pour mesurer le gain réel de parallélisation)
    const sequentialDurationMin = selectedRecipes.reduce(
      (sum, r) => sum + (Number(r.prepTime) || 10) + (Number(r.cookTime) || 15) + 5,
      0
    );

    // 1. Regroupement intelligent des préparations par type d'ingrédient
    const vegList = [];
    const proteinList = [];
    const grainList = [];

    (shoppingData.items || []).forEach((item) => {
      if (item.prepType === "chop_veg") vegList.push(`${item.name} (${item.formattedQty})`);
      else if (item.prepType === "prep_protein") proteinList.push(`${item.name} (${item.formattedQty})`);
      else if (item.prepType === "rinse_grain") grainList.push(`${item.name} (${item.formattedQty})`);
    });

    let cursor = startMin;

    // Étape initiale : Découpe groupée des légumes
    if (vegList.length > 0) {
      const vegPrepDur = Math.max(8, Math.min(22, vegList.length * 3 + 4));
      timeline.push({
        id: "step-prep-veg",
        startMin: cursor,
        durationMin: vegPrepDur,
        clock: formatMinutesAsClock(cursor),
        title: "Découper tous les légumes en une seule fois",
        description: `Laver, éplucher et tailler : ${vegList.join(", ")}.`,
        type: "prep",
        typeLabel: "Préparation",
        appliance: "Plan de travail"
      });
      cursor += vegPrepDur;
    }

    // Étape suivante : Préparation des protéines & marinades
    if (proteinList.length > 0) {
      const protPrepDur = Math.max(6, Math.min(15, proteinList.length * 4 + 2));
      timeline.push({
        id: "step-prep-protein",
        startMin: cursor,
        durationMin: protPrepDur,
        clock: formatMinutesAsClock(cursor),
        title: "Préparer et assaisonner les protéines",
        description: `Détailler et mariner : ${proteinList.join(", ")}.`,
        type: "prep",
        typeLabel: "Préparation",
        appliance: "Plan de travail"
      });
      cursor += protPrepDur;
    }

    // Si aucun légume/protéine catalogué, mise en place générale
    if (cursor === startMin) {
      timeline.push({
        id: "step-prep-general",
        startMin: cursor,
        durationMin: 10,
        clock: formatMinutesAsClock(cursor),
        title: "Mise en place des ingrédients et contenants",
        description: `Peser et préparer les bases pour ${selectedRecipes.length} recettes.`,
        type: "prep",
        typeLabel: "Préparation",
        appliance: "Plan de travail"
      });
      cursor += 10;
    }

    // 2. Ordonnancement parallèle des cuissons par appareil
    // Chaque appareil possède sa propre file temporelle : deux appareils distincts démarrent ensemble !
    const cookingLaunchBase = cursor;
    const applianceCursor = new Map();
    let maxCookingEnd = cookingLaunchBase;

    // Trier les recettes par temps de cuisson décroissant (Longest Processing Time first - LPT)
    const recipesByCookTime = [...selectedRecipes].sort(
      (a, b) => (Number(b.cookTime) || 15) - (Number(a.cookTime) || 15)
    );

    recipesByCookTime.forEach((recipe) => {
      const cookDur = Math.max(8, Number(recipe.cookTime) || 15);
      const equipList = recipe.equipment && recipe.equipment.length ? recipe.equipment : ["Plaques induction"];
      const primaryAppliance = equipList[0];

      const earliestStart = applianceCursor.get(primaryAppliance) || cookingLaunchBase;
      const stepEnd = earliestStart + cookDur;
      applianceCursor.set(primaryAppliance, stepEnd);

      if (stepEnd > maxCookingEnd) {
        maxCookingEnd = stepEnd;
      }

      const mainStepHint = (recipe.steps && recipe.steps[1]) || (recipe.steps && recipe.steps[0]) || "Cuisson maîtrisée";

      timeline.push({
        id: `step-cook-${recipe.id}`,
        startMin: earliestStart,
        durationMin: cookDur,
        clock: formatMinutesAsClock(earliestStart),
        title: `Lancer ${recipe.name} (${primaryAppliance})`,
        description: `${recipe.totalPortions} portions · ${mainStepHint}.`,
        type: "cook",
        typeLabel: primaryAppliance,
        appliance: primaryAppliance
      });

      // Si la recette utilise un second appareil (ex: riz sur plaques pendant poulet au Air Fryer)
      if (equipList.length > 1) {
        const secondaryAppliance = equipList[1];
        const secDur = Math.max(10, Math.round(cookDur * 0.75));
        const secStart = applianceCursor.get(secondaryAppliance) || cookingLaunchBase;
        const secEnd = secStart + secDur;
        applianceCursor.set(secondaryAppliance, secEnd);
        if (secEnd > maxCookingEnd) maxCookingEnd = secEnd;

        timeline.push({
          id: `step-cook-sec-${recipe.id}`,
          startMin: secStart,
          durationMin: secDur,
          clock: formatMinutesAsClock(secStart),
          title: `Cuisson parallèle accompagnement — ${recipe.name}`,
          description: grainList.length
            ? `Lancer la cuisson des féculents (${grainList.join(", ")}) sur ${secondaryAppliance}.`
            : `Utiliser ${secondaryAppliance} en simultané.`,
          type: "cook",
          typeLabel: secondaryAppliance,
          appliance: secondaryAppliance
        });
      }
    });

    // 3. Tâche de sauces / finitions pendant le temps masqué des cuissons
    const sauceStart = Math.min(cookingLaunchBase + 5, Math.max(cookingLaunchBase, maxCookingEnd - 12));
    timeline.push({
      id: "step-sauces",
      startMin: sauceStart,
      durationMin: 8,
      clock: formatMinutesAsClock(sauceStart),
      title: "Préparer les sauces, assaisonnements et garnitures",
      description: "Profitant du temps de cuisson passif, préparer les sauces, herbes et toppings.",
      type: "prep",
      typeLabel: "Temps masqué",
      appliance: "Plan de travail"
    });

    // 4. Assemblage final et mise en boîtes
    const freezableNames = selectedRecipes.filter((r) => r.freezable).map((r) => r.name);
    const packDuration = Math.max(8, selectedRecipes.length * 3);
    const sessionEnd = maxCookingEnd + packDuration;

    timeline.push({
      id: "step-boxing",
      startMin: maxCookingEnd,
      durationMin: packDuration,
      clock: formatMinutesAsClock(maxCookingEnd),
      title: "Assemblage, refroidissement et mise en boîtes",
      description:
        freezableNames.length > 0
          ? `Répartir en contenants hermétiques. Congélation possible pour : ${freezableNames.join(", ")}.`
          : "Répartir toutes les portions en contenants hermétiques et réfrigérer sous 2h.",
      type: "pack",
      typeLabel: "Conservation",
      appliance: "Boîtes hermétiques"
    });

    // Tri chronologique strict
    timeline.sort((a, b) => a.startMin - b.startMin);

    const totalDurationMin = Math.max(15, sessionEnd - startMin);
    const timeSavedMin = Math.max(0, sequentialDurationMin - totalDurationMin);

    return {
      steps: timeline,
      totalDurationMin,
      sequentialDurationMin,
      timeSavedMin,
      startClock: formatMinutesAsClock(startMin),
      endClock: formatMinutesAsClock(sessionEnd)
    };
  }

  global.BatchScheduler = {
    generateBatchSchedule
  };
})(window);
