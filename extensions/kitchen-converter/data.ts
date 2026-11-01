// Ingredient weights, oven temperatures and substitutions.
//
// Weights are grams per US cup (236.6 ml), measured the usual way: flour spooned and levelled, brown sugar packed.
// They follow the weight charts most bakers use (King Arthur Baking's, for most dry goods); liquids use their
// density. A cup of flour can weigh 10 % more or less depending on how it is filled: weigh when it matters.

export type Group =
  | "Flours & Starches"
  | "Sugars & Syrups"
  | "Fats"
  | "Dairy & Liquids"
  | "Chocolate"
  | "Salt, Leaveners & Flavorings"
  | "Grains & Crumbs"
  | "Nuts, Seeds & Dried Fruit"
  | "Cheese"
  | "Purées";

export interface Ingredient {
  id: string;
  name: string;
  /** French name. */
  fr: string;
  /** Other names, English and French, lower case. */
  aliases: string[];
  gramsPerCup: number;
  group: Group;
  note?: string;
}

const I = (
  id: string,
  name: string,
  fr: string,
  gramsPerCup: number,
  group: Group,
  aliases: string[] = [],
  note?: string,
): Ingredient => ({ id, name, fr, gramsPerCup, group, aliases, note });

export const INGREDIENTS: Ingredient[] = [
  // Flours & Starches
  I("flour", "All-purpose flour", "Farine de blé", 120, "Flours & Starches", [
    "flour",
    "plain flour",
    "ap flour",
    "white flour",
    "farine",
    "farine t45",
    "farine t55",
    "farine blanche",
  ], "Spooned into the cup and levelled; scooped, it can weigh 140 g"),
  I("bread-flour", "Bread flour", "Farine de force", 120, "Flours & Starches", [
    "strong flour",
    "farine t65",
    "farine à pain",
  ]),
  I("whole-wheat-flour", "Whole wheat flour", "Farine complète", 113, "Flours & Starches", [
    "wholemeal flour",
    "whole wheat",
    "farine t150",
    "farine intégrale",
  ]),
  I("cake-flour", "Cake flour", "Farine à gâteaux", 120, "Flours & Starches", ["farine fluide"]),
  I("self-rising-flour", "Self-rising flour", "Farine à levure incorporée", 113, "Flours & Starches", [
    "self-raising flour",
    "farine levante",
    "farine avec levure",
  ]),
  I("rye-flour", "Rye flour", "Farine de seigle", 106, "Flours & Starches", ["rye"]),
  I("almond-flour", "Almond flour", "Poudre d'amande", 96, "Flours & Starches", [
    "almond meal",
    "ground almonds",
    "amandes en poudre",
    "farine d'amande",
  ]),
  I("coconut-flour", "Coconut flour", "Farine de coco", 112, "Flours & Starches"),
  I("buckwheat-flour", "Buckwheat flour", "Farine de sarrasin", 120, "Flours & Starches", [
    "buckwheat",
    "farine de blé noir",
  ]),
  I("cornmeal", "Cornmeal", "Semoule de maïs", 138, "Flours & Starches", ["polenta", "polenta (dry)"]),
  I("semolina", "Semolina", "Semoule de blé", 167, "Flours & Starches", ["semoule", "semolina flour"]),
  I("cornstarch", "Cornstarch", "Fécule de maïs", 112, "Flours & Starches", ["cornflour", "maïzena", "maizena"]),
  I("potato-starch", "Potato starch", "Fécule de pomme de terre", 152, "Flours & Starches", ["fécule"]),
  I("rice-flour", "Rice flour", "Farine de riz", 142, "Flours & Starches"),
  // Sugars & Syrups
  I("sugar", "Granulated sugar", "Sucre en poudre", 198, "Sugars & Syrups", [
    "sugar",
    "white sugar",
    "caster sugar",
    "superfine sugar",
    "sucre",
    "sucre semoule",
    "sucre blanc",
  ]),
  I("brown-sugar", "Brown sugar, packed", "Cassonade", 213, "Sugars & Syrups", [
    "brown sugar",
    "light brown sugar",
    "dark brown sugar",
    "sucre roux",
    "sucre brun",
    "vergeoise",
  ]),
  I("powdered-sugar", "Powdered sugar", "Sucre glace", 113, "Sugars & Syrups", [
    "icing sugar",
    "confectioners sugar",
    "confectioners' sugar",
  ]),
  I("honey", "Honey", "Miel", 336, "Sugars & Syrups"),
  I("maple-syrup", "Maple syrup", "Sirop d'érable", 312, "Sugars & Syrups", ["maple"]),
  I("molasses", "Molasses", "Mélasse", 337, "Sugars & Syrups", ["treacle"]),
  I("corn-syrup", "Corn syrup", "Sirop de maïs", 312, "Sugars & Syrups", ["glucose syrup", "sirop de glucose"]),
  // Fats
  I("butter", "Butter", "Beurre", 227, "Fats", ["unsalted butter", "salted butter", "beurre doux", "beurre demi-sel"]),
  I("vegetable-oil", "Vegetable oil", "Huile végétale", 218, "Fats", [
    "oil",
    "canola oil",
    "sunflower oil",
    "rapeseed oil",
    "huile",
    "huile de tournesol",
    "huile de colza",
  ]),
  I("olive-oil", "Olive oil", "Huile d'olive", 216, "Fats"),
  I("coconut-oil", "Coconut oil", "Huile de coco", 218, "Fats", ["huile de noix de coco"]),
  // Dairy & Liquids
  I("water", "Water", "Eau", 237, "Dairy & Liquids"),
  I("milk", "Milk", "Lait", 244, "Dairy & Liquids", ["whole milk", "lait entier", "lait demi-écrémé"]),
  I("buttermilk", "Buttermilk", "Babeurre", 245, "Dairy & Liquids", ["lait ribot"]),
  I("heavy-cream", "Heavy cream", "Crème liquide", 238, "Dairy & Liquids", [
    "cream",
    "double cream",
    "whipping cream",
    "crème",
    "crème entière",
    "crème fleurette",
  ]),
  I("sour-cream", "Sour cream", "Crème aigre", 230, "Dairy & Liquids", ["crème fraîche", "creme fraiche"]),
  I("yogurt", "Plain yogurt", "Yaourt nature", 245, "Dairy & Liquids", [
    "yogurt",
    "yoghurt",
    "greek yogurt",
    "yaourt",
    "yaourt grec",
  ]),
  I("cream-cheese", "Cream cheese", "Fromage à la crème", 227, "Dairy & Liquids", ["philadelphia", "fromage frais"]),
  I("evaporated-milk", "Evaporated milk", "Lait concentré non sucré", 252, "Dairy & Liquids"),
  I("condensed-milk", "Sweetened condensed milk", "Lait concentré sucré", 306, "Dairy & Liquids", ["condensed milk"]),
  I("ricotta", "Ricotta", "Ricotta", 246, "Cheese"),
  // Chocolate
  I("cocoa", "Cocoa powder", "Cacao en poudre", 84, "Chocolate", [
    "cocoa",
    "unsweetened cocoa",
    "cacao",
    "cacao non sucré",
  ]),
  I("chocolate-chips", "Chocolate chips", "Pépites de chocolat", 170, "Chocolate", [
    "chocolate chunks",
    "chopped chocolate",
    "chocolate",
    "chocolat",
    "chocolat haché",
  ]),
  // Salt, Leaveners & Flavorings
  I("salt", "Table salt", "Sel fin", 288, "Salt, Leaveners & Flavorings", ["salt", "fine sea salt", "sel"]),
  I(
    "kosher-salt-diamond",
    "Kosher salt (Diamond Crystal)",
    "Sel casher (Diamond Crystal)",
    134,
    "Salt, Leaveners & Flavorings",
    ["diamond crystal", "kosher salt"],
    "Half the weight of table salt for the same spoon: don't swap them by volume",
  ),
  I("kosher-salt-morton", "Kosher salt (Morton)", "Sel casher (Morton)", 230, "Salt, Leaveners & Flavorings", [
    "morton kosher salt",
  ]),
  I("baking-powder", "Baking powder", "Levure chimique", 192, "Salt, Leaveners & Flavorings", [
    "levure",
    "poudre à lever",
  ]),
  I("baking-soda", "Baking soda", "Bicarbonate de soude", 288, "Salt, Leaveners & Flavorings", [
    "bicarbonate of soda",
    "bicarbonate",
    "bicarb",
  ]),
  I("yeast", "Instant or active dry yeast", "Levure de boulanger sèche", 149, "Salt, Leaveners & Flavorings", [
    "yeast",
    "instant yeast",
    "active dry yeast",
    "dry yeast",
    "levure boulangère",
    "levure sèche",
  ], "A packet is 7 g, 2 ¼ tsp"),
  I("cinnamon", "Ground cinnamon", "Cannelle moulue", 125, "Salt, Leaveners & Flavorings", ["cinnamon", "cannelle"]),
  I("vanilla", "Vanilla extract", "Extrait de vanille", 208, "Salt, Leaveners & Flavorings", ["vanilla", "vanille"]),
  // Grains & Crumbs
  I("rice", "White rice, uncooked", "Riz blanc cru", 185, "Grains & Crumbs", [
    "rice",
    "long grain rice",
    "basmati",
    "riz",
    "riz basmati",
  ]),
  I("quinoa", "Quinoa, uncooked", "Quinoa cru", 170, "Grains & Crumbs", ["quinoa"]),
  I("oats", "Rolled oats", "Flocons d'avoine", 89, "Grains & Crumbs", ["oats", "oatmeal", "porridge oats", "avoine"]),
  I("lentils", "Lentils, dry", "Lentilles sèches", 192, "Grains & Crumbs", ["lentils", "lentilles"]),
  I("couscous", "Couscous, dry", "Couscous sec", 173, "Grains & Crumbs", ["couscous", "semoule de couscous"]),
  I("breadcrumbs", "Dry breadcrumbs", "Chapelure", 112, "Grains & Crumbs", ["breadcrumbs", "bread crumbs"]),
  I("panko", "Panko", "Panko", 50, "Grains & Crumbs"),
  // Nuts, Seeds & Dried Fruit
  I("almonds", "Whole almonds", "Amandes entières", 142, "Nuts, Seeds & Dried Fruit", ["almonds", "amandes"]),
  I("walnuts", "Chopped walnuts", "Cerneaux de noix hachés", 113, "Nuts, Seeds & Dried Fruit", [
    "walnuts",
    "noix",
    "cerneaux de noix",
  ]),
  I("pecans", "Chopped pecans", "Noix de pécan hachées", 113, "Nuts, Seeds & Dried Fruit", [
    "pecans",
    "noix de pécan",
  ]),
  I("hazelnuts", "Whole hazelnuts", "Noisettes entières", 142, "Nuts, Seeds & Dried Fruit", ["hazelnuts", "noisettes"]),
  I("peanut-butter", "Peanut butter", "Beurre de cacahuète", 270, "Nuts, Seeds & Dried Fruit", [
    "beurre de cacahuètes",
  ]),
  I("raisins", "Raisins", "Raisins secs", 149, "Nuts, Seeds & Dried Fruit", ["sultanas", "raisins secs"]),
  I("coconut", "Shredded coconut", "Noix de coco râpée", 85, "Nuts, Seeds & Dried Fruit", [
    "desiccated coconut",
    "coco râpée",
  ]),
  I("sesame", "Sesame seeds", "Graines de sésame", 142, "Nuts, Seeds & Dried Fruit", ["sesame", "sésame"]),
  I("flax", "Ground flaxseed", "Graines de lin moulues", 100, "Nuts, Seeds & Dried Fruit", [
    "flaxseed",
    "flax meal",
    "linseed",
    "lin",
  ]),
  I("sunflower-seeds", "Sunflower seeds", "Graines de tournesol", 140, "Nuts, Seeds & Dried Fruit", [
    "sunflower seeds",
  ]),
  // Cheese
  I("parmesan", "Grated Parmesan", "Parmesan râpé", 100, "Cheese", ["parmesan", "parmigiano"]),
  I("cheddar", "Shredded cheddar", "Cheddar râpé", 113, "Cheese", [
    "cheddar",
    "shredded cheese",
    "grated cheese",
    "fromage râpé",
    "gruyère râpé",
    "emmental râpé",
  ]),
  // Purées
  I("banana", "Mashed banana", "Banane écrasée", 227, "Purées", ["banana", "banane"]),
  I("pumpkin", "Pumpkin purée", "Purée de potiron", 227, "Purées", ["pumpkin", "purée de citrouille", "potiron"]),
  I("applesauce", "Applesauce", "Compote de pommes", 255, "Purées", ["apple sauce", "compote"]),
];

