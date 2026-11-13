/**
 * Batch Malin V2.1 — Ordonnanceur parallèle de Batch Cooking (batch.js)
 * Gère la mise en place groupée, les cuissons parallèles par appareil,
 * l'affichage des étapes complètes des recettes et la répartition Frigo/Congélateur.
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

  function generateBatchSchedule(selectedRecipes, shoppingData, startTimeStr = "18:00", days = 5) {
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

    const sequentialDurationMin = selectedRecipes.reduce(
      (sum, r) => sum + (Number(r.prepTime) || 10) + (Number(r.cookTime) || 15) + 5,
      0
    );

    const vegList = [];
    const proteinList = [];
    const grainList = [];

    (shoppingData.items || []).forEach((item) => {
      if (item.prepType === "chop_veg") vegList.push(`${item.name} (${item.formattedQty})`);
      else if (item.prepType === "prep_protein") proteinList.push(`${item.name} (${item.formattedQty})`);
      else if (item.prepType === "rinse_grain") grainList.push(`${item.name} (${item.formattedQty})`);
    });

    let cursor = startMin;

    if (vegList.length > 0) {
      const vegPrepDur = Math.max(8, Math.min(25, vegList.length * 3 + 4));
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

    if (proteinList.length > 0) {
      const protPrepDur = Math.max(6, Math.min(18, proteinList.length * 4 + 2));
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

    const cookingLaunchBase = cursor;
    const applianceCursor = new Map();
    let maxCookingEnd = cookingLaunchBase;

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

      const recipeSteps = Array.isArray(recipe.steps) ? recipe.steps.filter(Boolean) : [];
      const summaryHint =
        recipeSteps.length > 0
          ? `${recipe.totalPortions} portions · ${recipeSteps.length} étape${recipeSteps.length > 1 ? "s" : ""} à suivre`
          : `${recipe.totalPortions} portions · Cuisson maîtrisée`;

      timeline.push({
        id: `step-cook-${recipe.id}`,
        startMin: earliestStart,
        durationMin: cookDur,
        clock: formatMinutesAsClock(earliestStart),
        title: `Lancer ${recipe.name} (${primaryAppliance})`,
        description: summaryHint,
        subSteps: recipeSteps,
        isCustom: Boolean(recipe.isCustom),
        type: "cook",
        typeLabel: primaryAppliance,
        appliance: primaryAppliance
      });

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

    const freezableNames = selectedRecipes.filter((r) => r.freezable).map((r) => r.name);
    const nonFreezableNames = selectedRecipes.filter((r) => !r.freezable).map((r) => r.name);
    const packDuration = Math.max(8, selectedRecipes.length * 3);
    const sessionEnd = maxCookingEnd + packDuration;

    let boxingDesc;
    if (Number(days) > 5) {
      const priorityFridge = nonFreezableNames.length
        ? `Priorité frigo (Jours 1–4) : ${nonFreezableNames.join(", ")}. `
        : "Réserver les portions des Jours 1–4 au réfrigérateur. ";
      const freezerPart = freezableNames.length
        ? `Congeler immédiatement le reste (Jours 5–${days}) : ${freezableNames.join(", ")}.`
        : `Congeler les portions au-delà du jour 4 après refroidissement complet.`;
      boxingDesc = priorityFridge + freezerPart;
    } else {
      boxingDesc =
        freezableNames.length > 0
          ? `Répartir en contenants hermétiques. Congélation possible pour : ${freezableNames.join(", ")}.`
          : "Répartir toutes les portions en contenants hermétiques et réfrigérer sous 2h.";
    }

    timeline.push({
      id: "step-boxing",
      startMin: maxCookingEnd,
      durationMin: packDuration,
      clock: formatMinutesAsClock(maxCookingEnd),
      title: Number(days) > 5 ? "Mise en boîtes : tri Frigo (J1–4) & Congélateur" : "Assemblage et mise en boîtes",
      description: boxingDesc,
      type: "pack",
      typeLabel: "Conservation",
      appliance: "Boîtes hermétiques"
    });

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
