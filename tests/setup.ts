import "dotenv/config";

// Las pruebas nunca deben depender de un servicio de IA real (lento, pago, y
// no determinista) — los casos que la usan ya están diseñados para que el
// desempate/sugerencia con IA falle rápido y limpio (judgeWithAI/
// guessIngredientWithAI devuelven null/[] cuando no hay clave configurada),
// exactamente igual que un desarrollador sin CLAUDE_API_KEY en su .env.
delete process.env.CLAUDE_API_KEY;
delete process.env.OPENAI_API_KEY;
