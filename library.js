/* Ukeshandel v0.3 – bakgrunnsbibliotek: norske hverdagsretter (statisk, ingen nettoppslag).
 * Vises som forslag øverst i Retter. «Legg til» kopierer retten inn i våre retter (id «lib-<id>»).
 * Format som seed.js: ingredienser er [navn, mengde, enhet, avdeling]. Enheter og avdelinger må finnes i appen.
 */
(function () {
  var FG = 'Frukt/grønt', KJ = 'Kjøl', FR = 'Frys', TV = 'Tørrvare', HU = 'Hus';

  var L = [
    { id: 'bergensk-fiskesuppe', name: 'Bergensk fiskesuppe', minutes: 40, ingredients: [
      ['torskefilet', 400, 'g', KJ], ['laksefilet', 200, 'g', KJ], ['gulrot', 2, 'stk', FG], ['purre', 1, 'stk', FG],
      ['sellerirot', 0.5, 'stk', FG], ['fiskebuljong', 1, 'l', TV], ['melk', 3, 'dl', KJ], ['matfløte', 2, 'dl', KJ],
      ['hvetemel', 0.5, 'dl', TV], ['smør', 2, 'ss', KJ], ['gressløk', 1, 'bunt', FG]]},
    { id: 'kjottsuppe', name: 'Kjøttsuppe', minutes: 120, note: 'God dagen derpå – lag mye', ingredients: [
      ['høyrygg av storfe', 800, 'g', KJ], ['gulrot', 4, 'stk', FG], ['kålrot', 0.5, 'stk', FG], ['sellerirot', 0.5, 'stk', FG],
      ['purre', 1, 'stk', FG], ['poteter', 600, 'g', FG], ['salt', 1, 'ss', TV], ['pepper', 1, 'ts', TV]]},
    { id: 'lapskaus', name: 'Lapskaus', minutes: 60, ingredients: [
      ['svinekjøtt i terninger', 500, 'g', KJ], ['poteter', 800, 'g', FG], ['gulrot', 3, 'stk', FG], ['kålrot', 0.5, 'stk', FG],
      ['løk', 2, 'stk', FG], ['kjøttbuljong', 1, 'l', TV], ['flatbrød', 1, 'pk', TV]]},
    { id: 'farikal', name: 'Fårikål', minutes: 150, note: 'Høstklassiker', ingredients: [
      ['fårikålkjøtt', 1.5, 'kg', KJ], ['hodekål', 1.5, 'kg', FG], ['hel sort pepper', 2, 'ss', TV], ['hvetemel', 2, 'ss', TV],
      ['salt', 1, 'ss', TV], ['poteter', 1, 'kg', FG]]},
    { id: 'ovnskylling-rotgronnsaker', name: 'Ovnsbakt kylling med rotgrønnsaker', minutes: 60, ingredients: [
      ['kyllinglår', 1, 'kg', KJ], ['poteter', 600, 'g', FG], ['gulrot', 3, 'stk', FG], ['pastinakk', 2, 'stk', FG],
      ['rødløk', 2, 'stk', FG], ['olivenolje', 3, 'ss', TV], ['rosmarin', 1, 'pk', FG], ['hvitløk', 4, 'fedd', FG]]},
    { id: 'karbonader', name: 'Karbonader med løk og poteter', minutes: 40, ingredients: [
      ['karbonadedeig', 600, 'g', KJ], ['løk', 2, 'stk', FG], ['poteter', 800, 'g', FG], ['brun saus', 1, 'pk', TV],
      ['erter', 1, 'pk', FR], ['smør', 2, 'ss', KJ]]},
    { id: 'medisterkaker', name: 'Medisterkaker med surkål', minutes: 40, ingredients: [
      ['medisterkaker', 600, 'g', KJ], ['surkål', 1, 'pk', KJ], ['poteter', 800, 'g', FG], ['brun saus', 1, 'pk', TV],
      ['tyttebærsyltetøy', 1, 'glass', TV]]},
    { id: 'raspeballer', name: 'Raspeballer med sideflesk', minutes: 90, note: 'Rester kan stekes neste dag', ingredients: [
      ['poteter', 1.5, 'kg', FG], ['byggmel', 3, 'dl', TV], ['hvetemel', 1, 'dl', TV], ['sideflesk', 600, 'g', KJ],
      ['pinnekjøttpølse', 1, 'pk', KJ], ['kålrot', 1, 'stk', FG], ['smør', 3, 'ss', KJ], ['salt', 1, 'ss', TV]]},
    { id: 'plukkfisk', name: 'Plukkfisk', minutes: 40, ingredients: [
      ['torskefilet', 500, 'g', FR], ['poteter', 600, 'g', FG], ['melk', 4, 'dl', KJ], ['hvetemel', 0.5, 'dl', TV],
      ['smør', 2, 'ss', KJ], ['bacon', 1, 'pk', KJ], ['gressløk', 1, 'bunt', FG], ['flatbrød', 1, 'pk', TV]]},
    { id: 'kokt-torsk', name: 'Kokt torsk med gulrøtter', minutes: 30, ingredients: [
      ['torskeloins', 600, 'g', KJ], ['poteter', 800, 'g', FG], ['gulrot', 4, 'stk', FG], ['smør', 100, 'g', KJ],
      ['sitron', 1, 'stk', FG], ['persille', 1, 'bunt', FG]]},
    { id: 'seibiff', name: 'Seibiff med løk', minutes: 30, ingredients: [
      ['seifilet', 600, 'g', KJ], ['løk', 3, 'stk', FG], ['hvetemel', 0.5, 'dl', TV], ['smør', 3, 'ss', KJ],
      ['poteter', 800, 'g', FG], ['gulrot', 3, 'stk', FG]]},
    { id: 'stekt-makrell', name: 'Stekt makrell med agurksalat', minutes: 30, ingredients: [
      ['makrellfilet', 600, 'g', KJ], ['poteter', 800, 'g', FG], ['agurk', 1, 'stk', FG], ['eddik', 2, 'ss', TV],
      ['sukker', 1, 'ss', TV], ['rømme', 1, 'beger', KJ], ['smør', 2, 'ss', KJ]]},
    { id: 'teriyakilaks', name: 'Teriyakilaks med ris', minutes: 25, ingredients: [
      ['laksefilet', 600, 'g', KJ], ['teriyakisaus', 1, 'flaske', TV], ['ris', 4, 'dl', TV], ['brokkoli', 1, 'stk', FG],
      ['sukkererter', 200, 'g', FG], ['sesamfrø', 1, 'ss', TV]]},
    { id: 'fiskeboller', name: 'Fiskeboller i hvit saus', minutes: 30, ingredients: [
      ['fiskeboller', 2, 'boks', TV], ['poteter', 800, 'g', FG], ['gulrot', 4, 'stk', FG], ['karri', 1, 'ts', TV],
      ['smør', 2, 'ss', KJ], ['hvetemel', 0.5, 'dl', TV]]},
    { id: 'fiskepinner', name: 'Fiskepinner med potetmos', minutes: 25, ingredients: [
      ['fiskepinner', 1, 'pk', FR], ['poteter', 800, 'g', FG], ['melk', 2, 'dl', KJ], ['smør', 2, 'ss', KJ],
      ['erter', 1, 'pk', FR], ['remulade', 1, 'beger', KJ]]},
    { id: 'pytt-i-panne', name: 'Pytt i panne', minutes: 25, note: 'Fin for rester', ingredients: [
      ['poteter', 800, 'g', FG], ['pølser', 1, 'pk', KJ], ['løk', 2, 'stk', FG], ['paprika', 1, 'stk', FG],
      ['egg', 4, 'stk', KJ], ['rødbeter', 1, 'glass', TV], ['smør', 2, 'ss', KJ]]},
    { id: 'tacopai', name: 'Tacopai', minutes: 50, ingredients: [
      ['kjøttdeig', 400, 'g', KJ], ['tacokrydder', 1, 'pk', TV], ['butterdeig', 1, 'pk', FR], ['rømme', 1, 'beger', KJ],
      ['egg', 2, 'stk', KJ], ['revet ost', 1, 'pk', KJ], ['paprika', 1, 'stk', FG], ['mais', 1, 'boks', TV]]},
    { id: 'hjemmelaget-pizza', name: 'Hjemmelaget pizza', minutes: 60, ingredients: [
      ['hvetemel', 6, 'dl', TV], ['tørrgjær', 1, 'pk', TV], ['olivenolje', 2, 'ss', TV], ['pizzasaus', 1, 'glass', TV],
      ['revet ost', 2, 'pk', KJ], ['skinke', 1, 'pk', KJ], ['champignon', 250, 'g', FG], ['paprika', 1, 'stk', FG]]},
    { id: 'hamburgere', name: 'Hamburgere', minutes: 30, ingredients: [
      ['kjøttdeig', 600, 'g', KJ], ['hamburgerbrød', 1, 'pk', TV], ['isbergsalat', 1, 'stk', FG], ['tomat', 2, 'stk', FG],
      ['rødløk', 1, 'stk', FG], ['cheddar i skiver', 1, 'pk', KJ], ['hamburgerdressing', 1, 'flaske', TV], ['pommes frites', 1, 'pk', FR]]},
    { id: 'carbonara', name: 'Spaghetti carbonara', minutes: 25, ingredients: [
      ['spaghetti', 400, 'g', TV], ['bacon', 2, 'pk', KJ], ['egg', 4, 'stk', KJ], ['parmesan', 1, 'stk', KJ],
      ['hvitløk', 2, 'fedd', FG], ['pepper', 1, 'ts', TV]]},
    { id: 'polsegryte', name: 'Pølsegryte', minutes: 30, ingredients: [
      ['wienerpølser', 1, 'pk', KJ], ['løk', 1, 'stk', FG], ['paprika', 2, 'stk', FG], ['knuste tomater', 2, 'boks', TV],
      ['matfløte', 2, 'dl', KJ], ['paprikapulver', 1, 'ss', TV], ['ris', 4, 'dl', TV]]},
    { id: 'chili-con-carne', name: 'Chili con carne', minutes: 45, ingredients: [
      ['kjøttdeig', 500, 'g', KJ], ['løk', 1, 'stk', FG], ['hvitløk', 3, 'fedd', FG], ['kidneybønner', 2, 'boks', TV],
      ['knuste tomater', 2, 'boks', TV], ['chilipulver', 2, 'ts', TV], ['spisskummen', 1, 'ts', TV], ['ris', 4, 'dl', TV],
      ['rømme', 1, 'beger', KJ]]},
    { id: 'tikka-masala', name: 'Kylling tikka masala', minutes: 40, ingredients: [
      ['kyllingfilet', 600, 'g', KJ], ['tikka masala-saus', 1, 'glass', TV], ['løk', 1, 'stk', FG], ['matfløte', 2, 'dl', KJ],
      ['basmatiris', 4, 'dl', TV], ['naanbrød', 1, 'pk', TV], ['koriander', 1, 'pk', FG]]},
    { id: 'vegetarlasagne', name: 'Vegetarlasagne', minutes: 70, ingredients: [
      ['squash', 1, 'stk', FG], ['aubergine', 1, 'stk', FG], ['paprika', 2, 'stk', FG], ['løk', 1, 'stk', FG],
      ['knuste tomater', 2, 'boks', TV], ['lasagneplater', 1, 'pk', TV], ['cottage cheese', 1, 'beger', KJ],
      ['revet ost', 1, 'pk', KJ], ['spinat', 1, 'pk', FR]]},
    { id: 'linsesuppe', name: 'Linsesuppe', minutes: 35, ingredients: [
      ['røde linser', 3, 'dl', TV], ['løk', 1, 'stk', FG], ['gulrot', 2, 'stk', FG], ['hvitløk', 2, 'fedd', FG],
      ['knuste tomater', 1, 'boks', TV], ['kokosmelk', 1, 'boks', TV], ['grønnsaksbuljong', 1, 'l', TV], ['karri', 2, 'ts', TV]]},
    { id: 'gul-ertesuppe', name: 'Gul ertesuppe med flesk', minutes: 90, note: 'Legg ertene i bløt kvelden før', ingredients: [
      ['gule erter', 500, 'g', TV], ['sideflesk', 400, 'g', KJ], ['løk', 1, 'stk', FG], ['gulrot', 2, 'stk', FG],
      ['kålrot', 0.5, 'stk', FG], ['timian', 1, 'ts', TV]]},
    { id: 'blomkalsuppe', name: 'Blomkålsuppe', minutes: 30, ingredients: [
      ['blomkål', 1, 'stk', FG], ['løk', 1, 'stk', FG], ['poteter', 300, 'g', FG], ['grønnsaksbuljong', 1, 'l', TV],
      ['matfløte', 2, 'dl', KJ], ['bacon', 1, 'pk', KJ], ['brød', 1, 'stk', TV]]},
    { id: 'soppristotto', name: 'Sopprisotto', minutes: 40, ingredients: [
      ['risottoris', 4, 'dl', TV], ['champignon', 400, 'g', FG], ['sjalottløk', 2, 'stk', FG], ['hvitløk', 2, 'fedd', FG],
      ['grønnsaksbuljong', 1, 'l', TV], ['parmesan', 1, 'stk', KJ], ['smør', 2, 'ss', KJ]]},
    { id: 'pasta-pesto-kylling', name: 'Pasta pesto med kylling', minutes: 25, ingredients: [
      ['penne', 400, 'g', TV], ['kyllingfilet', 400, 'g', KJ], ['grønn pesto', 1, 'glass', TV], ['cherrytomater', 250, 'g', FG],
      ['ruccola', 1, 'pk', FG], ['parmesan', 1, 'stk', KJ]]},
    { id: 'kremet-laksepasta', name: 'Kremet laksepasta', minutes: 25, ingredients: [
      ['tagliatelle', 400, 'g', TV], ['laksefilet', 400, 'g', KJ], ['matfløte', 3, 'dl', KJ], ['spinat', 1, 'pk', FR],
      ['sitron', 1, 'stk', FG], ['hvitløk', 2, 'fedd', FG], ['parmesan', 1, 'stk', KJ]]},
    { id: 'ovnsomelett', name: 'Ovnsomelett', minutes: 35, ingredients: [
      ['egg', 8, 'stk', KJ], ['melk', 2, 'dl', KJ], ['skinke', 1, 'pk', KJ], ['paprika', 1, 'stk', FG],
      ['vårløk', 1, 'bunt', FG], ['revet ost', 1, 'pk', KJ], ['brød', 1, 'stk', TV]]},
    { id: 'svinekoteletter', name: 'Svinekoteletter med poteter', minutes: 35, ingredients: [
      ['svinekoteletter', 4, 'stk', KJ], ['poteter', 800, 'g', FG], ['brokkoli', 1, 'stk', FG], ['løk', 1, 'stk', FG],
      ['brun saus', 1, 'pk', TV], ['smør', 2, 'ss', KJ]]},
    { id: 'svinefilet-soppsaus', name: 'Svinefilet med soppsaus', minutes: 40, ingredients: [
      ['svinefilet', 600, 'g', KJ], ['champignon', 250, 'g', FG], ['matfløte', 3, 'dl', KJ], ['kjøttbuljong', 1, 'ts', TV],
      ['poteter', 800, 'g', FG], ['aspargesbønner', 200, 'g', FG]]},
    { id: 'kyllinglar-ris', name: 'Kyllinglår med ris', minutes: 50, ingredients: [
      ['kyllinglår', 1, 'kg', KJ], ['ris', 4, 'dl', TV], ['paprikapulver', 1, 'ss', TV], ['hvitløk', 3, 'fedd', FG],
      ['maiskolber', 4, 'stk', FR], ['rømme', 1, 'beger', KJ]]},
    { id: 'stroganoff', name: 'Stroganoff med ris', minutes: 35, ingredients: [
      ['storfekjøtt i strimler', 500, 'g', KJ], ['løk', 1, 'stk', FG], ['champignon', 250, 'g', FG], ['paprikapulver', 1, 'ss', TV],
      ['tomatpuré', 2, 'ss', TV], ['matfløte', 3, 'dl', KJ], ['ris', 4, 'dl', TV], ['sylteagurk', 1, 'glass', TV]]},
    { id: 'kalruletter', name: 'Kålruletter', minutes: 60, ingredients: [
      ['hodekål', 1, 'stk', FG], ['kjøttdeig', 500, 'g', KJ], ['løk', 1, 'stk', FG], ['egg', 1, 'stk', KJ],
      ['melk', 1, 'dl', KJ], ['poteter', 800, 'g', FG], ['smør', 2, 'ss', KJ], ['hvetemel', 0.5, 'dl', TV]]},
    { id: 'fiskegryte', name: 'Fiskegryte', minutes: 35, ingredients: [
      ['torskefilet', 400, 'g', FR], ['reker', 200, 'g', FR], ['løk', 1, 'stk', FG], ['paprika', 1, 'stk', FG],
      ['kokosmelk', 1, 'boks', TV], ['rød karripasta', 1, 'ss', TV], ['limejuice', 1, 'ss', TV], ['ris', 4, 'dl', TV]]},
    { id: 'ovnstorsk-bacon', name: 'Ovnsbakt torsk med bacon', minutes: 35, ingredients: [
      ['torskeloins', 600, 'g', KJ], ['bacon', 1, 'pk', KJ], ['poteter', 800, 'g', FG], ['gulrot', 3, 'stk', FG],
      ['ertebelger', 200, 'g', FG], ['smør', 100, 'g', KJ]]},
    { id: 'schnitzel', name: 'Schnitzel med poteter', minutes: 35, ingredients: [
      ['svineschnitzel', 4, 'stk', KJ], ['egg', 1, 'stk', KJ], ['griljermel', 2, 'dl', TV], ['hvetemel', 0.5, 'dl', TV],
      ['poteter', 800, 'g', FG], ['sitron', 1, 'stk', FG], ['erter', 1, 'pk', FR], ['smør', 3, 'ss', KJ]]},
    { id: 'kyllingnuggets', name: 'Hjemmelagde kyllingnuggets', minutes: 35, ingredients: [
      ['kyllingfilet', 600, 'g', KJ], ['egg', 2, 'stk', KJ], ['cornflakes', 3, 'dl', TV], ['hvetemel', 0.5, 'dl', TV],
      ['søtpotet', 2, 'stk', FG], ['agurk', 1, 'stk', FG], ['ketchup', 1, 'flaske', TV]]},
    { id: 'risgrot', name: 'Risgrøt', minutes: 60, note: 'Rester blir riskrem', ingredients: [
      ['grøtris', 3, 'dl', TV], ['helmelk', 1.5, 'l', KJ], ['smør', 2, 'ss', KJ], ['sukker', 2, 'ss', TV],
      ['kanel', 1, 'ts', TV], ['saft', 1, 'flaske', TV]]},
    { id: 'kyllingenchiladas', name: 'Kyllingenchiladas', minutes: 45, ingredients: [
      ['kyllingfilet', 500, 'g', KJ], ['tortillalefser', 1, 'pk', TV], ['salsa', 1, 'glass', TV], ['sorte bønner', 1, 'boks', TV],
      ['mais', 1, 'boks', TV], ['revet ost', 1, 'pk', KJ], ['rømme', 1, 'beger', KJ], ['avokado', 2, 'stk', FG]]},
    { id: 'quesadilla', name: 'Quesadilla med kylling', minutes: 25, ingredients: [
      ['kyllingfilet', 400, 'g', KJ], ['tortillalefser', 1, 'pk', TV], ['revet ost', 1, 'pk', KJ], ['paprika', 1, 'stk', FG],
      ['vårløk', 1, 'bunt', FG], ['salsa', 1, 'glass', TV], ['rømme', 1, 'beger', KJ]]},
    { id: 'biffwok', name: 'Biffwok med nudler', minutes: 25, ingredients: [
      ['storfekjøtt i strimler', 400, 'g', KJ], ['eggnudler', 250, 'g', TV], ['wokgrønnsaker', 1, 'pk', FR],
      ['hvitløk', 2, 'fedd', FG], ['ingefær', 1, 'stk', FG], ['soyasaus', 3, 'ss', TV], ['østerssaus', 2, 'ss', TV]]},
    { id: 'nudelsuppe', name: 'Nudelsuppe med kylling', minutes: 30, ingredients: [
      ['kyllingfilet', 400, 'g', KJ], ['risnudler', 200, 'g', TV], ['kyllingbuljong', 1, 'l', TV], ['gulrot', 2, 'stk', FG],
      ['pak choi', 2, 'stk', FG], ['vårløk', 1, 'bunt', FG], ['soyasaus', 2, 'ss', TV], ['ingefær', 1, 'stk', FG]]},
    { id: 'kyllingfajitas', name: 'Kyllingfajitas', minutes: 30, ingredients: [
      ['kyllingfilet', 500, 'g', KJ], ['fajitaskrydder', 1, 'pk', TV], ['tortillalefser', 1, 'pk', TV], ['paprika', 2, 'stk', FG],
      ['rødløk', 1, 'stk', FG], ['guacamole', 1, 'beger', KJ], ['rømme', 1, 'beger', KJ]]},
    { id: 'kjottboller-tomatsaus', name: 'Kjøttboller i tomatsaus', minutes: 40, ingredients: [
      ['kjøttdeig', 500, 'g', KJ], ['egg', 1, 'stk', KJ], ['griljermel', 0.5, 'dl', TV], ['løk', 1, 'stk', FG],
      ['tomatsaus', 1, 'glass', TV], ['spaghetti', 400, 'g', TV], ['parmesan', 1, 'stk', KJ], ['basilikum', 1, 'pk', FG]]},
    { id: 'ovnspasta-skinke', name: 'Ovnsbakt pasta med skinke', minutes: 40, ingredients: [
      ['makaroni', 400, 'g', TV], ['kokt skinke', 200, 'g', KJ], ['brokkoli', 1, 'stk', FG], ['melk', 5, 'dl', KJ],
      ['hvetemel', 0.5, 'dl', TV], ['smør', 2, 'ss', KJ], ['revet ost', 1, 'pk', KJ]]},
    { id: 'sursot-svin', name: 'Sursøt svin med ris', minutes: 35, ingredients: [
      ['svinekjøtt i strimler', 500, 'g', KJ], ['sursøt saus', 1, 'glass', TV], ['paprika', 2, 'stk', FG], ['løk', 1, 'stk', FG],
      ['ananas i biter', 1, 'boks', TV], ['ris', 4, 'dl', TV]]},
    { id: 'grillspyd-kylling', name: 'Grillspyd med kylling', minutes: 40, ingredients: [
      ['kyllingfilet', 600, 'g', KJ], ['paprika', 2, 'stk', FG], ['squash', 1, 'stk', FG], ['rødløk', 2, 'stk', FG],
      ['grillspyd', 1, 'pk', HU], ['tzatziki', 1, 'beger', KJ], ['pitabrød', 1, 'pk', TV]]},
    { id: 'stekt-sild', name: 'Stekt sild med løk', minutes: 30, ingredients: [
      ['sildefilet', 600, 'g', KJ], ['løk', 2, 'stk', FG], ['havregryn', 1, 'dl', TV], ['smør', 3, 'ss', KJ],
      ['poteter', 800, 'g', FG], ['rødbeter', 1, 'glass', TV]]},
    { id: 'bacalao', name: 'Bacalao', minutes: 90, note: 'Klippfisken må vannes ut 1–2 døgn på forhånd', ingredients: [
      ['klippfisk', 800, 'g', KJ], ['poteter', 800, 'g', FG], ['løk', 2, 'stk', FG], ['hvitløk', 4, 'fedd', FG],
      ['hermetiske tomater', 2, 'boks', TV], ['paprika', 2, 'stk', FG], ['olivenolje', 1, 'dl', TV], ['oliven', 1, 'glass', TV]]},
    { id: 'kikertgryte', name: 'Kikertgryte', minutes: 35, ingredients: [
      ['kikerter', 2, 'boks', TV], ['løk', 1, 'stk', FG], ['hvitløk', 2, 'fedd', FG], ['søtpotet', 1, 'stk', FG],
      ['kokosmelk', 1, 'boks', TV], ['knuste tomater', 1, 'boks', TV], ['karri', 2, 'ts', TV], ['spinat', 1, 'pk', FR],
      ['ris', 4, 'dl', TV]]},
    { id: 'falafel-pita', name: 'Falafel i pita', minutes: 30, ingredients: [
      ['falafel', 1, 'pk', FR], ['pitabrød', 1, 'pk', TV], ['hummus', 1, 'beger', KJ], ['isbergsalat', 1, 'stk', FG],
      ['tomat', 2, 'stk', FG], ['agurk', 1, 'stk', FG], ['yoghurt naturell', 1, 'beger', KJ]]},
    { id: 'halloumi-ovnsgronnsaker', name: 'Ovnsbakte grønnsaker med halloumi', minutes: 40, ingredients: [
      ['halloumi', 2, 'pk', KJ], ['søtpotet', 2, 'stk', FG], ['rødløk', 2, 'stk', FG], ['paprika', 2, 'stk', FG],
      ['squash', 1, 'stk', FG], ['olivenolje', 3, 'ss', TV], ['couscous', 3, 'dl', TV]]},
    { id: 'potet-purresuppe', name: 'Potet- og purresuppe', minutes: 35, ingredients: [
      ['poteter', 600, 'g', FG], ['purre', 2, 'stk', FG], ['løk', 1, 'stk', FG], ['grønnsaksbuljong', 1, 'l', TV],
      ['matfløte', 2, 'dl', KJ], ['bacon', 1, 'pk', KJ], ['brød', 1, 'stk', TV]]},
    { id: 'fiskeburger', name: 'Fiskeburger', minutes: 25, ingredients: [
      ['fiskeburgere', 1, 'pk', FR], ['hamburgerbrød', 1, 'pk', TV], ['isbergsalat', 1, 'stk', FG], ['tomat', 2, 'stk', FG],
      ['rødløk', 1, 'stk', FG], ['remulade', 1, 'beger', KJ], ['pommes frites', 1, 'pk', FR]]},
    { id: 'reker-loff', name: 'Reker med loff', minutes: 15, note: 'Fredagskos om sommeren', ingredients: [
      ['reker med skall', 1, 'kg', KJ], ['loff', 1, 'stk', TV], ['majones', 1, 'flaske', TV], ['sitron', 2, 'stk', FG],
      ['dill', 1, 'pk', FG], ['smør', 1, 'pk', KJ]]},
    { id: 'kyllingform-brokkoli', name: 'Kyllingform med brokkoli', minutes: 45, ingredients: [
      ['kyllingfilet', 500, 'g', KJ], ['brokkoli', 1, 'stk', FG], ['matfløte', 3, 'dl', KJ], ['revet ost', 1, 'pk', KJ],
      ['karri', 1, 'ts', TV], ['ris', 4, 'dl', TV]]},
    { id: 'gulasjsuppe', name: 'Gulasjsuppe', minutes: 60, ingredients: [
      ['storfekjøtt i terninger', 500, 'g', KJ], ['løk', 2, 'stk', FG], ['paprika', 2, 'stk', FG], ['poteter', 400, 'g', FG],
      ['paprikapulver', 2, 'ss', TV], ['knuste tomater', 1, 'boks', TV], ['kjøttbuljong', 1, 'l', TV], ['rømme', 1, 'beger', KJ]]},
    { id: 'scampipasta', name: 'Scampipasta', minutes: 20, ingredients: [
      ['scampi', 400, 'g', FR], ['linguine', 400, 'g', TV], ['hvitløk', 4, 'fedd', FG], ['chili', 1, 'stk', FG],
      ['cherrytomater', 250, 'g', FG], ['olivenolje', 3, 'ss', TV], ['persille', 1, 'bunt', FG]]},
    { id: 'caesarsalat', name: 'Cæsarsalat med kylling', minutes: 25, ingredients: [
      ['kyllingfilet', 400, 'g', KJ], ['romanosalat', 2, 'stk', FG], ['bacon', 1, 'pk', KJ], ['krutonger', 1, 'pk', TV],
      ['parmesan', 1, 'stk', KJ], ['cæsardressing', 1, 'flaske', TV]]},
    { id: 'kylling-satay', name: 'Kylling satay med ris', minutes: 30, ingredients: [
      ['kyllingfilet', 600, 'g', KJ], ['peanøttsmør', 3, 'ss', TV], ['kokosmelk', 1, 'boks', TV], ['soyasaus', 2, 'ss', TV],
      ['limejuice', 1, 'ss', TV], ['agurk', 1, 'stk', FG], ['ris', 4, 'dl', TV], ['salte peanøtter', 1, 'pk', TV]]},
    { id: 'polsestroganoff', name: 'Pølsestroganoff', minutes: 25, note: 'Rask og barnevennlig', ingredients: [
      ['wienerpølser', 1, 'pk', KJ], ['løk', 1, 'stk', FG], ['tomatpuré', 3, 'ss', TV], ['matfløte', 3, 'dl', KJ],
      ['sennep', 1, 'ss', TV], ['ris', 4, 'dl', TV]]},
    { id: 'sodd', name: 'Sodd', minutes: 90, note: 'Trøndersk klassiker', ingredients: [
      ['fårekjøtt i terninger', 600, 'g', KJ], ['kjøttboller', 400, 'g', KJ], ['gulrot', 3, 'stk', FG], ['poteter', 800, 'g', FG],
      ['kålrot', 0.5, 'stk', FG], ['flatbrød', 1, 'pk', TV], ['salt', 1, 'ss', TV]]}
  ];

  function ing(t) { return { name: t[0], qty: t[1], unit: t[2], aisle: t[3] }; }
  window.UKESHANDEL_LIBRARY = L.map(function (r) {
    return { id: r.id, name: r.name, minutes: r.minutes, note: r.note || '', ingredients: r.ingredients.map(ing) };
  });
})();
