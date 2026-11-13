// js/shopping.js — Consolidation de la liste de courses, "Vider mon frigo" et Export iPhone

const BatchShopping = (() => {
  const AISLE_ORDER = [
    "Fruits & Légumes",
    "Viandes & Poissons",
    "Crèmerie & Œufs",
    "Épicerie Salée",
    "Conserves & Bocaux",
    "Épicerie Sucrée"
  ];

  function consolidate(planItems, recipesMap, ingredientsMap, customPrices, fridgeStock) {
    const rawTotals = {};

    planItems.forEach(entry => {
      const recipe = recipesMap[entry.recipeId];
      if (!recipe) return;
      const scale = (Number(entry.portions) || 1) / Math.max(1, Number(recipe.basePortions) || 1);

      (recipe.ingredients || []).forEach(item => {
        const ing = ingredientsMap[item.id];
        if (!ing) return;
        const needed = (Number(item.qty) || 0) * scale;
        rawTotals[item.id] = (rawTotals[item.id] || 0) + needed;
      });
    });

    const items = [];
    let totalGross = 0;
    let totalNet = 0;

    Object.keys(rawTotals).forEach(ingId => {
      const ing = ingredientsMap[ingId];
      if (!ing) return;
      const grossQty = ing.unit === 'pièce' ? Math.ceil(rawTotals[ingId]) : Math.round(rawTotals[ingId]);
      const stockQty = Math.max(0, Number((fridgeStock && fridgeStock[ingId]) || 0));
      const netQty = Math.max(0, grossQty - stockQty);

      const unitPrice = BatchPlanner.getEffectivePrice(ing, customPrices);
      const factor = Number(ing.unitFactor) || 1000;
      const grossCost = Math.round(((grossQty / factor) * unitPrice) * 100) / 100;
      const netCost = Math.round(((netQty / factor) * unitPrice) * 100) / 100;
      const isCustomPrice = customPrices && Object.prototype.hasOwnProperty.call(customPrices, ingId);

      totalGross += grossCost;
      totalNet += netCost;

      if (grossQty > 0) {
        items.push({
          id: ingId,
          name: ing.name,
          aisle: ing.aisle || "Épicerie Salée",
          unit: ing.unit,
          priceUnit: ing.priceUnit,
          unitFactor: factor,
          unitPrice,
          isCustomPrice,
          grossQty,
          stockQty,
          netQty,
          grossCost,
          netCost
        });
      }
    });

    // Group by aisle
    const grouped = {};
    items.forEach(it => {
      if (!grouped[it.aisle]) grouped[it.aisle] = [];
      grouped[it.aisle].push(it);
    });

    const orderedAisles = Object.keys(grouped).sort((a, b) => {
      const ia = AISLE_ORDER.indexOf(a);
      const ib = AISLE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'fr');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    orderedAisles.forEach(aisle => {
      grouped[aisle].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    });

    totalGross = Math.round(totalGross * 100) / 100;
    totalNet = Math.round(totalNet * 100) / 100;

    return {
      items,
      grouped,
      orderedAisles,
      totalGross,
      totalNet,
      totalSaved: Math.max(0, Math.round((totalGross - totalNet) * 100) / 100)
    };
  }

  function formatQty(qty, unit) {
    if (unit === 'g' && qty >= 1000) {
      return `${(qty / 1000).toFixed(2).replace(/\.00$/, '').replace('.', ',')} kg`;
    }
    if (unit === 'ml' && qty >= 1000) {
      return `${(qty / 1000).toFixed(2).replace(/\.00$/, '').replace('.', ',')} L`;
    }
    if (unit === 'pièce') {
      return `${qty} ${qty > 1 ? 'pièces' : 'pièce'}`;
    }
    return `${qty} ${unit}`;
  }

  /**
   * Génère le texte optimisé pour iPhone :
   * - mode === 'reminders' : 1 ligne par article sans en-têtes ni puces complexes,
   *   afin que le collage dans Apple Rappels crée instantanément une case à cocher par produit.
   * - mode === 'notes' : structuré par rayon avec prix estimés et total net.
   */
  function buildIphoneExportText(consolidated, checkedMap, options = {}) {
    const mode = options.mode || 'reminders';
    const includeChecked = Boolean(options.includeChecked);
    const storeName = (options.storeName || '').trim();

    const activeItems = consolidated.items.filter(it => {
      if (it.netQty <= 0) return false;
      if (!includeChecked && checkedMap && checkedMap[it.id]) return false;
      return true;
    });

    if (!activeItems.length) {
      return "Aucun article à acheter (liste vide ou tout est déjà dans votre panier / frigo).";
    }

    if (mode === 'reminders') {
      return activeItems
        .map(it => `${it.name} — ${formatQty(it.netQty, it.unit)}`)
        .join('
');
    }

    // Mode Apple Notes / WhatsApp détaillé par rayon
    const lines = [];
    const header = storeName ? `🛒 COURSES BATCH MALIN (${storeName})` : `🛒 COURSES BATCH MALIN`;
    lines.push(header);
    lines.push(`Total estimé : ${consolidated.totalNet.toFixed(2).replace('.', ',')} €`);
    lines.push("");

    consolidated.orderedAisles.forEach(aisle => {
      const aisleItems = (consolidated.grouped[aisle] || []).filter(it => {
        if (it.netQty <= 0) return false;
        if (!includeChecked && checkedMap && checkedMap[it.id]) return false;
        return true;
      });
      if (!aisleItems.length) return;

      const aisleSum = aisleItems.reduce((acc, x) => acc + x.netCost, 0);
      lines.push(`▸ ${aisle.toUpperCase()} (${aisleSum.toFixed(2).replace('.', ',')} €)`);
      aisleItems.forEach(it => {
        lines.push(`• ${it.name} : ${formatQty(it.netQty, it.unit)} (~${it.netCost.toFixed(2).replace('.', ',')} €)`);
      });
      lines.push("");
    });

    return lines.join('
').trim();
  }

  return {
    consolidate,
    formatQty,
    buildIphoneExportText
  };
})();