/** A US stick of butter: ½ cup, 8 tablespoons. */
export const BUTTER_STICK_G = 113.4;

export interface OvenRow {
  gas: string;
  celsius: number;
  fahrenheit: number;
  words: string;
}

/** The British gas mark table, as printed on most cookers and in cookbooks. */
export const OVEN: OvenRow[] = [
  { gas: "¼", celsius: 110, fahrenheit: 225, words: "Very cool" },
  { gas: "½", celsius: 120, fahrenheit: 250, words: "Very cool" },
  { gas: "1", celsius: 140, fahrenheit: 275, words: "Cool" },
  { gas: "2", celsius: 150, fahrenheit: 300, words: "Cool" },
  { gas: "3", celsius: 170, fahrenheit: 325, words: "Warm" },
  { gas: "4", celsius: 180, fahrenheit: 350, words: "Moderate" },
  { gas: "5", celsius: 190, fahrenheit: 375, words: "Moderately hot" },
  { gas: "6", celsius: 200, fahrenheit: 400, words: "Hot" },
  { gas: "7", celsius: 220, fahrenheit: 425, words: "Hot" },
  { gas: "8", celsius: 230, fahrenheit: 450, words: "Very hot" },
  { gas: "9", celsius: 240, fahrenheit: 475, words: "Very hot" },
];

