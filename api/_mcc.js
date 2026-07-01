// MCC (Merchant Category Code) → категорія нашого застосунку.
// Не всі 500+ MCC — тільки типові. Що не розпізналось → 'Інше'.

const MCC_MAP = {
  // ── Продукти ──────────────────────────────────────
  5411: 'Продукти', // Grocery stores, supermarkets
  5422: 'Продукти', // Freezer / meat lockers
  5441: 'Продукти', // Candy / nut / confectionery
  5451: 'Продукти', // Dairy products
  5462: 'Продукти', // Bakeries
  5499: 'Продукти', // Misc food stores (convenience)

  // ── Ресторани / кафе ─────────────────────────────
  5811: 'Ресторани', // Catering services
  5812: 'Ресторани', // Restaurants
  5813: 'Ресторани', // Bars, cocktail lounges
  5814: 'Ресторани', // Fast food

  // ── Транспорт ────────────────────────────────────
  4111: 'Транспорт', // Local passenger transport
  4121: 'Транспорт', // Taxi (Uber, Bolt, Uklon)
  4131: 'Транспорт', // Bus lines
  4511: 'Транспорт', // Airlines
  4784: 'Транспорт', // Tolls / bridge fees
  5541: 'Транспорт', // Gas stations (fuel)
  5542: 'Транспорт', // Automated fuel dispensers
  7523: 'Транспорт', // Parking lots
  7538: 'Транспорт', // Auto service shops
  7549: 'Транспорт', // Towing services

  // ── Комунальні ───────────────────────────────────
  4900: 'Комунальні', // Utilities (electric, gas, water)
  4814: 'Комунальні', // Telecom services (мобільний)
  4815: 'Комунальні', // Long distance telecom
  4816: 'Комунальні', // Computer network services (інтернет)
  4899: 'Комунальні', // Cable / satellite / TV

  // ── Здоров'я ─────────────────────────────────────
  5122: "Здоров'я", // Drugs, druggists (аптека)
  5912: "Здоров'я", // Drug stores
  5975: "Здоров'я", // Hearing aids
  5976: "Здоров'я", // Orthopedic goods
  8011: "Здоров'я", // Doctors
  8021: "Здоров'я", // Dentists
  8031: "Здоров'я", // Osteopaths
  8041: "Здоров'я", // Chiropractors
  8042: "Здоров'я", // Optometrists
  8043: "Здоров'я", // Opticians / eyeglasses
  8049: "Здоров'я", // Podiatrists
  8050: "Здоров'я", // Nursing
  8062: "Здоров'я", // Hospitals
  8071: "Здоров'я", // Medical labs
  8099: "Здоров'я", // Medical services

  // ── Одяг ─────────────────────────────────────────
  5611: 'Одяг', // Men's clothing
  5621: 'Одяг', // Women's ready-to-wear
  5631: 'Одяг', // Women's accessory / specialty
  5641: 'Одяг', // Children's / infants' wear
  5651: 'Одяг', // Family clothing
  5661: 'Одяг', // Shoe stores
  5691: 'Одяг', // Men/women clothing
  5697: 'Одяг', // Tailors, alterations
  5698: 'Одяг', // Wig / toupee stores
  5699: 'Одяг', // Misc apparel

  // ── Розваги ──────────────────────────────────────
  5813: 'Розваги', // Bars (overlap з ресторани — залишаємо як розваги)
  7832: 'Розваги', // Cinemas
  7911: 'Розваги', // Dance halls
  7922: 'Розваги', // Theatrical producers
  7929: 'Розваги', // Bands / orchestras
  7932: 'Розваги', // Billiard / pool
  7933: 'Розваги', // Bowling
  7941: 'Розваги', // Sports clubs
  7991: 'Розваги', // Tourist attractions
  7992: 'Розваги', // Golf courses
  7994: 'Розваги', // Video game arcades
  7996: 'Розваги', // Amusement parks
  7997: 'Розваги', // Membership clubs
  7998: 'Розваги', // Aquariums
  7999: 'Розваги', // Recreation services

  // ── Дім ──────────────────────────────────────────
  5200: 'Дім', // Home supply warehouse
  5211: 'Дім', // Lumber / building materials
  5231: 'Дім', // Glass / paint / wallpaper
  5251: 'Дім', // Hardware stores
  5261: 'Дім', // Nurseries / lawn / garden
  5712: 'Дім', // Furniture
  5713: 'Дім', // Floor coverings
  5714: 'Дім', // Drapery, upholstery
  5718: 'Дім', // Fireplace
  5719: 'Дім', // Misc home furnishing
  5722: 'Дім', // Household appliances
  5732: 'Дім', // Electronics stores
  5733: 'Дім', // Music stores (instruments)
  5734: 'Дім', // Computer software stores
  5735: 'Дім', // Record stores

  // ── Дитячі ───────────────────────────────────────
  5641: 'Дитячі', // (перекриваємо Одяг для дитячого)
  5945: 'Дитячі', // Hobby / toy / game shops
  8211: 'Дитячі', // Elementary / secondary schools
  8299: 'Дитячі', // Schools / educational services

  // ── Інше типове ──────────────────────────────────
  6011: 'Інше', // ATM withdrawal (готівка)
  6012: 'Інше', // Financial institutions
  4829: 'Інше', // Money transfer
};

export function mccToCategory(mcc, type = 'expense') {
  if (type === 'income') return 'Інше'; // для доходу категорію не вгадуємо
  if (!mcc) return 'Інше';
  return MCC_MAP[Number(mcc)] || 'Інше';
}
