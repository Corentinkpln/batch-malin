/**
 * Batch Malin V2.2 — Générateur de liste de courses consolidée (shopping.js)
 * Intègre : fusion d'unités, mise à l'échelle calorique et déduction du stock frigo.
 */
(function (global) {
  "use strict";

  const AISLE_ORDER = [
    "Boucherie & Poissonnerie",
    "Fruits & Légumes",
    "Crèmerie & Oeufs",
    "Épicerie & Féculents",
    "Condiments & Épices"
  ];

  function normalizeKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/œ/g, "oe")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  function toBaseUnit(quantity, unit) {
    const u = String(unit || "").trim().toLowerCase();
    const q = Number(quantity) || 0;

    if (u === "kg") return { qty: q * 1000, baseUnit: "g" };
    if (u === "g") return { qty: q, baseUnit: "g" };
    if (u === "l") return { qty: q * 1000, baseUnit: "ml" };
    if (u === "cl") return { qty: q * 10, baseUnit: "ml" };
    if (u === "ml") return { qty: q, baseUnit: "ml" };
    return { qty: q, baseUnit: u || "pièce" };
  }

  function formatDisplayQuantity(baseQty, baseUnit) {
    if (baseUnit === "g") {
      if (baseQty >= 1000) {
        const kg = Math.round((baseQty / 1000) * 100) / 100;
        return { formatted: `${kg.toLocaleString("fr-FR")} kg`, value: kg, unit: "kg" };
      }
      const roundedG = Math.round(baseQty);
      return { formatted: `${roundedG.toLocaleString("fr-FR")} g`, value: roundedG, unit: "g" };
    }

    if (baseUnit === "ml") {
      if (baseQty >= 1000) {
        const liters = Math.round((baseQty / 1000) * 100) / 100;
        return { formatted: `${liters.toLocaleString("fr-FR")} L`, value: liters, unit: "L" };
      }
      const roundedMl = Math.round(baseQty);
      return { formatted: `${roundedMl.toLocaleString("fr-FR")} ml`, value: roundedMl, unit: "ml" };
    }

    const roundedCount = Math.ceil(baseQty * 10) / 10;
    const unitLabel =
      roundedCount > 1 && baseUnit === "pièce"
        ? "pièces"
        : roundedCount > 1 && baseUnit === "boîte"
        ? "boîtes"
        : roundedCount > 1 && baseUnit === "gousse"
        ? "gousses"
        : roundedCount > 1 && baseUnit === "tranche"
        ? "tranches"
        : baseUnit;

    return {
      formatted: `${roundedCount.toLocaleString("fr-FR")} ${unitLabel}`,
      value: roundedCount,
      unit: unitLabel
    };
  }

  function buildShoppingList(selectedRecipes, ingredientsCatalog = {}, pantryItems = []) {
    const mergedMap = new Map();
    const pantryNormSet = new Set((pantryItems || []).map(normalizeKey).filter(Boolean));

    const catalogByNorm = new Map();
    Object.entries(ingredientsCatalog).forEach(([key, meta]) => {
      catalogByNorm.set(normalizeKey(key), { canonicalName: key, ...meta });
    });

    selectedRecipes.forEach((recipe) => {
      const portions = Number(recipe.totalPortions) || 1;
      const calorieScale = Number(recipe._calorieScale) || 1;
      const recipeIngredients = recipe.ingredients || [];

      recipeIngredients.forEach((item) => {
        const norm = normalizeKey(item.name);
        const catMeta = catalogByNorm.get(norm);
        const displayName = catMeta ? catMeta.canonicalName : item.name;
        const { qty, baseUnit } = toBaseUnit(item.quantity * calorieScale * portions, item.unit);
        const mapKey = `${norm}__${baseUnit}`;

        if (!mergedMap.has(mapKey)) {
          mergedMap.set(mapKey, {
            id: mapKey,
            name: displayName,
            normName: norm,
            baseQty: 0,
            baseUnit,
            aisle: (catMeta && catMeta.aisle) || "Épicerie & Féculents",
            prepType: (catMeta && catMeta.prepType) || "pantry",
            unitPrice: catMeta ? Number(catMeta.unitPrice) || 0 : 0,
            priceUnit: catMeta ? catMeta.unit : baseUnit,
            recipesUsedIn: new Set()
          });
        }

        const entry = mergedMap.get(mapKey);
        entry.baseQty += qty;
        entry.recipesUsedIn.add(recipe.name);
      });
    });

    const allItems = [];
    let totalEstimatedCost = 0;
    let savedFromPantry = 0;

    mergedMap.forEach((entry) => {
      const display = formatDisplayQuantity(entry.baseQty, entry.baseUnit);
      const inPantry =
        pantryNormSet.has(entry.normName) ||
        Array.from(pantryNormSet).some((p) => entry.normName.includes(p) || p.includes(entry.normName));

      let rawCost = 0;
      if (entry.unitPrice > 0) {
        if (entry.priceUnit === "kg" && entry.baseUnit === "g") {
          rawCost = (entry.baseQty / 1000) * entry.unitPrice;
        } else if (entry.priceUnit === "L" && entry.baseUnit === "ml") {
          rawCost = (entry.baseQty / 1000) * entry.unitPrice;
        } else {
          rawCost = entry.baseQty * entry.unitPrice;
        }
      } else {
        rawCost = entry.baseUnit === "g" ? (entry.baseQty / 1000) * 3.5 : 0.8;
      }

      rawCost = Math.round(rawCost * 100) / 100;
      const estimatedCost = inPantry ? 0 : rawCost;

      if (inPantry) {
        savedFromPantry += rawCost;
      } else {
        totalEstimatedCost += estimatedCost;
      }

      allItems.push({
        id: entry.id,
        name: entry.name,
        aisle: entry.aisle,
        prepType: entry.prepType,
        formattedQty: display.formatted,
        displayValue: display.value,
        displayUnit: display.unit,
        estimatedCost,
        rawCost,
        inPantry,
        recipeCount: entry.recipesUsedIn.size,
        recipesList: Array.from(entry.recipesUsedIn)
      });
    });

    const groupedByAisle = [];
    const aisleMap = new Map();

    allItems
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .forEach((item) => {
        if (!aisleMap.has(item.aisle)) {
          aisleMap.set(item.aisle, []);
        }
        aisleMap.get(item.aisle).push(item);
      });

    AISLE_ORDER.forEach((aisleName) => {
      if (aisleMap.has(aisleName)) {
        groupedByAisle.push({
          aisle: aisleName,
          items: aisleMap.get(aisleName)
        });
        aisleMap.delete(aisleName);
      }
    });

    aisleMap.forEach((items, aisleName) => {
      groupedByAisle.push({ aisle: aisleName, items });
    });

    return {
      items: allItems,
      groupedByAisle,
      totalItemsCount: allItems.length,
      totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
      savedFromPantry: Math.round(savedFromPantry * 100) / 100
    };
  }

  function formatShoppingListAsText(shoppingData) {
    const lines = ["BATCH MALIN — LISTE DE COURSES", ""];
    shoppingData.groupedByAisle.forEach((group) => {
      lines.push(`▸ ${group.aisle.toUpperCase()}`);
      group.items.forEach((item) => {
        const suffix = item.inPantry ? " [DÉJÀ EN STOCK]" : ` (~${item.estimatedCost.toFixed(2)} €)`;
        lines.push(`  • ${item.name} : ${item.formattedQty}${suffix}`);
      });
      lines.push("");
    });
    lines.push(`Total à acheter : ${shoppingData.totalEstimatedCost.toFixed(2)} €`);
    if (shoppingData.savedFromPantry > 0) {
      lines.push(`Économisé grâce aux restes frigo : ${shoppingData.savedFromPantry.toFixed(2)} €`);
    }
    return lines.join("
");
  }

  global.BatchShopping = {
    buildShoppingList,
    formatShoppingListAsText
  };
})(window);