export interface Substitution {
  id: string;
  /** What is missing. */
  name: string;
  fr: string;
  keywords: string[];
  /** For what quantity. */
  amount: string;
  /** Replacements, best first. */
  with: string[];
  note?: string;
}

export const SUBSTITUTIONS: Substitution[] = [
  {
    id: "buttermilk",
    name: "Buttermilk",
    fr: "Babeurre",
    keywords: ["buttermilk", "babeurre", "lait ribot"],
    amount: "1 cup (240 ml)",
    with: [
      "1 tbsp lemon juice or white vinegar, plus milk to make 1 cup; wait 5–10 minutes",
      "¾ cup plain yogurt + ¼ cup milk",
    ],
  },
  {
    id: "egg",
    name: "Egg",
    fr: "Œuf",
    keywords: ["egg", "eggs", "oeuf", "œuf", "oeufs", "vegan egg"],
    amount: "1 large egg (50 g)",
    with: [
      "1 tbsp ground flaxseed + 3 tbsp water, rested 5 minutes (binding)",
      "¼ cup (60 g) applesauce or mashed banana (moisture, in cakes and muffins)",
      "3 tbsp aquafaba, the liquid of a can of chickpeas (whips like egg white)",
    ],
    note: "Works for 1 or 2 eggs; recipes built on eggs (soufflés, custards) don't survive it",
  },
  {
    id: "baking-powder",
    name: "Baking powder",
    fr: "Levure chimique",
    keywords: ["baking powder", "levure chimique", "levure"],
    amount: "1 tsp",
    with: ["¼ tsp baking soda + ½ tsp cream of tartar", "¼ tsp baking soda + ½ cup buttermilk or yogurt (less liquid)"],
  },
  {
    id: "baking-soda",
    name: "Baking soda",
    fr: "Bicarbonate de soude",
    keywords: ["baking soda", "bicarbonate", "bicarb"],
    amount: "½ tsp",
    with: ["2 tsp baking powder (it adds some salt and acid: taste may change)"],
  },
  {
    id: "self-rising-flour",
    name: "Self-rising flour",
    fr: "Farine à levure incorporée",
    keywords: ["self-rising flour", "self-raising flour", "farine levante"],
    amount: "1 cup (113 g)",
    with: ["1 cup (120 g) all-purpose flour + 1 ½ tsp baking powder + ¼ tsp salt"],
  },
  {
    id: "cake-flour",
    name: "Cake flour",
    fr: "Farine à gâteaux",
    keywords: ["cake flour", "farine fluide"],
    amount: "1 cup",
    with: ["1 cup all-purpose flour, minus 2 tbsp, plus 2 tbsp cornstarch, sifted together"],
  },
  {
    id: "brown-sugar",
    name: "Brown sugar",
    fr: "Cassonade",
    keywords: ["brown sugar", "cassonade", "sucre roux"],
    amount: "1 cup, packed",
    with: ["1 cup granulated sugar + 1 tbsp molasses (2 tbsp for dark brown sugar)"],
  },
  {
    id: "powdered-sugar",
    name: "Powdered sugar",
    fr: "Sucre glace",
    keywords: ["powdered sugar", "icing sugar", "confectioners sugar", "sucre glace"],
    amount: "1 cup",
    with: ["1 cup granulated sugar + 1 tbsp cornstarch, blended to a fine powder"],
  },
  {
    id: "sour-cream",
    name: "Sour cream",
    fr: "Crème aigre",
    keywords: ["sour cream", "crème aigre", "crème fraîche"],
    amount: "1 cup",
    with: ["1 cup plain Greek yogurt", "1 cup crème fraîche"],
  },
  {
    id: "heavy-cream",
    name: "Heavy cream (for cooking)",
    fr: "Crème liquide (en cuisine)",
    keywords: ["heavy cream", "cream", "double cream", "crème", "crème liquide"],
    amount: "1 cup",
    with: ["¾ cup milk + ¼ cup melted butter (won't whip)", "1 cup evaporated milk"],
  },
  {
    id: "butter",
    name: "Butter (in baking)",
    fr: "Beurre (en pâtisserie)",
    keywords: ["butter", "beurre"],
    amount: "1 cup (227 g)",
    with: ["¾ cup + 1 tbsp (about 190 g) vegetable oil, for cakes and muffins", "1 cup coconut oil"],
    note: "Oil makes moist cakes but not flaky pastry or creamed cookies",
  },
  {
    id: "milk",
    name: "Milk",
    fr: "Lait",
    keywords: ["milk", "lait"],
    amount: "1 cup",
    with: ["½ cup evaporated milk + ½ cup water", "1 cup soy, oat or almond milk", "¼ cup milk powder + 1 cup water"],
  },
  {
    id: "lemon-juice",
    name: "Lemon juice",
    fr: "Jus de citron",
    keywords: ["lemon juice", "lemon", "citron", "jus de citron"],
    amount: "1 tsp",
    with: ["½ tsp white or cider vinegar", "1 tsp lime juice"],
  },
  {
    id: "wine",
    name: "Wine (in cooking)",
    fr: "Vin (en cuisine)",
    keywords: ["wine", "white wine", "red wine", "vin", "vin blanc", "vin rouge"],
    amount: "1 cup",
    with: ["1 cup broth + 1 tbsp vinegar (white or red to match)", "1 cup grape juice + 1 tbsp vinegar, in sauces"],
  },
  {
    id: "fresh-herbs",
    name: "Fresh herbs",
    fr: "Herbes fraîches",
    keywords: ["fresh herbs", "herbs", "herbes", "herbes fraîches"],
    amount: "1 tbsp chopped",
    with: ["1 tsp dried herbs, added earlier in the cooking"],
  },
  {
    id: "garlic",
    name: "Garlic clove",
    fr: "Gousse d'ail",
    keywords: ["garlic", "garlic clove", "ail", "gousse d'ail"],
    amount: "1 clove",
    with: ["⅛ tsp garlic powder", "½ tsp jarred minced garlic"],
  },
  {
    id: "honey",
    name: "Honey",
    fr: "Miel",
    keywords: ["honey", "miel"],
    amount: "1 cup",
    with: ["1 ¼ cups sugar + ¼ cup water or another liquid of the recipe", "1 cup maple syrup"],
  },
  {
    id: "corn-syrup",
    name: "Corn syrup",
    fr: "Sirop de maïs",
    keywords: ["corn syrup", "glucose", "sirop de glucose"],
    amount: "1 cup",
    with: ["1 cup sugar + ¼ cup water, simmered until dissolved", "1 cup golden syrup"],
  },
  {
    id: "cornstarch",
    name: "Cornstarch (to thicken)",
    fr: "Fécule de maïs (pour épaissir)",
    keywords: ["cornstarch", "cornflour", "maïzena", "maizena", "fécule"],
    amount: "1 tbsp",
    with: ["2 tbsp all-purpose flour (cook a little longer)", "1 tbsp potato starch or arrowroot"],
  },
  {
    id: "yeast",
    name: "Yeast",
    fr: "Levure de boulanger",
    keywords: ["yeast", "fresh yeast", "levure de boulanger", "levure fraîche"],
    amount: "1 packet (7 g, 2 ¼ tsp) instant or active dry yeast",
    with: [
      "21 g fresh yeast (3 times the weight)",
      "the same amount of active dry yeast, dissolved first in warm water",
    ],
  },
  {
    id: "chocolate",
    name: "Unsweetened chocolate",
    fr: "Chocolat noir non sucré",
    keywords: ["unsweetened chocolate", "baking chocolate", "chocolat", "chocolat noir"],
    amount: "30 g (1 oz)",
    with: ["3 tbsp cocoa powder + 1 tbsp butter or oil"],
  },
];
