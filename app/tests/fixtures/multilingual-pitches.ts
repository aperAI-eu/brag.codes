import { emptyDetails } from "../../src/projects/model.ts";

// Substituted provider outputs: these verify transport/storage, not model accuracy.
export const multilingualPitches = [
  {
    transcript:
      "Vytvoril som Susedskú záhradu. Susedia nevedia, kedy polievať. Aplikácia rozdeľuje služby. Použil som TypeScript. Zatiaľ je to prototyp.",
    proposal: {
      language: "sk",
      title: "Susedská záhrada",
      problem: "Susedia nevedia, kedy polievať.",
      description: "Aplikácia rozdeľuje služby pri polievaní susedskej záhrady.",
      details: {
        ...emptyDetails,
        core_idea: "Spoločný rozpis polievania",
        capabilities: ["Rozdelenie služieb"],
        stack: ["TypeScript"],
        reality_level: "prototype",
      },
    },
  },
  {
    transcript:
      "Vytvořil jsem Sousedskou zahradu. Sousedé nevědí, kdy zalévat. Aplikace rozděluje služby. Použil jsem TypeScript. Zatím je to prototyp.",
    proposal: {
      language: "cs",
      title: "Sousedská zahrada",
      problem: "Sousedé nevědí, kdy zalévat.",
      description: "Aplikace rozděluje služby při zalévání sousedské zahrady.",
      details: {
        ...emptyDetails,
        core_idea: "Společný rozpis zalévání",
        capabilities: ["Rozdělení služeb"],
        stack: ["TypeScript"],
        reality_level: "prototype",
      },
    },
  },
  {
    transcript:
      "I built Neighbourhood Garden. Neighbours do not know when to water. The app assigns shifts. I used TypeScript. It is a prototype.",
    proposal: {
      language: "en",
      title: "Neighbourhood Garden",
      problem: "Neighbours do not know when to water.",
      description: "The app assigns watering shifts for a neighbourhood garden.",
      details: {
        ...emptyDetails,
        core_idea: "A shared watering schedule",
        capabilities: ["Assign shifts"],
        stack: ["TypeScript"],
        reality_level: "prototype",
      },
    },
  },
];
