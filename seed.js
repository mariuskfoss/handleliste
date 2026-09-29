/* Testdata for Ukeshandel. Brukes ved første oppstart og ved «Tilbakestill testdata». */
(function () {
  var FG = 'Frukt/grønt', KJ = 'Kjøl', FR = 'Frys', TV = 'Tørrvare', HU = 'Hus';

  // [navn, mengde, enhet, avdeling]
  var recipes = [
    { name: 'Taco', minutes: 30, note: 'Unger spiser dette', ingredients: [
      ['kjøttdeig', 400, 'g', KJ], ['tacokrydder', 1, 'pk', TV], ['tacolefser', 1, 'pk', TV],
      ['isbergsalat', 1, 'stk', FG], ['tomat', 3, 'stk', FG], ['agurk', 1, 'stk', FG],
      ['løk', 1, 'stk', FG], ['mais', 1, 'boks', TV], ['revet ost', 1, 'pk', KJ],
      ['rømme', 1, 'beger', KJ], ['tacosaus', 1, 'glass', TV]
    ]},
    { name: 'Spaghetti bolognese', minutes: 35, note: '', ingredients: [
      ['kjøttdeig', 400, 'g', KJ], ['løk', 1, 'stk', FG], ['hvitløk', 2, 'fedd', FG],
      ['gulrot', 2, 'stk', FG], ['knuste tomater', 2, 'boks', TV], ['tomatpuré', 2, 'ss', TV],
      ['spaghetti', 400, 'g', TV], ['parmesan', 1, 'stk', KJ]
    ]},
    { name: 'Fiskekaker med poteter og gulrøtter', minutes: 30, note: 'Unger spiser dette', ingredients: [
      ['fiskekaker', 600, 'g', KJ], ['poteter', 800, 'g', FG], ['gulrot', 4, 'stk', FG],
      ['løk', 1, 'stk', FG], ['melk', 3, 'dl', KJ], ['hvetemel', 0.5, 'dl', TV], ['smør', 2, 'ss', KJ]
    ]},
    { name: 'Kyllinggryte med ris', minutes: 40, note: '', ingredients: [
      ['kyllingfilet', 600, 'g', KJ], ['løk', 1, 'stk', FG], ['hvitløk', 2, 'fedd', FG],
      ['paprika', 2, 'stk', FG], ['knuste tomater', 1, 'boks', TV], ['matfløte', 3, 'dl', KJ],
      ['karri', 1, 'ss', TV], ['ris', 4, 'dl', TV]
    ]},
    { name: 'Laks med poteter og brokkoli', minutes: 30, note: '', ingredients: [
      ['laksefilet', 600, 'g', KJ], ['poteter', 800, 'g', FG], ['brokkoli', 1, 'stk', FG],
      ['sitron', 1, 'stk', FG], ['rømme', 1, 'beger', KJ], ['dill', 1, 'pk', FG]
    ]},
    { name: 'Pølser i lompe', minutes: 15, note: 'Unger spiser dette', ingredients: [
      ['grillpølser', 2, 'pk', KJ], ['lomper', 1, 'pk', TV], ['ketchup', 1, 'flaske', TV],
      ['sennep', 1, 'flaske', TV], ['sprøstekt løk', 1, 'pk', TV], ['potetsalat', 1, 'beger', KJ]
    ]},
    { name: 'Kjøttkaker i brun saus', minutes: 50, note: '', ingredients: [
      ['kjøttdeig', 600, 'g', KJ], ['løk', 1, 'stk', FG], ['egg', 1, 'stk', KJ], ['melk', 1, 'dl', KJ],
      ['potetmel', 2, 'ss', TV], ['brun saus', 1, 'pk', TV], ['poteter', 800, 'g', FG],
      ['erter', 1, 'pk', FR], ['tyttebærsyltetøy', 1, 'glass', TV]
    ]},
    { name: 'Pannekaker med bacon', minutes: 30, note: 'Unger spiser dette', ingredients: [
      ['hvetemel', 3, 'dl', TV], ['melk', 6, 'dl', KJ], ['egg', 3, 'stk', KJ], ['smør', 2, 'ss', KJ],
      ['bacon', 1, 'pk', KJ], ['blåbærsyltetøy', 1, 'glass', TV]
    ]},
    { name: 'Fiskegrateng', minutes: 60, note: '', ingredients: [
      ['torskefilet', 500, 'g', FR], ['makaroni', 150, 'g', TV], ['melk', 5, 'dl', KJ],
      ['hvetemel', 0.5, 'dl', TV], ['smør', 3, 'ss', KJ], ['egg', 2, 'stk', KJ],
      ['revet ost', 1, 'pk', KJ], ['griljermel', 2, 'ss', TV], ['gulrot', 3, 'stk', FG]
    ]},
    { name: 'Lasagne', minutes: 60, note: 'Lag dobbel porsjon og frys halvparten', ingredients: [
      ['kjøttdeig', 400, 'g', KJ], ['løk', 1, 'stk', FG], ['hvitløk', 2, 'fedd', FG],
      ['gulrot', 2, 'stk', FG], ['knuste tomater', 2, 'boks', TV], ['lasagneplater', 1, 'pk', TV],
      ['melk', 5, 'dl', KJ], ['hvetemel', 0.5, 'dl', TV], ['smør', 3, 'ss', KJ], ['revet ost', 1, 'pk', KJ]
    ]},
    { name: 'Kylling-wok', minutes: 25, note: '', ingredients: [
      ['kyllingfilet', 500, 'g', KJ], ['wokgrønnsaker', 1, 'pk', FR], ['paprika', 1, 'stk', FG],
      ['hvitløk', 2, 'fedd', FG], ['ingefær', 1, 'stk', FG], ['soyasaus', 3, 'ss', TV], ['ris', 4, 'dl', TV]
    ]},
    { name: 'Tomatsuppe med egg og makaroni', minutes: 20, note: 'Unger spiser dette', ingredients: [
      ['tomatsuppe', 2, 'pk', TV], ['makaroni', 100, 'g', TV], ['egg', 4, 'stk', KJ]
    ]}
  ];

  var staples = [
    ['melk', 2, 'l', KJ], ['brød', 1, 'stk', TV], ['smør', 1, 'pk', KJ], ['egg', 12, 'stk', KJ],
    ['kaffe', 1, 'pk', TV], ['bananer', 6, 'stk', FG], ['oppvaskmiddel', 1, 'flaske', HU],
    ['dopapir', 1, 'pk', HU]
  ];

  function ing(t) { return { name: t[0], qty: t[1], unit: t[2], aisle: t[3] }; }

  window.UKESHANDEL_SEED = function () {
    return {
      recipes: recipes.map(function (r, i) {
        return { id: 'r' + (i + 1), name: r.name, minutes: r.minutes, note: r.note,
          ingredients: r.ingredients.map(ing) };
      }),
      staples: staples.map(function (s, i) {
        var o = ing(s); o.id = 's' + (i + 1); o.active = true; return o;
      })
    };
  };
})();
